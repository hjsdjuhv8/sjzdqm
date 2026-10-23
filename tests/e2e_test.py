# -*- coding: utf-8 -*-
"""端到端测试：真实 HTTP 请求，验证前台/后台全链路。"""
import json
import sys
import io
import http.cookiejar
import urllib.request
import urllib.parse
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8124"
PW = open(r"D:\z1383\deepseak\deltaforce-codes\data\.admin-password",
          encoding="utf-8").read().strip()

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

FAILS = []


def check(name, cond, detail=""):
    mark = "PASS" if cond else "FAIL"
    if not cond:
        FAILS.append(name)
    print(f"[{mark}] {name}" + (f"  -- {detail}" if detail and not cond else ""))


def req(path, data=None, method=None):
    url = BASE + path
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None
    r = urllib.request.Request(url, data=body, method=method or ("POST" if body else "GET"))
    if body:
        r.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with opener.open(r, timeout=15) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw.decode("utf-8"))
            except Exception:
                return resp.status, raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


print("=" * 66)
print("1. 未登录访问后台接口应被拒绝")
print("=" * 66)
st, d = req("/api/admin/list")
check("未登录 /api/admin/list 返回 401", st == 401, f"got {st}")
st, d = req("/api/admin/import", {"rows": [{"code": "x", "gunName": "y"}]})
check("未登录 /api/admin/import 返回 401", st == 401, f"got {st}")

print()
print("=" * 66)
print("2. 登录")
print("=" * 66)
st, d = req("/api/admin/login", {"password": "wrong-password"})
check("错误密码返回 401", st == 401, f"got {st}")
st, d = req("/api/admin/login", {"password": PW})
check("正确密码登录成功", st == 200 and d.get("ok"), f"got {st} {d}")
st, d = req("/api/admin/session")
check("会话状态 loggedIn", d.get("loggedIn") is True, str(d))

print()
print("=" * 66)
print("3. 批量解析（各种真实粘贴形态）")
print("=" * 66)
batch = "\n".join([
    "腾龙突击步枪-全面战场-6IL87QG013CE082VBOHIS",
    "AK-12突击步枪-全面战场-6IL88AC013CE082VBOHIS",
    "【三角洲行动】K416-烽火地带-6IF9CIC08C3ND23MR2PJT",
    "1. M249轻机枪-全面战场-QJB201TESTCODE01",
    "SCAR-H战斗步枪-5116089223937551183-烽火地带",
    "这条不是改枪码，应该被跳过",
    "",
])
st, d = req("/api/admin/parse", {"text": batch})
items = d.get("items", []) if isinstance(d, dict) else []
check("解析返回 200", st == 200, f"got {st}")
check("识别出 5 条有效码", len([i for i in items if i.get("code")]) == 5,
      str([i.get("code") for i in items]))
check("识别出 1 条无效行", len([i for i in items if not i.get("code")]) == 1, str(len(items)))
gun = {i["code"]: i for i in items if i.get("code")}
check("腾龙 → 枪名正确", gun.get("6IL87QG013CE082VBOHIS", {}).get("gunName") == "腾龙突击步枪",
      str(gun.get("6IL87QG013CE082VBOHIS")))
check("AK-12 未被连字符切坏",
      gun.get("6IL88AC013CE082VBOHIS", {}).get("gunName") == "AK-12突击步枪",
      str(gun.get("6IL88AC013CE082VBOHIS")))
check("带【】前缀仍能解析",
      gun.get("6IF9CIC08C3ND23MR2PJT", {}).get("gunName") == "K416突击步枪",
      str(gun.get("6IF9CIC08C3ND23MR2PJT")))
check("带序号仍能解析",
      gun.get("QJB201TESTCODE01", {}).get("gunName") == "M249轻机枪",
      str(gun.get("QJB201TESTCODE01")))
check("纯数字老式码的枪名不被码污染",
      gun.get("5116089223937551183", {}).get("gunName") == "SCAR-H战斗步枪",
      str(gun.get("5116089223937551183")))
check("模式识别正确",
      gun.get("6IL87QG013CE082VBOHIS", {}).get("mode") == "全面战场",
      str(gun.get("6IL87QG013CE082VBOHIS", {}).get("mode")))

print()
print("=" * 66)
print("4. 导入入库")
print("=" * 66)
rows = [{"code": i["code"], "gunName": i["gunName"], "mode": i.get("mode", ""),
         "season": "S9"} for i in items if i.get("code") and i.get("gunName")]

# 每次运行用唯一的码，保证「新增」这条断言可重复执行
RUN_TAG = str(int(__import__("time").time()))[-6:]
for r in rows:
    r["code"] = r["code"] + "-T" + RUN_TAG

st, d = req("/api/admin/import", {"rows": rows, "defaults": {"season": "S9"}})
check("导入成功", st == 200 and d.get("ok"), f"{st} {d}")
check("新增条数 > 0", d.get("inserted", 0) == len(rows), str(d))

st, d = req("/api/codes?limit=100")
check("前台能查到全部已上架", d.get("total", 0) >= 7, str(d.get("total")))

# 重复导入应变成 update 而不是报错
st, d2 = req("/api/admin/import", {"rows": rows, "defaults": {"season": "S9"}})
check("重复导入走更新而非新增", d2.get("updated", 0) == len(rows) and d2.get("inserted", 0) == 0,
      str(d2))

print()
print("=" * 66)
print("5. 搜索与筛选")
print("=" * 66)
st, d = req("/api/codes?q=" + urllib.parse.quote("腾龙"))
check("按枪名搜索命中", d.get("total", 0) >= 1, str(d.get("total")))
st, d = req("/api/codes?q=" + urllib.parse.quote("腾龙"))
check("搜索结果是腾龙那一条",
      all("腾龙" in i["gun_name"] for i in d.get("items", [])), str(d.get("items")))

st, d = req("/api/codes?mode=" + urllib.parse.quote("烽火地带"))
check("按模式筛选可用",
      all(i["mode"] == "烽火地带" for i in d.get("items", [])) and d.get("total", 0) >= 1,
      str(d.get("total")))

st, d = req("/api/codes?sort=name")
names = [i["gun_name"] for i in d.get("items", [])]
check("按枪名排序生效", names == sorted(names) or len(names) <= 1, str(names))

st, d = req("/api/codes?q=" + urllib.parse.quote("不存在的枪名xyz"))
check("无结果时返回空列表", d.get("total") == 0 and d.get("items") == [], str(d))

print()
print("=" * 66)
print("6. 复制计数")
print("=" * 66)
target = rows[0]["code"]
st, before = req("/api/codes?q=" + urllib.parse.quote(rows[0]["gunName"]))
n0 = next((i["copied"] for i in before["items"] if i["code"] == target), None)
st, d = req("/api/copy", {"code": target})
check("复制计数接口成功", st == 200 and d.get("ok"), f"{st} {d}")
st, after = req("/api/codes?q=" + urllib.parse.quote(rows[0]["gunName"]))
n1 = next((i["copied"] for i in after["items"] if i["code"] == target), None)
check("计数确实自增", n1 == n0 + 1, f"{n0} -> {n1}")
st, d = req("/api/copy", {"code": "NOT-EXIST-CODE"})
check("不存在的码返回 404", st == 404, f"got {st}")

print()
print("=" * 66)
print("7. 编辑与删除")
print("=" * 66)
st, d = req("/api/admin/save", {"code": target, "gunName": "腾龙突击步枪改",
                                "mode": "全面战场", "tags": "测试标签",
                                "price": 123456, "status": "published"})
check("单条保存成功", st == 200 and d.get("ok"), f"{st} {d}")
st, d = req("/api/codes?q=" + urllib.parse.quote("测试标签"))
check("保存的标签能被搜到", d.get("total", 0) >= 1, str(d))

st, d = req("/api/admin/save", {"code": target, "gunName": "腾龙突击步枪改",
                                "status": "draft"})
check("改为草稿成功", st == 200 and d.get("ok"), f"{st} {d}")
st, d = req("/api/codes?q=" + urllib.parse.quote("腾龙突击步枪改"))
check("草稿不在前台展示", d.get("total") == 0, str(d.get("total")))
st, d = req("/api/admin/list?q=" + urllib.parse.quote("腾龙突击步枪改"))
check("草稿在后台可见", len(d.get("items", [])) == 1, str(d))

st, d = req("/api/admin/delete", {"code": target})
check("删除成功", st == 200 and d.get("ok"), f"{st} {d}")
st, d = req("/api/codes?q=" + urllib.parse.quote(target))
check("删除后前台查不到", d.get("total") == 0,
      "total=%s items=%s" % (d.get("total"), d.get("items")))
st, d = req("/api/admin/list?q=" + urllib.parse.quote(target))
check("删除后后台也查不到", len(d.get("items", [])) == 0,
      "items=%s" % [i.get("code") for i in d.get("items", [])])

print()
print("=" * 66)
print("8. 安全与边界")
print("=" * 66)
st, d = req("/api/admin/login", {"password": PW})
check("重新登录（用于后续测试）", st == 200, str(st))

st, d = req("/api/admin/import", {"rows": [{"code": "", "gunName": ""}]})
check("空导入被拒绝", st == 400, f"got {st} {d}")

# 超大 body 应被拒绝（不是崩溃）
big = "A" * (33 * 1024 * 1024)
try:
    r = urllib.request.Request(BASE + "/api/copy",
                               data=json.dumps({"code": big}).encode(),
                               headers={"Content-Type": "application/json"})
    with opener.open(r, timeout=20) as resp:
        st = resp.status
except urllib.error.HTTPError as e:
    st = e.code
except Exception as e:
    st = f"ERR {type(e).__name__}"
check("超大请求体被拒绝而非崩溃", st in (400, 413, 500), f"got {st}")

st, d = req("/api/health")
check("健康检查正常", d.get("ok") is True, str(d))

print()
print("=" * 66)
print("9. 导出")
print("=" * 66)
try:
    with opener.open(BASE + "/api/codes/export", timeout=10) as resp:
        text = resp.read().decode("utf-8")
    st = resp.status
except urllib.error.HTTPError as e:
    text, st = "", e.code
lines = [l for l in text.splitlines() if l.strip()]
check("导出返回明文行", st == 200 and len(lines) >= 5, f"status={st} lines={len(lines)}")
check("导出行包含枪名与码", any("-" in l for l in lines), text[:200])

print()
print("=" * 66)
print("10. 清理测试数据（不污染真实数据库）")
print("=" * 66)
# 测试往真实库里写过带 RUN_TAG 的条目，结束时删干净。
# 注意：其中一条已在「删除功能」测试里被删掉，所以这里允许它返回 404。
cleaned = 0
already_gone = 0
for r in rows:
    st, _ = req("/api/admin/delete", {"code": r["code"]})
    if st == 200:
        cleaned += 1
    elif st == 404:
        already_gone += 1
print(f"  已清理 {cleaned} 条，{already_gone} 条此前已被删除（标记 -T{RUN_TAG}）")
check("测试数据已清理", cleaned + already_gone == len(rows),
      f"cleaned={cleaned} gone={already_gone} total={len(rows)}")

# 再确认库里确实没有残留
st, d = req("/api/codes?q=" + urllib.parse.quote("-T" + RUN_TAG))
check("库中无本次测试残留", d.get("total", -1) == 0, str(d.get("total")))

print()
print("=" * 66)
if FAILS:
    print(f"失败 {len(FAILS)} 项：")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("全部通过 ✓")

