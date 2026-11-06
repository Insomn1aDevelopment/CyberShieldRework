// КиберЩит — фронтенд (одностраничное приложение на hash-роутинге)
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = name => `<i data-lucide="${name}"></i>`;
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- иконки, появление при прокрутке, счётчики ----------
const revealObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('seen'); revealObs.unobserve(e.target); } }), { threshold: .12 });
let enhanceQueued = false;
function enhance() {
  enhanceQueued = false;
  if ($('i[data-lucide]')) lucide.createIcons();
  $$('.rv:not([data-rv])').forEach(el => { el.dataset.rv = 1; revealObs.observe(el); });
  $$('[data-count]:not([data-done])').forEach(el => {
    el.dataset.done = 1;
    const to = +el.dataset.count, suf = el.dataset.suf || '', t0 = performance.now(), dur = REDUCED ? 0 : 900;
    const step = now => { const k = Math.min(1, dur ? (now - t0) / dur : 1); el.textContent = Math.round(to * (1 - (1 - k) ** 3)) + suf; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
new MutationObserver(() => { if (!enhanceQueued) { enhanceQueued = true; requestAnimationFrame(enhance); } }).observe(document.body, { childList: true, subtree: true });

// ---------- конфетти ----------
function confetti() {
  if (REDUCED) return;
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const cs = getComputedStyle(document.documentElement);
  const colors = [cs.getPropertyValue('--accent'), cs.getPropertyValue('--accent2'), '#22c55e', '#facc15', '#38bdf8'];
  const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35, vx: (Math.random() - .5) * 16, vy: -Math.random() * 14 - 4, s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[Math.random() * colors.length | 0] }));
  const t0 = performance.now();
  (function frame(now) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) { p.vy += .45; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
    if (now - t0 < 2600) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
  })(t0);
}

function toast(text, icon = 'sparkles') {
  const t = document.createElement('div');
  t.className = 'toast'; t.innerHTML = ic(icon) + `<span>${esc(text)}</span>`;
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ---------- API ----------
// Настройки: aiUrl — адрес Worker с нейросетью (папка worker/, см. README), youtubeId — ID видеогайда на YouTube
const CONFIG = { aiUrl: '', youtubeId: '' };
let ME = null;            // пользователь; без входа прогресс не сохраняется
let S = {};               // статистика текущего пользователя

// ---------- аккаунт в куках: cs_acc — профиль, cs_prog — прогресс, cs_in — вход выполнен ----------
// Базы нет: аккаунт живёт только в этом браузере. Пароль защищает от случайного входа, а не от владельца компьютера.
const COOKIE_PATH = location.pathname.replace(/[^/]*$/, '');
const cookie = {
  get(k) {
    const m = document.cookie.match('(?:^|; )' + k + '=([^;]*)');
    try { return m ? JSON.parse(decodeURIComponent(m[1])) : null; } catch { return null; }
  },
  set(k, v) { // false — значение не влезло в лимит куки (~4 КБ)
    const s = v == null ? '' : encodeURIComponent(JSON.stringify(v));
    document.cookie = `${k}=${s};path=${COOKIE_PATH};max-age=${v == null ? 0 : 31536000};SameSite=Lax${location.protocol === 'https:' ? ';Secure' : ''}`;
    return s.length < 4000;
  },
};
const hashPw = async (nick, pw) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nick.toLowerCase() + ':' + pw)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
function loadAccount() {
  const a = cookie.get('cs_acc');
  if (!a || !cookie.get('cs_in')) return;
  const p = cookie.get('cs_prog') || {};
  ME = { nick: a.nick, display_name: a.name || '', bio: a.bio || '', created_at: a.at,
    achievements: Object.entries(p.a || {}).map(([id, t]) => ({ id, unlocked_at: t })) };
  S = { ...p.s, registered: 1 };
}
const storeProfile = pw => cookie.set('cs_acc', { nick: ME.nick, name: ME.display_name, bio: ME.bio, at: ME.created_at, pw: pw || cookie.get('cs_acc')?.pw });
function storeProgress() {
  if (!cookie.set('cs_prog', { s: S, a: Object.fromEntries(ME.achievements.map(a => [a.id, a.unlocked_at])) }))
    toast('Прогресс не поместился в куки и не сохранён', 'triangle-alert');
}

// ---------- прогресс и достижения (только с аккаунтом) ----------
const gotIds = () => new Set([...(ME?.achievements || []).map(a => a.id), ...(ME ? ACHIEVEMENTS.filter(a => a.test(S)).map(a => a.id) : [])]);
function save() {
  if (!ME) return;
  const known = new Set(ME.achievements.map(a => a.id));
  const fresh = ACHIEVEMENTS.filter(a => a.test(S) && !known.has(a.id));
  fresh.forEach((a, i) => setTimeout(() => toast('Новое достижение: ' + a.title, a.icon), i * 400));
  if (fresh.length) { confetti(); ME.achievements.push(...fresh.map(a => ({ id: a.id, unlocked_at: Date.now() }))); }
  storeProgress();
}
const bump = (k, n = 1) => { S[k] = (S[k] || 0) + n; save(); };
const setMax = (k, v) => { if (v > (S[k] || 0)) { S[k] = v; save(); } };
const flag = k => { if (!S[k]) { S[k] = 1; save(); } };
const addTo = (k, v) => { if (!(S[k] || []).includes(v)) { S[k] = [...(S[k] || []), v]; save(); } };
const guestHint = () => ME ? '' : `<p class="muted" style="font-size:14px">${ic('lock')} Результат не сохранится. <a href="#/profile">Войди или создай аккаунт</a>, чтобы копить прогресс и получать награды.</p>`;

function signOut() { cookie.set('cs_in', null); ME = null; S = {}; updateNav(); }
function updateNav() {
  $('#navAch').classList.toggle('locked', !ME);
  $('#navAch').title = ME ? '' : 'Доступно после входа';
  $('#navProfile span').textContent = ME ? ME.nick : 'Войти';
}

// ---------- роутер ----------
let timer = null, cleanups = [];
const stopTimer = () => { clearInterval(timer); timer = null; };
const routes = { '': home, quiz, detective, sort, survival, spot, kb, tips, password, uk, constitution, achievements, ai, profile };
const ROUTE_NAMES = { quiz: 'Квиз', detective: 'Детектив', sort: 'Сортировка', survival: 'На выживание', spot: 'Найди подвох', kb: 'База знаний', tips: 'Советы', password: 'Проверка пароля', uk: 'Уголовный кодекс', constitution: 'Конституция', achievements: 'Достижения', ai: 'КиберAI', profile: 'Профиль' };
const WIDE = ['profile', 'ai', 'achievements'];

function render() {
  stopTimer(); document.onkeydown = null;
  cleanups.forEach(f => f()); cleanups = [];
  const r = location.hash.replace(/^#\/?/, '').split('/')[0];
  const page = routes[r] ? r : '';
  const app = $('#app');
  app.className = WIDE.includes(page) ? 'wide' : '';
  app.innerHTML = '';
  routes[page](app);
  $$('.nav [data-r]').forEach(el => el.classList.toggle('on', el.dataset.r.split(' ').includes(page)));
  $$('.dd').forEach(d => d.classList.remove('open'));
  scrollTo({ top: 0, behavior: 'instant' });
}
addEventListener('hashchange', render);
$$('.dd > button').forEach(b => b.onclick = e => { e.stopPropagation(); const d = b.parentElement, was = d.classList.contains('open'); $$('.dd').forEach(x => x.classList.remove('open')); d.classList.toggle('open', !was); });
document.addEventListener('click', () => $$('.dd').forEach(d => d.classList.remove('open')));

const hero = (icon, pill, title, sub) => `<section class="hero"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</section>`;
const statCards = items => `<div class="grid">${items.map(([v, l, c, suf]) => `<div class="stat rv"><b class="${c || ''}" data-count="${v}" data-suf="${suf || ''}">0</b><span>${l}</span></div>`).join('')}</div>`;
const accuracy = () => S.answered ? Math.round(S.correct / S.answered * 100) : 0;

// ---------- главная ----------
const HOME_PLAY = [
  ['target', 'Квиз-тренажёр', () => `${QUESTIONS.length} вопросов, три уровня сложности`, 'quiz'],
  ['search', 'Кибер-детектив', () => `${CASES.length} дел по реальным схемам мошенников`, 'detective'],
  ['layers', 'Кибер-сортировка', () => 'Разложи ситуации на безопасные и опасные', 'sort'],
  ['infinity', 'На выживание', () => 'Правда или ложь на скорость, три жизни', 'survival'],
  ['scan-eye', 'Найди подвох', () => `${SPOT.length} сообщений от мошенников — найди, где обман`, 'spot'],
];
const HOME_LEARN = [
  ['book-open', 'База знаний', () => 'Угрозы, защита и куда обращаться за помощью', 'kb'],
  ['list-checks', 'Советы и чеклист', () => 'Простые правила и 12 шагов к защите', 'tips'],
  ['key-round', 'Проверка пароля', () => 'Насколько быстро взломают твой пароль', 'password'],
  ['gavel', 'Уголовный кодекс', () => 'Что в сети считается преступлением', 'uk'],
  ['scroll-text', 'Конституция', () => 'Твои права и тайна переписки', 'constitution'],
  ['bot', 'КиберAI', () => 'Задай любой вопрос о безопасности', 'ai'],
];
const homeList = items => `<div class="menu">${items.map(([i, t, d, h]) => `<a href="#/${h}"><span class="ico">${ic(i)}</span><span><b>${t}</b><small>${d()}</small></span></a>`).join('')}</div>`;
function home(app) {
  const yt = /^[\w-]{11}$/.test(CONFIG.youtubeId) ? CONFIG.youtubeId : '';
  app.innerHTML = `
    <section class="hero home-hero">
      <button class="cs-logo" id="csLogo" aria-label="Щит КиберЩит. Нажми, чтобы получить совет">${LOGO_SVG}</button>
      <div class="cs-tip" id="csTip" aria-live="polite"><small>Нажми на щит — получишь совет</small></div>
      <h1>КиберЩит</h1>
      <p>Играй и учись <span class="typer" id="typer"></span></p>
      <div class="row center"><a class="btn acc" href="#/quiz">${ic('target')} Начать квиз</a><a class="btn" href="#/detective">${ic('search')} Раскрыть дело</a></div>
    </section>
    ${ME ? statCards([[S.games || 0, 'Игр сыграно', 'c-acc'], [S.best || 0, 'Лучший счёт', 'c-ok'], [accuracy(), 'Точность', '', '%'], [gotIds().size, 'Наград']])
      : `<div class="card guest"><span class="ico">${ic('user')}</span><p>Без аккаунта играть можно, но результаты не сохранятся. С аккаунтом копятся очки и награды.</p><a class="btn sm" href="#/profile">Создать аккаунт</a></div>`}
    <h2 class="label">Играть</h2>${homeList(HOME_PLAY)}
    <h2 class="label">Разобраться</h2>${homeList(HOME_LEARN)}
    ${yt ? `<h2 class="label">Как пользоваться платформой</h2><div class="yt" id="yt" role="button" tabindex="0" aria-label="Смотреть видео"><img src="https://i.ytimg.com/vi/${yt}/hqdefault.jpg" alt="Видеогайд по платформе КиберЩит" loading="lazy"><span class="play">${ic('play')}</span></div>` : ''}`;

  if (yt) {
    const box = $('#yt', app);
    const play = () => { box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&modestbranding=1" title="Видеогайд КиберЩит" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; box.onclick = box.onkeydown = null; };
    box.onclick = play; box.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } };
  }
  // клик по щиту: волна + случайный совет
  const logo = $('#csLogo', app), tip = $('#csTip', app);
  let lastTip = -1;
  logo.onclick = () => {
    logo.classList.remove('hit'); void logo.offsetWidth; logo.classList.add('hit');
    let i; do i = Math.random() * TIPS.length | 0; while (i === lastTip && TIPS.length > 1); lastTip = i;
    tip.innerHTML = `${ic(TIPS[i].icon)}<span><b>${esc(TIPS[i].title)}.</b> ${esc(TIPS[i].text)}</span>`;
    tip.classList.remove('show'); void tip.offsetWidth; tip.classList.add('show');
  };

  // печатающаяся строка под заголовком
  const typer = $('#typer', app), words = ['распознавать мошенников', 'придумывать надёжные пароли', 'защищать личные данные', 'знать свои права в сети'];
  if (REDUCED) { typer.textContent = words[0]; return; }
  let w = 0, n = 0, del = false, timer;
  const step = () => {
    if (!typer.isConnected) return;
    const word = words[w];
    n += del ? -1 : 1; typer.textContent = word.slice(0, n);
    let wait = del ? 35 : 70;
    if (!del && n === word.length) { del = true; wait = 1800; }
    else if (del && n === 0) { del = false; w = (w + 1) % words.length; wait = 300; }
    timer = setTimeout(step, wait);
  };
  step(); cleanups.push(() => clearTimeout(timer));
}

const SHIELD_D = 'M120 32 186 58v54c0 44-28 76-66 96-38-20-66-52-66-96V58z';
const LOGO_SVG = `<svg class="cs-mark" viewBox="0 0 240 240" aria-hidden="true">
  <defs>
    <linearGradient id="csG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="s1"/><stop offset="1" class="s2"/></linearGradient>
    <clipPath id="csClip"><path d="${SHIELD_D}"/></clipPath>
  </defs>
  <circle class="cs-orbit" cx="120" cy="120" r="112"/>
  <circle class="cs-orbit o2" cx="120" cy="120" r="100"/>
  <g class="cs-traces"><path d="M54 92H30V70H14"/><path d="M54 140H22v24"/><path d="M186 92h24V70h16"/><path d="M186 140h32v24"/><path d="M120 208v20"/></g>
  <g class="cs-nodes"><circle cx="14" cy="70" r="4"/><circle cx="22" cy="164" r="4"/><circle cx="226" cy="70" r="4"/><circle cx="218" cy="164" r="4"/><circle cx="120" cy="228" r="4"/></g>
  <path class="cs-fill" d="${SHIELD_D}"/>
  <path class="cs-edge" pathLength="1" d="${SHIELD_D}"/>
  <path class="cs-inner" d="M120 50 170 70v42c0 34-20 59-50 76-30-17-50-42-50-76V70z"/>
  <g clip-path="url(#csClip)"><g class="cs-grid">${Array.from({ length: 9 }, (_, i) => `<path d="M${50 + i * 18} 30v190M40 ${40 + i * 20}h160"/>`).join('')}</g><rect class="cs-scan" x="40" y="0" width="160" height="14"/></g>
  <path class="cs-check" pathLength="1" d="m92 118 20 20 38-40"/>
</svg>`;

// ---------- общий каркас игр ----------
const gameIntro = ({ icon, kicker, title, sub, rules, best, body = '' }) => `
  <section class="g-intro"><div class="g-badge">${ic(icon)}</div><h1>${title}</h1><p>${sub}</p></section>
  <div class="card g-panel">${body}
    <div class="g-rules">${rules.map(([i, t]) => `<div>${ic(i)}<span>${t}</span></div>`).join('')}</div>
    <div class="g-start">${ME && best != null ? `<span class="g-best">${ic('trophy')} Рекорд: <b>${best}</b></span>` : ''}<button class="btn acc" id="go">${ic('play')} Начать</button></div>
  </div>`;
const hud = chips => `<div class="hud"><button class="hud-quit" id="quit" title="Выйти из игры" aria-label="Выйти из игры">${ic('x')}</button>${chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>`;
const steps = (n, i, res) => `<div class="steps">${Array.from({ length: n }, (_, k) => `<i class="${k < i ? (res[k] ? 'ok' : 'bad') : k === i ? 'cur' : ''}"></i>`).join('')}</div>`;
const choices = (a, b) => `<div class="choices">
  <button class="choice good" data-v="1">${ic(a[0])}<b>${a[1]}</b><kbd>←</kbd></button>
  <button class="choice bad" data-v="0">${ic(b[0])}<b>${b[1]}</b><kbd>→</kbd></button></div>`;
const resultScreen = ({ big, sub, pct, stats, msg, extra = '' }) => `
  <div class="card result"><h2>Игра окончена</h2>
    <div class="res-ring" style="--p:${Math.round(pct)}"><div><b data-count="${big}">0</b><small>${sub}</small></div></div>
    <div class="res-stats">${stats.map(([v, l, c]) => `<div><b class="${c || ''}">${v}</b><span>${l}</span></div>`).join('')}</div>
    <p class="res-msg">${msg}</p>${extra}${guestHint()}
    <div class="row center"><button class="btn acc" id="again">${ic('refresh-cw')} Ещё раз</button><a class="btn" href="#/kb">${ic('book-open')} База знаний</a></div></div>`;

// ---------- квиз ----------
function quiz(app) {
  let diff = ls.get('cs_diff') in DIFFS ? ls.get('cs_diff') : 'easy';
  const quit = () => { stopTimer(); document.onkeydown = null; intro(); };
  const intro = () => {
    app.innerHTML = gameIntro({
      icon: 'target', kicker: 'Квиз-тренажёр', title: 'Проверь знания',
      sub: `${QUESTIONS.length} вопросов о безопасности в интернете. Чем быстрее и точнее ответ, тем больше очков.`,
      best: S.best || 0,
      body: `<div class="label" style="margin-top:0">Уровень сложности</div>
        <div class="diffs">${Object.entries(DIFFS).map(([k, d]) => `<button class="diff ${k === diff ? 'on' : ''}" data-d="${k}" style="--c:${d.color}"><b>${d.name}</b><small>${d.count} вопросов · ${d.time} сек · ×${d.mult}</small></button>`).join('')}</div>`,
      rules: [['timer', 'Быстрый ответ — больше очков'], ['flame', 'Серия из 3+ верных даёт бонус'], ['lightbulb', 'Одна подсказка 50/50 за игру'], ['keyboard', 'Клавиши 1–4 для ответа']],
    });
    $$('.diff', app).forEach(b => b.onclick = () => { diff = b.dataset.d; ls.set('cs_diff', diff); $$('.diff', app).forEach(x => x.classList.toggle('on', x === b)); });
    $('#go', app).onclick = start;
  };

  let st;
  const start = () => { const d = DIFFS[diff]; st = { d, qs: shuffle(QUESTIONS).slice(0, d.count), i: 0, score: 0, streak: 0, correct: 0, hint: false, res: [] }; ask(); };
  const ask = () => {
    const { d, qs, i } = st, q = qs[i];
    let left = d.time, answered = false; const t0 = Date.now();
    const order = shuffle(q.o.map((text, idx) => ({ text, idx })));
    app.innerHTML = hud([`${ic('list-ordered')} ${i + 1}/${qs.length}`, `<span class="streak ${st.streak >= 3 ? 'hot' : ''}">${ic('flame')} ${st.streak}</span>`, `<span id="sc">${ic('star')} ${st.score}</span>`, `<span id="left">${ic('timer')} ${left}</span>`]) + `
      <div class="card play">${steps(qs.length, i, st.res)}
      <div class="timer" id="tm"><div id="bar" style="width:100%"></div></div>
      <p class="question">${esc(q.q)}</p>
      <div class="opts">${order.map((o, k) => `<button class="opt" data-i="${o.idx}"><kbd>${k + 1}</kbd><span>${esc(o.text)}</span></button>`).join('')}</div>
      <div id="after"></div>
      <div class="row" style="margin-top:16px"><button class="btn sm" id="hint" ${st.hint ? 'disabled' : ''}>${ic('lightbulb')} 50/50</button></div></div>`;
    $('#quit', app).onclick = quit;
    const finish = picked => {
      if (answered) return; answered = true;
      stopTimer();
      const ok = picked === q.a, secs = (Date.now() - t0) / 1000;
      st.res.push(ok);
      $$('.opt', app).forEach(b => { b.disabled = true; const n = +b.dataset.i; if (n === q.a) b.classList.add('ok'); else if (n === picked) b.classList.add('bad', 'shake'); });
      $('#hint', app).disabled = true;
      S.answered = (S.answered || 0) + 1;
      if (ok) {
        st.correct++; st.streak++;
        st.score += Math.round(100 * d.mult + left * 5 * d.mult + (st.streak >= 3 ? 50 * (st.streak - 2) : 0));
        S.correct = (S.correct || 0) + 1;
        if (secs <= 3) S.lightning = 1;
        S.maxStreak = Math.max(S.maxStreak || 0, st.streak);
        const sc = $('#sc', app); sc.innerHTML = ic('star') + ' ' + st.score; sc.classList.add('pop');
      } else st.streak = 0;
      save();
      const last = st.i + 1 >= st.qs.length;
      $('#after', app).innerHTML = `<div class="explain ${ok ? 'is-ok' : 'is-bad'}"><b>${ok ? ic('circle-check') + ' Верно!' : picked === -1 ? ic('timer') + ' Время вышло' : ic('circle-x') + ' Неверно'}</b> ${esc(q.e)}</div>
        <button class="btn dark sm" id="next" style="margin-top:14px">${last ? 'Результат' : 'Дальше'}</button>`;
      $('#next', app).onclick = () => { st.i++; last ? end() : ask(); };
      $('#next', app).focus();
    };
    $$('.opt', app).forEach(b => b.onclick = () => finish(+b.dataset.i));
    document.onkeydown = e => { const b = $$('.opt', app)[+e.key - 1]; if (b && !b.disabled) finish(+b.dataset.i); };
    $('#hint', app).onclick = () => {
      st.hint = true; $('#hint', app).disabled = true;
      shuffle($$('.opt', app).filter(b => +b.dataset.i !== q.a)).slice(0, 2).forEach(b => { b.disabled = true; b.classList.add('gone'); });
    };
    timer = setInterval(() => {
      left = Math.max(0, d.time - Math.floor((Date.now() - t0) / 1000));
      $('#left', app).innerHTML = ic('timer') + ' ' + left;
      $('#bar', app).style.width = (left / d.time * 100) + '%';
      $('#tm', app).classList.toggle('low', left <= 5);
      if (!left) finish(-1);
    }, 250);
  };
  const end = () => {
    document.onkeydown = null;
    const ratio = st.correct / st.qs.length;
    S.games = (S.games || 0) + 1; S.quizGames = (S.quizGames || 0) + 1;
    S.best = Math.max(S.best || 0, st.score);
    if (ratio === 1) S.perfect = 1;
    if (!st.hint) S.noHint = 1;
    if (diff === 'hard' && ratio >= .7) S.hardWin = 1;
    S.modes = [...new Set([...(S.modes || []), 'quiz'])];
    save();
    if (ratio >= .8) confetti();
    app.innerHTML = resultScreen({
      big: st.score, sub: 'очков', pct: ratio * 100,
      stats: [[`${st.correct}/${st.qs.length}`, 'Верных', 'c-ok'], [Math.round(ratio * 100) + '%', 'Точность', 'c-acc'], ...(ME ? [[S.best, 'Рекорд']] : [])],
      msg: ratio === 1 ? 'Ни одной ошибки — отличная работа!' : ratio >= .7 ? 'Хороший результат!' : ratio >= .4 ? 'Неплохо. Попробуй ещё раз — получится лучше.' : 'Загляни в Базу знаний и попробуй снова.',
    });
    $('#again', app).onclick = intro;
  };
  intro();
}

// ---------- детектив ----------
function detective(app) {
  const list = () => {
    const solved = CASES.filter(c => (S.cases || []).includes(c.id)).length;
    app.innerHTML = `<section class="g-intro"><div class="g-badge">${ic('search')}</div><h1>Раскрой дело</h1><p>Изучи улики и разгадай схему мошенников. Все дела основаны на реальных случаях.</p></section>
      <div class="card case-progress"><div class="qbar" style="margin:0 0 8px"><span>${ic('folder-open')} Раскрыто дел</span><span>${solved} из ${CASES.length}</span></div><div class="progress"><div style="width:${solved / CASES.length * 100}%"></div></div></div>
      <div class="cases">${CASES.map((c, i) => { const done = (S.cases || []).includes(c.id); return `<button class="case rv ${done ? 'done' : ''}" data-c="${c.id}">
        <span class="case-no">№${String(i + 1).padStart(2, '0')}</span><span class="ico">${ic(c.icon)}</span>
        <h3>${esc(c.title)}</h3><p>${esc(c.intro)}</p>
        <span class="case-st">${done ? ic('badge-check') + ' Раскрыто' : ic('lock') + ' Не раскрыто'}</span></button>`; }).join('')}</div>`;
    $$('[data-c]', app).forEach(b => b.onclick = () => open(CASES.find(c => c.id === b.dataset.c)));
  };
  const open = c => {
    const opened = new Set(); let wrong = 0;
    const n = CASES.indexOf(c) + 1;
    app.innerHTML = `<button class="btn sm" id="back">${ic('arrow-left')} Все дела</button>
      <div class="card case-head"><span class="case-no">Дело №${String(n).padStart(2, '0')}</span><div class="threat-head"><span class="ico">${ic(c.icon)}</span><h2>${esc(c.title)}</h2></div><p>${esc(c.intro)}</p></div>
      <div class="label">Улики <span class="muted" id="cnt" style="margin-left:auto;letter-spacing:0">0/${c.clues.length}</span></div>
      <div class="grid g2">${c.clues.map((k, i) => `<button class="flip" data-k="${i}"><div class="flip-in">
        <div class="flip-face"><b>${ic(k.icon)} ${esc(k.title)}</b><span style="font-size:14px">${esc(k.text)}</span><small>${ic('search')} Нажми, чтобы изучить</small></div>
        <div class="flip-face flip-back"><b>${ic('lightbulb')} Вывод</b><p>${esc(k.note)}</p></div></div></button>`).join('')}</div>
      <div class="label">Вердикт</div>
      <div class="card"><p class="question">${esc(c.question)}</p><div class="opts">${c.options.map((o, i) => `<button class="opt" data-i="${i}"><kbd>${i + 1}</kbd><span>${esc(o)}</span></button>`).join('')}</div><div id="after"></div></div>`;
    $('#back', app).onclick = list;
    $$('.flip', app).forEach(b => b.onclick = () => {
      b.classList.toggle('open'); opened.add(b.dataset.k);
      $('#cnt', app).textContent = `${opened.size}/${c.clues.length}`;
      if (opened.size === c.clues.length) flag('detClues');
    });
    $$('.opt', app).forEach(b => b.onclick = () => {
      if (+b.dataset.i !== c.a) {
        wrong++; b.classList.add('bad', 'shake'); b.disabled = true;
        $('#after', app).innerHTML = `<div class="explain is-bad"><b>${ic('circle-x')} Не совсем.</b> Переверни все улики и попробуй ещё раз.</div>`;
        return;
      }
      b.classList.add('ok'); $$('.opt', app).forEach(x => x.disabled = true);
      if (!(S.cases || []).includes(c.id)) { S.games = (S.games || 0) + 1; addTo('cases', c.id); }
      if (!wrong) flag('detClean');
      addTo('modes', 'detective');
      confetti();
      const next = CASES[n];
      $('#after', app).innerHTML = `<div class="explain is-ok"><b>${ic('badge-check')} Дело раскрыто!</b> ${esc(c.explain)}</div>
        <div class="explain"><b>${ic('gavel')} Закон:</b> ${esc(c.law)}</div>
        ${guestHint()}
        <div class="row" style="margin-top:14px">${next ? `<button class="btn dark sm" id="nx">Следующее дело</button>` : ''}<button class="btn sm" id="ls">Все дела</button></div>`;
      if (next) $('#nx', app).onclick = () => open(next);
      $('#ls', app).onclick = list;
    });
  };
  list();
}

// ---------- сортировка ----------
function sort(app) {
  const N = 12;
  const quit = () => { document.onkeydown = null; intro(); };
  const intro = () => {
    app.innerHTML = gameIntro({
      icon: 'layers', kicker: 'Кибер-сортировка', title: 'Безопасно или нет?',
      sub: `${N} случайных ситуаций из ${SORT_ITEMS.length}. Реши, какие из них безопасны, а какие нет.`,
      best: `${S.sortBest || 0} из ${N}`,
      rules: [['shield-check', 'Безопасно — влево'], ['triangle-alert', 'Опасно — вправо'], ['keyboard', 'Стрелки ← и → на клавиатуре'], ['list-checks', 'В конце — разбор ошибок']],
    });
    $('#go', app).onclick = start;
  };
  let items, i, score, mistakes, res;
  const start = () => { items = shuffle(SORT_ITEMS).slice(0, N); i = 0; score = 0; mistakes = []; res = []; show(); };
  const show = () => {
    const it = items[i];
    app.innerHTML = hud([`${ic('list-ordered')} ${i + 1}/${N}`, `${ic('circle-check')} ${score}`]) + `
      <div class="card play">${steps(N, i, res)}
      <div class="sort-card" id="sc"><span class="sort-tag">${ic('message-square-warning')} Ситуация</span><span>${esc(it.t)}</span></div>
      ${choices(['shield-check', 'Безопасно'], ['triangle-alert', 'Опасно'])}
      <div id="after"></div></div>`;
    $('#quit', app).onclick = quit;
    let done = false;
    const pick = safe => {
      if (done) return; done = true;
      const ok = safe === it.safe;
      res.push(ok);
      if (ok) score++; else mistakes.push(it);
      $$('.choice', app).forEach(b => b.disabled = true);
      const sc = $('#sc', app);
      sc.classList.add(safe ? 'fly-l' : 'fly-r');
      if (!ok) sc.classList.add('shake');
      $('#after', app).innerHTML = `<div class="explain ${ok ? 'is-ok' : 'is-bad'}"><b>${ok ? ic('circle-check') + ' Верно' : ic('circle-x') + ' Ошибка'}:</b> это ${it.safe ? 'безопасно' : 'опасно'} — ${esc(it.why)}</div><button class="btn dark sm" id="next" style="margin-top:12px">Дальше</button>`;
      $('#next', app).onclick = advance; $('#next', app).focus();
    };
    const advance = () => { i++; i < items.length ? show() : end(); };
    $$('.choice', app).forEach(b => b.onclick = () => pick(b.dataset.v === '1'));
    document.onkeydown = e => { if (e.key === 'ArrowLeft') pick(true); else if (e.key === 'ArrowRight') pick(false); };
  };
  const end = () => {
    document.onkeydown = null;
    S.games = (S.games || 0) + 1; S.sortGames = (S.sortGames || 0) + 1; S.sortBest = Math.max(S.sortBest || 0, score);
    if (score === N) { S.sortPerfect = 1; confetti(); }
    S.modes = [...new Set([...(S.modes || []), 'sort'])];
    save();
    app.innerHTML = resultScreen({
      big: score, sub: `из ${N}`, pct: score / N * 100,
      stats: [[score, 'Верно', 'c-ok'], [mistakes.length, 'Ошибок', 'c-bad'], ...(ME ? [[S.sortBest, 'Рекорд']] : [])],
      msg: score === N ? 'Без единой ошибки!' : score >= 9 ? 'Отличное чутьё на опасность!' : 'Посмотри разбор — в следующий раз получится лучше.',
      extra: mistakes.length ? `<div style="text-align:left"><div class="label">Разбор ошибок</div>${mistakes.map(m => `<div class="explain"><b>${esc(m.t)}</b> — ${m.safe ? 'безопасно' : 'опасно'}. ${esc(m.why)}</div>`).join('')}</div>` : '',
    });
    $('#again', app).onclick = start;
  };
  intro();
}

// ---------- на выживание ----------
function survival(app) {
  const quit = () => { stopTimer(); document.onkeydown = null; intro(); };
  const intro = () => {
    app.innerHTML = gameIntro({
      icon: 'infinity', kicker: 'На выживание', title: 'Правда или ложь',
      sub: 'Три жизни и всё меньше времени на каждый ответ. Сколько продержишься?',
      best: S.survBest || 0,
      rules: [['heart', 'Три жизни — ошибка отнимает одну'], ['timer', 'Время сокращается с каждым верным ответом'], ['keyboard', '← правда, → ложь'], ['trophy', 'Награды за 20 и 50 очков']],
    });
    $('#go', app).onclick = start;
  };
  let pool, lives, score, limit;
  const start = () => { pool = shuffle(SURVIVAL); lives = 3; score = 0; limit = 10; next(); };
  const next = () => {
    if (!pool.length) pool = shuffle(SURVIVAL);
    const it = pool.pop(), t0 = Date.now(); let done = false;
    app.innerHTML = hud([`<span class="hearts">${[0, 1, 2].map(k => `<i data-lucide="heart" class="${k < lives ? '' : 'lost'}"></i>`).join('')}</span>`, `${ic('star')} ${score}`, `${ic('timer')} ${limit.toFixed(1)} с`]) + `
      <div class="card play"><div class="timer" id="tm"><div id="bar" style="width:100%"></div></div>
      <div class="sort-card" id="sc"><span class="sort-tag">${ic('quote')} Утверждение</span><span>${esc(it.t)}</span></div>
      ${choices(['circle-check', 'Правда'], ['circle-x', 'Ложь'])}</div>`;
    $('#quit', app).onclick = quit;
    const answer = v => {
      if (done) return; done = true; stopTimer();
      const ok = v === it.a;
      if (ok) { score++; limit = Math.max(3, limit - .3); } else lives--;
      const sc = $('#sc', app); sc.classList.add(ok ? 'fly-l' : 'fly-r'); if (!ok) sc.classList.add('shake');
      setTimeout(() => lives > 0 ? next() : end(), ok ? 350 : 900);
    };
    $$('.choice', app).forEach(b => b.onclick = () => answer(b.dataset.v === '1'));
    document.onkeydown = e => { if (e.key === 'ArrowLeft') answer(true); if (e.key === 'ArrowRight') answer(false); };
    timer = setInterval(() => {
      const rest = limit - (Date.now() - t0) / 1000;
      $('#bar', app).style.width = Math.max(0, rest / limit * 100) + '%';
      $('#tm', app).classList.toggle('low', rest < 2);
      if (rest <= 0) answer(null);
    }, 100);
  };
  const end = () => {
    document.onkeydown = null;
    const prev = S.survBest || 0;
    S.games = (S.games || 0) + 1; S.survGames = (S.survGames || 0) + 1; S.survBest = Math.max(prev, score);
    S.modes = [...new Set([...(S.modes || []), 'survival'])];
    save();
    if (score >= 20) confetti();
    app.innerHTML = resultScreen({
      big: score, sub: 'очков', pct: Math.min(100, score / 50 * 100),
      stats: [[score, 'Верных ответов', 'c-ok'], [limit.toFixed(1) + ' с', 'Темп', 'c-acc'], ...(ME ? [[S.survBest, 'Рекорд']] : [])],
      msg: ME && score > prev ? 'Новый рекорд!' : score >= 20 ? 'Крепкий щит!' : 'Попробуй ещё раз и продержись дольше.',
    });
    $('#again', app).onclick = start;
  };
  intro();
}

// ---------- найди подвох ----------
function spot(app) {
  let i = Math.max(0, SPOT.findIndex(m => !(S.spots || []).includes(m.id)));
  const draw = () => {
    const m = SPOT[i], flags = m.parts.filter(p => p[1]).length, found = new Set();
    let misses = 0, over = false;
    app.innerHTML = hero('scan-eye', '', 'Найди подвох', 'Нажимай на всё, что выдаёт мошенника. После трёх промахов подсказки откроются сами.') + `
      <div class="spot">
        <div class="hud"><span class="chip">${ic('mail')} ${i + 1} из ${SPOT.length}</span><span class="chip">${ic('scan-eye')} <span id="cnt">0/${flags}</span></span><span class="chip"><span class="hearts" id="hp">${ic('heart').repeat(3)}</span></span></div>
        <div class="card spot-msg" id="msg"><div class="spot-head"><span class="ico">${ic(m.icon)}</span><div><b>${esc(m.from)}</b><small>${esc(m.kind)}</small></div></div>
          <p class="spot-text">${m.parts.map(([t], k) => t.trim().length < 3 ? esc(t) : `<span class="sp" role="button" tabindex="0" data-k="${k}">${esc(t)}</span>`).join('')}</p></div>
        <div id="notes"></div><div id="after"></div>${guestHint()}</div>`;
    const note = k => $('#notes', app).insertAdjacentHTML('beforeend',
      `<div class="explain spot-note"><b>${ic('triangle-alert')} «${esc(m.parts[k][0].trim())}»</b> ${esc(m.parts[k][1])}</div>`);
    const finish = win => {
      over = true;
      if (win) addTo('spots', m.id);
      m.parts.forEach(([, e], k) => { if (e && !found.has(k)) { $(`[data-k="${k}"]`, app).classList.add('missed'); note(k); } });
      const last = i === SPOT.length - 1;
      $('#after', app).innerHTML = `<div class="explain ${win ? 'is-ok' : 'is-bad'}"><b>${win ? ic('badge-check') + ' Все подвохи найдены!' : ic('circle-x') + ' Мошенник почти обманул.'}</b>
        ${win ? 'Такое сообщение лучше сразу удалить и показать взрослым.' : 'Подсказки к пропущенным подвохам — выше.'}</div>
        <div class="row" style="margin-top:14px">${last ? '' : '<button class="btn acc sm" id="nx">Следующее сообщение</button>'}<button class="btn sm" id="rt">${ic('refresh-cw')} Пройти заново</button></div>`;
      if (!last) $('#nx', app).onclick = () => { i++; draw(); };
      $('#rt', app).onclick = draw;
    };
    const pick = el => {
      if (over || el.classList.contains('hit') || el.classList.contains('miss')) return;
      const k = +el.dataset.k;
      if (m.parts[k][1]) {
        el.classList.add('hit'); found.add(k); note(k);
        $('#cnt', app).textContent = `${found.size}/${flags}`;
        if (found.size === flags) finish(true);
      } else {
        el.classList.add('miss'); misses++;
        $$('#hp svg', app)[3 - misses]?.classList.add('lost');
        const msg = $('#msg', app); msg.classList.remove('shake'); void msg.offsetWidth; msg.classList.add('shake');
        if (misses >= 3) finish(false);
      }
    };
    $$('.sp', app).forEach(el => {
      el.onclick = () => pick(el);
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(el); } };
    });
  };
  draw();
}

// ---------- проверка пароля (всё считается в браузере, пароль никуда не отправляется) ----------
function pwCheck(pw) {
  const low = pw.toLowerCase();
  const tests = [
    [pw.length >= 12, 'Не короче 12 символов'],
    [/[a-zа-яё]/.test(pw) && /[A-ZА-ЯЁ]/.test(pw), 'Есть строчные и заглавные буквы'],
    [/\d/.test(pw), 'Есть цифры'],
    [/[^\p{L}\d]/u.test(pw), 'Есть символы: - ! ? # и другие'],
    [pw.length > 0 && !COMMON_PW.some(c => low.includes(c)) && !/(.)\1\1/.test(pw), 'Нет популярных паролей и повторов вроде «aaa»'],
  ];
  const pool = [[/[a-z]/, 26], [/[A-Z]/, 26], [/[а-яё]/, 33], [/[А-ЯЁ]/, 33], [/\d/, 10], [/[^\p{L}\d]/u, 33]].reduce((n, [re, k]) => n + (re.test(pw) ? k : 0), 0);
  // ponytail: грубая оценка полного перебора (10 млрд вариантов в секунду); словарные атаки учтены только списком COMMON_PW
  const bits = tests[4][0] ? pw.length * Math.log2(pool || 1) : Math.min(20, pw.length * 2);
  const secs = 2 ** bits / 1e10 / 2;
  // оценка по времени взлома: меньше часа, года, тысячи лет
  const score = !pw ? 0 : secs < 3600 ? 1 : secs < 3.2e7 ? 2 : secs < 3.2e10 ? 3 : 4;
  return { tests, score, secs };
}
const crackTime = s => [[1, 'меньше секунды'], [60, 'несколько секунд'], [3600, 'несколько минут'], [86400, 'несколько часов'], [2.6e6, 'несколько дней'],
  [3.2e7, 'несколько месяцев'], [3.2e9, 'годы'], [3.2e10, 'века'], [3.2e13, 'тысячи лет']].find(([lim]) => s < lim)?.[1] || 'миллионы лет';
const PW_LEVELS = ['Начни вводить пароль', 'Слабый', 'Так себе', 'Хороший', 'Отличный'];
const rnd = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const genPassphrase = () => {
  const ws = new Set(); while (ws.size < 3) ws.add(PW_WORDS[rnd(PW_WORDS.length)]);
  return [...ws].map(w => w[0].toUpperCase() + w.slice(1)).join('-') + '-' + (rnd(90) + 10) + '!?#$%&*'[rnd(7)];
};

function password(app) {
  app.innerHTML = hero('key-round', '', 'Проверка пароля', 'Узнай, сколько времени понадобится взломщику. Пароль проверяется прямо в браузере и никуда не отправляется.') + `
    <div class="card">
      <label class="field" for="pw"><span>Введи пароль</span></label>
      <div class="pw-in"><input class="in" id="pw" type="password" autocomplete="off" spellcheck="false" placeholder="Например: Кот-Луна-Ракета-42!"><button class="btn sm" id="eye" type="button" aria-label="Показать пароль">${ic('eye')}</button></div>
      <div class="pw-meter" id="meter" data-s="0"><i></i><i></i><i></i><i></i></div>
      <div class="pw-verdict" aria-live="polite"><b id="lvl">${PW_LEVELS[0]}</b><span id="time"></span></div>
      <ul class="pw-tests" id="tests"></ul>
    </div>
    <h2 class="label">Пароль-фраза</h2>
    <div class="card"><p class="muted" style="margin-top:0">Три случайных слова, число и символ. Такой пароль легко запомнить и очень трудно подобрать.</p>
      <div class="pw-gen"><code id="gen"></code><button class="btn sm" id="regen">${ic('dices')} Другая</button><button class="btn sm" id="copy">${ic('copy')} Копировать</button><button class="btn acc sm" id="try">Проверить</button></div>
    </div>`;
  const pw = $('#pw', app), gen = $('#gen', app);
  const update = () => {
    const { tests, score, secs } = pwCheck(pw.value);
    $('#meter', app).dataset.s = score;
    $('#lvl', app).textContent = PW_LEVELS[score];
    $('#time', app).textContent = pw.value ? 'Взлом перебором: ' + crackTime(secs) : '';
    $('#tests', app).innerHTML = tests.map(([ok, t]) => `<li class="${ok ? 'ok' : ''}">${ic(ok ? 'circle-check' : 'circle')} ${t}</li>`).join('');
    if (score === 4) flag('pwStrong');
  };
  pw.oninput = update;
  $('#eye', app).onclick = () => { const show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; $('#eye', app).innerHTML = ic(show ? 'eye-off' : 'eye'); $('#eye', app).setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль'); };
  const regen = () => { gen.textContent = genPassphrase(); };
  $('#regen', app).onclick = regen;
  $('#copy', app).onclick = () => navigator.clipboard?.writeText(gen.textContent).then(() => toast('Скопировано', 'copy'), () => toast('Не удалось скопировать', 'triangle-alert'));
  $('#try', app).onclick = () => { pw.value = gen.textContent; pw.type = 'text'; update(); pw.focus(); };
  regen(); update();
}

// ---------- база знаний ----------
function kb(app) {
  const tabs = [['threats', 'triangle-alert', 'Угрозы'], ['protect', 'shield-check', 'Защита'], ['laws', 'scale', 'Законы РБ'], ['help', 'life-buoy', 'Помощь']];
  const show = tab => {
    addTo('kbTabs', tab);
    $$('.tab', app).forEach(t => t.classList.toggle('on', t.dataset.t === tab));
    const body = $('#kbBody', app);
    if (tab === 'threats') body.innerHTML = THREATS.map(t => `<div class="card rv">
      <div class="threat-head"><span class="ico">${ic(t.icon)}</span><div><h2 style="font-size:22px">${t.title}</h2><small>${t.sub}</small></div></div>
      <p>${t.text}</p><div class="signs"><h4>Признаки</h4><ul>${t.signs.map(s => `<li>${s}</li>`).join('')}<li class="good">${ic('circle-check')} ${t.tip}</li></ul></div>
      <div class="danger"><span>Опасность</span><span>${t.danger}/10</span></div><div class="dbar"><div style="width:${t.danger * 10}%"></div></div></div>`).join('');
    if (tab === 'protect') body.innerHTML = `<div class="grid g2">${PROTECT.map(p => `<div class="card rv" style="margin:0"><span class="ico">${ic(p.icon)}</span><h3 style="font-size:18px;margin-top:12px">${p.title}</h3><ul style="padding-left:18px;margin:10px 0 0">${p.items.map(i => `<li>${i}</li>`).join('')}</ul></div>`).join('')}</div>`;
    if (tab === 'laws') body.innerHTML = LAWS.map(l => `<div class="card rv"><div class="threat-head" style="margin:0"><span class="ico">${ic(l.icon)}</span><h3 style="font-size:17px">${l.title}</h3></div><p style="margin:12px 0 0">${l.text}</p>${l.link ? `<a class="btn sm" style="margin-top:12px" href="#/${l.link}">Подробнее</a>` : ''}</div>`).join('') +
      '<p class="muted" style="font-size:13px">Официальные тексты законов — на Национальном правовом интернет-портале pravo.by.</p>';
    if (tab === 'help') body.innerHTML = HELP.map(h => `<div class="card rv"><div class="threat-head" style="margin:0"><span class="ico">${ic(h.icon)}</span><div><h3 style="font-size:17px">${h.title}</h3><p style="margin:6px 0 0">${h.text}</p></div></div></div>`).join('');
  };
  app.innerHTML = hero('book-open', 'База знаний', 'Кибербезопасность', 'Какие бывают угрозы, как от них защититься, что говорит закон и куда обращаться') +
    `<div class="row center" style="margin-bottom:24px">${tabs.map(([k, i, l]) => `<button class="tab" data-t="${k}">${ic(i)} ${l}</button>`).join('')}</div><div id="kbBody"></div>`;
  $$('.tab', app).forEach(t => t.onclick = () => show(t.dataset.t));
  show('threats');
}

// ---------- советы + чеклист ----------
function tips(app) {
  let done = new Set(S.checklist || []);
  app.innerHTML = hero('lightbulb', 'Советы', 'Простые правила', 'Привычки, которые защищают твои аккаунты, деньги и личные данные') +
    `<div class="grid g2">${TIPS.map(t => `<div class="card rv" style="margin:0"><span class="ico">${ic(t.icon)}</span><h3 style="font-size:17px;margin-top:12px">${t.title}</h3><p class="muted" style="margin:6px 0 0;font-size:14px">${t.text}</p></div>`).join('')}</div>
    <div class="label">${ic('list-checks')} Чеклист безопасности</div>
    <div class="card rv"><div class="row" style="justify-content:space-between;margin-bottom:10px"><span class="muted" id="cnt"></span><button class="btn sm" id="reset">${ic('refresh-cw')} Сбросить</button></div>
    <div class="progress"><div id="pbar"></div></div>${ME ? '' : `<p class="muted" style="font-size:13px">${ic('lock')} Без аккаунта отметки не сохраняются.</p>`}
    <div id="list"></div></div>`;
  const draw = () => {
    $('#cnt', app).textContent = `Выполнено ${done.size} из ${CHECKLIST.length}`;
    $('#pbar', app).style.width = done.size / CHECKLIST.length * 100 + '%';
    $('#list', app).innerHTML = CHECKLIST.map((c, i) => `<label class="check ${done.has(i) ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${done.has(i) ? 'checked' : ''}><span>${c}</span></label>`).join('');
    $$('#list input', app).forEach(cb => cb.onchange = () => {
      cb.checked ? done.add(+cb.dataset.i) : done.delete(+cb.dataset.i);
      S.checklist = [...done];
      if (done.size === CHECKLIST.length) { S.checklistFull = 1; confetti(); toast('Чеклист выполнен полностью!', 'shield-check'); }
      save(); draw();
    });
  };
  $('#reset', app).onclick = () => { done = new Set(); S.checklist = []; save(); draw(); toast('Чеклист сброшен', 'refresh-cw'); };
  draw();
}

// ---------- законы ----------
const articles = (list, withPunish) => list.map(a => `<div class="card art rv"><span class="num">Ст. ${a.art}</span><div><h3 style="font-size:18px">${a.title}</h3><p style="margin:6px 0 0">${a.text}</p>${withPunish ? `<div class="punish">${ic('scale')}<span>Наказание по ч. 1: ${a.punish}</span></div>` : ''}</div></div>`).join('');
function uk(app) {
  app.innerHTML = hero('gavel', 'Уголовный кодекс', 'Закон в сети', 'Какие действия в интернете считаются преступлением в Республике Беларусь') +
    `<div class="card rv" style="border-color:var(--accent)"><b>Важно знать.</b> В общем случае уголовная ответственность наступает с <b>16 лет</b>, а за некоторые преступления — с <b>14 лет</b> (ст. 27 УК). В этот список входит хищение с помощью компьютерной информации (ст. 212). Незнание закона не освобождает от ответственности.</div>
    <div class="label">Глава 31 и связанные статьи</div>${articles(UK, true)}
    <p class="muted" style="font-size:13px">Кратко и простыми словами, для учёбы. Сверено с текстом УК на pravo.by (ноябрь 2026). Полные формулировки и все части статей — там же.</p>`;
}
function constitution(app) {
  app.innerHTML = hero('scroll-text', 'Конституция', 'Твои права', 'Основной закон Республики Беларусь защищает тебя и в интернете') +
    articles(CONSTITUTION, false) + '<p class="muted" style="font-size:13px">По тексту Конституции Республики Беларусь в действующей редакции (pravo.by).</p>';
}

// ---------- достижения ----------
const ring = (n, total, size = 84) => {
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--card2)" stroke-width="6"/><circle class="ring-val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - n / total)}"/></svg>`;
};
const animateRings = root => requestAnimationFrame(() => requestAnimationFrame(() => $$('.ring-val', root).forEach(c => c.style.strokeDashoffset = c.dataset.off)));
const lockWall = (app, title, text) => {
  app.innerHTML = `<div class="card lockwall"><span class="ico">${ic('lock')}</span><h2 style="font-size:28px">${title}</h2><p class="muted" style="max-width:420px;margin:10px auto 20px">${text}</p><a class="btn acc" href="#/profile">${ic('user')} Войти или создать аккаунт</a></div>`;
};
function achievements(app) {
  if (!ME) return lockWall(app, 'Достижения', 'Награды привязаны к аккаунту. Создай его — он хранится прямо в этом браузере, почта и телефон не нужны.');
  const got = gotIds(), n = got.size, pct = Math.round(n / ACHIEVEMENTS.length * 100);
  const dates = Object.fromEntries(ME.achievements.map(a => [a.id, a.unlocked_at]));
  app.innerHTML = hero('trophy', 'Коллекция наград', 'Достижения', 'Награды сохраняются в твоём аккаунте') + `
    <div class="card row" style="gap:24px">${ring(n, ACHIEVEMENTS.length)}<b>${n}<small>из ${ACHIEVEMENTS.length}</small></b></div>
      <div style="flex:1"><h2 style="font-size:22px">Прогресс: ${pct}%</h2><p class="muted" style="margin:6px 0 12px">${pct === 100 ? 'Все награды собраны!' : pct >= 50 ? 'Больше половины пути пройдено.' : 'Играй в игры и проходи задания, чтобы открыть новые награды.'}</p>
      <div class="row"><a class="btn dark sm" href="#/quiz">${ic('target')} Квиз</a><a class="btn sm" href="#/detective">${ic('search')} Детектив</a><button class="btn sm danger" id="reset">${ic('trash-2')} Сбросить</button></div></div></div>
    <div style="margin:16px 0">${statCards([[S.games || 0, 'Игр сыграно', 'c-acc'], [S.best || 0, 'Лучший счёт', 'c-ok'], [accuracy(), 'Точность', '', '%'], [S.answered || 0, 'Ответов']])}</div>
    ${ACH_CATS.map(([cat, icon]) => { const list = ACHIEVEMENTS.filter(a => a.cat === cat); return `
      <div class="row" style="justify-content:space-between;margin:28px 0 12px"><h2 style="font-size:20px;display:flex;gap:8px;align-items:center">${ic(icon)} ${cat}</h2><small class="muted">${list.filter(a => got.has(a.id)).length}/${list.length}</small></div>
      <div class="grid">${list.map(a => `<div class="ach rv ${got.has(a.id) ? 'got' : 'locked'}"><span class="ico">${ic(got.has(a.id) ? a.icon : 'lock')}</span><b>${a.title}</b><p>${a.desc}</p><p style="margin-top:6px;font-size:11px">${got.has(a.id) ? (dates[a.id] ? 'Получено ' + new Date(dates[a.id]).toLocaleDateString('ru-RU') : 'Получено') : 'Пока закрыто'}</p></div>`).join('')}</div>`; }).join('')}`;
  animateRings(app);
  $('#reset', app).onclick = async () => {
    if (!confirm('Сбросить всю статистику и достижения? Это нельзя отменить.')) return;
    ME.achievements = ME.achievements.filter(a => a.id === 'registered'); S = { registered: 1 };
    storeProgress(); render(); toast('Прогресс сброшен', 'refresh-cw');
  };
}

// ---------- AI ----------
const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/\[\[go:(\w+)\]\]/g, (m, r) => ROUTE_NAMES[r] ? `<a class="go-btn" href="#/${r}">${ROUTE_NAMES[r]}</a>` : '');
const TYPING = '<span class="typing"><i></i><i></i><i></i></span>';
const AI_HELLO = 'Привет! Я КиберAI. Помогаю разобраться, как оставаться в безопасности в интернете.\n\nМожно спросить:\n• как распознать обман\n• как защитить аккаунт\n• что говорят законы Беларуси\n• что делать, если что-то случилось\n\nВыбери тему или напиши свой вопрос. Не пиши мне своё имя, адрес, телефон и пароли.';
let aiHistory = [];
function localReply(text, mode) {
  const t = text.toLowerCase(), hit = list => list.find(([keys]) => keys.some(k => t.includes(k)));
  const route = mode === 'helper' && hit(AI_ROUTE_HINTS);
  return route ? `Вот подходящий раздел. [[go:${route[1]}]]` : hit(AI_FALLBACK)?.[1] || AI_FALLBACK_DEFAULT;
}
// Нейросеть через Worker; если он не настроен, перегружен или недоступен — встроенная база ответов
async function askAI(messages, mode) {
  if (CONFIG.aiUrl) try {
    const r = await fetch(CONFIG.aiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, mode }) });
    const { reply } = await r.json();
    if (reply) return reply;
  } catch {}
  return localReply(messages.at(-1).content, mode);
}
function ai(app) {
  app.innerHTML = hero('bot', 'Консультант', 'КиберAI', 'Задай вопрос о безопасности в интернете, своих правах или законах Беларуси') + `
    <div class="chat-wrap"><div class="card topics" style="padding:16px"><div class="label" style="margin:0 0 4px">Быстрые темы</div>
      ${AI_TOPICS.map(([i, t]) => `<button data-q="${esc(t)}">${ic(i)} ${esc(t)}</button>`).join('')}</div>
    <div class="card chat"><div class="chat-head"><span class="ai-badge">${ic('bot')}</span><div><h3 style="font-size:17px">КиберAI</h3><small><i></i> Отвечает на вопросы о безопасности в сети</small></div><button class="btn sm" id="clear">${ic('trash-2')} Очистить</button></div>
      <div class="msgs" id="msgs"></div>
      <form id="f"><input class="in" id="q" placeholder="Напиши вопрос..." maxlength="1500" autocomplete="off"><button class="send" aria-label="Отправить">${ic('send')}</button></form></div></div>
    <p class="muted" style="font-size:12px;text-align:center;margin-top:12px">КиберAI может ошибаться. Если случилось что-то серьёзное — обязательно расскажи взрослым.</p>`;
  const msgs = $('#msgs', app);
  const add = (role, html) => { const d = document.createElement('div'); d.className = 'msg ' + (role === 'user' ? 'me' : 'bot'); d.innerHTML = html; msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d; };
  const draw = () => { msgs.innerHTML = ''; add('assistant', fmt(AI_HELLO)); aiHistory.forEach(m => add(m.role, fmt(m.content))); };
  let busy = false;
  const send = async text => {
    text = text.trim(); if (!text || busy) return;
    busy = true; aiHistory.push({ role: 'user', content: text }); add('user', esc(text)); bump('aiMsgs');
    const wait = add('assistant', TYPING);
    const reply = await askAI(aiHistory, 'consultant');
    aiHistory.push({ role: 'assistant', content: reply });
    if (wait.isConnected) { wait.innerHTML = fmt(reply); msgs.scrollTop = msgs.scrollHeight; }
    busy = false;
  };
  $('#f', app).onsubmit = e => { e.preventDefault(); const q = $('#q', app); send(q.value); q.value = ''; };
  $$('[data-q]', app).forEach(b => b.onclick = () => send(b.dataset.q));
  $('#clear', app).onclick = () => { aiHistory = []; draw(); };
  draw();
}

// ---------- профиль ----------
function profile(app) { ME ? cabinet(app) : authForm(app, cookie.get('cs_acc') ? 'login' : 'register'); }
function authForm(app, mode) {
  const reg = mode === 'register', saved = cookie.get('cs_acc');
  app.className = '';
  app.innerHTML = `<section class="hero" style="padding-bottom:20px"><span class="ico" style="width:64px;height:64px;border-radius:20px">${ic('user')}</span><h1 style="font-size:32px;margin-top:14px">Личный кабинет</h1><p>Сохраняй результаты и собирай награды</p></section>
    <div class="card" style="max-width:380px;margin:0 auto"><div class="row" style="margin-bottom:22px;flex-wrap:nowrap"><button class="tab ${reg ? '' : 'on'}" data-m="login" style="flex:1;justify-content:center">ВОЙТИ</button><button class="tab ${reg ? 'on' : ''}" data-m="register" style="flex:1;justify-content:center">РЕГИСТРАЦИЯ</button></div>
    <form id="af" novalidate>
      <div class="note">${ic('cookie')}<span>${reg ? 'Аккаунт хранится только в этом браузере, в куках. На другом устройстве или после очистки кук его не будет. Почту, телефон и настоящее имя мы не спрашиваем.' : saved ? `В этом браузере сохранён аккаунт <b>@${esc(saved.nick)}</b>.` : 'В этом браузере пока нет аккаунта — сначала зарегистрируйся.'}</span></div>
      <label class="field"><span>Никнейм</span><input class="in" name="nick" placeholder="CyberHero" required minlength="3" maxlength="20" autocomplete="username" value="${reg ? '' : esc(saved?.nick)}"></label>
      ${reg ? '<label class="field"><span>Как тебя называть (необязательно)</span><input class="in" name="display_name" placeholder="Без фамилии" maxlength="30"></label>' : ''}
      <label class="field"><span>Пароль${reg ? ' (не короче 8 символов)' : ''}</span><input class="in" type="password" name="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
      ${reg ? '<label class="consent"><input type="checkbox" name="consent" required><span>Я не буду писать в профиле личные данные. Родители знают, что я регистрируюсь.</span></label>' : ''}
      <div class="err" id="aerr"></div>
      <button class="btn acc" style="width:100%;justify-content:center">${reg ? 'Создать аккаунт' : 'Войти'}</button>
    </form></div>`;
  $$('[data-m]', app).forEach(b => b.onclick = () => authForm(app, b.dataset.m));
  $('#af', app).onsubmit = async e => {
    e.preventDefault();
    const f = e.target, err = m => { $('#aerr', app).textContent = m; };
    const nick = f.nick.value.trim(), pw = f.password.value;
    if (reg) {
      if (!/^[\p{L}\d_.-]{3,20}$/u.test(nick)) return err('Никнейм: от 3 до 20 символов — буквы, цифры, _ . -');
      if (pw.length < 8) return err('Пароль должен быть не короче 8 символов');
      if (pw.toLowerCase() === nick.toLowerCase() || ['12345678', '123456789', 'qwertyui', 'password'].includes(pw)) return err('Этот пароль слишком простой — придумай другой');
      if (!f.consent.checked) return err('Нужно согласие с правилами и разрешение родителей');
      if (saved && !confirm(`В этом браузере уже есть аккаунт @${saved.nick}. Заменить его? Его прогресс пропадёт.`)) return;
      ME = { nick, display_name: f.display_name.value.trim(), bio: '', created_at: Date.now(), achievements: [] };
      S = { registered: 1 };
      storeProfile(await hashPw(nick, pw));
    } else if (!saved || saved.nick.toLowerCase() !== nick.toLowerCase() || saved.pw !== await hashPw(saved.nick, pw)) {
      return err(saved ? 'Неверный никнейм или пароль' : 'В этом браузере нет такого аккаунта. Зарегистрируйся.');
    }
    cookie.set('cs_in', 1);
    if (reg) { save(); toast('Аккаунт создан!', 'user'); } else { loadAccount(); toast('С возвращением, ' + ME.nick + '!', 'user'); }
    updateNav(); render();
  };
}
function cabinet(app, tab = 'ach') {
  const got = ACHIEVEMENTS.filter(a => gotIds().has(a.id));
  app.innerHTML = `<div class="prof"><div class="card" style="text-align:center;padding:24px 16px">
      <div class="avatar">${esc((ME.display_name || ME.nick)[0].toUpperCase())}</div>
      <h2 style="font-size:22px;margin-top:12px">${esc(ME.display_name || ME.nick)}</h2><div class="c-acc" style="font:13px var(--mono)">@${esc(ME.nick)}</div>
      ${ME.bio ? `<p class="muted" style="font-size:14px">${esc(ME.bio)}</p>` : ''}
      <div class="mini"><div><b>${S.best || 0}</b>Рекорд</div><div><b>${got.length}</b>Наград</div><div><b>${S.games || 0}</b>Игр</div></div>
      <div>${got.slice(-3).map(a => `<span class="badge">${ic(a.icon)} ${a.title}</span>`).join('')}</div>
      <p class="muted" style="font:12px var(--mono)">С нами с ${new Date(ME.created_at).toLocaleDateString('ru-RU')}</p>
      <div style="display:grid;gap:8px"><button class="btn sm" data-t="settings">${ic('pencil')} Изменить</button>
      <button class="btn sm danger" id="out">${ic('log-out')} Выйти</button></div></div>
    <div><div class="row" style="margin-bottom:16px">${[['ach', 'trophy', 'Награды'], ['stats', 'target', 'Статистика'], ['settings', 'pencil', 'Настройки']].map(([k, i, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${ic(i)} ${l}</button>`).join('')}</div>
      <div id="pbody"></div></div></div>`;
  $$('[data-t]', app).forEach(b => b.onclick = () => cabinet(app, b.dataset.t));
  $('#out', app).onclick = () => { signOut(); location.hash = '#/'; render(); };
  const body = $('#pbody', app);

  if (tab === 'ach') body.innerHTML = got.length ? `<div class="grid">${got.map(a => `<div class="ach got"><span class="ico">${ic(a.icon)}</span><b>${a.title}</b><p>${a.desc}</p></div>`).join('')}</div>` : `<div class="card muted">Пока нет наград — <a href="#/quiz">сыграй в квиз</a>!</div>`;
  if (tab === 'stats') body.innerHTML = statCards([
    [S.games || 0, 'Игр сыграно', 'c-acc'], [S.best || 0, 'Рекорд квиза', 'c-ok'], [accuracy(), 'Точность', '', '%'], [S.answered || 0, 'Ответов'],
    [(S.cases || []).length, 'Дел раскрыто', '', '/5'], [S.sortBest || 0, 'Сортировка', '', '/12'], [S.survBest || 0, 'Выживание'], [S.maxStreak || 0, 'Лучшая серия']]);
  if (tab === 'settings') {
    body.innerHTML = `<div class="card"><form id="sf"><label class="field"><span>Как тебя называть</span><input class="in" name="display_name" maxlength="30" value="${esc(ME.display_name)}"></label>
      <label class="field"><span>О себе</span><textarea class="in" name="bio" rows="3" maxlength="200" placeholder="Например: люблю головоломки">${esc(ME.bio)}</textarea></label>
      <p class="muted" style="font-size:12px">Не пиши фамилию, адрес, номер школы и телефон.</p>
      <button class="btn acc sm">${ic('circle-check')} Сохранить</button></form></div>`;
    $('#sf', app).onsubmit = e => {
      e.preventDefault();
      ME.display_name = e.target.display_name.value.trim(); ME.bio = e.target.bio.value.trim();
      if (storeProfile()) toast('Профиль сохранён', 'circle-check'); else toast('Слишком длинный текст для куки', 'triangle-alert');
      cabinet(app, 'settings');
    };
  }
}

// ---------- виджет-помощник ----------
const wMsgs = $('#wMsgs');
const wAdd = (cls, html) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; wMsgs.append(d); wMsgs.scrollTop = 1e9; return d; };
$('#wBtn').onclick = () => { const p = $('#wPanel'); p.hidden = !p.hidden; if (!p.hidden) $('#wInput').focus(); };
$('#wClose').onclick = () => $('#wPanel').hidden = true;
$$('.w-chips button').forEach(b => b.onclick = () => { location.hash = '#/' + b.dataset.go; });
wMsgs.addEventListener('click', e => { if (e.target.closest('.go-btn') && innerWidth < 780) $('#wPanel').hidden = true; });
const wHistory = [];
$('#wForm').onsubmit = async e => {
  e.preventDefault();
  const q = $('#wInput').value.trim(); if (!q) return;
  $('#wInput').value = ''; wAdd('me', esc(q));
  wHistory.push({ role: 'user', content: q });
  const wait = wAdd('bot', TYPING);
  const reply = await askAI(wHistory.slice(-6), 'helper');
  wHistory.push({ role: 'assistant', content: reply });
  wait.innerHTML = fmt(reply);
};

// ---------- тема ----------
const themeBtn = $('#theme');
// Светлая тема — «защитник», тёмная — «хакер». Смена режима раскрывается кругом от кнопки.
const isHacker = () => document.documentElement.dataset.theme === 'dark';
const syncThemeBtn = () => { themeBtn.innerHTML = isHacker() ? `${ic('shield-check')}<span>Стать защитником</span>` : `${ic('terminal')}<span>Стать хакером</span>`; };
themeBtn.onclick = () => {
  const t = isHacker() ? 'light' : 'dark';
  const apply = () => { document.documentElement.dataset.theme = t; ls.set('cs_theme', t); syncThemeBtn(); enhance(); };
  if (REDUCED || !document.startViewTransition) return apply();
  const r = themeBtn.getBoundingClientRect(), st = document.documentElement.style;
  st.setProperty('--vx', r.left + r.width / 2 + 'px'); st.setProperty('--vy', r.top + r.height / 2 + 'px');
  document.startViewTransition(apply);
};

// ---------- поток кода на фоне: плотные колонки с разной скоростью, яркий символ на конце ----------
(function rain() {
  if (REDUCED) return;
  const cv = $('#rain'), ctx = cv.getContext('2d');
  const chars = '01010110{}[]()<>/=;:+-*#$&|!?_КИБЕРЩИТ', fs = 15, gap = fs * 1.15;
  let cols = [];
  const resize = () => {
    cv.width = innerWidth; cv.height = innerHeight;
    cols = Array.from({ length: Math.ceil(cv.width / gap) }, () => ({ y: Math.random() * -60, v: .35 + Math.random() * .8 }));
  };
  resize(); addEventListener('resize', resize);
  setInterval(() => {
    if (document.hidden) return;
    const cs = getComputedStyle(document.documentElement), ch = () => chars[Math.random() * chars.length | 0];
    ctx.globalAlpha = .1; ctx.fillStyle = cs.getPropertyValue('--bg').trim(); ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.font = fs + 'px "IBM Plex Mono", monospace';
    const accent = cs.getPropertyValue('--accent').trim(), head = cs.getPropertyValue('--text').trim();
    cols.forEach((c, i) => {
      const y = c.y * fs;
      ctx.globalAlpha = .75; ctx.fillStyle = accent; ctx.fillText(ch(), i * gap, y - fs);
      ctx.globalAlpha = 1; ctx.fillStyle = head; ctx.fillText(ch(), i * gap, y);
      c.y += c.v;
      if (y > cv.height && Math.random() > .975) { c.y = Math.random() * -20; c.v = .35 + Math.random() * .8; }
    });
  }, 50);
})();

// ---------- запуск ----------
(async function boot() {
  syncThemeBtn();
  loadAccount();
  updateNav(); render();
})();
