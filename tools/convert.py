# -*- coding: utf-8 -*-
"""
法典转换器：把 法典源/*.docx 解析成网站用的结构化数据。
输出：
  site/data/<codexId>.json   每本法典的词条 + 目录树
  site/data/codexes.json     法典索引（给顶部切换用）
  site/data/待复核_<codexId>.txt  可能解析有误的词条，供人工复核
用法：python tools/convert.py   （或双击 转换法典.bat）
"""
import os, re, io, json, hashlib, glob
from docx import Document
from docx.oxml.ns import qn

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "法典源")
DATA_DIR = os.path.join(ROOT, "site", "data")
IMG_DIR = os.path.join(ROOT, "site", "images")
os.makedirs(DATA_DIR, exist_ok=True)

# 已知法典 → 短 id（其余用文件名哈希）
ID_MAP = [("所长常规", "suozhang")]   # 原「所长常规」法典固定用 suozhang（已配图，勿改）；其余按文件名生成唯一 id
IMG_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "avif"]

def codex_id(stem):
    for key, cid in ID_MAP:
        if key in stem:
            return cid
    return "codex_" + hashlib.md5(stem.encode("utf-8")).hexdigest()[:8]

def parse_meta(stem):
    ver = re.search(r"(\d{4}[.\-]\d{1,2}[.\-]?\d{0,2})", stem)
    title = re.split(r"[（(]", stem)[0].strip()
    author = ""
    m = re.search(r"[（(].*?([一-鿿]{2,})整理", stem)
    if m:
        author = m.group(1)
    return title or stem, (ver.group(1) if ver else ""), author

def is_cjk(c):
    return "一" <= c <= "鿿"

def has_cjk(t):
    return any(is_cjk(c) for c in t)

def cjk_ratio(t):
    cjk = sum(1 for c in t if is_cjk(c))
    al = sum(1 for c in t if c.isalnum() or is_cjk(c))
    return cjk / al if al else 0.0

def classify(t):
    """把一段文本判定为 词条标题(title) / tag行(tag) / 其它(note)"""
    r = cjk_ratio(t)
    if r > 0.5 and len(t) < 45:          # 中文为主的短行 → 标题（即便夹少量英文/括号）
        return "title"
    has_latin = bool(re.search(r"[A-Za-z]", t))
    has_tagsig = any(s in t for s in [",", "，", "::", "{", "}", "[", "]", "_"])
    if has_latin and has_tagsig:          # 含英文且有tag语法 → tag行
        return "tag"
    if len(t) < 45 and has_cjk(t):        # 中英混排的短标题（如 上古galgame风格）
        return "title"
    if len(t) < 35 and has_latin:         # 极短的纯英文标签 → 当标题
        return "title"
    return "note"

def outline_lvl(p):
    pPr = p._p.pPr
    if pPr is None:
        return None
    o = pPr.find(qn("w:outlineLvl"))
    return int(o.get(qn("w:val"))) if o is not None else None

def is_pink(p):
    for r in p.runs:
        rPr = r._element.rPr
        if rPr is not None:
            hh = rPr.find(qn("w:highlight"))
            if hh is not None and hh.get(qn("w:val")) not in (None, "none"):
                return True
    return False

def find_image(cid, eid):
    for ext in IMG_EXTS:
        fn = os.path.join(IMG_DIR, cid, eid + "." + ext)
        if os.path.exists(fn):
            return eid + "." + ext
    return None

def build_tree(entries):
    root = {}
    for e in entries:
        node = root
        for name in e["path"]:
            node = node.setdefault(name, {"_count": 0, "_children": {}})
            node["_count"] += 1
            node = node["_children"]
    def to_list(d):
        out = []
        for name, v in d.items():
            out.append({"name": name, "count": v["_count"], "children": to_list(v["_children"])})
        return out
    return to_list(root)

def convert(path, cid):
    stem = os.path.splitext(os.path.basename(path))[0]
    title, ver, author = parse_meta(stem)
    doc = Document(path)

    cats = [None, None, None, None]
    entries, cur = [], None
    seen_toc = False
    for p in doc.paragraphs:
        if p.style.name.startswith("toc"):
            seen_toc = True
            continue
        t = p.text.strip()
        if not t:
            continue
        lv = outline_lvl(p)
        if lv is not None and lv <= 3:
            cats[lv] = t
            for k in range(lv + 1, 4):
                cats[k] = None
            cur = None
            continue
        if not seen_toc:            # 跳过目录之前的零碎
            continue
        kind = classify(t)
        if kind == "title":
            cur = {"title": t, "path": [c for c in cats if c], "tags": [], "isNew": is_pink(p)}
            entries.append(cur)
        elif kind == "tag":
            if cur is None:
                cur = {"title": "(未命名)", "path": [c for c in cats if c], "tags": [], "isNew": False}
                entries.append(cur)
            cur["tags"].append(t)
            if is_pink(p):
                cur["isNew"] = True
        # note: 丢弃

    # 仅保留有 tag 的词条；分配 id；合并 tag 行；探测配图
    final, review = [], []
    n = 0
    for e in entries:
        if not e["tags"]:
            continue
        n += 1
        eid = f"{cid}-{n:04d}"
        block = "\n".join(e["tags"]).strip()
        item = {
            "id": eid,
            "title": e["title"],
            "path": e["path"],
            "tags": block,
            "isNew": e["isNew"],
            "image": find_image(cid, eid),
        }
        final.append(item)
        # 可疑：tag 块里没有任何逗号/:: → 可能是误判
        if ("," not in block) and ("，" not in block) and ("::" not in block):
            review.append(item)
        elif len(e["title"]) > 30:
            review.append(item)

    tree = build_tree(final)
    imaged = sum(1 for e in final if e["image"])

    with io.open(os.path.join(DATA_DIR, cid + ".json"), "w", encoding="utf-8") as f:
        json.dump({
            "id": cid, "title": title, "version": ver, "author": author,
            "entryCount": len(final), "imagedCount": imaged,
            "tree": tree, "entries": final,
        }, f, ensure_ascii=False)

    if review:
        with io.open(os.path.join(DATA_DIR, f"待复核_{cid}.txt"), "w", encoding="utf-8") as f:
            f.write(f"# {title}：{len(review)} 条可能解析有误，请人工瞄一眼\n\n")
            for e in review:
                f.write(f"[{' › '.join(e['path'])}] {e['title']}\n    {e['tags'][:120]}\n\n")

    return {"id": cid, "title": title, "version": ver, "author": author,
            "entryCount": len(final), "imagedCount": imaged, "reviewCount": len(review)}

def main():
    docs = sorted(glob.glob(os.path.join(SRC_DIR, "*.docx")))
    index = []
    seen = {}
    for d in docs:
        if os.path.basename(d).startswith("~$"):
            continue
        stem = os.path.splitext(os.path.basename(d))[0]
        cid = codex_id(stem)
        if cid in seen:                       # 防撞：同 id 自动加后缀，杜绝互相覆盖
            seen[cid] += 1
            cid = f"{cid}_{seen[cid]}"
        else:
            seen[cid] = 1
        info = convert(d, cid)
        index.append({k: info[k] for k in ("id", "title", "version", "author", "entryCount", "imagedCount")})
        print(f"[OK] {info['id']}: {info['entryCount']} entries, "
              f"{info['imagedCount']} imaged, {info['reviewCount']} to review")
    with io.open(os.path.join(DATA_DIR, "codexes.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"[DONE] {len(index)} codex(es) -> site/data/")

if __name__ == "__main__":
    main()
