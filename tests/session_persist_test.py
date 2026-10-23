# -*- coding: utf-8 -*-
"""验证会话持久化：登录 → 重启服务 → 会话仍然有效。"""
import json
import sys
import io
import http.cookiejar
import urllib.request
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8151"
PW = open(r"D:\z1383\deepseak\deltaforce-codes\data\.admin-password",
          encoding="utf-8").read().strip()

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
    with op.open(r, timeout=10) as resp:
        return json.loads(resp.read().decode())

def get(path):
    with op.open(BASE + path, timeout=10) as resp:
        return json.loads(resp.read().decode())

mode = sys.argv[2] if len(sys.argv) > 2 else "login"

if mode == "login":
    post("/api/admin/login", {"password": PW})
    d = get("/api/admin/session")
    check("登录后会话有效", d.get("loggedIn") is True, d)
    # 保存 cookie 供第二阶段使用
    for c in jar:
        print("COOKIE:", c.name, c.value)
    print("STAGE1_OK")
else:
    d = get("/api/admin/session")
    check("重启后会话仍然有效（不用重新登录）", d.get("loggedIn") is True, d)
    # 关键：重启后直接调 parse 不应 401
    try:
        r = post("/api/admin/parse", {"text": "腾龙突击步枪-全面战场-6IL87QG013CE082VBOHIS"})
        check("重启后解析接口可用", len(r.get("items", [])) >= 1, r)
    except urllib.error.HTTPError as e:
        check("重启后解析接口可用", False, f"HTTP {e.code}")
    print("STAGE2_DONE")

if fails:
    print("失败:", fails)
    sys.exit(1)
