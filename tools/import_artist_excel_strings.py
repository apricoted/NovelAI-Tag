# -*- coding: utf-8 -*-
"""
Import a multi-volume Excel artist string collection into the main codex UI.

Default mode is a dry run. It parses workbook cells and floating image anchors,
reports whether volumes look independent or cumulative, and keeps multi-image
relationships. Use --apply to write JSON and local image caches.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import posixpath
import re
import shutil
import unicodedata
import zipfile
import zlib
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "site" / "data"
IMAGE_DIR = ROOT / "site" / "images"
ORIGINAL_DIR = ROOT / "originals"
OUTPUT_DIR = ROOT / "output"
MAXDIM = 1100

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "odr": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

INTRO_TITLE_RE = re.compile(r"(说明|例图|范例|目录|前言|注意|使用|更新|版本|声明|作者|来源)")
VOLUME_RE = re.compile(r"第[一二三四五六七八九十\d]+卷")
UPDATE_RE = re.compile(r"（([^）]+更新)）|\(([^)]+更新)\)")
ASCII_ARTIST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _'().+\-/!]{1,78}$")
GENERIC_PROMPT_TOKEN_RE = re.compile(
    r"^(1\s*girl|1girl|solo|beach|masterpiece|best quality|amazing quality|very aesthetic|"
    r"rating|year\s*\d+|newest|perfect|cinematic|no text|skinny)$",
    re.I,
)


@dataclass
class ImageRef:
    row: int
    col: int
    media: str


@dataclass
class Candidate:
    workbook: Path
    volume: str
    sheet: str
    title_row: int
    tag_row: int
    col: int
    title: str
    tags: str
    images: list[ImageRef] = field(default_factory=list)

    @property
    def key(self) -> tuple[str, str, int, int, str]:
        return (str(self.workbook), self.sheet, self.title_row, self.col, norm_tags(self.tags))


def clean_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = value.replace("\u3000", " ")
    return re.sub(r"[ \t\r\f\v]+", " ", value).strip()


def rels_path(part: str) -> str:
    p = Path(part)
    return str(p.parent / "_rels" / (p.name + ".rels")).replace("\\", "/")


def read_rels(zf: zipfile.ZipFile, part: str) -> dict[str, str]:
    rp = rels_path(part)
    out: dict[str, str] = {}
    if rp not in zf.namelist():
        return out
    root = ET.fromstring(zf.read(rp))
    for rel in root:
        rid = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        if rid and target:
            out[rid] = target
    return out


def norm_target(src_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(src_part), target))


def excel_col(ref: str) -> int:
    m = re.match(r"([A-Z]+)", ref)
    if not m:
        return 0
    n = 0
    for ch in m.group(1):
        n = n * 26 + ord(ch) - 64
    return n


def load_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    values: list[str] = []
    with zf.open("xl/sharedStrings.xml") as fh:
        for _, elem in ET.iterparse(fh, events=("end",)):
            if elem.tag.endswith("}si"):
                values.append("".join(t.text or "" for t in elem.iter() if t.tag.endswith("}t")))
                elem.clear()
    return values


def workbook_sheets(zf: zipfile.ZipFile) -> list[tuple[str, str]]:
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    wb_rels = read_rels(zf, "xl/workbook.xml")
    sheets: list[tuple[str, str]] = []
    for sheet in wb.findall(".//main:sheets/main:sheet", NS):
        rid = sheet.attrib["{%s}id" % NS["odr"]]
        sheets.append((sheet.attrib["name"], norm_target("xl/workbook.xml", wb_rels[rid])))
    return sheets


def cell_text(cell: ET.Element, shared: list[str]) -> str:
    typ = cell.attrib.get("t")
    if typ == "s":
        v = cell.find("main:v", NS)
        return shared[int(v.text)] if v is not None and v.text is not None else ""
    if typ == "inlineStr":
        return "".join(t.text or "" for t in cell.iter() if t.tag.endswith("}t"))
    v = cell.find("main:v", NS)
    return v.text if v is not None and v.text is not None else ""


def read_cells(zf: zipfile.ZipFile, sheet_part: str, shared: list[str]) -> dict[tuple[int, int], str]:
    cells: dict[tuple[int, int], str] = {}
    with zf.open(sheet_part) as fh:
        for _, row in ET.iterparse(fh, events=("end",)):
            if not row.tag.endswith("}row"):
                continue
            r = int(row.attrib.get("r", "0"))
            for cell in row:
                if not cell.tag.endswith("}c"):
                    continue
                ref = cell.attrib.get("r", "")
                c = excel_col(ref)
                if not r or not c:
                    continue
                text = clean_text(cell_text(cell, shared))
                if text:
                    cells[(r, c)] = text
            row.clear()
    return cells


def drawing_part_for_sheet(zf: zipfile.ZipFile, sheet_part: str) -> str | None:
    sheet_rels = read_rels(zf, sheet_part)
    with zf.open(sheet_part) as fh:
        for _, elem in ET.iterparse(fh, events=("end",)):
            if elem.tag.endswith("}drawing"):
                rid = elem.attrib["{%s}id" % NS["r"]]
                return norm_target(sheet_part, sheet_rels[rid])
            elem.clear()
    return None


def read_images(zf: zipfile.ZipFile, drawing_part: str) -> list[ImageRef]:
    drawing_rels = read_rels(zf, drawing_part)
    root = ET.fromstring(zf.read(drawing_part))
    out: list[ImageRef] = []
    for anchor in root:
        if not (anchor.tag.endswith("}oneCellAnchor") or anchor.tag.endswith("}twoCellAnchor")):
            continue
        start = anchor.find("xdr:from", NS)
        blip = anchor.find(".//a:blip", NS)
        if start is None or blip is None:
            continue
        rid = blip.attrib.get("{%s}embed" % NS["r"])
        if not rid:
            continue
        media = norm_target(drawing_part, drawing_rels[rid])
        out.append(ImageRef(
            row=int(start.find("xdr:row", NS).text) + 1,
            col=int(start.find("xdr:col", NS).text) + 1,
            media=media,
        ))
    return sorted(out, key=lambda x: (x.row, x.col, x.media))


def resolve_media_name(zf: zipfile.ZipFile, media: str) -> str:
    if media in zf.NameToInfo:
        return media
    basename = posixpath.basename(media)
    fallbacks = [
        posixpath.join("xl", "media", basename),
        media.replace("xl/drawings/media/", "xl/media/"),
    ]
    for candidate in fallbacks:
        if candidate in zf.NameToInfo:
            return candidate
    return ""


def volume_label(path: Path) -> str:
    name = path.stem
    volume_match = VOLUME_RE.search(name)
    update_match = UPDATE_RE.search(name)
    volume = volume_match.group(0) if volume_match else name
    update = next((g for g in (update_match.groups() if update_match else ()) if g), "")
    return f"{volume}（{update}）" if update else volume


def volume_sort_key(path: Path) -> tuple[int, str]:
    order = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    m = VOLUME_RE.search(path.stem)
    if not m:
        return (999, path.name)
    value = m.group(0).removeprefix("第").removesuffix("卷")
    return (int(value) if value.isdigit() else order.get(value, 999), path.name)


def extract_artist_keys(text: str) -> list[str]:
    text = normalize_artist_prefix(text)
    keys: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r"artist\s*:\s*([^,，;\n\r]+)", text or "", re.I):
        value = clean_text(match.group(1))
        value = value.strip().strip("[]{}")
        if not value:
            continue
        key = norm_title(value)
        if key and key not in seen:
            keys.append(value)
            seen.add(key)
    return keys


def normalize_artist_prefix(text: str) -> str:
    return re.sub(r"\batrist\s*:", "artist:", text or "", flags=re.I)


def looks_like_artist_tags(text: str) -> bool:
    text = clean_text(normalize_artist_prefix(text))
    if not text:
        return False
    if not re.search(r"\bartist\s*:", text, re.I):
        return False
    if INTRO_TITLE_RE.search(text) and len(extract_artist_keys(text)) == 0:
        return False
    return True


def looks_like_bare_artist_name(text: str, row: int) -> bool:
    text = clean_text(text)
    if row < 4:
        return False
    if not text or len(text) > 80:
        return False
    if re.search(r"[\u4e00-\u9fff]", text):
        return False
    if re.fullmatch(r"\d+(\.\d+)?", text):
        return False
    if text.startswith("#") or "http" in text.lower():
        return False
    if re.search(r"\b(prompt|guidance|step|variety|karras|euler|sheet|value)\b", text, re.I):
        return False
    return bool(ASCII_ARTIST_RE.fullmatch(text))


def looks_like_numeric_artist_name(text: str) -> bool:
    return bool(re.fullmatch(r"\d{3,10}", clean_text(text)))


def norm_common(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("，", ",").replace("：", ":")
    return text.strip().lower()


def norm_tags(text: str) -> str:
    return re.sub(r"\s+", "", norm_common(text))


def norm_title(text: str) -> str:
    text = re.sub(r"^artist\s*:", "", norm_common(text))
    return re.sub(r"\s+", "", text)


def title_from_nearby_cell(cells: dict[tuple[int, int], str], tag_row: int, col: int, tags: str) -> str:
    keys = extract_artist_keys(tags)
    if keys:
        return ", ".join(keys[:2])
    probes = [
        (tag_row - 1, col),
        (tag_row, col - 1),
        (tag_row - 1, col - 1),
        (tag_row - 2, col),
        (tag_row, col + 1),
    ]
    for pos in probes:
        text = clean_text(cells.get(pos, ""))
        if not text or looks_like_artist_tags(text):
            continue
        if INTRO_TITLE_RE.fullmatch(text):
            continue
        return text
    return keys[0] if keys else tags[:80]


def is_intro_title(title: str) -> bool:
    title = clean_text(title)
    return bool(title and INTRO_TITLE_RE.search(title) and not re.search(r"[A-Za-z0-9_]", title))


def discover_candidates(
    workbook: Path,
    volume: str,
    sheet_name: str,
    cells: dict[tuple[int, int], str],
) -> list[Candidate]:
    out: list[Candidate] = []
    seen: set[tuple[int, int, str]] = set()
    for (row, col), text in sorted(cells.items()):
        if looks_like_artist_tags(text):
            tags = clean_text(normalize_artist_prefix(text))
            title = title_from_nearby_cell(cells, row, col, tags)
        elif looks_like_bare_artist_name(text, row) or (
            col == 1
            and looks_like_numeric_artist_name(text)
            and not looks_like_artist_tags(cells.get((row, 2), ""))
        ):
            title = clean_text(text)
            tags = f"artist:{title}"
        else:
            continue
        if is_intro_title(title):
            continue
        key = (row, col, norm_tags(tags))
        if key in seen:
            continue
        seen.add(key)
        out.append(Candidate(
            workbook=workbook,
            volume=volume,
            sheet=sheet_name,
            title_row=row,
            tag_row=row,
            col=col,
            title=title,
            tags=tags,
        ))
    return out


def candidate_key_for_image(
    img: ImageRef,
    cells: dict[tuple[int, int], str],
    candidates_by_lookup: dict[tuple[int, int, str], Candidate],
) -> Candidate | None:
    # Most source sheets place title in row N and tag in row N+1, with images
    # floating from the image column. Search current column first; this avoids
    # the historical "previous cell stole next image" problem.
    for row in (img.row, img.row - 1):
        for col in range(img.col, max(0, img.col - 8), -1):
            tags = clean_text(cells.get((row, col), ""))
            if looks_like_artist_tags(tags):
                hit = candidates_by_lookup.get((row, col, norm_tags(normalize_artist_prefix(tags))))
                if hit:
                    return hit
            if looks_like_bare_artist_name(tags, row):
                hit = candidates_by_lookup.get((row, col, norm_tags(f"artist:{tags}")))
                if hit:
                    return hit
    return None


def assign_images_by_span(
    images: list[ImageRef],
    candidates: list[Candidate],
    assigned: set[str],
    blocked: set[str] | None = None,
) -> list[ImageRef]:
    blocked = blocked or set()
    unassigned: list[ImageRef] = []
    by_sheet_candidates = sorted(candidates, key=lambda c: (c.title_row, c.col))
    for img in images:
        if img.media in assigned or img.media in blocked:
            continue
        choices = []
        for idx, cand in enumerate(by_sheet_candidates):
            next_row = by_sheet_candidates[idx + 1].title_row if idx + 1 < len(by_sheet_candidates) else cand.tag_row + 12
            if cand.title_row <= img.row < next_row and cand.col <= img.col <= cand.col + 12:
                choices.append((abs(img.col - cand.col), abs(img.row - cand.tag_row), cand))
        if not choices:
            unassigned.append(img)
            continue
        choices.sort(key=lambda item: item[:2])
        choices[0][2].images.append(img)
        assigned.add(img.media)
    return unassigned


def extract_prompt_artist_keys(prompt: str) -> list[str]:
    prefixed = [norm_title(key) for key in extract_artist_keys(prompt)]
    if prefixed:
        return prefixed

    keys: list[str] = []
    seen: set[str] = set()
    for line in (prompt or "").replace("\u00a0", " ").splitlines()[:6]:
        for part in re.split(r"[,，;；]", line):
            token = clean_text(part).strip(" ,，;；:：")
            token = re.sub(r"\byear\s*\d+\b.*$", "", token, flags=re.I).strip(" ,，;；")
            if not token or GENERIC_PROMPT_TOKEN_RE.match(token):
                continue
            if looks_like_bare_artist_name(token, 4) or looks_like_numeric_artist_name(token):
                key = norm_title(token)
                if key and key not in seen:
                    keys.append(key)
                    seen.add(key)
        if keys:
            break
    return keys


def prompt_artist_keys_from_bytes(raw: bytes) -> list[str]:
    prompt, _ = prompt_from_image_bytes(raw)
    return extract_prompt_artist_keys(prompt)


def assign_images_by_prompt(
    zf: zipfile.ZipFile,
    images: list[ImageRef],
    candidates: list[Candidate],
    assigned: set[str],
    blocked: set[str],
) -> Counter:
    stats = Counter()
    by_key: dict[str, list[Candidate]] = defaultdict(list)
    for cand in candidates:
        key = primary_key(cand.tags)
        if key:
            by_key[key].append(cand)

    for img in images:
        resolved = resolve_media_name(zf, img.media)
        if not resolved:
            stats["missingMedia"] += 1
            continue
        raw = zf.read(resolved)
        keys = [key for key in prompt_artist_keys_from_bytes(raw) if key]
        if not keys:
            stats["promptNoArtist"] += 1
            continue
        hits: list[Candidate] = []
        seen: set[int] = set()
        for key in keys:
            for cand in by_key.get(key, []):
                marker = id(cand)
                if marker not in seen:
                    hits.append(cand)
                    seen.add(marker)
        if len(hits) == 1:
            hits[0].images.append(img)
            assigned.add(img.media)
            stats["promptAssigned"] += 1
        elif len(hits) > 1:
            nearby = [cand for cand in hits if abs(cand.tag_row - img.row) <= 3]
            if len(nearby) == 1:
                nearby[0].images.append(img)
                assigned.add(img.media)
                stats["promptAssignedNearby"] += 1
            else:
                stats["promptAmbiguous"] += 1
                blocked.add(img.media)
        else:
            stats["promptNoCandidate"] += 1
            blocked.add(img.media)
    return stats


def parse_workbook(workbook: Path) -> tuple[list[Candidate], dict[str, object]]:
    volume = volume_label(workbook)
    candidates: list[Candidate] = []
    stats: dict[str, object] = {
        "file": str(workbook),
        "volume": volume,
        "sheets": [],
        "imageAnchors": 0,
        "unassignedImages": 0,
        "candidateCount": 0,
        "assignedImages": 0,
    }
    with zipfile.ZipFile(workbook) as zf:
        shared = load_shared_strings(zf)
        for sheet_name, sheet_part in workbook_sheets(zf):
            if sheet_name == "目录":
                continue
            cells = read_cells(zf, sheet_part, shared)
            drawing_part = drawing_part_for_sheet(zf, sheet_part)
            all_images = read_images(zf, drawing_part) if drawing_part else []
            missing_media = [img for img in all_images if not resolve_media_name(zf, img.media)]
            images = [img for img in all_images if resolve_media_name(zf, img.media)]
            sheet_candidates = discover_candidates(workbook, volume, sheet_name, cells)
            by_lookup = {(cand.tag_row, cand.col, norm_tags(cand.tags)): cand for cand in sheet_candidates}
            assigned: set[str] = set()
            blocked: set[str] = set()
            prompt_stats = assign_images_by_prompt(zf, images, sheet_candidates, assigned, blocked)
            direct_unassigned: list[ImageRef] = []
            for img in images:
                if img.media in assigned or img.media in blocked:
                    continue
                cand = candidate_key_for_image(img, cells, by_lookup)
                if cand:
                    cand.images.append(img)
                    assigned.add(img.media)
                else:
                    direct_unassigned.append(img)
            unassigned = assign_images_by_span(direct_unassigned, sheet_candidates, assigned, blocked)
            candidates.extend(sheet_candidates)
            stats["imageAnchors"] = int(stats["imageAnchors"]) + len(all_images)
            stats["missingMediaAnchors"] = int(stats.get("missingMediaAnchors", 0)) + len(missing_media)
            unresolved_images = len(unassigned) + len(blocked)
            stats["unassignedImages"] = int(stats["unassignedImages"]) + unresolved_images
            stats["sheets"].append({
                "name": sheet_name,
                "cells": len(cells),
                "candidates": len(sheet_candidates),
                "imageAnchors": len(all_images),
                "missingMediaAnchors": len(missing_media),
                "assignedImages": sum(len(c.images) for c in sheet_candidates),
                "unassignedImages": unresolved_images,
                "blockedPromptImages": len(blocked),
                "promptAssignment": dict(prompt_stats),
                "firstCells": [
                    {"row": r, "col": c, "text": text[:120]}
                    for (r, c), text in sorted(cells.items())[:20]
                ],
                "firstCandidates": [
                    {
                        "title": cand.title,
                        "row": cand.title_row,
                        "tagRow": cand.tag_row,
                        "col": cand.col,
                        "tags": cand.tags[:160],
                        "images": len(cand.images),
                    }
                    for cand in sheet_candidates[:20]
                ],
            })
    stats["candidateCount"] = len(candidates)
    stats["assignedImages"] = sum(len(c.images) for c in candidates)
    return candidates, stats


def build_volume_overlap(candidates: list[Candidate]) -> list[dict[str, object]]:
    by_volume: dict[str, set[str]] = defaultdict(set)
    for cand in candidates:
        key = primary_key(cand.tags) or norm_tags(cand.tags)
        if key:
            by_volume[cand.volume].add(key)
    volumes = list(by_volume)
    out: list[dict[str, object]] = []
    for i, left in enumerate(volumes):
        for right in volumes[i + 1:]:
            a, b = by_volume[left], by_volume[right]
            inter = a & b
            out.append({
                "left": left,
                "right": right,
                "leftCount": len(a),
                "rightCount": len(b),
                "overlap": len(inter),
                "leftCoveredPct": round(len(inter) / len(a) * 100, 2) if a else 0,
                "rightCoveredPct": round(len(inter) / len(b) * 100, 2) if b else 0,
            })
    return out


def primary_key(tags: str) -> str:
    keys = extract_artist_keys(tags)
    return norm_title(keys[0]) if keys else ""


def build_entries(candidates: list[Candidate], codex_id: str) -> list[dict[str, object]]:
    sheet_counts = Counter((cand.workbook, cand.sheet) for cand in candidates)
    entries: list[dict[str, object]] = []
    for seq, cand in enumerate(candidates, start=1):
        path = [cand.volume]
        if (
            sheet_counts[(cand.workbook, cand.sheet)]
            and cand.sheet
            and not cand.sheet.lower().startswith("sheet")
            and not re.fullmatch(r"工作表\d+", cand.sheet)
        ):
            path.append(cand.sheet)
        entries.append({
            "title": cand.title,
            "path": path,
            "tags": cand.tags,
            "isNew": False,
            "id": f"{codex_id}_{seq:04d}",
            "_source": {
                "workbook": str(cand.workbook),
                "sheet": cand.sheet,
                "row": cand.title_row,
                "tagRow": cand.tag_row,
                "col": cand.col,
                "media": [img.media for img in cand.images],
            },
        })
    return entries


def build_tree(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    root: dict[str, dict[str, object]] = {}
    for entry in entries:
        node = root
        for name in entry.get("path", []):
            cur = node.setdefault(name, {"name": name, "count": 0, "children": {}})
            cur["count"] = int(cur["count"]) + 1
            node = cur["children"]

    def emit(node_map: dict[str, dict[str, object]]) -> list[dict[str, object]]:
        return [
            {"name": item["name"], "count": item["count"], "children": emit(item["children"])}
            for item in node_map.values()
        ]

    return emit(root)


def media_ext(media: str, raw: bytes) -> str:
    suffix = Path(media).suffix.lower().lstrip(".")
    if suffix == "jpeg":
        suffix = "jpg"
    if suffix in {"jpg", "png", "webp", "gif", "bmp", "avif"}:
        return suffix
    try:
        fmt = Image.open(io.BytesIO(raw)).format
        return (fmt or "png").lower().replace("jpeg", "jpg")
    except Exception:
        return "bin"


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def asset_rev(paths: list[Path]) -> str:
    h = hashlib.sha256()
    used = False
    for path in paths:
        if path and path.exists():
            h.update(hash_file(path).encode("ascii"))
            used = True
    return h.hexdigest()[:16] if used else ""


def save_one_image(zf: zipfile.ZipFile, media: str, base_name: str, site_image_dir: Path, original_dir: Path) -> dict[str, object]:
    resolved = resolve_media_name(zf, media)
    if not resolved:
        raise FileNotFoundError(media)
    raw = zf.read(resolved)
    ext = media_ext(media, raw)
    original_name = f"{base_name}.{ext}"
    thumb_name = f"{base_name}.jpg"
    original_path = original_dir / original_name
    thumb_path = site_image_dir / thumb_name

    original_dir.mkdir(parents=True, exist_ok=True)
    site_image_dir.mkdir(parents=True, exist_ok=True)
    with open(original_path, "wb") as fh:
        fh.write(raw)

    image = Image.open(io.BytesIO(raw))
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.thumbnail((MAXDIM, MAXDIM), Image.LANCZOS)
    thumb_w, thumb_h = image.size
    image.save(thumb_path, "JPEG", quality=86, optimize=True)
    return {
        "path": thumb_name,
        "original": original_name,
        "width": thumb_w,
        "height": thumb_h,
        "thumbPath": thumb_path,
        "originalPath": original_path,
    }


def write_images(codex_id: str, entries: list[dict[str, object]]) -> int:
    site_image_dir = IMAGE_DIR / codex_id
    original_dir = ORIGINAL_DIR / codex_id
    if site_image_dir.exists():
        shutil.rmtree(site_image_dir)
    if original_dir.exists():
        shutil.rmtree(original_dir)

    by_workbook: dict[str, list[dict[str, object]]] = defaultdict(list)
    for entry in entries:
        source = entry["_source"]
        by_workbook[source["workbook"]].append(entry)

    written = 0
    for workbook, workbook_entries in by_workbook.items():
        with zipfile.ZipFile(workbook) as zf:
            for entry in workbook_entries:
                media_names = entry["_source"]["media"]
                assets = []
                for i, media in enumerate(media_names, start=1):
                    suffix = "" if i == 1 else f"-{i:02d}"
                    assets.append(save_one_image(zf, media, entry["id"] + suffix, site_image_dir, original_dir))
                if not assets:
                    continue
                primary = assets[0]
                entry["image"] = primary["path"]
                entry["imageWidth"] = primary["width"]
                entry["imageHeight"] = primary["height"]
                entry["original"] = primary["original"]
                entry["images"] = [{"path": a["path"], "original": a["original"]} for a in assets]
                entry["assetRev"] = asset_rev([p for a in assets for p in (a["thumbPath"], a["originalPath"])])
                written += len(assets)
    for entry in entries:
        entry.pop("_source", None)
    return written


def update_codex_index(codex: dict[str, object]) -> None:
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
            if item.get("id") == "artist_300":
                insert_at = i + 1
                break
        index.insert(insert_at, meta)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_json(path: Path, payload: object, compact: bool = False) -> None:
    text = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":") if compact else None,
        indent=None if compact else 2,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")


def decode_text(data: bytes) -> str:
    for enc in ("utf-8", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace")


def read_png_text_chunks_from_bytes(raw: bytes) -> list[dict[str, str]]:
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return []
    out = []
    pos = 8
    while pos + 8 <= len(raw):
        size = int.from_bytes(raw[pos:pos + 4], "big")
        name = raw[pos + 4:pos + 8].decode("latin-1", "replace")
        data = raw[pos + 8:pos + 8 + size]
        pos += 12 + size
        if name == "tEXt":
            keyword, _, text = data.partition(b"\x00")
            out.append({"keyword": decode_text(keyword), "text": decode_text(text)})
        elif name == "iTXt":
            keyword, text = parse_png_itxt(data)
            out.append({"keyword": keyword, "text": text})
        elif name == "zTXt":
            keyword, _, payload = data.partition(b"\x00")
            text = ""
            if payload:
                try:
                    text = decode_text(zlib.decompress(payload[1:]))
                except Exception:
                    text = ""
            out.append({"keyword": decode_text(keyword), "text": text})
        if name == "IEND":
            break
    return out


def parse_png_itxt(data: bytes) -> tuple[str, str]:
    parts: list[bytes] = []
    rest = data
    for _ in range(5):
        head, sep, tail = rest.partition(b"\x00")
        parts.append(head)
        rest = tail if sep else b""
        if not sep:
            break
    keyword = decode_text(parts[0]) if parts else ""
    if len(parts) >= 5:
        compressed = parts[1] == b"\x01"
        text = zlib.decompress(rest) if compressed else rest
    else:
        text = rest or data
    return keyword, decode_text(text)


def nai_v4_caption_text(data: dict[str, object], key: str) -> str:
    value = data.get(key)
    caption = ((value or {}).get("caption") or {}) if isinstance(value, dict) else {}
    parts: list[str] = []
    base = caption.get("base_caption")
    if base:
        parts.append(str(base))
    for item in caption.get("char_captions") or []:
        if isinstance(item, dict) and item.get("char_caption"):
            parts.append(str(item["char_caption"]))
    return "\n".join(parts).strip()


def prompt_from_png_fields(fields: dict[str, str]) -> str:
    comment = fields.get("Comment")
    if comment:
        try:
            payload = json.loads(comment)
            return (
                nai_v4_caption_text(payload, "v4_prompt")
                or str(payload.get("prompt") or "")
            ).strip()
        except Exception:
            pass
    if fields.get("Description"):
        return fields["Description"].strip()
    if fields.get("parameters"):
        prompt, _, _ = fields["parameters"].partition("Negative prompt:")
        return prompt.strip()
    return ""


def read_lsb_byte(bit_iter) -> int:
    value = 0
    for i in range(8):
        value |= next(bit_iter) << (7 - i)
    return value


def read_stealth_pngcomp_from_bytes(raw: bytes) -> dict[str, object] | None:
    magic = b"stealth_pngcomp"
    try:
        with Image.open(io.BytesIO(raw)) as im:
            alpha = im.convert("RGBA").getchannel("A")
            pixels = alpha.load()
            width, height = alpha.size

            def bits():
                for x in range(width):
                    for y in range(height):
                        yield pixels[x, y] & 1

            bit_iter = bits()
            found_magic = bytes(read_lsb_byte(bit_iter) for _ in range(len(magic)))
            if found_magic != magic:
                return None
            bit_length = int.from_bytes(bytes(read_lsb_byte(bit_iter) for _ in range(4)), "big", signed=True)
            if bit_length <= 0:
                return None
            byte_length = (bit_length + 7) // 8
            compressed = bytes(read_lsb_byte(bit_iter) for _ in range(byte_length))
            decoded = json.loads(zlib.decompress(compressed, 16 + zlib.MAX_WBITS).decode("utf-8"))
            return decoded if isinstance(decoded, dict) else None
    except Exception:
        return None


def prompt_from_image_bytes(raw: bytes) -> tuple[str, str]:
    fields = {c["keyword"]: c["text"] for c in read_png_text_chunks_from_bytes(raw)}
    prompt = prompt_from_png_fields(fields)
    if prompt:
        return prompt, "png"
    if raw.startswith(b"\x89PNG"):
        stealth = read_stealth_pngcomp_from_bytes(raw)
        if stealth:
            prompt = (
                nai_v4_caption_text(stealth, "v4_prompt")
                or str(stealth.get("prompt") or stealth.get("positive_prompt") or stealth.get("Description") or "")
            ).strip()
            if prompt:
                return prompt, "stealth_pngcomp"
    return "", "none"


def search_blob(text: str) -> tuple[str, str]:
    norm = norm_common(text)
    compact = re.sub(r"[\s_:\-(),{}\[\]'\"/\\]+", "", norm)
    return norm, compact


def tag_matches_prompt(tag: str, prompt: str) -> bool:
    tag_norm = norm_common(tag)
    prompt_norm, prompt_compact = search_blob(prompt)
    if tag_norm and f"artist:{tag_norm}" in prompt_norm:
        return True
    if tag_norm and tag_norm in prompt_norm:
        return True
    tag_compact = re.sub(r"[\s_:\-(),{}\[\]'\"/\\]+", "", tag_norm)
    return bool(tag_compact and tag_compact in prompt_compact)


def verify_candidate_images(candidates: list[Candidate], sample_limit: int = 0) -> dict[str, object]:
    stats = Counter()
    samples: dict[str, list[dict[str, object]]] = defaultdict(list)
    by_workbook: dict[Path, list[Candidate]] = defaultdict(list)
    for cand in candidates:
        if cand.images:
            by_workbook[cand.workbook].append(cand)
    checked = 0
    for workbook, workbook_candidates in by_workbook.items():
        with zipfile.ZipFile(workbook) as zf:
            for cand in workbook_candidates:
                keys = extract_artist_keys(cand.tags)
                for img in cand.images:
                    if sample_limit and checked >= sample_limit:
                        stats["sampleLimitReached"] = 1
                        return {"stats": dict(stats), "samples": samples}
                    resolved = resolve_media_name(zf, img.media)
                    if not resolved:
                        stats["missingMedia"] += 1
                        continue
                    raw = zf.read(resolved)
                    prompt, source = prompt_from_image_bytes(raw)
                    checked += 1
                    stats["checked"] += 1
                    stats[f"source:{source}"] += 1
                    if not prompt:
                        stats["noPrompt"] += 1
                        if len(samples["noPrompt"]) < 30:
                            samples["noPrompt"].append(sample_item(cand, img, source))
                        continue
                    if not keys:
                        stats["noArtistKey"] += 1
                        continue
                    if any(tag_matches_prompt(key, prompt) for key in keys):
                        stats["matched"] += 1
                    else:
                        stats["mismatched"] += 1
                        if len(samples["mismatched"]) < 50:
                            item = sample_item(cand, img, source)
                            item["artistKeys"] = keys
                            item["promptSha16"] = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]
                            item["promptSample"] = prompt[:240]
                            samples["mismatched"].append(item)
    return {"stats": dict(stats), "samples": samples}


def sample_item(cand: Candidate, img: ImageRef, source: str = "") -> dict[str, object]:
    return {
        "volume": cand.volume,
        "workbook": cand.workbook.name,
        "sheet": cand.sheet,
        "title": cand.title,
        "tagRow": cand.tag_row,
        "col": cand.col,
        "imageRow": img.row,
        "imageCol": img.col,
        "media": img.media,
        "source": source,
        "tags": cand.tags[:200],
    }


def make_codex(
    codex_id: str,
    title: str,
    version: str,
    author: str,
    source: str,
    entries: list[dict[str, object]],
) -> dict[str, object]:
    public_entries = []
    for entry in entries:
        public = {k: v for k, v in entry.items() if k != "_source"}
        public_entries.append(public)
    return {
        "id": codex_id,
        "type": "string",
        "title": title,
        "version": version,
        "author": author,
        "entryCount": len(public_entries),
        "imagedCount": sum(1 for e in public_entries if e.get("image") or e.get("images")),
        "hasOriginal": True,
        "source": source,
        "contributors": [{"name": author or "未署名", "role": "词条整理 / 配图数据提供"}],
        "tree": build_tree(public_entries),
        "entries": public_entries,
    }


def infer_relationship(overlap: list[dict[str, object]]) -> str:
    if not overlap:
        return "unknown"
    max_covered = max(max(row["leftCoveredPct"], row["rightCoveredPct"]) for row in overlap)
    avg_overlap = sum(row["overlap"] for row in overlap) / len(overlap)
    if max_covered >= 90:
        return "likely_cumulative_or_revised"
    if avg_overlap <= 3:
        return "likely_independent_volumes"
    return "mixed_overlap"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-dir", type=Path, default=Path(r"D:\program\comful\nai4.5full个人单画师收藏"))
    ap.add_argument("--excel-file", type=Path, action="append", default=[])
    ap.add_argument("--codex-id", default="artist_nai45_personal")
    ap.add_argument("--title", default="Nai4.5Full个人单画师收藏")
    ap.add_argument("--version", default="2025.9.27")
    ap.add_argument("--author", default="千早爱音")
    ap.add_argument("--source", default="千早爱音 · Nai4.5Full个人单画师收藏")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--verify-metadata", action="store_true")
    ap.add_argument("--verify-sample-limit", type=int, default=0)
    args = ap.parse_args()

    workbooks = [p.resolve() for p in args.excel_file] if args.excel_file else sorted(args.source_dir.glob("*.xlsx"), key=volume_sort_key)
    if not workbooks:
        raise SystemExit(f"No xlsx files found: {args.source_dir}")
    missing = [str(path) for path in workbooks if not path.exists()]
    if missing:
        raise SystemExit("Missing Excel file(s): " + ", ".join(missing))

    target_json = DATA_DIR / f"{args.codex_id}.json"
    if args.apply and target_json.exists() and not args.overwrite:
        raise SystemExit(f"Target exists; pass --overwrite to replace: {target_json}")

    all_candidates: list[Candidate] = []
    workbook_stats = []
    for workbook in workbooks:
        print(f"parsing {workbook.name}", flush=True)
        candidates, stats = parse_workbook(workbook)
        all_candidates.extend(candidates)
        workbook_stats.append(stats)

    all_candidates.sort(key=lambda c: (volume_sort_key(c.workbook), c.sheet, c.title_row, c.col))
    entries = build_entries(all_candidates, args.codex_id)
    overlap = build_volume_overlap(all_candidates)
    relationship = infer_relationship(overlap)
    image_counts = Counter(len(c.images) for c in all_candidates)
    duplicate_primary_tags = [
        {"key": key, "count": count}
        for key, count in Counter(primary_key(c.tags) for c in all_candidates if primary_key(c.tags)).items()
        if count > 1
    ]
    verification = {"stats": {}, "samples": {}}
    if args.verify_metadata:
        print("verifying embedded image prompts", flush=True)
        verification = verify_candidate_images(all_candidates, args.verify_sample_limit)

    if args.apply:
        print("writing images", flush=True)
        written_images = write_images(args.codex_id, entries)
        codex = make_codex(args.codex_id, args.title, args.version, args.author, args.source, entries)
        codex["imagedCount"] = sum(1 for e in codex["entries"] if e.get("image") or e.get("images"))
        write_json(target_json, codex, compact=True)
        update_codex_index(codex)
    else:
        written_images = 0

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_dir = OUTPUT_DIR / f"{args.codex_id}_excel_import_{stamp}"
    report = {
        "apply": bool(args.apply),
        "sourceDir": str(args.source_dir),
        "workbooks": workbook_stats,
        "codexId": args.codex_id,
        "title": args.title,
        "version": args.version,
        "entryCount": len(entries),
        "imagedEntries": sum(1 for c in all_candidates if c.images),
        "imageCount": sum(len(c.images) for c in all_candidates),
        "writtenImages": written_images,
        "multiImageEntries": sum(1 for c in all_candidates if len(c.images) > 1),
        "imageCountDistribution": dict(sorted(image_counts.items())),
        "volumeOverlap": overlap,
        "relationship": relationship,
        "duplicatePrimaryTags": duplicate_primary_tags[:200],
        "duplicatePrimaryTagCount": len(duplicate_primary_tags),
        "verification": verification,
        "candidateSamples": [
            {
                "volume": c.volume,
                "workbook": c.workbook.name,
                "sheet": c.sheet,
                "title": c.title,
                "tagRow": c.tag_row,
                "col": c.col,
                "tags": c.tags[:200],
                "images": len(c.images),
                "imageAnchors": [{"row": img.row, "col": img.col, "media": img.media} for img in c.images[:5]],
            }
            for c in all_candidates[:100]
        ],
        "missingImageSamples": [
            {
                "volume": c.volume,
                "workbook": c.workbook.name,
                "sheet": c.sheet,
                "title": c.title,
                "tagRow": c.tag_row,
                "col": c.col,
                "tags": c.tags[:200],
            }
            for c in all_candidates if not c.images
        ][:100],
    }
    write_json(report_dir / "report.json", report)

    summary = {
        "apply": bool(args.apply),
        "codexId": args.codex_id,
        "workbooks": len(workbooks),
        "entries": len(entries),
        "imagedEntries": report["imagedEntries"],
        "images": report["imageCount"],
        "writtenImages": written_images,
        "multiImageEntries": report["multiImageEntries"],
        "missingImageEntries": len(entries) - int(report["imagedEntries"]),
        "relationship": relationship,
        "duplicatePrimaryTagCount": len(duplicate_primary_tags),
        "verificationStats": verification["stats"],
        "report": str(report_dir / "report.json"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
