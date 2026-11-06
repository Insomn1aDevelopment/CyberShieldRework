// Самопроверка: node worker/test.mjs  → OK
import assert from 'node:assert/strict';
import worker from './worker.js';

const SITE = 'https://insomn1adevelopment.github.io';
const env = { ALLOWED_ORIGINS: SITE + ',http://localhost:8000', AI_BASE_URL: 'https://ai.test/v1/', AI_MODEL: 'm', AI_API_KEY: 'k' };
const ask = (body, { origin = SITE, method = 'POST', e = env } = {}) => worker.fetch(new Request('https://w.test/', {
  method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined,
}), e);
const q = text => ({ messages: [{ role: 'user', content: text }] });

let sent;
globalThis.fetch = async (url, init) => { sent = { url, init: { ...init, body: JSON.parse(init.body) } }; return Response.json({ choices: [{ message: { content: ' Ответ ' } }] }); };

// чужой сайт не пускаем
assert.equal((await ask(q('hi'), { origin: 'https://evil.test' })).status, 403);
// preflight
const pre = await ask(null, { method: 'OPTIONS' });
assert.equal(pre.status, 204);
assert.equal(pre.headers.get('Access-Control-Allow-Origin'), SITE);
// пустой вопрос
assert.equal((await ask({ messages: [] })).status, 400);
// нормальный ответ: системный промпт, ключ, обрезка истории
let r = await ask({ mode: 'helper', messages: Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' + i })) });
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { reply: 'Ответ' });
assert.equal(sent.url, 'https://ai.test/v1/chat/completions');
assert.equal(sent.init.headers.Authorization, 'Bearer k');
assert.match(sent.init.body.messages[0].content, /помощник по сайту/);
assert.equal(sent.init.body.messages.length, 13);
// сбой нейросети → reply: null, сайт ответит сам
globalThis.fetch = async () => new Response('limit', { status: 429 });
r = await ask(q('пароль'));
assert.deepEqual(await r.json(), { reply: null });
// лимит запросов
r = await ask(q('пароль'), { e: { ...env, LIMITER: { limit: async () => ({ success: false }) } } });
assert.equal(r.status, 429);
console.log('OK');
