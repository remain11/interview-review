"""八股复习站本地服务（仅标准库）

python server.py [--port 8765] [--lan] [--no-browser]

  默认只监听 127.0.0.1。
  --lan  监听所有网卡，允许 Tailscale(100.64.0.0/10) 和局域网私有地址访问；
         非本机访问需要口令（data/token.txt，首次启动自动生成），
         手机第一次打开 http://<主机>:8765/?key=<口令> 后浏览器会记住。

- 静态文件: static/
- GET   /api/bank   合并 data/bank/*.json 的全部题目
- GET   /api/state  答题状态（含 rev 版本号）
- POST  /api/patch  增量更新（多设备同时用不会互相覆盖）
- PUT   /api/state  整体覆盖（仅用于导入进度）
每次写入前备份上一版到 state.bak.json，另外每天保留一份 data/backups/state-YYYYMMDD.json。
"""
import argparse
import hmac
import ipaddress
import json
import os
import secrets
import shutil
import subprocess
import threading
import time
import webbrowser
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
BANK = ROOT / "data" / "bank"
# BAGU_DATA 可以把进度/口令放到别的目录（测试用，避免碰到真实进度）
USER_DATA = Path(os.environ.get("BAGU_DATA") or ROOT / "data")
STATE = USER_DATA / "state.json"
BACKUPS = USER_DATA / "backups"
TOKEN_FILE = USER_DATA / "token.txt"
LOCK = threading.Lock()
MAX_BODY = 20 * 1024 * 1024
COOKIE = "bagu_key"

# --lan 时允许的来源网段（本机永远允许且免口令）
ALLOWED_NETS = [ipaddress.ip_network(n) for n in (
    "100.64.0.0/10", "fd7a:115c:a1e0::/48",              # Tailscale
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",     # 局域网
)]
TOKEN = ""


def load_bank() -> list:
    questions, seen = [], set()
    for f in sorted(BANK.glob("*.json")):
        for q in json.loads(f.read_text(encoding="utf-8")):
            if q["id"] in seen:
                continue
            seen.add(q["id"])
            questions.append(q)
    return questions


# ---------- 状态存取 ----------
def empty_state() -> dict:
    return {"version": 1, "rev": 0, "records": {}, "excluded": {}, "round": {"seen": {}, "started": 0},
            "daily": {}, "settings": {}}


def read_state() -> dict:
    st = empty_state()
    if STATE.exists():
        st.update(json.loads(STATE.read_text(encoding="utf-8")))
    # 旧格式兼容：daily 以前是 {n, known, ...}，现在只存题数；current/theme 改为每台设备各自保存
    st["daily"] = {k: (v.get("n", 0) if isinstance(v, dict) else int(v)) for k, v in st["daily"].items()}
    st.pop("current", None)
    st["settings"].pop("theme", None)
    return st


def write_state(st: dict):
    if STATE.exists():
        shutil.copyfile(STATE, STATE.with_suffix(".bak.json"))
        BACKUPS.mkdir(exist_ok=True)
        daily = BACKUPS / f"state-{time.strftime('%Y%m%d')}.json"
        if not daily.exists():
            shutil.copyfile(STATE, daily)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, STATE)


def apply_patch(st: dict, p: dict):
    """按题目粒度合并：同一道题以后写入的为准，不同题互不影响"""
    for key in ("records", "excluded"):
        for qid, v in (p.get(key) or {}).items():
            if v is None:
                st[key].pop(qid, None)
            else:
                st[key][qid] = v
    started = p.get("round_started")
    if started is not None and started != st["round"].get("started"):
        st["round"] = {"seen": {}, "started": started}
    for qid, v in (p.get("seen") or {}).items():
        if v:
            st["round"]["seen"][qid] = 1
        else:
            st["round"]["seen"].pop(qid, None)
    for day, inc in (p.get("daily_inc") or {}).items():
        st["daily"][day] = max(0, st["daily"].get(day, 0) + int(inc))
    if isinstance(p.get("settings"), dict):
        st["settings"] = {k: v for k, v in p["settings"].items() if k != "theme"}


# ---------- 访问控制 ----------
def load_token() -> str:
    if TOKEN_FILE.exists():
        tok = TOKEN_FILE.read_text(encoding="utf-8").strip()
        if tok:
            return tok
    tok = secrets.token_urlsafe(9)
    TOKEN_FILE.write_text(tok, encoding="utf-8")
    return tok


def client_ip(handler) -> ipaddress._BaseAddress:
    ip = ipaddress.ip_address(handler.client_address[0])
    if getattr(ip, "ipv4_mapped", None):
        ip = ip.ipv4_mapped
    return ip


LOGIN_PAGE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>八股复习 - 输入口令</title>
<body style="font-family:sans-serif;max-width:360px;margin:20vh auto;padding:0 20px">
<h2>八股复习</h2><p>{msg}</p>
<form method="get" action="/"><label>口令 <input name="key" autofocus style="width:100%;padding:8px;font-size:16px"></label>
<button style="margin-top:12px;padding:8px 20px;font-size:16px">进入</button></form>
<p style="color:#888;font-size:13px">口令在电脑上的 data/token.txt，启动窗口里也会打印。</p></body>"""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(STATIC), **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            return
        super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, text, code=200):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        """本机直接放行；其他来源必须在允许网段内且带正确口令。返回 False 时已经写好响应。"""
        ip = client_ip(self)
        if ip.is_loopback:
            return True
        if not any(ip in net for net in ALLOWED_NETS):
            self.send_error(403)
            return False
        url = urlsplit(self.path)
        key = parse_qs(url.query).get("key", [""])[0]
        if key:
            if hmac.compare_digest(key, TOKEN):
                # 口令正确：写入 cookie，并跳转去掉地址栏里的口令
                self.send_response(303)
                self.send_header("Set-Cookie", f"{COOKIE}={TOKEN}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict")
                self.send_header("Location", url.path or "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
            else:
                self.send_html(LOGIN_PAGE.format(msg="口令不对，再试一次。"), 401)
            return False
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        if COOKIE in cookie and hmac.compare_digest(cookie[COOKIE].value, TOKEN):
            return True
        if url.path.startswith("/api/"):
            self.send_json({"error": "unauthorized"}, 401)
        else:
            self.send_html(LOGIN_PAGE.format(msg="从其他设备访问需要口令。"), 401)
        return False

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("bad length")
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("body must be an object")
        return data

    def do_GET(self):
        if not self.authorized():
            return
        path = urlsplit(self.path).path
        if path == "/api/bank":
            return self.send_json(load_bank())
        if path == "/api/state":
            with LOCK:
                return self.send_json(read_state())
        return super().do_GET()

    def do_HEAD(self):
        if self.authorized():
            super().do_HEAD()

    def do_POST(self):
        if not self.authorized():
            return
        if urlsplit(self.path).path != "/api/patch":
            return self.send_json({"error": "not found"}, 404)
        try:
            patch = self.read_json()
            with LOCK:
                st = read_state()
                apply_patch(st, patch)
                st["rev"] += 1
                write_state(st)
                rev = st["rev"]
        except (ValueError, TypeError, AttributeError) as e:
            return self.send_json({"error": str(e)}, 400)
        return self.send_json({"ok": True, "rev": rev})

    def do_PUT(self):
        if not self.authorized():
            return
        if urlsplit(self.path).path != "/api/state":
            return self.send_json({"error": "not found"}, 404)
        try:
            data = self.read_json()
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        with LOCK:
            st = empty_state()
            apply_patch(st, {"records": data.get("records"), "excluded": data.get("excluded"),
                             "settings": data.get("settings"),
                             "round_started": (data.get("round") or {}).get("started", 0),
                             "seen": (data.get("round") or {}).get("seen")})
            st["daily"] = {k: (v.get("n", 0) if isinstance(v, dict) else int(v)) for k, v in (data.get("daily") or {}).items()}
            st["rev"] = read_state()["rev"] + 1
            write_state(st)
        return self.send_json({"ok": True, "rev": st["rev"]})


def tailscale_hosts() -> list[str]:
    """尽量找出本机的 Tailscale 地址，打印给用户用"""
    try:
        out = subprocess.run(["tailscale", "status", "--json"], capture_output=True, text=True, timeout=5)
        me = json.loads(out.stdout)["Self"]
        hosts = [me.get("DNSName", "").rstrip(".")] + [ip for ip in me.get("TailscaleIPs", []) if ":" not in ip]
        return [h for h in hosts if h]
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        return []


def main():
    global TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--lan", action="store_true", help="允许 Tailscale/局域网设备访问（需要口令）")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("0.0.0.0" if args.lan else "127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"八股复习站已启动: {url}  (Ctrl+C 退出)")
    if args.lan:
        TOKEN = load_token()
        print(f"其他设备访问口令: {TOKEN}   (data/token.txt，删除后重启会换新口令)")
        for h in tailscale_hosts():
            print(f"  手机打开: http://{h}:{args.port}/?key={TOKEN}")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
