// КиберAI: посредник между сайтом и нейросетью. Ключ лежит в секретах Cloudflare и в браузер не попадает.
// Публикация и настройка — в README, раздел «Нейросеть».

const SAFETY =
  'Аудитория — дети и подростки 10–17 лет из Беларуси. Пиши по-русски, просто и доброжелательно, коротко (до 120 слов), ' +
  'без запугивания и страшных подробностей. Никогда не проси имя, адрес, телефон, школу, фото, пароли или данные карты. ' +
  'Не помогай взламывать, обманывать или травить кого-либо — мягко откажи и объясни, почему это вредно и наказуемо. ' +
  'Не обсуждай темы, не связанные с безопасностью в интернете, — вежливо верни разговор к теме. ' +
  'Если ребёнку страшно, его травят, шантажируют или обманули — посоветуй сразу рассказать родителям или педагогу; ' +
  'телефоны: милиция 102, Республиканская детская телефонная линия 8-801-100-16-11 (бесплатно, анонимно, круглосуточно). ' +
  'Номера статей называй только если уверен: УК РБ ст. 209 (мошенничество), 212 (хищение путём модификации компьютерной информации), ' +
  '222 (незаконный оборот платёжных инструментов, средств платежа и их реквизитов), 349, 350, 352, 354, 355 (гл. 31); ' +
  'уголовная ответственность в общем случае с 16 лет, за ст. 212 — с 14 лет (ст. 27 УК). Закон № 99-З «О защите персональных данных». ' +
  'Иначе советуй проверить на pravo.by. Можно выделять **жирным** и делать списки через •.';

const PROMPTS = {
  consultant: 'Ты — КиберAI, консультант детской образовательной платформы «КиберЩит» по кибербезопасности. ' + SAFETY,
  helper:
    'Ты — помощник по сайту «КиберЩит». Отвечай 1–2 предложениями. Разделы сайта и метки перехода: ' +
    'квиз-тренажёр [[go:quiz]], кибер-детектив [[go:detective]], кибер-сортировка [[go:sort]], режим «На выживание» [[go:survival]], ' +
    'база знаний [[go:kb]], советы и чеклист [[go:tips]], Уголовный кодекс [[go:uk]], Конституция [[go:constitution]], ' +
    'достижения [[go:achievements]], AI-консультант [[go:ai]], профиль и награды [[go:profile]]. ' +
    'Если подходит раздел — добавь в конец ответа его метку. Сложные вопросы о безопасности отправляй к консультанту [[go:ai]]. ' + SAFETY,
};

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).includes(origin);
    const cors = allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {};
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });

    if (!allowed) return json({ error: 'Доступ только с сайта КиберЩит' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Нужен POST' }, 405);

    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success)
      return json({ error: 'Слишком много вопросов подряд. Подожди минуту.' }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Некорректный запрос' }, 400); }
    const msgs = (Array.isArray(body?.messages) ? body.messages : []).slice(-12)
      .map(m => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: clip(m?.content, 1500) }))
      .filter(m => m.content);
    if (!msgs.length || msgs.at(-1).role !== 'user') return json({ error: 'Пустой вопрос' }, 400);

    const system = PROMPTS[body.mode === 'helper' ? 'helper' : 'consultant'];
    try {
      const r = await fetch(env.AI_BASE_URL.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.AI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env.AI_MODEL, max_tokens: 500, temperature: 0.4, messages: [{ role: 'system', content: system }, ...msgs] }),
      });
      if (!r.ok) throw new Error('AI ' + r.status + ': ' + (await r.text()).slice(0, 200));
      const reply = (await r.json()).choices?.[0]?.message?.content?.trim();
      return json({ reply: reply || null });
    } catch (e) {
      console.log('AI error:', e.message); // видно в `npx wrangler tail`
      return json({ reply: null }); // сайт ответит из встроенной базы
    }
  },
};
