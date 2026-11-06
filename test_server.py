"""Самопроверка API: python test_server.py"""
import json
import os
import threading
import urllib.error
import urllib.request

os.environ["AI_API_KEY"] = ""
import server  # noqa: E402

server.AI_API_KEY = ""
srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}"


def call(path, body=None):
    req = urllib.request.Request(BASE + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


assert call("/api/config") == (200, {"youtubeId": "", "ai": False})
# AI без ключа возвращает null — браузер отвечает из встроенной базы (AI_FALLBACK в data.js)
assert call("/api/ai", {"messages": [{"role": "user", "content": "Как придумать пароль?"}]}) == (200, {"reply": None})
assert call("/api/ai", {"messages": []})[0] == 400
# аккаунтов на сервере больше нет — они в куках браузера
assert call("/api/register", {"nick": "x"})[0] == 404
# сайт раздаётся, файлы вне static/ — нет
with urllib.request.urlopen(BASE + "/") as r:
    assert b"<!doctype html>" in r.read()
try:
    urllib.request.urlopen(BASE + "/server.py")
    raise AssertionError("server.py доступен снаружи")
except urllib.error.HTTPError as e:
    assert e.code == 404
srv.shutdown()
print("OK")
