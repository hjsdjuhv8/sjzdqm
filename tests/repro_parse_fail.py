# -*- coding: utf-8 -*-
"""复现用户场景：后台页面已登录并加载了列表，然后会话失效 → 点击解析会怎样。"""
import json
import sys
import io
import sqlite3
import http.cookiejar
import urllib.request
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
WD = r"D:\z1383\deepseak\deltaforce-codes"
PW = open(WD + r"\data\.admin-password", encoding="utf-8").read().strip()

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def post(path, data):
    r = urllib.request.Request(BASE + path, data=json.dumps(data).encode(),
                               headers={"Content-Type": "application/json"})
    try:
        with op.open(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return e.code, body
    except Exception as e:
        return "EXC", f"{type(e).__name__}: {e}"

def get(path):
    try:
        with op.open(BASE + path, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return "EXC", f"{type(e).__name__}: {e}"

print("=" * 62)
print("1. 正常登录 → 加载列表（模拟页面刚打开的状态）")
print("=" * 62)
st, d = post("/api/admin/login", {"password": PW})
print(f"  login: {st} {d}")
st, d = get("/api/admin/list")
print(f"  list : {st} 条数={len(d.get('items', [])) if isinstance(d, dict) else d}")

print()
print("=" * 62)
print("2. 模拟会话过期（直接从数据库删掉该 session）")
print("=" * 62)
tok = None
for c in jar:
    if c.name == "df_admin":
        tok = c.value
print(f"  当前 token: {tok[:16]}...")
conn = sqlite3.connect(WD + r"\data\codes.db")
n = conn.execute("DELETE FROM sessions WHERE token=?", (tok,)).rowcount
conn.commit()
conn.close()
print(f"  已删除 session 行数: {n}")

print()
print("=" * 62)
print("3. 再点「解析预览」（这就是用户遇到的情况）")
print("=" * 62)
st, d = post("/api/admin/parse",
             {"text": "腾龙突击步枪-全面战场-6IL87QG013CE082VBOHIS\nK416-烽火地带-6IF9CIC08C3ND23MR2PJT"})
print(f"  parse: HTTP {st}")
print(f"  body : {d}")

print()
print("=" * 62)
print("4. 会话无效后，列表接口是否也失败？（前端会切到登录页）")
print("=" * 62)
st, d = get("/api/admin/list")
print(f"  list : HTTP {st}  {str(d)[:120]}")
