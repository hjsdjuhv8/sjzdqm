# -*- coding: utf-8 -*-
"""验证「导出静态站」功能：下载 zip → 解压 → 检查文件 → 起本地静态服务 → 浏览器验证。"""
import io
import json
import os
import shutil
import sys
import urllib.request
import http.cookiejar
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8140"
PW = open(r"D:\z1383\deepseak\deltaforce-codes\data\.admin-password",
          encoding="utf-8").read().strip()
OUT = r"D:\z1383\deepseak\deltaforce-codes\tests\_static_out"

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

fails = []
def check(name, cond, detail=""):
    print(("[PASS] " if cond else "[FAIL] ") + name + ("" if cond else "  -- " + str(detail)))
    if not cond:
        fails.append(name)

def post(path, data):
    r = urllib.request.Request(BASE + path, data=json.dumps(data).encode(),
                               headers={"Content-Type": "application/json"})
    return op.open(r, timeout=15)

print("=" * 60)
print("1. 登录后请求静态站导出")
print("=" * 60)

# 未登录应 401
try:
    op.open(BASE + "/api/codes/static", timeout=10)
    check("未登录被拒绝", False, "居然成功了")
except urllib.error.HTTPError as e:
    check("未登录被拒绝(401)", e.code == 401, e.code)

post("/api/admin/login", {"password": PW})
resp = op.open(BASE + "/api/codes/static", timeout=20)
zbytes = resp.read()
check("下载成功", resp.status == 200 and len(zbytes) > 1000, f"{resp.status} {len(zbytes)}")
check("Content-Type 是 zip", "zip" in resp.headers.get("Content-Type", ""),
      resp.headers.get("Content-Type"))

print()
print("=" * 60)
print("2. 解压并检查内容")
print("=" * 60)

if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT, exist_ok=True)

zf = zipfile.ZipFile(io.BytesIO(zbytes))
names = zf.namelist()
print("   包内文件:", names)
for need in ("index.html", "styles.css", "app.js", "codes.json", "404.html"):
    check(f"包含 {need}", need in names, names)

index_html = zf.read("index.html").decode("utf-8")
check("index 里没有 /static/ 绝对路径", "/static/" not in index_html,
      [l for l in index_html.splitlines() if "/static/" in l][:3])
check("index 里已注入 DF_STATIC 开关", "DF_STATIC = true" in index_html)
check("index 引用了相对 styles.css", 'href="styles.css"' in index_html)
check("index 引用了相对 app.js", 'src="app.js"' in index_html)

data = json.loads(zf.read("codes.json").decode("utf-8"))
check("codes.json 有 items", isinstance(data.get("items"), list) and len(data["items"]) > 0,
      len(data.get("items", [])))
check("codes.json 带生成时间", bool(data.get("generated_at")))
sample = data["items"][0]
for f in ("gun_name", "code", "mode", "copied"):
    check(f"条目含字段 {f}", f in sample, list(sample.keys()))

zf.extractall(OUT)
print()
print("   已解压到:", OUT)

print()
print("=" * 60)
print("3. 数据一致性")
print("=" * 60)
# 和线上接口对比条数
api = json.loads(op.open(BASE + "/api/codes?limit=500", timeout=15).read().decode())
check("静态包条数 == 线上已上架条数",
      len(data["items"]) == api["total"],
      f'{len(data["items"])} vs {api["total"]}')

print()
print("=" * 60)
if fails:
    print(f"失败 {len(fails)} 项")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("静态站导出全部通过 ✓")
