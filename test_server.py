"""Самопроверка API: python test_server.py"""
import json
import os
import sqlite3
import tempfile
import threading
import urllib.error
import urllib.request

os.environ["CYBERSHIELD_DB"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["AI_API_KEY"] = ""
os.environ["ADMIN_NICKS"] = "admin"
import server  # noqa: E402

server.AI_API_KEY = ""
turnstile_calls = []
server.verify_turnstile = lambda tok, ip: turnstile_calls.append(tok) or (tok or server.err(400, "нет токена"))
server.init_db()
srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}"


def call(path, body=None, token=None, method=None):
    req = urllib.request.Request(BASE + path, method=method or ("POST" if body is not None else "GET"),
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": "Bearer " + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def reg(nick, pw="secret-pass", **kw):
    return call("/api/register", {"nick": nick, "password": pw, "consent": True, "turnstile": "t", **kw})


# миграции применились
assert sqlite3.connect(server.DB).execute("pragma user_version").fetchone()[0] == len(server.MIGRATIONS)
assert call("/api/config")[1]["turnstileSiteKey"]

# регистрация: проверки
assert reg("ab")[0] == 400
assert reg("egor", "short")[0] == 400
assert reg("egor", "12345678")[0] == 400
assert call("/api/register", {"nick": "egor", "password": "secret-pass", "turnstile": "t"})[0] == 400  # нет согласия
assert call("/api/register", {"nick": "egor", "password": "secret-pass", "consent": True})[0] == 400  # нет Turnstile
code, d = reg("Егор", display_name="Егор")
assert code == 200 and d["user"]["nick"] == "Егор", d
assert [a["id"] for a in d["user"]["achievements"]] == ["registered"]
t1 = d["token"]
assert reg("егор")[0] == 409  # ник без учёта регистра, в том числе кириллица
t2 = reg("cyberman")[1]["token"]
ta = reg("admin")[1]["token"]

# токен хранится в БД только в виде хэша
assert not sqlite3.connect(server.DB).execute("select 1 from sessions where token_hash=?", (t1,)).fetchone()

# прогресс и достижения привязаны к аккаунту
call("/api/progress", {"stats": {"best": 900, "cases": ["sms"], "checklist": [1, 2]}, "achievements": ["perfect", "hack_me"]}, t1)
call("/api/progress", {"stats": {"best": 500, "cases": ["call"], "checklist": [2]}}, t1)
u = call("/api/me", token=t1)[1]["user"]
assert u["stats"]["best"] == 900 and sorted(u["stats"]["cases"]) == ["call", "sms"] and u["stats"]["checklist"] == [2], u
assert {a["id"] for a in u["achievements"]} == {"registered", "perfect"}  # неизвестный id отброшен
assert call("/api/progress", method="DELETE", token=t1)[1]["user"]["achievements"][0]["id"] == "registered"
assert call("/api/progress", {"stats": {}}, None)[0] == 401  # без аккаунта прогресс не сохраняется

# лента: фильтры для детей
assert call("/api/posts", {"text": "привет"})[0] == 401
assert call("/api/posts", {"text": "звони +375 29 123-45-67"}, t1)[0] == 400
assert call("/api/posts", {"text": "заходи на https://example.com"}, t1)[0] == 400
assert call("/api/posts", {"text": "ты сука"}, t1)[0] == 400
assert call("/api/posts", {"text": "Не сообщайте <b>коды</b> из SMS!"}, t1)[0] == 200
pid = call("/api/posts")[1]["posts"][0]["id"]
call(f"/api/posts/{pid}/like", {}, t2)
p = call("/api/posts", token=t2)[1]["posts"][0]
assert p["likes"] == 1 and p["liked"] and not p["mine"] and p["text"] == "Не сообщайте <b>коды</b> из SMS!"
call(f"/api/posts/{pid}/like", {}, t2)
assert call("/api/posts")[1]["posts"][0]["likes"] == 0

call("/api/me", {"incognito": True}, t1)
assert call("/api/posts", token=t2)[1]["posts"][0]["author"] == "Аноним"
assert call("/api/posts", token=t1)[1]["posts"][0]["author"] == "Егор"
assert call(f"/api/posts/{pid}", token=t2, method="DELETE")[0] == 403
assert call(f"/api/posts/{pid}", token=ta, method="DELETE")[0] == 200  # модератор может удалить

# три жалобы скрывают запись
call("/api/posts", {"text": "спорная запись"}, t1)
pid = call("/api/posts")[1]["posts"][0]["id"]
for t in (t2, ta, reg("third")[1]["token"]):
    call(f"/api/posts/{pid}/report", {}, t)
assert all(p["id"] != pid for p in call("/api/posts")[1]["posts"])

# AI без ключа отвечает из встроенной базы; помощник даёт ссылку на раздел
assert "пароль" in call("/api/ai", {"messages": [{"role": "user", "content": "Как придумать пароль?"}]})[1]["reply"].lower()
assert "[[go:quiz]]" in call("/api/ai", {"messages": [{"role": "user", "content": "где квиз?"}], "mode": "helper"})[1]["reply"]
assert call("/api/ai", {"messages": []})[0] == 400

# блокировка после 5 неудачных входов
server._hits.clear()
for _ in range(5):
    assert call("/api/login", {"nick": "cyberman", "password": "wrong", "turnstile": "t"})[0] == 401
assert call("/api/login", {"nick": "cyberman", "password": "secret-pass", "turnstile": "t"})[0] == 429

# лимит запросов на вход
server._hits.clear()
codes = [call("/api/login", {"nick": "nobody", "password": "x", "turnstile": "t"})[0] for _ in range(11)]
assert codes[-1] == 429 and codes[0] == 401

call("/api/logout", {}, t1)
assert call("/api/me", token=t1)[0] == 401

with urllib.request.urlopen(BASE + "/") as r:
    assert "Content-Security-Policy" in r.headers and "КиберЩит" in r.read().decode()
print("OK")
srv.shutdown()
