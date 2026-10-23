#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键发布 —— 把本地数据库导出成 data/codes.json，然后 commit + push 到 GitHub。
EdgeOne 收到 push 会自动重新构建，链接内容随即更新。

用法：
    python publish.py                 # 导出 + 提交 + 推送
    python publish.py --no-push       # 只导出，不碰 git（先看看改了什么）
    python publish.py -m "新增腾龙码"  # 自定义提交信息
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "data", "codes.db")
JSON_OUT = os.path.join(BASE, "data", "codes.json")

FIELDS = ("id,code,gun_name,category,mode,season,price,tags,notes,"
          "video_url,copied,updated_at")


def export_json():
    if not os.path.exists(DB):
        print("[X] 找不到 data/codes.db，先在本地用 start.bat 导入数据。")
        return None
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"SELECT {FIELDS} FROM codes WHERE status='published' "
            f"ORDER BY copied DESC, id DESC").fetchall()
    finally:
        conn.close()
    items = [dict(r) for r in rows]
    payload = {"ok": True, "total": len(items), "items": items}
    os.makedirs(os.path.dirname(JSON_OUT), exist_ok=True)
    with open(JSON_OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"[√] 已导出 {len(items)} 条到 data/codes.json")
    return len(items)


def run(cmd, check=True):
    # 显式指定 utf-8：Windows 默认用 GBK 解码子进程输出，
    # git 输出里的中文会触发 UnicodeDecodeError（虽然命令其实成功了）。
    env = dict(os.environ, PYTHONIOENCODING="utf-8", GIT_TERMINAL_PROMPT="0")
    r = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=env)
    if check and r.returncode != 0:
        print(f"[X] 命令失败: {' '.join(cmd)}")
        print(r.stdout.strip())
        print(r.stderr.strip())
        return False, r
    return True, r


def publish(message):
    ok, r = run(["git", "rev-parse", "--is-inside-work-tree"], check=False)
    if not ok or "true" not in r.stdout:
        print("[X] 当前目录不是 git 仓库。先执行：")
        print("    git init && git add . && git commit -m 'init'")
        return False

    run(["git", "add", "data/codes.json"])

    ok, r = run(["git", "diff", "--cached", "--quiet"], check=False)
    if ok and r.returncode == 0:
        print("[i] data/codes.json 没有变化，无需提交。")
        return True

    ok, _ = run(["git", "commit", "-m", message])
    if not ok:
        return False
    print(f"[√] 已提交: {message}")

    ok, r = run(["git", "push"], check=False)
    if not ok:
        print("[!] push 失败，检查是否已设置 remote：")
        print("    git remote add origin https://github.com/你的用户名/仓库.git")
        return False
    print("[√] 已推送。EdgeOne 会自动重新构建（通常 1~2 分钟）。")
    return True


def main():
    ap = argparse.ArgumentParser(description="导出数据并发布到 GitHub")
    ap.add_argument("--no-push", action="store_true", help="只导出，不提交不推送")
    ap.add_argument("-m", "--message", default="更新改枪码数据",
                    help="提交信息")
    args = ap.parse_args()

    n = export_json()
    if n is None:
        return 1
    if args.no_push:
        print("[i] 跳过 git 操作（--no-push）")
        return 0
    return 0 if publish(args.message) else 1


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    sys.exit(main())
