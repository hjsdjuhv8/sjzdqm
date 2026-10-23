#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
三角洲行动 · 改枪码库
=====================
零依赖（Python 标准库 + SQLite）的单文件后端。

    python3 server.py              # 开发：http://127.0.0.1:8000
    python3 server.py --port 8080  # 换端口

首次启动会自动建库、生成 .admin-password（只打印一次）、写入 3 条示例数据。

目录结构
    server.py      后端（HTTP 路由 / 静态文件 / API）
    static/        前端页面（纯 HTML + CSS + JS，无构建步骤）
    data/          codes.db + .admin-password（部署时只备份这个目录）

安全提醒
    本服务会把*游戏内生成的改枪码*公开给所有人查看，这是产品需求；
    但后台写入接口只允许持有密码的人调用。不要把管理密码放进前端代码。
"""

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import time
import base64
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
from http.cookies import SimpleCookie

# ----------------------------------------------------------------------------
# 路径与常量
# ----------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "codes.db")
PASSWORD_FILE = os.path.join(DATA_DIR, ".admin-password")

STATIC_PREFIX = "/static/"
MAX_BODY = 32 * 1024 * 1024          # 单次请求体上限 32MB（够几万条粘贴）
HARD_BODY_LIMIT = 256 * 1024 * 1024  # 超过这个直接断连，不去读
LOGIN_WINDOW = 600                   # 登录失败统计窗口（秒）
LOGIN_MAX_FAILS = 10                 # 窗口内允许的失败次数
COOKIE_NAME = "df_admin"
SESSION_TTL = 7 * 24 * 3600          # 后台登录有效期 7 天

GUN_CATEGORIES = [
    "突击步枪", "战斗步枪", "冲锋枪", "射手步枪",
    "狙击步枪", "霰弹枪", "轻机枪", "手枪",
]
MODES = ["烽火地带", "全面战场"]


# ----------------------------------------------------------------------------
# 改枪码解析
# ----------------------------------------------------------------------------
# 游戏里点「分享」得到的一串文本，形态是：
#   枪名-模式-码        例：腾龙突击步枪-全面战场-6IL87QG013CE082VBOHIS
#   枪名-码             例：AUG突击步枪-6IL87QG013CE082VBOHIS
#   纯码                例：6IL87QG013CE082VBOHIS
# 注意开头有可能是 "突击步枪-" 这种（枪名被截断），所以统一用「模式词」定位。
#
# 下面这份别名表把视频里/玩家口里的俗称，归一到「能精确检索」的展示名。
# 部署后直接改这里就能扩表，不需要动前端。

ALIAS = {
    "腾龙": "腾龙突击步枪",
    "ak12": "AK-12突击步枪",
    "ak-12": "AK-12突击步枪",
    "akm": "AKM突击步枪",
    "m7": "M7战斗步枪",
    "asval": "AS Val突击步枪",
    "as val": "AS Val突击步枪",
    "k416": "K416突击步枪",
    "kc17": "KC17突击步枪",
    "mp5": "MP5冲锋枪",
    "mk4": "MK4冲锋枪",
    "m249": "M249轻机枪",
    "qjb201": "QJB201轻机枪",
    "qbz95": "QBZ95突击步枪",
    "qbz-95": "QBZ95突击步枪",
    "aug": "AUG突击步枪",
    "sr25": "SR-25射手步枪",
    "sr-25": "SR-25射手步枪",
    "r93": "R93狙击步枪",
    "scar": "SCAR-H战斗步枪",
    "scar-h": "SCAR-H战斗步枪",
    "m16a4": "M16A4突击步枪",
    "sv98": "SV-98狙击步枪",
    "sv-98": "SV-98狙击步枪",
    "aks74u": "AKS-74U突击步枪",
    "aks-74u": "AKS-74U突击步枪",
    "vector": "Vector冲锋枪",
    "m1014": "M1014霰弹枪",
    "p90": "P90冲锋枪",
}

# 没写模式时，按枪名猜一个默认值（可手动改，这里只影响导入时的预填）
MODE_HINT = {
    "腾龙突击步枪": "全面战场",
    "AK-12突击步枪": "全面战场",
    "AKM突击步枪": "全面战场",
    "M7战斗步枪": "全面战场",
    "AS Val突击步枪": "全面战场",
    "K416突击步枪": "全面战场",
    "KC17突击步枪": "全面战场",
    "MP5冲锋枪": "全面战场",
    "MK4冲锋枪": "全面战场",
    "M249轻机枪": "全面战场",
    "QJB201轻机枪": "全面战场",
    "QBZ95突击步枪": "全面战场",
    "AUG突击步枪": "全面战场",
    "SR-25射手步枪": "全面战场",
    "R93狙击步枪": "全面战场",
    "SCAR-H战斗步枪": "烽火地带",
    "M16A4突击步枪": "烽火地带",
    "SV-98狙击步枪": "烽火地带",
    "AKS-74U突击步枪": "烽火地带",
    "Vector冲锋枪": "烽火地带",
    "M1014霰弹枪": "烽火地带",
    "P90冲锋枪": "烽火地带",
}

# 分类推测：只做前缀匹配兜底，解析结果始终允许人工覆盖
CATEGORY_HINTS = [
    ("突击步枪", "突击步枪"), ("战斗步枪", "战斗步枪"), ("射手步枪", "射手步枪"),
    ("狙击步枪", "狙击步枪"), ("冲锋枪", "冲锋枪"), ("霰弹枪", "霰弹枪"),
    ("轻机枪", "轻机枪"), ("机枪", "轻机枪"), ("手枪", "手枪"),
]

CJK = re.compile(r"[\u4e00-\u9fff]")


def guess_category(name: str) -> str:
    for suffix, cat in CATEGORY_HINTS:
        if name.endswith(suffix) or suffix in name:
            return cat
    if CJK.search(name):
        return "其他"
    return "其他"


CATEGORY_NAMES = set(GUN_CATEGORIES) | {"其他"}
PREFIX_BRACKET = re.compile(r"^\s*[【\[（(][^】\]）)]*[】\]）)]\s*")
HASHTAG = re.compile(r"#[^\s#]+")
BULLET_NUM = re.compile(r"^\d{1,2}\s*[.、)）]\s*")          # "1. " "2、" 这类序号
LEAD_NOISE = re.compile(r"^[\s*·•、,，。:：>》\-—_|]+")
SEP = re.compile(r"[\s\-—_|·]+")
CODE_CHARS = re.compile(r"^[A-Za-z0-9_]+$")


def normalize_gun_name(raw: str) -> str:
    """把俗称/截断的枪名尽量还原成展示名。"""
    s = (raw or "").strip().strip("-—–_|·• ")
    if not s:
        return ""

    # 已经是完整的展示名（以兵种分类结尾）就别再切了，否则 "AK-12" 会被切坏
    for suffix in sorted(GUN_CATEGORIES, key=len, reverse=True):
        if s.endswith(suffix):
            return s

    key = re.sub(r"\s+", "", s).lower()
    if key in ALIAS:
        return ALIAS[key]

    # 形如 "三角洲行动】腾龙" 或 "武器：腾龙"：取最后一段再试一次
    if SEP.search(s):
        tail = SEP.split(s)[-1].strip()
        if tail:
            k2 = re.sub(r"\s+", "", tail).lower()
            if k2 in ALIAS:
                return ALIAS[k2]
            for suffix in sorted(GUN_CATEGORIES, key=len, reverse=True):
                if tail.endswith(suffix):
                    return tail
            if CJK.search(tail) and len(tail) >= 2:
                s = tail
    return s


def _clean_line(text: str) -> str:
    text = (text or "").replace("\ufeff", "").strip()
    text = PREFIX_BRACKET.sub("", text)           # 【三角洲行动】xxx
    text = HASHTAG.sub("", text)                  # #三角洲 这类话题标签
    text = text.strip("「」『』【】\"'“”‘’")
    text = text.replace("—", "-").replace("–", "-").replace("－", "-")
    # 序号和项目符号可能交替出现（"- 1. xxx"），多洗几遍
    for _ in range(3):
        before = text
        text = LEAD_NOISE.sub("", text)
        text = BULLET_NUM.sub("", text)
        if text == before:
            break
    return text.strip()


def _split_mode(rest: str):
    """从 "枪名-模式" 里取出模式；模式必须出现在末尾才算数。"""
    best_i, best_m = -1, ""
    for m in MODES:
        i = rest.rfind(m)
        if i > best_i:
            best_i, best_m = i, m
    if best_i < 0:
        return rest, ""
    tail = rest[best_i + len(best_m):].strip("-—–_ ")
    if tail:                       # 模式词后面还有东西 → 不是模式位
        return rest, ""
    gun = rest[:best_i].strip("-—–_ ")
    return gun, best_m


def parse_code(raw: str) -> dict:
    """
    解析一行分享文本，返回 {ok, gunName, mode, code, category, reason}。
    思路：先在整行里找出唯一的那串「不含中文、长度≥6」的内容当作码，
    剩下的部分再切出「枪名」和「模式」。
    """
    text = _clean_line(raw)
    if not text:
        return {"ok": False, "reason": "空行"}

    # 1) 找码：取最后一个符合条件的无中文片段（码总是在末尾）
    segments = [s for s in SEP.split(text) if s]
    code, code_idx = "", -1
    for i in range(len(segments) - 1, -1, -1):
        seg = segments[i]
        if (len(seg) >= 6 and not CJK.search(seg) and CODE_CHARS.match(seg)
                and (re.search(r"\d", seg) or len(seg) >= 10)):
            code, code_idx = seg, i
            break

    if not code:
        return {"ok": False, "reason": "没找到码",
                "gunName": normalize_gun_name(text)}

    # 2) 剩下的部分（去掉码本身）里切枪名与模式
    rest = text.replace(code, "", 1)
    rest = "-".join([p for p in re.split(r"[\s\-—–_|·]+", rest) if p.strip()])
    gun_raw, mode = _split_mode(rest)

    gun_name = normalize_gun_name(gun_raw)
    if gun_name in CATEGORY_NAMES:      # "突击步枪" 这种是被截断的，不是枪名
        gun_name = ""
    if not mode and gun_name:
        mode = MODE_HINT.get(gun_name, "")

    result = {
        "ok": bool(gun_name),
        "gunName": gun_name,
        "mode": mode,
        "code": code,
        "category": guess_category(gun_name),
        "reason": "" if gun_name else "缺枪名（码已识别，请补枪名）",
    }
    return result


def split_batch(raw_text: str):
    """把一大段粘贴内容切成若干条，跳过空行与明显的非码行。"""
    items, seen = [], set()
    for line in (raw_text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#") or line.startswith("//"):
            continue
        parsed = parse_code(line)
        if not parsed.get("code"):
            items.append({"input": line, "ok": False,
                          "reason": parsed.get("reason") or "无法识别"})
            continue
        parsed["input"] = line
        items.append(parsed)
        # 重复只做标记，不丢弃：已存在的码在导入时会被覆盖更新，这正是想要的
        if parsed["code"] in seen:
            parsed["duplicate"] = True
        seen.add(parsed["code"])
    return items


# ----------------------------------------------------------------------------
# 数据库
# ----------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    gun_name    TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT '其他',
    mode        TEXT NOT NULL DEFAULT '',
    season      TEXT NOT NULL DEFAULT '',
    price       INTEGER NOT NULL DEFAULT 0,
    tags        TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    video_url   TEXT NOT NULL DEFAULT '',
    build_cost  INTEGER NOT NULL DEFAULT 0,
    copied      INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'published',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_codes_gun  ON codes(gun_name);
CREATE INDEX IF NOT EXISTS idx_codes_mode ON codes(mode);
CREATE INDEX IF NOT EXISTS idx_codes_stat ON codes(status);

CREATE TABLE IF NOT EXISTS copy_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    code      TEXT NOT NULL,
    ts        TEXT NOT NULL,
    ip_hash   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_code ON copy_events(code);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token   TEXT PRIMARY KEY,
    expires INTEGER NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = db_connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
        row = conn.execute("SELECT COUNT(*) AS n FROM codes").fetchone()
        if row["n"] == 0:
            seed(conn)
    finally:
        conn.close()
    ensure_password()


def seed(conn: sqlite3.Connection):
    """首次启动写入几条示例，方便你马上看到效果；正式用之前清掉即可。"""
    samples = [
        ("腾龙突击步枪-全面战场-6IL87QG013CE082VBOHIS", "腾龙突击步枪", "突击步枪",
         "全面战场", "S9", 300000, "30发弹匣,无导气,快攻", "容错率高、机动性拉满，适合快攻突袭", "", 8),
        ("SCAR-H战斗步枪-5116089223937551183-烽火地带", "SCAR-H战斗步枪", "战斗步枪",
         "烽火地带", "S9", 150000, "稳定,中距离", "中距离压制，后坐力可控", "", 5),
        ("AUG突击步枪-全面战场-6IL88AC013CE082VBOHIS", "AUG突击步枪", "突击步枪",
         "全面战场", "S9", 220000, "高倍镜,压枪稳", "中距离架点，射击稳定性好", "", 6),
    ]
    ts = now_iso()
    for code, gun, cat, mode, season, price, tags, notes, video, copied in samples:
        conn.execute(
            "INSERT OR IGNORE INTO codes (code,gun_name,category,mode,season,price,tags,"
            "notes,video_url,copied,status,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (code, gun, cat, mode, season, price, tags, notes, video, copied,
             "published", ts, ts),
        )
    conn.commit()


def ensure_password():
    if os.path.exists(PASSWORD_FILE):
        return None
    pw = base64.urlsafe_b64encode(secrets.token_bytes(12)).decode().rstrip("=")
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PASSWORD_FILE, "w", encoding="utf-8") as f:
        f.write(pw + "\n")
    try:
        os.chmod(PASSWORD_FILE, 0o600)
    except OSError:
        pass
    return pw


def read_password() -> str:
    try:
        with open(PASSWORD_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        pw = ensure_password()
        return pw or ""


# ----------------------------------------------------------------------------
# 会话与限流
# ----------------------------------------------------------------------------
# 会话持久化到数据库：否则服务一重启（双击 start.bat 每次都会重启）
# 你就得重新登录一次，而且在「已登录」界面上点按钮会突然报错。
# 限流计数放内存无所谓，重启清零可以接受。

_login_fails = {}   # ip -> [时间戳...]  仅登录限流用，重启清零可接受


def make_session() -> str:
    token = secrets.token_urlsafe(32)
    exp = int(time.time() + SESSION_TTL)
    conn = db_connect()
    try:
        conn.execute("DELETE FROM sessions WHERE expires < ?", (int(time.time()),))
        conn.execute("INSERT INTO sessions (token, expires) VALUES (?,?)", (token, exp))
        conn.commit()
    finally:
        conn.close()
    return token


def session_valid(token: str) -> bool:
    if not token:
        return False
    conn = db_connect()
    try:
        row = conn.execute("SELECT expires FROM sessions WHERE token = ?",
                           (token,)).fetchone()
        if not row:
            return False
        if row["expires"] < time.time():
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
            return False
        return True
    finally:
        conn.close()


def drop_session(token: str):
    if not token:
        return
    conn = db_connect()
    try:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
    finally:
        conn.close()


def prune_sessions():
    t = time.time()
    for ip in [ip for ip, hits in _login_fails.items()
               if not hits or hits[-1] < t - LOGIN_WINDOW]:
        _login_fails.pop(ip, None)
    conn = db_connect()
    try:
        conn.execute("DELETE FROM sessions WHERE expires < ?", (int(t),))
        conn.commit()
    finally:
        conn.close()


def login_blocked(ip: str) -> bool:
    hits = [h for h in _login_fails.get(ip, []) if h > time.time() - LOGIN_WINDOW]
    _login_fails[ip] = hits
    return len(hits) >= LOGIN_MAX_FAILS


def record_fail(ip: str):
    _login_fails.setdefault(ip, []).append(time.time())


def hash_ip(ip: str) -> str:
    return hashlib.sha256((ip or "").encode()).hexdigest()[:16]


# ----------------------------------------------------------------------------
# HTTP 处理器
# ----------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    server_version = "DFCodes/1.0"

    # -- 基础设施 ---------------------------------------------------------

    def log_message(self, fmt, *args):  # 静音默认日志，只留错误
        pass

    def _send_json(self, obj, status=200, extra_headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return b""
        if length > HARD_BODY_LIMIT:
            # 超大：读掉也没意义，直接断连
            self.close_connection = True
            raise ConnectionAbortedError("payload far too large")
        if length > MAX_BODY:
            # 必须先把请求体读完再回 413。否则客户端还在写，我们发完就关，
            # 内核会用 RST 打断它，客户端只会看到 ConnectionAborted 而不是错误码。
            CHUNK, guard = 65536, length
            while guard > 0:
                got = self.rfile.read(min(CHUNK, guard))
                if not got:
                    break
                guard -= len(got)
            self._send_json({"ok": False, "error": "请求体过大，请分批导入"}, 413,
                            extra_headers={"Connection": "close"})
            self.close_connection = True
            raise ConnectionAbortedError("payload too large")
        return self.rfile.read(length)

    def _json_body(self):
        raw = self._read_body()
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"JSON 解析失败: {exc}")

    def _client_ip(self):
        fwd = self.headers.get("X-Forwarded-For")
        if fwd:
            return fwd.split(",")[0].strip()
        return self.client_address[0] if self.client_address else ""

    def _is_https(self):
        """判断用户是不是通过 HTTPS 访问的（反代场景看 X-Forwarded-Proto）。"""
        proto = (self.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip()
        return proto == "https"

    def _cookie_flags(self):
        # 走 HTTPS 时必须加 Secure，否则公网上这个登录态可以被明文嗅探劫持
        return "; Secure" if self._is_https() else ""

    def _cookie_token(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return ""
        try:
            c = SimpleCookie()
            c.load(raw)
            morsel = c.get(COOKIE_NAME)
            return morsel.value if morsel else ""
        except Exception:
            return ""

    def _require_admin(self):
        if session_valid(self._cookie_token()):
            return True
        self._send_json({"ok": False, "error": "未登录或登录已过期"}, 401)
        return False

    # -- 路由 -------------------------------------------------------------

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == "/":
                return self._serve_static("index.html")
            if path.startswith(STATIC_PREFIX):
                rel = path[len(STATIC_PREFIX):]
                return self._serve_static(rel)
            if path.startswith("/api/"):
                return self._api_get(path)
            # 给每个改枪码一个可分享的独立地址，抖音评论区可以直挂
            m = re.match(r"^/c/([A-Za-z0-9_\-.]+)/?$", path)
            if m:
                return self._serve_static("index.html")
            if path in ("/admin", "/admin/"):
                return self._serve_static("admin.html")
            return self._serve_static("404.html", status=404)
        except Exception as exc:  # noqa: BLE001
            self._send_json({"ok": False, "error": f"服务端错误: {exc}"}, 500)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/admin/login":
                return self.api_login()
            if path.startswith("/api/admin/"):
                if not self._require_admin():
                    return None
                return self._api_admin_post(path)
            if path == "/api/copy":
                return self.api_copy()
            self._send_json({"ok": False, "error": "接口不存在"}, 404)
        except ValueError as exc:
            self._send_json({"ok": False, "error": str(exc)}, 400)
        except ConnectionAbortedError:
            pass                      # 413 已经回过，这里不再二次响应
        except Exception as exc:  # noqa: BLE001
            self._send_json({"ok": False, "error": f"服务端错误: {exc}"}, 500)

    # -- 静态文件 ---------------------------------------------------------

    def _serve_static(self, rel, status=200):
        rel = unquote(rel or "")
        target = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not target.startswith(STATIC_DIR + os.sep) and target != STATIC_DIR:
            return self._send_json({"ok": False, "error": "非法路径"}, 400)
        if not os.path.isfile(target):
            if rel != "404.html":
                return self._serve_static("404.html", status=404)
            self._send_json({"ok": False, "error": "未找到"}, 404)
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".ico": "image/x-icon",
            ".txt": "text/plain; charset=utf-8",
        }.get(os.path.splitext(target)[1].lower(), "application/octet-stream")
        with open(target, "rb") as f:
            data = f.read()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if target.endswith(".html"):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # -- 公开 API ---------------------------------------------------------

    def _api_get(self, path):
        if path == "/api/codes":
            return self.api_list()
        if path == "/api/codes/export":
            return self.api_export()
        if path == "/api/codes/static":
            return self.api_build_static()
        if path == "/api/health":
            return self._send_json({"ok": True, "ts": now_iso()})
        if path == "/api/meta":
            conn = db_connect()
            try:
                total = conn.execute(
                    "SELECT COUNT(*) n FROM codes WHERE status='published'").fetchone()["n"]
                guns = [r["gun_name"] for r in conn.execute(
                    "SELECT DISTINCT gun_name FROM codes WHERE status='published' "
                    "ORDER BY gun_name")]
                seasons = [r["season"] for r in conn.execute(
                    "SELECT DISTINCT season FROM codes WHERE status='published' "
                    "AND season<>'' ORDER BY season DESC")]
            finally:
                conn.close()
            return self._send_json({
                "ok": True, "total": total, "guns": guns, "seasons": seasons,
                "categories": GUN_CATEGORIES, "modes": MODES,
            })
        if path == "/api/admin/session":
            return self._send_json({"ok": True,
                                    "loggedIn": session_valid(self._cookie_token())})
        if path == "/api/admin/list":
            if not self._require_admin():
                return None
            return self.api_admin_list()
        self._send_json({"ok": False, "error": "接口不存在"}, 404)

    def api_list(self):
        qs = parse_qs(urlparse(self.path).query)
        q = (qs.get("q", [""])[0] or "").strip()
        mode = (qs.get("mode", [""])[0] or "").strip()
        category = (qs.get("category", [""])[0] or "").strip()
        season = (qs.get("season", [""])[0] or "").strip()
        sort = (qs.get("sort", ["hot"])[0] or "hot").strip()
        try:
            limit = max(1, min(int(qs.get("limit", ["50"])[0] or 50), 500))
            offset = max(0, int(qs.get("offset", ["0"])[0] or 0))
        except ValueError:
            limit, offset = 50, 0

        where = ["status='published'"]
        args = []
        if q:
            like = f"%{q}%"
            where.append("(gun_name LIKE ? OR tags LIKE ? OR notes LIKE ? OR code LIKE ? "
                         "OR category LIKE ?)")
            args += [like, like, like, like, like]
        if mode:
            where.append("mode = ?")
            args.append(mode)
        if category:
            where.append("category = ?")
            args.append(category)
        if season:
            where.append("season = ?")
            args.append(season)

        order = {
            "hot": "copied DESC, id DESC",
            "new": "id DESC",
            "name": "gun_name ASC, copied DESC",
            "price": "price ASC, copied DESC",
        }.get(sort, "copied DESC, id DESC")

        sql = ("SELECT id,code,gun_name,category,mode,season,price,tags,notes,video_url,"
               "copied,updated_at FROM codes WHERE " + " AND ".join(where) +
               " ORDER BY " + order + " LIMIT ? OFFSET ?")

        conn = db_connect()
        try:
            total = conn.execute(
                "SELECT COUNT(*) n FROM codes WHERE " + " AND ".join(where), args
            ).fetchone()["n"]
            rows = conn.execute(sql, args + [limit, offset]).fetchall()
        finally:
            conn.close()

        items = [dict(r) for r in rows]
        return self._send_json({"ok": True, "total": total, "limit": limit,
                                "offset": offset, "items": items})

    def api_export(self):
        """整库导出成纯文本，一行一条，方便你自己留档或迁移。"""
        if not self._require_admin():
            return
        conn = db_connect()
        try:
            rows = conn.execute(
                "SELECT gun_name,mode,code FROM codes ORDER BY gun_name, id").fetchall()
        finally:
            conn.close()
        lines = []
        for r in rows:
            if r["mode"]:
                lines.append(f'{r["gun_name"]}-{r["mode"]}-{r["code"]}')
            else:
                lines.append(f'{r["gun_name"]}-{r["code"]}')
        self.send_response(200)
        body = ("\n".join(lines) + "\n").encode("utf-8")
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Disposition",
                         'attachment; filename="gun-codes.txt"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_build_static(self):
        """
        把「前台 + 数据」打包成一个 zip，解压后直接传对象存储/静态托管即可上线。
        这样你的粉丝点开的是一个固定链接，不依赖你的电脑开着。
        """
        if not self._require_admin():
            return
        import io
        import zipfile

        conn = db_connect()
        try:
            rows = conn.execute(
                "SELECT id,code,gun_name,category,mode,season,price,tags,notes,"
                "video_url,copied,updated_at FROM codes "
                "WHERE status='published' ORDER BY copied DESC, id DESC").fetchall()
        finally:
            conn.close()

        payload = {
            "ok": True,
            "generated_at": now_iso(),
            "total": len(rows),
            "items": [dict(r) for r in rows],
        }
        data_json = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        files = {
            "index.html": None,
            "styles.css": None,
            "app.js": None,
            "404.html": None,
        }
        for name in files:
            path = os.path.join(STATIC_DIR, name)
            with open(path, "rb") as f:
                files[name] = f.read()

        # 静态模式下关掉 /api 探测，直接读 codes.json；路径全部改成相对路径，
        # 这样放进任何子目录（对象存储路径、GitHub Pages 项目页）都能用。
        index_html = files["index.html"].decode("utf-8")
        index_html = (index_html
                      .replace('href="/static/styles.css"', 'href="styles.css"')
                      .replace('src="/static/app.js"',
                               'src="app.js"')
                      .replace('<script src="app.js"></script>',
                               '<script>window.DF_STATIC = true;</script>\n'
                               '<script src="app.js"></script>')
                      .replace('href="/"', 'href="./"'))

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("index.html", index_html)
            zf.writestr("styles.css", files["styles.css"])
            zf.writestr("app.js", files["app.js"])
            zf.writestr("404.html", files["404.html"])
            zf.writestr("codes.json", data_json)

        body = buf.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header(
            "Content-Disposition",
            'attachment; filename="gun-codes-static.zip"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def api_copy(self):
        """复制计数：只做计数，不记录任何身份信息，IP 只存哈希。"""
        try:
            payload = self._json_body()
        except ValueError:
            payload = {}
        code = (payload.get("code") or "").strip()
        if not code:
            return self._send_json({"ok": False, "error": "缺少 code"}, 400)
        conn = db_connect()
        try:
            cur = conn.execute(
                "UPDATE codes SET copied = copied + 1, updated_at = ? "
                "WHERE code = ? AND status='published'",
                (now_iso(), code),
            )
            if cur.rowcount == 0:
                return self._send_json({"ok": False, "error": "码不存在"}, 404)
            conn.execute(
                "INSERT INTO copy_events (code, ts, ip_hash) VALUES (?,?,?)",
                (code, now_iso(), hash_ip(self._client_ip())),
            )
            conn.commit()
        finally:
            conn.close()
        return self._send_json({"ok": True})

    # -- 后台 API ---------------------------------------------------------

    def api_login(self):
        ip = self._client_ip()
        if login_blocked(ip):
            return self._send_json(
                {"ok": False, "error": "尝试次数过多，请 10 分钟后再试"}, 429)
        payload = self._json_body()
        pw = (payload.get("password") or "").strip()
        if not pw or not hmac.compare_digest(pw, read_password()):
            record_fail(ip)
            return self._send_json({"ok": False, "error": "密码错误"}, 401)
        token = make_session()
        cookie = (f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; "
                  f"Max-Age={SESSION_TTL}{self._cookie_flags()}")
        return self._send_json({"ok": True},
                               extra_headers={"Set-Cookie": cookie})

    def _api_admin_post(self, path):
        if path == "/api/admin/logout":
            drop_session(self._cookie_token())
            return self._send_json(
                {"ok": True},
                extra_headers={"Set-Cookie": f"{COOKIE_NAME}=; Path=/; Max-Age=0"})
        if path == "/api/admin/parse":
            payload = self._json_body()
            text = payload.get("text") or ""
            return self._send_json({"ok": True, "items": split_batch(text)})
        if path == "/api/admin/import":
            return self.api_import()
        if path == "/api/admin/delete":
            return self.api_delete()
        if path == "/api/admin/list":
            return self.api_admin_list()
        if path == "/api/admin/save":
            return self.api_save()
        self._send_json({"ok": False, "error": "接口不存在"}, 404)

    def api_admin_list(self):
        """后台列表：能看到草稿和下线状态的条目。"""
        qs = parse_qs(urlparse(self.path).query)
        q = (qs.get("q", [""])[0] or "").strip()
        where, args = [], []
        if q:
            like = f"%{q}%"
            where.append("(gun_name LIKE ? OR code LIKE ? OR tags LIKE ?)")
            args += [like, like, like]
        sql = ("SELECT * FROM codes "
               + ("WHERE " + " AND ".join(where) + " " if where else "")
               + "ORDER BY id DESC LIMIT 3000")
        conn = db_connect()
        try:
            rows = conn.execute(sql, args).fetchall()
        finally:
            conn.close()
        self._send_json({"ok": True, "items": [dict(r) for r in rows]})

    def api_import(self):
        """
        批量导入。请求体：
            { "text": "整段粘贴", "defaults": {"mode":"","category":"","season":""} }
        或直接给结构化行：
            { "rows": [{gunName,mode,code,tags,notes,price,season,category,videoUrl}] }
        """
        payload = self._json_body()
        defaults = payload.get("defaults") or {}
        rows = []

        if isinstance(payload.get("rows"), list):
            for r in payload["rows"]:
                if not isinstance(r, dict):
                    continue
                code = (r.get("code") or "").strip()
                gun = (r.get("gunName") or "").strip()
                if not code:
                    continue
                rows.append({
                    "code": code,
                    "gunName": gun or "未命名",
                    "category": (r.get("category") or defaults.get("category")
                                 or guess_category(gun)),
                    "mode": r.get("mode") or defaults.get("mode") or "",
                    "season": r.get("season") or defaults.get("season") or "",
                    "price": int(r.get("price") or 0),
                    "tags": (r.get("tags") or "").strip(),
                    "notes": (r.get("notes") or "").strip(),
                    "video_url": (r.get("videoUrl") or "").strip(),
                })
        else:
            parsed = split_batch(payload.get("text") or "")
            for p in parsed:
                if not p.get("ok"):
                    continue
                gun = p.get("gunName") or "未命名"
                rows.append({
                    "code": p["code"],
                    "gunName": gun,
                    "category": defaults.get("category") or p.get("category")
                    or guess_category(gun),
                    "mode": p.get("mode") or defaults.get("mode") or "",
                    "season": p.get("season") or defaults.get("season") or "",
                    "price": 0,
                    "tags": (p.get("tags") or "").strip(),
                    "notes": (p.get("notes") or "").strip(),
                    "video_url": "",
                })

        if not rows:
            return self._send_json({"ok": False, "error": "没有解析出任何有效条目",
                                    "inserted": 0, "updated": 0, "skipped": 0}, 400)

        ts = now_iso()
        inserted = updated = 0
        conn = db_connect()
        try:
            for r in rows:
                existed = conn.execute(
                    "SELECT id FROM codes WHERE code = ?", (r["code"],)).fetchone()
                if existed:
                    # 已存在的码：覆盖可编辑字段，但保留复制计数
                    conn.execute(
                        "UPDATE codes SET gun_name=?,category=?,mode=?,season=?,tags=?,"
                        "notes=?,video_url=?,updated_at=? WHERE code=?",
                        (r["gunName"], r["category"], r["mode"], r["season"],
                         r["tags"], r["notes"], r["video_url"], ts, r["code"]))
                    updated += 1
                else:
                    conn.execute(
                        "INSERT INTO codes (code,gun_name,category,mode,season,price,tags,"
                        "notes,video_url,copied,status,created_at,updated_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,0,'published',?,?)",
                        (r["code"], r["gunName"], r["category"], r["mode"],
                         r["season"], r["price"], r["tags"], r["notes"],
                         r["video_url"], ts, ts))
                    inserted += 1
            conn.commit()
        finally:
            conn.close()
        return self._send_json({"ok": True, "inserted": inserted,
                                "updated": updated, "total": len(rows)})

    def api_save(self):
        """单条编辑（后台表格里改字段）。"""
        payload = self._json_body()
        code = (payload.get("code") or "").strip()
        if not code:
            return self._send_json({"ok": False, "error": "缺少 code"}, 400)
        fields = {
            "gun_name": (payload.get("gunName") or "").strip(),
            "category": (payload.get("category") or "其他").strip(),
            "mode": (payload.get("mode") or "").strip(),
            "season": (payload.get("season") or "").strip(),
            "tags": (payload.get("tags") or "").strip(),
            "notes": (payload.get("notes") or "").strip(),
            "video_url": (payload.get("videoUrl") or "").strip(),
            "status": (payload.get("status") or "published").strip(),
        }
        try:
            fields["price"] = int(payload.get("price") or 0)
        except (TypeError, ValueError):
            fields["price"] = 0
        conn = db_connect()
        try:
            existed = conn.execute("SELECT id FROM codes WHERE code=?",
                                   (code,)).fetchone()
            if not existed:
                return self._send_json({"ok": False, "error": "码不存在"}, 404)
            conn.execute(
                "UPDATE codes SET gun_name=?,category=?,mode=?,season=?,tags=?,notes=?,"
                "video_url=?,status=?,price=?,updated_at=? WHERE code=?",
                (fields["gun_name"] or "未命名", fields["category"], fields["mode"],
                 fields["season"], fields["tags"], fields["notes"],
                 fields["video_url"], fields["status"], fields["price"],
                 now_iso(), code))
            conn.commit()
        finally:
            conn.close()
        return self._send_json({"ok": True})

    def api_delete(self):
        payload = self._json_body()
        code = (payload.get("code") or "").strip()
        if not code:
            return self._send_json({"ok": False, "error": "缺少 code"}, 400)
        conn = db_connect()
        try:
            cur = conn.execute("DELETE FROM codes WHERE code=?", (code,))
            conn.execute("DELETE FROM copy_events WHERE code=?", (code,))
            conn.commit()
        finally:
            conn.close()
        if cur.rowcount == 0:
            return self._send_json({"ok": False, "error": "码不存在"}, 404)
        return self._send_json({"ok": True})


# ----------------------------------------------------------------------------
# 启动
# ----------------------------------------------------------------------------

def lan_ips():
    """尽量列出本机的局域网地址，方便让别人先用手机试试。"""
    ips = set()
    try:
        import socket
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    # UDP 连接法：不会真的发包，但能拿到出口网卡地址
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(("223.5.5.5", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


def main():
    # Windows 控制台默认可能是 GBK，直接 print 中文会乱码/报错
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="三角洲改枪码库")
    ap.add_argument("--host", default="127.0.0.1",
                    help="监听地址；服务器上部署用 0.0.0.0")
    ap.add_argument("--port", type=int, default=8000, help="监听端口")
    ap.add_argument("--reset", action="store_true",
                    help="清空数据库后重新建库（仅保留示例数据），用于清理测试数据")
    args = ap.parse_args()

    os.makedirs(STATIC_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)

    if args.reset:
        for suffix in ("", "-wal", "-shm"):
            path = DB_PATH + suffix
            if os.path.exists(path):
                os.remove(path)
        print("已清空数据库，将以示例数据重建。")

    generated = ensure_password()
    init_db()

    print("=" * 60)
    print("  三角洲行动 · 改枪码库")
    print("=" * 60)
    shown = "0.0.0.0" if args.host == "0.0.0.0" else args.host
    print(f"  前台     http://{shown}:{args.port}/")
    print(f"  后台     http://{shown}:{args.port}/admin")
    print(f"  数据库   {DB_PATH}")
    if args.host == "0.0.0.0":
        print("-" * 60)
        print("  已监听所有网卡，别人可以通过你的公网 IP / 域名访问。")
        for ip in lan_ips():
            print(f"    局域网试试： http://{ip}:{args.port}/")
        print("  注意：公网能访问还需要在路由器/防火墙放行这个端口，")
        print("       并且强烈建议套 HTTPS（见 README）。")
    else:
        print("-" * 60)
        print("  当前只允许本机访问。要让别人访问，用 --host 0.0.0.0 启动。")
    if generated:
        print("-" * 60)
        print(f"  已生成管理密码： {generated}")
        print("  （只显示这一次，已保存到 data/.admin-password）")
    else:
        print(f"  管理密码见  {PASSWORD_FILE}")
    print("=" * 60)
    sys.stdout.flush()

    handler = partial(Handler, directory=STATIC_DIR)
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    httpd.daemon_threads = True
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
