# -*- coding: utf-8 -*-
"""
Import a WPS DISPIMG-based artist string workbook into site/data.

Default mode is a dry run. It maps =DISPIMG("ID...", 1) formulas through
xl/cellimages.xml, keeps multiple images per artist row, and can verify image
metadata against the artist tag before writing.
"""
from __future__ import annotations

import argparse
import json
import posixpath
import re
import shutil
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

import import_artist_excel_strings as base


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "site" / "data"
IMAGE_DIR = ROOT / "site" / "images"
ORIGINAL_DIR = ROOT / "originals"
OUTPUT_DIR = ROOT / "output"

NS = {
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "etc": "http://www.wps.cn/officeDocument/2017/etCustomData",
}
REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


@dataclass
class WpsImage:
    row: int
    col: int
    image_id: str
    media: str
    label: str = ""


@dataclass
class ArtistRow:
    row: int
    title: str
    tags: str
    images: list[WpsImage] = field(default_factory=list)
    missing_image_ids: list[str] = field(default_factory=list)


def extract_dispimg_ids(text: str) -> list[str]:
    out: list[str] = []
    marker = 'DISPIMG("'
    start = 0
    while marker in (text or "")[start:]:
        a = text.find(marker, start) + len(marker)
        b = text.find('"', a)
        if b < 0:
            break
        out.append(text[a:b])
        start = b + 1
    return out


def read_cellimage_map(zf: zipfile.ZipFile) -> dict[str, str]:
    if "xl/cellimages.xml" not in zf.NameToInfo:
        return {}
    rels: dict[str, str] = {}
    rels_path = "xl/_rels/cellimages.xml.rels"
    if rels_path in zf.NameToInfo:
        root = ET.fromstring(zf.read(rels_path))
        for rel in root.findall(f"{REL_NS}Relationship"):
            rid = rel.attrib.get("Id")
            target = rel.attrib.get("Target", "")
            if rid and target:
                rels[rid] = target

    id_to_media: dict[str, str] = {}
    root = ET.fromstring(zf.read("xl/cellimages.xml"))
    for item in root.findall("etc:cellImage", NS):
        cnv = item.find(".//xdr:cNvPr", NS)
        blip = item.find(".//a:blip", NS)
        if cnv is None or blip is None:
            continue
        image_id = cnv.attrib.get("name")
        rid = blip.attrib.get("{%s}embed" % NS["r"])
        target = rels.get(rid or "", "")
        if not image_id or not target:
            continue
        id_to_media[image_id] = posixpath.normpath(posixpath.join("xl", target))
    return id_to_media


def parse_workbook(path: Path) -> tuple[list[ArtistRow], dict[str, object]]:
    stats: dict[str, object] = {
        "source": str(path),
        "sheets": [],
        "entries": 0,
        "images": 0,
        "missingImageIds": 0,
        "missingMedia": 0,
    }
    rows: list[ArtistRow] = []
    with zipfile.ZipFile(path) as zf:
        id_to_media = read_cellimage_map(zf)
        shared = base.load_shared_strings(zf)
        for sheet_name, sheet_part in base.workbook_sheets(zf):
            if sheet_name.startswith("WpsReserved"):
                continue
            cells = base.read_cells(zf, sheet_part, shared)
            sheet_rows: list[ArtistRow] = []
            for (row, col), text in sorted(cells.items()):
                if col != 1 or not base.looks_like_artist_tags(text):
                    continue
                keys = base.extract_artist_keys(text)
                if not keys:
                    continue
                artist = ArtistRow(row=row, title=keys[0], tags=base.normalize_artist_prefix(text).strip())
                for img_col in sorted(c for (r, c) in cells if r == row and c > 1):
                    for image_id in extract_dispimg_ids(cells.get((row, img_col), "")):
                        media = id_to_media.get(image_id, "")
                        label = cells.get((2, img_col), "")
                        if not media:
                            artist.missing_image_ids.append(image_id)
                            continue
                        if media not in zf.NameToInfo:
                            artist.missing_image_ids.append(image_id)
                            stats["missingMedia"] = int(stats["missingMedia"]) + 1
                            continue
                        artist.images.append(WpsImage(row=row, col=img_col, image_id=image_id, media=media, label=label))
                sheet_rows.append(artist)
            rows.extend(sheet_rows)
            stats["sheets"].append({
                "name": sheet_name,
                "entries": len(sheet_rows),
                "images": sum(len(r.images) for r in sheet_rows),
                "missingImageIds": sum(len(r.missing_image_ids) for r in sheet_rows),
                "imageCountDistribution": dict(Counter(len(r.images) for r in sheet_rows)),
                "firstRows": [
                    {
                        "row": r.row,
                        "title": r.title,
                        "tags": r.tags,
                        "images": len(r.images),
                        "missingImageIds": r.missing_image_ids[:3],
                    }
                    for r in sheet_rows[:20]
                ],
            })
    stats["entries"] = len(rows)
    stats["images"] = sum(len(r.images) for r in rows)
    stats["missingImageIds"] = sum(len(r.missing_image_ids) for r in rows)
    stats["imageCountDistribution"] = dict(Counter(len(r.images) for r in rows))
    return rows, stats


def verify_images(path: Path, rows: list[ArtistRow], sample_limit: int = 0) -> dict[str, object]:
    stats = Counter()
    samples: dict[str, list[dict[str, object]]] = defaultdict(list)
    checked = 0
    by_key = {base.primary_key(r.tags): r for r in rows if base.primary_key(r.tags)}
    with zipfile.ZipFile(path) as zf:
        for row in rows:
            keys = [base.norm_title(key) for key in base.extract_artist_keys(row.tags)]
            for img in row.images:
                if sample_limit and checked >= sample_limit:
                    stats["sampleLimitReached"] = 1
                    return {"stats": dict(stats), "samples": samples}
                raw = zf.read(img.media)
                prompt, source = base.prompt_from_image_bytes(raw)
                checked += 1
                stats["checked"] += 1
                stats[f"source:{source}"] += 1
                if not prompt:
                    stats["noPrompt"] += 1
                    add_sample(samples["noPrompt"], row, img, source)
                    continue
                prompt_keys = base.extract_prompt_artist_keys(prompt)
                if prompt_keys:
                    hits = [key for key in prompt_keys if key in by_key]
                    if len(hits) == 1 and hits[0] not in keys:
                        stats["mismatched"] += 1
                        item = add_sample(samples["mismatched"], row, img, source)
                        if item is not None:
                            item["promptKeys"] = prompt_keys[:5]
                            item["promptSample"] = prompt[:220]
                        continue
                if any(base.tag_matches_prompt(key, prompt) for key in keys):
                    stats["matched"] += 1
                elif not prompt_keys:
                    stats["noArtistInPrompt"] += 1
                    add_sample(samples["noArtistInPrompt"], row, img, source)
                else:
                    stats["mismatched"] += 1
                    item = add_sample(samples["mismatched"], row, img, source)
                    if item is not None:
                        item["promptKeys"] = prompt_keys[:5]
                        item["promptSample"] = prompt[:220]
    return {"stats": dict(stats), "samples": samples}


def filter_mismatched_images(path: Path, rows: list[ArtistRow]) -> dict[str, object]:
    stats = Counter()
    samples: list[dict[str, object]] = []
    by_key = {base.primary_key(row.tags): row for row in rows if base.primary_key(row.tags)}
    mismatches: list[dict[str, object]] = []
    with zipfile.ZipFile(path) as zf:
        for row in rows:
            current_keys = [base.norm_title(key) for key in base.extract_artist_keys(row.tags)]
            kept: list[WpsImage] = []
            for img in row.images:
                raw = zf.read(img.media)
                prompt, source = base.prompt_from_image_bytes(raw)
                if not prompt:
                    kept.append(img)
                    stats["keptNoPrompt"] += 1
                    continue
                prompt_keys = base.extract_prompt_artist_keys(prompt)
                should_drop = False
                target_key = ""
                if prompt_keys:
                    candidate_hits = [key for key in prompt_keys if key in by_key]
                    if any(key in current_keys for key in prompt_keys):
                        should_drop = False
                    elif candidate_hits or not any(base.tag_matches_prompt(key, prompt) for key in current_keys):
                        should_drop = True
                        unique_hits = sorted(set(candidate_hits))
                        if len(unique_hits) == 1:
                            target_key = unique_hits[0]
                if should_drop:
                    mismatches.append({
                        "row": row,
                        "img": img,
                        "source": source,
                        "promptKeys": prompt_keys,
                        "promptSample": prompt[:220],
                        "targetKey": target_key,
                    })
                else:
                    kept.append(img)
            row.images = kept
    for item in mismatches:
        row = item["row"]
        img = item["img"]
        target_key = str(item.get("targetKey") or "")
        target_row = by_key.get(target_key) if target_key else None
        action = "dropped"
        if target_row is not None and target_row is not row and not target_row.images:
            target_row.images.append(img)
            action = "reassigned"
            stats["reassignedMismatched"] += 1
        else:
            stats["droppedMismatched"] += 1
            if target_row is row:
                stats["dropSelfTarget"] += 1
            elif target_row is not None and target_row.images:
                stats["dropTargetHasImage"] += 1
            elif not target_key:
                stats["dropNoUniqueTarget"] += 1
            else:
                stats["dropMissingTarget"] += 1
        if len(samples) < 100:
            sample = {
                "row": row.row,
                "title": row.title,
                "tags": row.tags,
                "imageCol": img.col,
                "label": img.label,
                "media": img.media,
                "source": item["source"],
                "promptKeys": item["promptKeys"][:8],
                "promptSample": item["promptSample"],
                "action": action,
            }
            if target_row is not None:
                sample["targetRow"] = target_row.row
                sample["targetTitle"] = target_row.title
                sample["targetTags"] = target_row.tags
            samples.append(sample)
    return {"stats": dict(stats), "samples": samples}


def add_sample(bucket: list[dict[str, object]], row: ArtistRow, img: WpsImage, source: str) -> dict[str, object] | None:
    if len(bucket) >= 50:
        return None
    item = {
        "row": row.row,
        "title": row.title,
        "tags": row.tags,
        "imageCol": img.col,
        "label": img.label,
        "media": img.media,
        "source": source,
    }
    bucket.append(item)
    return item


def build_tree(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    return base.build_tree(entries)


def make_entries(rows: list[ArtistRow], codex_id: str, category: str) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for i, row in enumerate(rows, start=1):
        entries.append({
            "title": row.title,
            "path": [category],
            "tags": row.tags,
            "isNew": False,
            "id": f"{codex_id}_{i:04d}",
            "_source": {
                "row": row.row,
                "media": [{"col": img.col, "media": img.media, "label": img.label} for img in row.images],
                "missingImageIds": row.missing_image_ids,
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
            assets = []
            for i, item in enumerate(entry["_source"]["media"], start=1):
                suffix = "" if i == 1 else f"-{i:02d}"
                asset = base.save_one_image(zf, item["media"], entry["id"] + suffix, site_image_dir, original_dir)
                if item.get("label"):
                    asset["label"] = item["label"]
                assets.append(asset)
            if not assets:
                continue
            primary = assets[0]
            entry["image"] = primary["path"]
            entry["imageWidth"] = primary["width"]
            entry["imageHeight"] = primary["height"]
            entry["original"] = primary["original"]
            entry["images"] = [
                {
                    "path": asset["path"],
                    "original": asset["original"],
                    **({"label": asset["label"]} if asset.get("label") else {}),
                }
                for asset in assets
            ]
            entry["assetRev"] = base.asset_rev([p for asset in assets for p in (asset["thumbPath"], asset["originalPath"])])
            written += len(assets)
    for entry in entries:
        entry.pop("_source", None)
    return written


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
        "imagedCount", "hasOriginal", "source", "contributors",
    ]
    meta = {key: codex[key] for key in meta_keys if key in codex}
    found = False
    for i, item in enumerate(index):
        if item.get("id") == codex["id"]:
            index[i] = {**item, **meta}
            found = True
            break
    if not found:
        insert_at = len(index)
        for i, item in enumerate(index):
            if item.get("id") == "artist_nai45_personal":
                insert_at = i + 1
                break
        index.insert(insert_at, meta)
    write_json(index_path, index)


def make_codex(args: argparse.Namespace, entries: list[dict[str, object]]) -> dict[str, object]:
    public_entries = [{k: v for k, v in entry.items() if k != "_source"} for entry in entries]
    return {
        "id": args.codex_id,
        "type": "string",
        "title": args.title,
        "version": args.version,
        "author": args.author,
        "entryCount": len(public_entries),
        "imagedCount": sum(1 for e in public_entries if e.get("image") or e.get("images")),
        "hasOriginal": True,
        "source": args.source_label,
        "contributors": [{"name": args.author, "role": "词条整理 / 配图数据提供"}],
        "tree": build_tree(public_entries),
        "entries": public_entries,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, default=Path(r"D:\program\comful\4.5画师收录.xlsx"))
    ap.add_argument("--codex-id", default="artist_45_collection")
    ap.add_argument("--title", default="4.5画师收录")
    ap.add_argument("--version", default="2026.4.18")
    ap.add_argument("--author", default="兔")
    ap.add_argument("--source-label", default="兔 · 4.5画师收录")
    ap.add_argument("--category", default="4.5画师收录")
    ap.add_argument("--verify-metadata", action="store_true")
    ap.add_argument("--verify-sample-limit", type=int, default=0)
    ap.add_argument("--keep-mismatched", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()

    if not args.source.exists():
        raise SystemExit(f"missing source: {args.source}")
    target_json = DATA_DIR / f"{args.codex_id}.json"
    if args.apply and target_json.exists() and not args.overwrite:
        raise SystemExit(f"target exists; pass --overwrite to replace: {target_json}")

    rows, stats = parse_workbook(args.source)
    filtered = {"stats": {}, "samples": []}
    if not args.keep_mismatched:
        filtered = filter_mismatched_images(args.source, rows)
    entries = make_entries(rows, args.codex_id, args.category)
    verification = {"stats": {}, "samples": {}}
    if args.verify_metadata:
        verification = verify_images(args.source, rows, args.verify_sample_limit)

    written_images = 0
    if args.apply:
        written_images = write_images(args.source, args.codex_id, entries)
        codex = make_codex(args, entries)
        write_json(target_json, codex, compact=True)
        update_index(codex)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_dir = OUTPUT_DIR / f"{args.codex_id}_wps_import_{stamp}"
    report = {
        "apply": bool(args.apply),
        "source": str(args.source),
        "codexId": args.codex_id,
        "title": args.title,
        "version": args.version,
        "author": args.author,
        "stats": stats,
        "filtered": filtered,
        "entryCount": len(entries),
        "imagedEntries": sum(1 for row in rows if row.images),
        "imageCount": sum(len(row.images) for row in rows),
        "multiImageEntries": sum(1 for row in rows if len(row.images) > 1),
        "missingImageEntries": sum(1 for row in rows if not row.images),
        "writtenImages": written_images,
        "verification": verification,
        "missingImageSamples": [
            {"row": row.row, "title": row.title, "tags": row.tags, "missingImageIds": row.missing_image_ids}
            for row in rows if not row.images or row.missing_image_ids
        ][:100],
    }
    write_json(report_dir / "report.json", report)
    summary = {
        "apply": bool(args.apply),
        "codexId": args.codex_id,
        "entries": len(entries),
        "imagedEntries": report["imagedEntries"],
        "images": report["imageCount"],
        "multiImageEntries": report["multiImageEntries"],
        "missingImageEntries": report["missingImageEntries"],
        "missingImageIds": stats["missingImageIds"],
        "writtenImages": written_images,
        "verificationStats": verification["stats"],
        "report": str(report_dir / "report.json"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
