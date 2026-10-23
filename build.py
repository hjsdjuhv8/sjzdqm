# -*- coding: utf-8 -*-
"""
构建脚本 —— 供 EdgeOne Pages / Vercel / Netlify 等平台在云端执行。

作用：把 static/ 下的前端文件 + data/codes.db 里的数据，
     合成为一个纯静态目录 public/（可直接发布的产物）。

云端没有 Python 环境时，也可以只提交 data/codes.json（导出物），
本脚本会自动识别并使用它。

本地用法：
    python build.py            # 生成 public/
"""

import json
import os
import re
import shutil
import sqlite3
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")
DATA = os.path.join(BASE, "data")
OUT = os.path.join(BASE, "public")
DB_PATH = os.path.join(DATA, "codes.db")
JSON_PATH = os.path.join(DATA, "codes.json")   # 云端优先用这个

# 与 server.py 的 GUN_CATEGORIES 保持一致
GUN_CATEGORIES_PY = [
    "步枪", "冲锋枪", "霰弹枪", "轻机枪",
    "精确射手步枪", "狙击步枪", "手枪", "特殊武器",
]


def read_from_db():
    if not os.path.exists(DB_PATH):
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT id,code,gun_name,category,mode,season,price,tags,notes,"
            "video_url,copied,updated_at FROM codes "
            "WHERE status='published' ORDER BY copied DESC, id DESC").fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def read_from_json():
    if not os.path.exists(JSON_PATH):
        return None
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        d = json.load(f)
    if isinstance(d, dict):
        return d.get("items") or []
    if isinstance(d, list):
        return d
    return None


# 与 server.py / build.js 保持一致的分类口径
LEGACY_CATEGORY = {
    "突击步枪": "步枪",
    "战斗步枪": "步枪",
    "射手步枪": "精确射手步枪",
}
VALID_CATEGORIES = set(GUN_CATEGORIES_PY) | {"其他"}


def normalize_categories(items):
    """
    把导出物里的旧分类纠正成新口径，并按枪名兜底补全。
    data/codes.json 是导出文件，可能残留旧分类，构建时统一修正。
    """
    migrated = guessed = 0
    for it in items:
        cat = it.get("category") or ""
        if cat in LEGACY_CATEGORY:
            it["category"] = LEGACY_CATEGORY[cat]
            migrated += 1
        elif cat not in VALID_CATEGORIES:
            new = guess_category(it.get("gun_name") or "")
            if new != cat:
                guessed += 1
            it["category"] = new
    if migrated or guessed:
        print(f"[build] 分类归一：迁移旧分类 {migrated} 条，按枪名补全 {guessed} 条")
    return items


def guess_category(name):
    hints = [
        ("精确射手步枪", "精确射手步枪"), ("射手步枪", "精确射手步枪"),
        ("突击步枪", "步枪"), ("战斗步枪", "步枪"),
        ("轻机枪", "轻机枪"), ("机枪", "轻机枪"),
        ("冲锋枪", "冲锋枪"), ("霰弹枪", "霰弹枪"),
        ("狙击步枪", "狙击步枪"), ("狙击枪", "狙击步枪"),
        ("手枪", "手枪"), ("步枪", "步枪"),
    ]
    for kw, cat in sorted(hints, key=lambda x: len(x[0]), reverse=True):
        if kw in (name or ""):
            return cat
    return "其他"


def main():
    # 优先级：data/codes.json > data/codes.db
    # 优先用 JSON，是为了保证「构建结果 === 你提交到 GitHub 的那份数据」，
    # 避免本地库和线上数据悄悄不一致。
    items = read_from_json()
    source = "data/codes.json"
    if items is None:
        items = read_from_db()
        source = "data/codes.db"

    if items is None:
        print("[build] 警告：既没有 data/codes.json 也没有 data/codes.db，")
        print("        将生成一个空数据的站点。请在本地先导出数据。")
        items = []

    items = normalize_categories(items)
    print(f"[build] 数据来源: {source}  条目数: {len(items)}")

    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)

    # 1. 三个静态资源原件
    for name in ("styles.css", "app.js", "404.html"):
        shutil.copy2(os.path.join(STATIC, name), os.path.join(OUT, name))

    # 2. index.html：把 /static/xxx 改成相对路径，并强制静态模式
    with open(os.path.join(STATIC, "index.html"), "r", encoding="utf-8") as f:
        html = f.read()

    html = (html
            .replace('href="/static/styles.css"', 'href="styles.css"')
            .replace('src="/static/app.js"', 'src="app.js"')
            .replace('<script src="app.js"></script>',
                     '<script>window.DF_STATIC = true;</script>\n'
                     '<script src="app.js"></script>')
            .replace('href="/"', 'href="./"'))

    if "/static/" in html:
        print("[build] 警告：index.html 里仍有 /static/ 绝对路径，检查一下")

    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    # 3. 数据文件
    payload = {"ok": True, "total": len(items), "items": items}
    with open(os.path.join(OUT, "codes.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    # 4. 站点地图，方便搜索引擎收录
    write_sitemap(items)

    total = sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT))
    print(f"[build] 产物目录: {OUT}")
    print(f"[build] 文件数: {len(os.listdir(OUT))}  总体积: {total/1024:.1f} KB")
    return 0


def write_sitemap(items):
    """给每个改枪码生成一个可分享的 URL，SEO 与抖音评论区都能用。"""
    urls = ["/"]
    for it in items:
        code = it.get("code") or ""
        if code:
            safe = re.sub(r"[^A-Za-z0-9_-]", "", code)
            if safe:
                urls.append(f"/c/{safe}")
    body = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        body.append(f"  <url><loc>{u}</loc></url>")
    body.append("</urlset>")
    with open(os.path.join(OUT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(body))


if __name__ == "__main__":
    sys.exit(main())
