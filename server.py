"""КиберЩит — бэкенд. Только стандартная библиотека Python 3.10+.

Запуск: python server.py  ->  http://localhost:8000
Настройки — в файле .env (пример: .env.example).
"""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
STATIC = ROOT / "static"


def load_env(path=ROOT / ".env"):
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                v = v.strip().strip('"\'')
                if v:  # пустое значение = значение по умолчанию
                    os.environ.setdefault(k.strip(), v)


load_env()
env = os.environ.get
DB = env("CYBERSHIELD_DB", str(ROOT / "cybershield.db"))
PORT = int(env("PORT", "8000"))
AI_BASE_URL = env("AI_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
AI_API_KEY = env("AI_API_KEY", "")
AI_MODEL = env("AI_MODEL", "llama-3.3-70b-versatile")
# Тестовые ключи Cloudflare: проверка всегда проходит. Для продакшена задай свои в .env
TURNSTILE_SITE_KEY = env("TURNSTILE_SITE_KEY", "1x00000000000000000000AA")
TURNSTILE_SECRET = env("TURNSTILE_SECRET", "1x0000000000000000000000000000000AA")
YOUTUBE_ID = env("YOUTUBE_ID", "")
ADMIN_NICKS = {n.strip().casefold() for n in env("ADMIN_NICKS", "").split(",") if n.strip()}
TRUST_PROXY = env("TRUST_PROXY", "") == "1"  # за Cloudflare: брать IP из CF-Connecting-IP
SESSION_DAYS = 30

ACHIEVEMENT_IDS = {
    "first_step", "perfect", "lightning", "no_hint", "streak5", "streak10", "hard_win", "score1000", "quiz5",
    "answered100", "det_first", "det_3", "det_all", "det_clean", "det_clues", "sort_first", "sort_perfect",
    "surv_first", "surv_20", "surv_50", "all_games", "kb_reader", "checklist_full", "ai_talk", "registered", "poster",
}

MIGRATIONS = [
    """
    create table users(
      id integer primary key,
      nick text not null,
      nick_key text not null unique,
      display_name text not null default '',
      bio text not null default '',
      pw_hash text not null,
      incognito integer not null default 0,
      consent_at text not null,
      created_at text not null default current_timestamp,
      last_login_at text,
      failed_logins integer not null default 0,
      locked_until real not null default 0
    );
    create table sessions(
      token_hash text primary key,
      user_id integer not null references users(id) on delete cascade,
      created_at text not null default current_timestamp,
      expires_at real not null,
      ip text, user_agent text
    );
    create index sessions_user on sessions(user_id);
    create table user_stats(
      user_id integer primary key references users(id) on delete cascade,
      data text not null default '{}',
      updated_at text not null default current_timestamp
    );
    create table user_achievements(
      user_id integer not null references users(id) on delete cascade,
      achievement_id text not null,
      unlocked_at text not null default current_timestamp,
      primary key(user_id, achievement_id)
    );
    create table posts(
      id integer primary key,
      user_id integer not null references users(id) on delete cascade,
      text text not null,
      hidden integer not null default 0,
      created_at text not null default current_timestamp
    );
    create index posts_created on posts(created_at);
    create table likes(
      post_id integer not null references posts(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      created_at text not null default current_timestamp,
      primary key(post_id, user_id)
    );
    create table reports(
      post_id integer not null references posts(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      created_at text not null default current_timestamp,
      primary key(post_id, user_id)
    );
    """,
]


class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


def err(code, msg):
    raise ApiError(code, msg)


def connect():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("pragma foreign_keys=on")
    return c


def init_db():
    c = connect()
    c.execute("pragma journal_mode=wal")
    version = c.execute("pragma user_version").fetchone()[0]
    for i, sql in enumerate(MIGRATIONS[version:], start=version + 1):
        c.executescript(f"begin; {sql}; pragma user_version={i}; commit;")
    c.close()


def clip(v, n):
    return str(v or "").strip()[:n]


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + "$" + hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200_000).hex()


def check_pw(pw, stored):
    return secrets.compare_digest(hash_pw(pw, stored.split("$")[0]), stored)


def sha(token):
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- защита ----------
_hits = defaultdict(deque)
_hits_lock = threading.Lock()


def rate_limit(key, limit, window):
    # ponytail: лимиты в памяти процесса; при нескольких процессах вынести в БД/Redis
    now = time.time()
    with _hits_lock:
        q = _hits[key]
        while q and q[0] < now - window:
            q.popleft()
        if len(q) >= limit:
            err(429, "Слишком много запросов. Подожди немного и попробуй снова.")
        q.append(now)


def verify_turnstile(token, ip):
    if not token:
        err(400, "Подтверди, что ты не робот")
    data = urllib.parse.urlencode({"secret": TURNSTILE_SECRET, "response": token, "remoteip": ip}).encode()
    try:
        with urllib.request.urlopen("https://challenges.cloudflare.com/turnstile/v0/siteverify", data, timeout=10) as r:
            ok = json.load(r).get("success")
    except Exception as e:
        print("Turnstile error:", e)
        err(503, "Не удалось проверить защиту от роботов. Попробуй ещё раз.")
    if not ok:
        err(400, "Проверка на робота не пройдена. Обнови страницу.")


BAD_WORDS = re.compile(
    r"(?<![а-яё])(х[уy][йеёяию]|п[иі]зд|[её]б[аеиуо]|бл[яе]д|сук[аи]|муд[ао]к|пид[оа]р|г[ао]вн|дерьм|шлюх|залуп|сдохн|убью|ненавижу)",
    re.I)
PERSONAL = re.compile(r"(\+?\d[\d\s()\-]{8,}\d)|([\w.+-]+@[\w-]+\.[\w.]+)|(https?://|www\.|t\.me/)", re.I)


def check_text(text):
    if BAD_WORDS.search(text):
        err(400, "В сообщении есть грубые слова. Давай общаться вежливо.")
    if PERSONAL.search(text):
        err(400, "Не публикуй телефоны, почту и ссылки — это личные данные и частый приём мошенников.")


# ---------- AI ----------
SAFETY = (
    "Аудитория — дети и подростки 10–17 лет из Беларуси. Пиши по-русски, просто и доброжелательно, коротко (до 120 слов), "
    "без запугивания и страшных подробностей. Никогда не проси имя, адрес, телефон, школу, фото, пароли или данные карты. "
    "Не помогай взламывать, обманывать или травить кого-либо — мягко откажи и объясни, почему это вредно и наказуемо. "
    "Не обсуждай темы, не связанные с безопасностью в интернете, — вежливо верни разговор к теме. "
    "Если ребёнку страшно, его травят, шантажируют или обманули — посоветуй сразу рассказать родителям или педагогу; "
    "телефоны: милиция 102, Республиканская детская телефонная линия 8-801-100-16-11 (бесплатно, анонимно, круглосуточно). "
    "Номера статей называй только если уверен: УК РБ ст. 209 (мошенничество), 212 (хищение путём модификации компьютерной информации), "
    "222 (незаконный оборот платёжных инструментов, средств платежа и их реквизитов), 349, 350, 352, 354, 355 (гл. 31); "
    "уголовная ответственность в общем случае с 16 лет, за ст. 212 — с 14 лет (ст. 27 УК). Закон № 99-З «О защите персональных данных». "
    "Иначе советуй проверить на pravo.by. Можно выделять **жирным** и делать списки через •."
)
CONSULTANT = "Ты — КиберAI, консультант детской образовательной платформы «КиберЩит» по кибербезопасности. " + SAFETY
HELPER = (
    "Ты — помощник по сайту «КиберЩит». Отвечай 1–2 предложениями. Разделы сайта и метки перехода: "
    "квиз-тренажёр [[go:quiz]], кибер-детектив [[go:detective]], кибер-сортировка [[go:sort]], режим «На выживание» [[go:survival]], "
    "база знаний [[go:kb]], советы и чеклист [[go:tips]], Уголовный кодекс [[go:uk]], Конституция [[go:constitution]], "
    "достижения [[go:achievements]], AI-консультант [[go:ai]], профиль и лента [[go:profile]]. "
    "Если подходит раздел — добавь в конец ответа его метку. Сложные вопросы о безопасности отправляй к консультанту [[go:ai]]. "
) + SAFETY

def ai_reply(body):
    msgs = []
    for m in (body.get("messages") or [])[-12:]:
        if isinstance(m, dict) and clip(m.get("content"), 1500):
            msgs.append({"role": "assistant" if m.get("role") == "assistant" else "user",
                         "content": clip(m.get("content"), 1500)})
    if not msgs or msgs[-1]["role"] != "user":
        err(400, "Пустой вопрос")
    mode = "helper" if body.get("mode") == "helper" else "consultant"
    if AI_API_KEY:
        try:
            req = urllib.request.Request(
                AI_BASE_URL + "/chat/completions",
                data=json.dumps({"model": AI_MODEL, "max_tokens": 500, "temperature": 0.4,
                                 "messages": [{"role": "system", "content": HELPER if mode == "helper" else CONSULTANT}] + msgs
                                 }).encode(),
                headers={"Authorization": "Bearer " + AI_API_KEY, "Content-Type": "application/json", "User-Agent": "CyberShield/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                text = json.load(r)["choices"][0]["message"]["content"]
            if text and text.strip():
                return text.strip()
        except Exception as e:  # сеть/ключ/лимит — браузер ответит из встроенной базы (AI_FALLBACK в data.js)
            print("AI error:", e)
    return None


# ---------- данные пользователя ----------
def user_payload(c, u):
    stats = c.execute("select data from user_stats where user_id=?", (u["id"],)).fetchone()
    ach = c.execute("select achievement_id, unlocked_at from user_achievements where user_id=? order by unlocked_at",
                    (u["id"],)).fetchall()
    return {"id": u["id"], "nick": u["nick"], "display_name": u["display_name"], "bio": u["bio"],
            "incognito": bool(u["incognito"]), "created_at": u["created_at"],
            "is_admin": u["nick_key"] in ADMIN_NICKS,
            "stats": json.loads(stats["data"]) if stats else {},
            "achievements": [{"id": a["achievement_id"], "unlocked_at": a["unlocked_at"]} for a in ach]}


def merge_stats(old, new):
    out = dict(old)
    for k, v in new.items():
        if not isinstance(k, str) or len(k) > 32:
            continue
        if isinstance(v, bool) or isinstance(v, (int, float)):
            out[k] = max(out.get(k, 0) if isinstance(out.get(k), (int, float)) else 0, v)
        elif isinstance(v, list) and k == "checklist":  # чеклист можно снимать — заменяем целиком
            out[k] = [x for x in v if isinstance(x, int)][:20]
        elif isinstance(v, list):
            out[k] = list(dict.fromkeys([*out.get(k, []), *[clip(x, 40) for x in v[:50]]]))[:50]
    return out


def save_progress(c, uid, b):
    stats = b.get("stats") or {}
    if not isinstance(stats, dict) or len(json.dumps(stats)) > 20_000:
        err(400, "Некорректный прогресс")
    row = c.execute("select data from user_stats where user_id=?", (uid,)).fetchone()
    merged = merge_stats(json.loads(row["data"]) if row else {}, stats)
    c.execute("insert into user_stats(user_id, data) values(?, ?) on conflict(user_id) do update "
              "set data=excluded.data, updated_at=current_timestamp", (uid, json.dumps(merged)))
    # ponytail: достижения проверяются на клиенте, сервер лишь сверяет id; для рейтингов перенести проверку на сервер
    for aid in set(b.get("achievements") or []) & ACHIEVEMENT_IDS:
        c.execute("insert or ignore into user_achievements(user_id, achievement_id) values(?, ?)", (uid, aid))


def new_session(c, u, ip, ua):
    token = secrets.token_urlsafe(32)
    c.execute("insert into sessions(token_hash, user_id, expires_at, ip, user_agent) values(?,?,?,?,?)",
              (sha(token), u["id"], time.time() + SESSION_DAYS * 86400, ip, clip(ua, 200)))
    c.execute("update users set last_login_at=current_timestamp, failed_logins=0, locked_until=0 where id=?", (u["id"],))
    return {"token": token, "user": user_payload(c, u)}


# ---------- маршруты ----------
def route(c, method, path, b, user, ip, ua):
    if method == "GET" and path == "/api/config":
        return {"turnstileSiteKey": TURNSTILE_SITE_KEY, "youtubeId": YOUTUBE_ID, "ai": bool(AI_API_KEY)}

    if method == "POST" and path == "/api/register":
        rate_limit("auth:" + ip, 10, 600)
        nick, pw = clip(b.get("nick"), 40), str(b.get("password") or "")
        if not re.fullmatch(r"[\w.-]{3,20}", nick):
            err(400, "Никнейм: от 3 до 20 символов — буквы, цифры, _ . -")
        if len(pw) < 8:
            err(400, "Пароль должен быть не короче 8 символов")
        if pw.casefold() == nick.casefold() or pw in ("12345678", "123456789", "qwertyui", "password"):
            err(400, "Этот пароль слишком простой — придумай другой")
        if not b.get("consent"):
            err(400, "Нужно согласие с правилами и разрешение родителей")
        display = clip(b.get("display_name"), 30)
        check_text(nick + " " + display)
        verify_turnstile(b.get("turnstile"), ip)
        try:
            cur = c.execute("insert into users(nick, nick_key, display_name, pw_hash, consent_at) values(?,?,?,?,current_timestamp)",
                            (nick, nick.casefold(), display, hash_pw(pw)))
        except sqlite3.IntegrityError:
            err(409, "Такой никнейм уже занят")
        u = c.execute("select * from users where id=?", (cur.lastrowid,)).fetchone()
        c.execute("insert into user_achievements(user_id, achievement_id) values(?, 'registered')", (u["id"],))
        return new_session(c, u, ip, ua)

    if method == "POST" and path == "/api/login":
        rate_limit("auth:" + ip, 10, 600)
        verify_turnstile(b.get("turnstile"), ip)
        u = c.execute("select * from users where nick_key=?", (clip(b.get("nick"), 40).casefold(),)).fetchone()
        if u and u["locked_until"] > time.time():
            err(429, "Слишком много неудачных попыток. Попробуй через 15 минут.")
        if not u or not check_pw(str(b.get("password") or ""), u["pw_hash"]):
            if u:
                c.execute("update users set failed_logins=failed_logins+1, locked_until=case when failed_logins+1>=5 "
                          "then ? else 0 end where id=?", (time.time() + 900, u["id"]))
                c.commit()
            err(401, "Неверный никнейм или пароль")
        return new_session(c, u, ip, ua)

    if method == "POST" and path == "/api/ai":
        rate_limit("ai:" + ip, 20, 600)
        return {"reply": ai_reply(b)}

    if method == "GET" and path == "/api/posts":
        me = user["id"] if user else 0
        rows = c.execute("""
          select p.id, p.text, p.created_at, p.user_id, u.nick, u.incognito,
            (select count(*) from likes l where l.post_id=p.id) likes,
            exists(select 1 from likes l where l.post_id=p.id and l.user_id=?) liked,
            exists(select 1 from reports r where r.post_id=p.id and r.user_id=?) reported
          from posts p join users u on u.id=p.user_id
          where p.hidden=0 order by p.id desc limit 100""", (me, me)).fetchall()
        return {"posts": [{"id": r["id"], "text": r["text"], "created_at": r["created_at"],
                           "author": "Аноним" if r["incognito"] and r["user_id"] != me else r["nick"],
                           "likes": r["likes"], "liked": bool(r["liked"]), "reported": bool(r["reported"]),
                           "mine": r["user_id"] == me} for r in rows]}

    if not user:
        err(401, "Нужно войти в профиль")
    uid = user["id"]

    if path == "/api/me" and method == "GET":
        return {"user": user_payload(c, user)}
    if path == "/api/me" and method == "POST":
        display, bio = clip(b.get("display_name", user["display_name"]), 30), clip(b.get("bio", user["bio"]), 200)
        check_text(display + " " + bio)
        c.execute("update users set display_name=?, bio=?, incognito=? where id=?",
                  (display, bio, int(bool(b.get("incognito", user["incognito"]))), uid))
        return {"user": user_payload(c, c.execute("select * from users where id=?", (uid,)).fetchone())}
    if path == "/api/progress" and method == "POST":
        save_progress(c, uid, b)
        return {"user": user_payload(c, user)}
    if path == "/api/progress" and method == "DELETE":
        c.execute("delete from user_stats where user_id=?", (uid,))
        c.execute("delete from user_achievements where user_id=? and achievement_id!='registered'", (uid,))
        return {"user": user_payload(c, user)}
    if path == "/api/logout" and method == "POST":
        c.execute("delete from sessions where token_hash=?", (user["_token_hash"],))
        return {"ok": True}
    if path == "/api/posts" and method == "POST":
        rate_limit(f"post:{uid}", 5, 300)
        text = clip(b.get("text"), 300)
        if len(text) < 2:
            err(400, "Напиши хотя бы пару слов")
        check_text(text)
        c.execute("insert into posts(user_id, text) values(?, ?)", (uid, text))
        return {"ok": True}

    m = re.fullmatch(r"/api/posts/(\d+)(/like|/report)?", path)
    if m:
        pid, action = int(m[1]), m[2]
        post = c.execute("select * from posts where id=?", (pid,)).fetchone()
        if not post:
            err(404, "Пост не найден")
        if action == "/like" and method == "POST":
            if c.execute("delete from likes where post_id=? and user_id=?", (pid, uid)).rowcount == 0:
                c.execute("insert into likes(post_id, user_id) values(?, ?)", (pid, uid))
            return {"ok": True}
        if action == "/report" and method == "POST":
            c.execute("insert or ignore into reports(post_id, user_id) values(?, ?)", (pid, uid))
            if c.execute("select count(*) from reports where post_id=?", (pid,)).fetchone()[0] >= 3:
                c.execute("update posts set hidden=1 where id=?", (pid,))
            return {"ok": True}
        if not action and method == "DELETE":
            if post["user_id"] != uid and user["nick_key"] not in ADMIN_NICKS:
                err(403, "Можно удалять только свои записи")
            c.execute("delete from posts where id=?", (pid,))
            return {"ok": True}
    err(404, "Не найдено")


CSP = ("default-src 'self'; script-src 'self' https://challenges.cloudflare.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
       "img-src 'self' data: https://i.ytimg.com; connect-src 'self'; "
       "frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com; "
       "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(STATIC), **k)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        super().do_GET()

    def do_POST(self):
        self.api("POST")

    def do_DELETE(self):
        self.api("DELETE")

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", CSP)
        super().end_headers()

    def client_ip(self):
        return (TRUST_PROXY and self.headers.get("CF-Connecting-IP")) or self.client_address[0]

    def send_json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def api(self, method):
        c = connect()
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 64_000:
                err(413, "Слишком большой запрос")
            body = json.loads(self.rfile.read(n)) if n else {}
            if not isinstance(body, dict):
                err(400, "Ожидается JSON-объект")
            token = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
            user = None
            if token:
                row = c.execute("select u.*, s.token_hash _token_hash from sessions s join users u on u.id=s.user_id "
                                "where s.token_hash=? and s.expires_at>?", (sha(token), time.time())).fetchone()
                user = dict(row) if row else None
            out = route(c, method, self.path.split("?")[0], body, user, self.client_ip(), self.headers.get("User-Agent"))
            c.commit()
            self.send_json(out)
        except ApiError as e:
            self.send_json({"error": e.msg}, e.code)
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "Некорректный запрос"}, 400)
        finally:
            c.close()


if __name__ == "__main__":
    init_db()
    print(f"КиберЩит: http://localhost:{PORT}  |  AI: {AI_MODEL + ' @ ' + AI_BASE_URL if AI_API_KEY else 'встроенные ответы (нет AI_API_KEY)'}"
          f"  |  Turnstile: {'тестовый ключ' if TURNSTILE_SITE_KEY.startswith('1x000') else 'боевой ключ'}")
    print("Остановить: Ctrl+C")
    with ThreadingHTTPServer(("", PORT), Handler) as srv:
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен")
