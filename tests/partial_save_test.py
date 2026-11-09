# -*- coding: utf-8 -*-
"""验证 api_save 只更新传入字段，不会清空其他字段。"""
import json
import sys
import io
import http.cookiejar
import urllib.request
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8903"
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
    with op.open(r, timeout=15) as resp:
        return json.loads(resp.read().decode())

def get(path):
    with op.open(BASE + path, timeout=15) as resp:
        return json.loads(resp.read().decode())

post("/api/admin/login", {"password": PW})
items = get("/api/admin/list?q=")["items"]
target = items[0]
code = target["code"]
print("测试条目:", code)
print("原值:", json.dumps({k: target[k] for k in
      ("gun_name", "category", "mode", "season", "variant", "price_tier", "notes")},
      ensure_ascii=False))

print()
print("=== 只传 variant 和 notes，其他字段应保持不变 ===")
post("/api/admin/save", {"code": code, "variant": "满改", "notes": "局部更新测试"})

after = [x for x in get("/api/admin/list?q=")["items"] if x["code"] == code][0]
print("更新后:", json.dumps({k: after[k] for k in
      ("gun_name", "category", "mode", "season", "variant", "price_tier", "notes")},
      ensure_ascii=False))

check("枪名未被清空", after["gun_name"] == target["gun_name"],
      f'{target["gun_name"]} -> {after["gun_name"]}')
check("分类未被清空", after["category"] == target["category"],
      f'{target["category"]} -> {after["category"]}')
check("模式未被清空", after["mode"] == target["mode"],
      f'{target["mode"]} -> {after["mode"]}')
check("赛季未被清空", after["season"] == target["season"],
      f'{target["season"]} -> {after["season"]}')
check("variant 已更新为满改", after["variant"] == "满改", after["variant"])
check("notes 已更新", after["notes"] == "局部更新测试", after["notes"])

print()
print("=== 还原 ===")
post("/api/admin/save", {"code": code, "variant": "", "notes": "",
                         "priceTier": "", "price": 0})
final = [x for x in get("/api/admin/list?q=")["items"] if x["code"] == code][0]
check("已还原", final["variant"] == "" and final["notes"] == "",
      f'variant={final["variant"]} notes={final["notes"]}')
check("枪名仍完好", bool(final["gun_name"]) and final["gun_name"] != "未命名",
      final["gun_name"])

print()
if fails:
    print("失败:", fails)
    sys.exit(1)
print("局部更新验证通过 ✓")
