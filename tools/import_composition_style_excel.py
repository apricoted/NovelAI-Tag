# -*- coding: utf-8 -*-
"""
Import the composition/style prompt workbook into site/data.

The source workbook stores prompt text in alternating columns and floating
images anchored in the column immediately to the right. Images do not carry
recoverable generation metadata, so the import relies on the sheet geometry.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import import_artist_excel_strings as base


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "site" / "data"
IMAGE_DIR = ROOT / "site" / "images"
ORIGINAL_DIR = ROOT / "originals"
OUTPUT_DIR = ROOT / "output"

TITLE_OVERRIDES = [
    "运河小船上的静谧时刻",
    "九份夜巷里的热汤回眸",
    "新年市集里的糖果笑脸",
    "台式夜市游戏摊前",
    "平溪铁轨旁写天灯",
    "便利店夏夜吃冰棒",
    "秋夜露天电影节回眸",
    "云海新月上的钓星少女",
    "海边露台的月夜舞步",
    "书店木架旁整理书册",
    "枫林里仰光微笑",
    "花店工作台前修剪玫瑰",
    "黄昏大学天台眺望城市",
    "公寓阳台吹晚风",
    "秋林溪边俯身触水",
    "夕阳河桥上的回眸",
    "冬日客厅沙发阅读",
    "山间小站与复古红车",
    "明亮咖啡馆靠窗独坐",
    "夜樱灯下仰望",
    "日式房间里的插花练习",
    "暴雨公交亭里的独处",
    "雨天窗上画心",
    "雨后寺院撑伞漫步",
    "老天文台前窥望星空",
    "金色屋顶上的吉他",
    "阳光画室里的成品审视",
    "时间静止房间里的惊奇",
    "清晨花市挑选盆栽",
    "春日草坪吹蒲公英",
    "雨后山径与指尖蝴蝶",
    "黄昏屋顶花园浇花",
    "雷雨后捷运站台小憩",
    "台式夜市里的珍珠奶茶回眸",
    "日落海边咖啡馆发呆",
    "盛夏老街折扇遮阳",
    "秋日山路徒步回望",
    "秋日校园咖啡馆沉思",
    "台北河滨骑行",
    "塞纳河旧书摊选书",
    "中央公园暮色滑冰",
    "祇园祭宵山人群回眸",
    "平溪天灯节放灯后仰望",
    "中秋苏州园林提灯",
    "沙发上亲密共享耳机",
    "夜市饰品摊前的双人挑选",
    "明亮厨房里的双人蛋糕课",
    "淡水码头日落背影",
    "阳明山海芋田捧花",
    "山间茶屋品春茶",
    "红砖老巷里仰望繁花",
    "春日草坪上的耳机午后",
    "盛夏缘侧纳凉",
    "澎湖海岸公路骑车回眸",
    "西湖石桥油纸伞清晨",
    "日本乡间夏夜萤火",
    "秋日岚山竹林沉思",
    "北京银杏大道拍胶片",
    "山间木屋夜里捧热饮",
    "奈良公园喂小鹿",
    "札幌雪祭仰望雪雕",
    "乌来冬夜露天温泉",
    "雪后胡同里的糖葫芦",
    "白川乡雪夜观景台",
]


@dataclass
class StyleRow:
    sheet: str
    row: int
    text_col: int
    image_col: int
    text: str
    media: str


def clean_prompt(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def title_from_prompt(text: str, index: int) -> str:
    text = clean_prompt(text)
    first_clause = text.split(",", 1)[0].strip()
    title = first_clause if len(first_clause) >= 12 else text[:72].strip()
    if not title:
        title = f"构图风格 {index:03d}"
    if len(title) > 80:
        title = title[:77].rstrip() + "..."
    return title


def parse_workbook(path: Path) -> tuple[list[StyleRow], dict[str, object]]:
    rows: list[StyleRow] = []
    stats: dict[str, object] = {
        "source": str(path),
        "sheets": [],
        "imageAnchors": 0,
        "assignedImages": 0,
        "unassignedImages": 0,
        "textCells": 0,
        "textCellsWithoutImage": 0,
        "missingMedia": 0,
    }
    with zipfile.ZipFile(path) as zf:
        shared = base.load_shared_strings(zf)
        for sheet_name, sheet_part in base.workbook_sheets(zf):
            cells = {key: clean_prompt(value) for key, value in base.read_cells(zf, sheet_part, shared).items()}
            text_cells = {
                key: value
                for key, value in cells.items()
                if value and "DISPIMG(" not in value
            }
            drawing_part = base.drawing_part_for_sheet(zf, sheet_part)
            image_refs = base.read_images(zf, drawing_part) if drawing_part else []
            assigned_text_keys: set[tuple[int, int]] = set()
            sheet_rows: list[StyleRow] = []
            unassigned = []
            missing_media = []

            for img in sorted(image_refs, key=lambda item: (item.row, item.col, item.media)):
                resolved = base.resolve_media_name(zf, img.media)
                if not resolved:
                    missing_media.append({"row": img.row, "col": img.col, "media": img.media})
                    continue
                text_key = (img.row, img.col - 1)
                text = text_cells.get(text_key, "")
                if not text:
                    # Very small fallback for odd anchors: scan left on the same row.
                    for col in range(img.col - 1, 0, -1):
                        if text_cells.get((img.row, col)):
                            text_key = (img.row, col)
                            text = text_cells[text_key]
                            break
                if not text:
                    unassigned.append({"row": img.row, "col": img.col, "media": img.media})
                    continue
                assigned_text_keys.add(text_key)
                sheet_rows.append(StyleRow(
                    sheet=sheet_name,
                    row=img.row,
                    text_col=text_key[1],
                    image_col=img.col,
                    text=text,
                    media=img.media,
                ))

            text_without_image = sorted(
                {"row": row, "col": col, "text": text[:120]}
                for (row, col), text in text_cells.items()
                if (row, col) not in assigned_text_keys
            )
            rows.extend(sheet_rows)
            stats["imageAnchors"] = int(stats["imageAnchors"]) + len(image_refs)
            stats["assignedImages"] = int(stats["assignedImages"]) + len(sheet_rows)
            stats["unassignedImages"] = int(stats["unassignedImages"]) + len(unassigned)
            stats["textCells"] = int(stats["textCells"]) + len(text_cells)
            stats["textCellsWithoutImage"] = int(stats["textCellsWithoutImage"]) + len(text_without_image)
            stats["missingMedia"] = int(stats["missingMedia"]) + len(missing_media)
            stats["sheets"].append({
                "name": sheet_name,
                "textCells": len(text_cells),
                "imageAnchors": len(image_refs),
                "assignedImages": len(sheet_rows),
                "unassignedImages": len(unassigned),
                "missingMedia": len(missing_media),
                "textCellsWithoutImage": len(text_without_image),
                "imageAnchorColumns": dict(Counter(img.col for img in image_refs)),
                "textColumns": dict(Counter(col for _, col in text_cells)),
                "firstRows": [
                    {
                        "row": item.row,
                        "textCol": item.text_col,
                        "imageCol": item.image_col,
                        "media": item.media,
                        "text": item.text[:120],
                    }
                    for item in sheet_rows[:12]
                ],
                "unassignedSamples": unassigned[:12],
                "textWithoutImageSamples": text_without_image[:12],
            })
    return rows, stats


def make_entries(rows: list[StyleRow], codex_id: str, category: str) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for i, row in enumerate(rows, start=1):
        title = TITLE_OVERRIDES[i - 1] if i <= len(TITLE_OVERRIDES) else title_from_prompt(row.text, i)
        entries.append({
            "title": title,
            "path": [category],
            "tags": row.text,
            "isNew": False,
            "id": f"{codex_id}_{i:04d}",
            "_source": {
                "sheet": row.sheet,
                "row": row.row,
                "textCol": row.text_col,
                "imageCol": row.image_col,
                "media": row.media,
            },
        })
    return entries


def write_images(path: Path, codex_id: str, entries: list[dict[str, object]]) -> int:
    site_image_dir = IMAGE_DIR / codex_id
    original_dir = ORIGINAL_DIR / codex_id
    if site_image_dir.exists():
        shutil.rmtree(site_image_dir)
    if original_dir.exists():
        shutil.rmtree(original_dir)
    written = 0
    with zipfile.ZipFile(path) as zf:
        for entry in entries:
            source = entry["_source"]
            asset = base.save_one_image(zf, source["media"], entry["id"], site_image_dir, original_dir)
            entry["image"] = asset["path"]
            entry["imageWidth"] = asset["width"]
            entry["imageHeight"] = asset["height"]
            entry["original"] = asset["original"]
            entry["images"] = [{"path": asset["path"], "original": asset["original"]}]
            entry["assetRev"] = base.asset_rev([asset["thumbPath"], asset["originalPath"]])
            written += 1
    for entry in entries:
        entry.pop("_source", None)
    return written


def build_tree(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    return base.build_tree(entries)


def make_codex(args: argparse.Namespace, entries: list[dict[str, object]]) -> dict[str, object]:
    public_entries = [{k: v for k, v in entry.items() if k != "_source"} for entry in entries]
    return {
        "id": args.codex_id,
        "type": "string",
        "title": args.title,
        "version": args.version,
        "author": args.author,
        "entryCount": len(public_entries),
        "imagedCount": sum(1 for item in public_entries if item.get("image") or item.get("images")),
        "hasOriginal": False,
        "selectorTitle": args.selector_title,
        "source": args.source_label,
        "contributors": [{"name": args.author, "role": "词条整理 / 配图数据提供"}],
        "tree": build_tree(public_entries),
        "entries": public_entries,
    }


def write_json(path: Path, payload: object, compact: bool = False) -> None:
    text = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":") if compact else None,
        indent=None if compact else 2,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")


def update_index(codex: dict[str, object]) -> None:
    index_path = DATA_DIR / "codexes.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    meta_keys = [
        "id", "type", "title", "version", "author", "entryCount",
        "imagedCount", "hasOriginal", "selectorTitle", "source", "contributors",
    ]
    meta = {key: codex[key] for key in meta_keys if key in codex}
    for i, item in enumerate(index):
        if item.get("id") == codex["id"]:
            index[i] = {**item, **meta}
            write_json(index_path, index)
            return
    insert_at = len(index)
    for i, item in enumerate(index):
        if item.get("id") == "artist_45_collection":
            insert_at = i + 1
            break
    index.insert(insert_at, meta)
    write_json(index_path, index)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, default=Path(r"D:\program\comful\构图风格.xlsx"))
    ap.add_argument("--codex-id", default="composition_style")
    ap.add_argument("--title", default="构图风格")
    ap.add_argument("--version", default="2025.10.19")
    ap.add_argument("--author", default="未署名")
    ap.add_argument("--selector-title", default="构图风格(场景串)")
    ap.add_argument("--source-label", default="构图风格.xlsx")
    ap.add_argument("--category", default="构图风格")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()

    if not args.source.exists():
        raise SystemExit(f"missing source: {args.source}")
    target_json = DATA_DIR / f"{args.codex_id}.json"
    if args.apply and target_json.exists() and not args.overwrite:
        raise SystemExit(f"target exists; pass --overwrite to replace: {target_json}")

    rows, stats = parse_workbook(args.source)
    entries = make_entries(rows, args.codex_id, args.category)
    written_images = 0
    if args.apply:
        written_images = write_images(args.source, args.codex_id, entries)
        codex = make_codex(args, entries)
        write_json(target_json, codex, compact=True)
        update_index(codex)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_dir = OUTPUT_DIR / f"{args.codex_id}_import_{stamp}"
    report = {
        "apply": bool(args.apply),
        "source": str(args.source),
        "codexId": args.codex_id,
        "title": args.title,
        "version": args.version,
        "author": args.author,
        "stats": stats,
        "entryCount": len(entries),
        "imagedEntries": len(entries),
        "imageCount": len(entries),
        "writtenImages": written_images,
        "entrySamples": [
            {
                "id": entry["id"],
                "title": entry["title"],
                "tags": entry["tags"][:160],
                "source": entry.get("_source", {}),
            }
            for entry in entries[:20]
        ],
    }
    write_json(report_dir / "report.json", report)
    summary = {
        "apply": bool(args.apply),
        "codexId": args.codex_id,
        "entries": len(entries),
        "imagedEntries": len(entries),
        "images": len(entries),
        "writtenImages": written_images,
        "stats": stats,
        "report": str(report_dir / "report.json"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
