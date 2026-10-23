# -*- coding: utf-8 -*-
"""模拟 EdgeOne 构建：在全新克隆的仓库里执行 buildCommand，校验产物。"""
import json
import os
import subprocess
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

REPO = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\z1383\AppData\Local\Temp\df_clone_test"

fails = []
def check(name, cond, detail=""):
    print(("[PASS] " if cond else "[FAIL] ") + name + ("" if cond else "  -- " + str(detail)))
    if not cond:
        fails.append(name)

print("=" * 62)
print("1. 检查 edgeone.json 构建配置")
print("=" * 62)
with open(os.path.join(REPO, "edgeone.json"), encoding="utf-8") as f:
    cfg = json.load(f)
build_cmd = cfg.get("buildCommand", "")
out_dir = cfg.get("outputDirectory", "")
print(f"  buildCommand   = {build_cmd}")
print(f"  outputDirectory = {out_dir}")
check("构建命令使用 node", "build.js" in build_cmd, build_cmd)
check("输出目录是 public", out_dir == "public", out_dir)
check("不再依赖 python 构建", "python" not in build_cmd.lower(), build_cmd)

print()
print("=" * 62)
print("2. 执行构建（真实跑一遍 buildCommand）")
print("=" * 62)

# edgeone.json 里写的是 "node build.js"
cmd = ["node", "build.js"]
print("  $ " + " ".join(cmd))
# 显式指定 utf-8：Windows 默认用 GBK 解码子进程输出，遇到中文会抛异常
env = dict(os.environ, PYTHONIOENCODING="utf-8")
r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True,
                   encoding="utf-8", errors="replace", shell=True, env=env)
print("  exit:", r.returncode)
for line in (r.stdout or "").strip().splitlines():
    print("  |", line)
if r.stderr and r.stderr.strip():
    print("  stderr:", r.stderr.strip()[:400])
check("构建成功退出", r.returncode == 0, r.returncode)

print()
print("=" * 62)
print("3. 校验产物")
print("=" * 62)
pub = os.path.join(REPO, "public")
check("public 目录已生成", os.path.isdir(pub))
if os.path.isdir(pub):
    files = sorted(os.listdir(pub))
    print("  产物:", files)
    for need in ("index.html", "styles.css", "app.js", "codes.json"):
        check(f"包含 {need}", need in files, files)

    with open(os.path.join(pub, "index.html"), encoding="utf-8") as f:
        html = f.read()
    check("index 无 /static/ 绝对路径", "/static/" not in html,
          [l for l in html.splitlines() if "/static/" in l][:2])
    check("已注入 DF_STATIC 开关", "DF_STATIC = true" in html)
    check("引用相对 styles.css", 'href="styles.css"' in html)
    check("引用相对 app.js", 'src="app.js"' in html)

    with open(os.path.join(pub, "codes.json"), encoding="utf-8") as f:
        data = json.load(f)
    check("codes.json 有数据", len(data.get("items", [])) > 0, len(data.get("items", [])))
    check("total 与实际一致", data.get("total") == len(data.get("items", [])),
          f'{data.get("total")} vs {len(data.get("items", []))}')

    # 关键：新分类与黑潮爆破是否进入数据
    items = data.get("items", [])
    cats = {i.get("category") for i in items}
    print("  出现的分类:", sorted(cats))
    check("分类已用新口径（不含'突击步枪'）", "突击步枪" not in cats, cats)

    # 老数据的模式
    modes = {i.get("mode") for i in items}
    print("  出现的模式:", sorted(modes))

    total_size = sum(os.path.getsize(os.path.join(pub, f)) for f in files)
    print(f"  总体积: {total_size/1024:.1f} KB")
    check("体积在合理范围(<5MB)", total_size < 5 * 1024 * 1024, total_size)

print()
print("=" * 62)
if fails:
    print(f"失败 {len(fails)} 项：")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("EdgeOne 构建模拟全部通过 ✓")
