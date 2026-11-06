"""КиберЩит — необязательный бэкенд: раздаёт сайт и подключает нейросеть к КиберAI.
Аккаунты и прогресс хранятся в куках браузера, базы данных нет.
Без сервера (GitHub Pages) сайт работает целиком, КиберAI отвечает из встроенной базы.

Запуск: python server.py  ->  http://localhost:8000
Настройки — в файле .env.
"""
import json
import os
import threading
import time
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
                v = v.strip().strip("\"'")
                if v:  # пустое значение = значение по умолчанию
                    os.environ.setdefault(k.strip(), v)


load_env()
env = os.environ.get
PORT = int(env("PORT", "8000"))
AI_BASE_URL = env("AI_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
AI_API_KEY = env("AI_API_KEY", "")
AI_MODEL = env("AI_MODEL", "llama-3.3-70b-versatile")
YOUTUBE_ID = env("YOUTUBE_ID", "")
TRUST_PROXY = env("TRUST_PROXY", "") == "1"  # за Cloudflare: брать IP из CF-Connecting-IP


class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


def err(code, msg):
    raise ApiError(code, msg)


def clip(v, n):
    return str(v or "").strip()[:n]


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
    "достижения [[go:achievements]], AI-консультант [[go:ai]], профиль и награды [[go:profile]]. "
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


def route(method, path, b, ip):
    if method == "GET" and path == "/api/config":
        return {"youtubeId": YOUTUBE_ID, "ai": bool(AI_API_KEY)}
    if method == "POST" and path == "/api/ai":
        rate_limit("ai:" + ip, 20, 600)
        return {"reply": ai_reply(b)}
    err(404, "Не найдено")


CSP = ("default-src 'self'; script-src 'self'; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
       "img-src 'self' data: https://i.ytimg.com; connect-src 'self'; "
       "frame-src https://www.youtube-nocookie.com; "
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

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", CSP)
        super().end_headers()

    def send_json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def api(self, method):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 64_000:
                err(413, "Слишком большой запрос")
            body = json.loads(self.rfile.read(n)) if n else {}
            if not isinstance(body, dict):
                err(400, "Ожидается JSON-объект")
            ip = (TRUST_PROXY and self.headers.get("CF-Connecting-IP")) or self.client_address[0]
            self.send_json(route(method, self.path.split("?")[0], body, ip))
        except ApiError as e:
            self.send_json({"error": e.msg}, e.code)
        except ValueError:
            self.send_json({"error": "Некорректный запрос"}, 400)


if __name__ == "__main__":
    print(f"КиберЩит: http://localhost:{PORT}  |  AI: {AI_MODEL + ' @ ' + AI_BASE_URL if AI_API_KEY else 'встроенные ответы (нет AI_API_KEY)'}")
    print("Остановить: Ctrl+C")
    with ThreadingHTTPServer(("", PORT), Handler) as srv:
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен")
