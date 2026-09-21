'use strict';
// Святкування досягнення цілі тижня (score перетнув 85%).
//
// Історія специфікації: (1) було різко й лякало — білий спалах картки й стрибок
// числа ×1.15; (2) стало ЗАНАДТО тихо — користувач дивиться на чекбокс, який
// щойно натиснув, а сигнали були вгорі картки; (3) зараз "середина": заливка й
// контур усієї картки (.goal-reached), пульс числа (.celebrate), дуга кружечка
// (.arc-reach), конфеті з точки тапу (<canvas>) і тост «Тиждень N · ціль 85%
// досягнута» — видно з будь-якого місця екрана, але без світлих спалахів.
//
// render() будує DOM з нуля, тож одноразовість тримається на стані
// celebration (живе ~2.4 с) і від'ємному --goal-delay: повторний render()
// посеред анімації її не обриває, а після — клас не повертається (той самий
// урок, що й just-toggled у checkbox-animation-scope.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mountTracker, flush } = require('./helpers/tracker');

const BODY_SRC = fs.readFileSync(path.join(__dirname, '..', 'body.html'), 'utf8');

// Неділя першого тижня: усі 7 днів уже не "майбутні", отже клікабельні.
const NOW = new Date(2026, 7, 2, 12);
const DAYS_OFF = [false, false, false, false, false, false, false];
const ALL_DAYS = [true, true, true, true, true, true, true];
const CALORIE_LABEL = 'Не більше 2000 ккал/день';
const LOG_LABEL = 'Облік їжі кожного дня';
const CIRC = 2 * Math.PI * 19; // r=19 у renderJourney
const TOAST_TEXT = 'Тиждень 1 · ціль 85% досягнута';

// 5 дій по 20%: борг і капітал виконані повністю (150 = план тижня 1), w1 і
// "облік їжі" теж; калорійні дні — k із 7. Score = (4 + k/7) / 5:
//   k=1 → 83%,  k=2 → 86% — рівно один клік через поріг 85%.
function week(calorieTrue, over = {}) {
  const calorieDays = DAYS_OFF.map((_, i) => i < calorieTrue);
  return Object.assign({
    weight: null, debtAmt: 150, capitalAmt: 150,
    checks: { w1: true }, logDays: ALL_DAYS.slice(), calorieDays, custom: {},
  }, over);
}

function mount(calorieTrue, opts = {}) {
  return mountTracker(Object.assign({ now: NOW, seed: { weeks: { 1: week(calorieTrue) } } }, opts));
}

function grid(document, label) {
  const g = [...document.querySelectorAll('.daily-grid')].find((el) => el.getAttribute('aria-label') === label);
  assert.ok(g, `денна сітка "${label}" має бути в картці тижня 1`);
  return g;
}

function click(dom, el) {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

async function clickCalorie(dom, idx) {
  // Вузол перезапитуємо щоразу: render() після кліку заміняє весь DOM.
  click(dom, grid(dom.window.document, CALORIE_LABEL).querySelectorAll('.day-square')[idx]);
  await flush();
}

// render() без зміни score: вага не входить у score, а blur поля викликає повний render().
async function rerender(dom) {
  const { document } = dom.window;
  const row = [...document.querySelectorAll('.metric-row')]
    .find((r) => r.querySelector('.metric-label')?.textContent === 'Вага');
  const input = row.querySelector('.stepper input');
  input.value = '80';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
  await flush();
}

function heroScore(document) {
  return document.querySelector('#hero-wrap .hero-num').textContent;
}

function goalClassCounts(document) {
  return {
    glow: document.querySelectorAll('#hero-wrap .hero-card.goal-reached').length,
    pulse: document.querySelectorAll('#hero-wrap .hero-num.celebrate').length,
    arcs: document.querySelectorAll('#journey-wrap .arc-reach').length,
  };
}
const NONE = { glow: 0, pulse: 0, arcs: 0 };
const ALL = { glow: 1, pulse: 1, arcs: 1 };

const toasts = (document) => [...document.querySelectorAll('#goal-toast-wrap .goal-toast')];
const canvases = (document) => [...document.querySelectorAll('body > canvas')];

// Позиція елемента: тест сам каже, де "на екрані" стоїть чекбокс і картка
// (jsdom не має layout, getBoundingClientRect інакше завжди нулі).
function mockRects(dom) {
  const zero = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  dom.window.Element.prototype.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains('just-toggled')) return { left: 100, top: 400, width: 32, height: 32, right: 132, bottom: 432 };
    if (this.classList && this.classList.contains('hero-card')) return { left: 10, top: 20, width: 300, height: 600, right: 310, bottom: 620 };
    return zero;
  };
}

function allCss(dom) {
  return [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
}

// Тіло першого блоку, що починається з header (з урахуванням вкладених {}).
function braceBody(text, header) {
  const start = text.indexOf(header);
  assert.notEqual(start, -1, `не знайдено "${header}"`);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`не закрито блок "${header}"`);
}

// ═══ CSS / JS: жодних світлих літералів ═══════════════════════════════════

test('CSS: білого спалаху #E1F5EE і flashBg/.flash більше немає', async () => {
  const dom = mount(1);
  await flush();
  const css = allCss(dom);

  assert.doesNotMatch(css, /#E1F5EE/i, 'літерал майже білого кольору має зникнути з CSS');
  assert.doesNotMatch(css, /flashBg/, 'keyframes flashBg має бути видалено');
  assert.doesNotMatch(css, /\.flash\b/, 'клас .flash має бути видалено');
});

test('CSS: анімації досягнення (картка, число, дуга, тост) — лише токени, жодних світлих/літеральних кольорів', async () => {
  const dom = mount(1);
  await flush();
  const css = allCss(dom);

  const blocks = {
    'goalGlow keyframes': braceBody(css, '@keyframes goalGlow'),
    'goalCard keyframes': braceBody(css, '@keyframes goalCard'),
    'goalTop keyframes': braceBody(css, '@keyframes goalTop'),
    'goalNumColor keyframes': braceBody(css, '@keyframes goalNumColor'),
    'celebratePulse keyframes': braceBody(css, '@keyframes celebratePulse'),
    'arcReach keyframes': braceBody(css, '@keyframes arcReach'),
    'goalToast keyframes': braceBody(css, '@keyframes goalToast'),
    '.hero-card.goal-reached': braceBody(css, '.hero-card.goal-reached {'),
    '.goal-reached::after': braceBody(css, '.hero-card.goal-reached::after'),
    '.celebrate': braceBody(css, '.celebrate {'),
    '.arc-reach': braceBody(css, '.arc-reach {'),
    '.goal-toast': braceBody(css, '.goal-toast {'),
  };
  for (const [name, body] of Object.entries(blocks)) {
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, `${name}: жодних hex-літералів кольору`);
    assert.doesNotMatch(body, /\b(rgba?|hsla?)\(/i, `${name}: жодних rgb()/hsl() літералів`);
    assert.doesNotMatch(body, /\bwhite\b/i, `${name}: жодного білого`);
    for (const m of body.matchAll(/background-color:\s*([^;]+);/g)) {
      assert.match(m[1].trim(), /^var\(--[\w-]+\)$/, `${name}: background-color лише з токена, отримав "${m[1]}"`);
    }
  }
  assert.match(blocks['.goal-toast'], /font-family:\s*'Inter'/, 'тост поза #tracker-root не успадковує Inter — шрифт має бути заданий явно');
  assert.match(blocks['.goal-reached::after'], /var\(--accent-celebrate\)/, 'рівномірна заливка — токеном --accent-celebrate');
  assert.match(blocks['goalCard keyframes'], /var\(--accent\)/, 'контур стає --accent');
});

test('CSS: токен --accent-celebrate оголошено в :root, це напівпрозорий зелений 25–30%', async () => {
  const dom = mount(1);
  await flush();
  const m = /--accent-celebrate:\s*rgba\(\s*47,\s*190,\s*147,\s*([\d.]+)\s*\)/.exec(allCss(dom));
  assert.ok(m, '--accent-celebrate: rgba(<accent>, α) має бути оголошено в :root');
  assert.ok(Number(m[1]) >= 0.25 && Number(m[1]) <= 0.30, `альфа має бути 0.25–0.30, отримав ${m[1]}`);
  assert.match(allCss(dom), /--accent-deep:\s*#[0-9a-f]{6}/i, 'темніший зелений для конфеті — токеном');
});

test('CSS: число пульсує 1 → 1.08 → 1 за 0.5 с з cubic-bezier(0.22, 1, 0.36, 1), без відскоку нижче 1', async () => {
  const dom = mount(1);
  await flush();
  const css = allCss(dom);

  const scales = [...braceBody(css, '@keyframes celebratePulse').matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.ok(scales.length >= 3, 'очікував кілька кроків scale у celebratePulse');
  assert.equal(Math.max(...scales), 1.08);
  assert.ok(Math.min(...scales) >= 1, 'без відскоку нижче 1');
  assert.match(braceBody(css, '.celebrate {'), /celebratePulse\s+0\.5s\s+cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
  assert.match(braceBody(css, '.celebrate {'), /goalNumColor/, 'колір числа плавно переходить у зелений');
});

test('CSS: картка — наростання ~0.3 с, утримання ~0.8 с, згасання ~1.2 с (13% / 48% / 100% від 2.3 с)', async () => {
  const dom = mount(1);
  await flush();
  const css = allCss(dom);

  assert.match(braceBody(css, '.hero-card.goal-reached {'), /goalCard\s+2\.3s/);
  const glow = braceBody(css, '@keyframes goalGlow');
  assert.match(glow, /13%\s*\{\s*opacity:\s*1/);
  assert.match(glow, /48%\s*\{\s*opacity:\s*1/);
  // 0.3 / 2.3 ≈ 13%, 1.1 / 2.3 ≈ 48%
  assert.ok(Math.abs(0.3 / 2.3 * 100 - 13) < 1 && Math.abs(1.1 / 2.3 * 100 - 48) < 1);
  const card = braceBody(css, '@keyframes goalCard');
  assert.match(card, /box-shadow:[^;]*0 0 0 2px var\(--accent\)/, 'кільце 2px кольором accent');
  assert.match(card, /box-shadow:[^;]*0 0 28px 4px var\(--accent-celebrate\)/, 'м\'яке зовнішнє сяйво');
  assert.match(card, /border-left-color:\s*var\(--accent\)/, 'контур усієї картки, а не лише верх');
  assert.match(card, /border-bottom-color:\s*var\(--accent\)/);
});

test('CSS: prefers-reduced-motion гасить і ::before/::after, а тост лишає лише з fade (без виїзду)', async () => {
  const dom = mount(1);
  await flush();
  const css = allCss(dom);

  const reduced = braceBody(css, '@media (prefers-reduced-motion: reduce)');
  assert.match(reduced, /#tracker-root \*::after/, 'селектор `*` не зачіпає псевдоелементи — вони мають бути перелічені окремо');
  assert.match(reduced, /animation-duration:\s*0\.01ms/);
  assert.match(reduced, /\.goal-toast\s*\{\s*animation-name:\s*goalToastFade/, 'тост у reduced-motion — fade без translate');
  assert.doesNotMatch(braceBody(css, '@keyframes goalToastFade'), /transform/, 'жодного руху у варіанті для reduced-motion');
});

test('JS святкування: жодних hex/rgb/білих літералів — кольори лише з токенів', () => {
  for (const fn of ['launchConfetti', 'showGoalToast_', 'startGoalCelebration_', 'detectGoalReached_', 'goalDelayCss_']) {
    const body = braceBody(BODY_SRC, `function ${fn}(`);
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, `${fn}: hex-літерал кольору`);
    assert.doesNotMatch(body, /\b(rgba?|hsla?)\(/i, `${fn}: rgb()/hsl() літерал`);
    assert.doesNotMatch(body, /\b(white|#fff)\b/i, `${fn}: біле`);
  }
  const confetti = braceBody(BODY_SRC, 'function launchConfetti(');
  for (const token of ['--accent', '--accent-text', '--accent-deep', '--text-primary', '--warn']) {
    assert.ok(confetti.includes(`'${token}'`), `конфеті бере колір з токена ${token}`);
  }
});

// ═══ Перехід через поріг: усі сигнали ═════════════════════════════════════

test('перехід 83 → 86: картка, число, дуга, конфеті й тост — і все зі своїми параметрами', async () => {
  const dom = mount(1, { fakeTime: true });
  mockRects(dom);
  await flush();
  const { document } = dom.window;

  assert.equal(heroScore(document), '83%', 'стартовий score має бути 83% (тест-дані)');
  assert.deepEqual(goalClassCounts(document), NONE, 'до кліку жодної анімації');
  assert.equal(dom.canvasLog.created, 0);
  assert.equal(toasts(document).length, 0);

  await clickCalorie(dom, 1);

  assert.equal(heroScore(document), '86%');
  assert.deepEqual(goalClassCounts(document), ALL);
  assert.match(document.querySelector('#hero-wrap').textContent, /· 🎉 ціль досягнута!/, 'текст лишився');

  // Конфеті: рівно один запуск із центру щойно натиснутого чекбокса (100+16, 400+16).
  assert.equal(dom.canvasLog.created, 1, 'launchConfetti викликано рівно один раз');
  const cv = canvases(document);
  assert.equal(cv.length, 1);
  assert.equal(cv[0].getAttribute('data-origin-x'), '116');
  assert.equal(cv[0].getAttribute('data-origin-y'), '416');

  // Тост: рівно один, у контейнері з aria-live, поза #tracker-root.
  assert.equal(toasts(document).length, 1);
  assert.equal(toasts(document)[0].textContent, TOAST_TEXT);
  const wrap = document.getElementById('goal-toast-wrap');
  assert.equal(wrap.getAttribute('aria-live'), 'polite');
  assert.ok(!document.getElementById('tracker-root').contains(wrap), 'тост живе поза вузлами, які перебудовує render()');

  // Дуга — у кружечку тижня 1: "було" 83% → "стало" 86%, offset спадає.
  const arc = document.querySelector('#journey-wrap .journey-cell circle.arc-reach');
  assert.ok(arc, 'клас дуги — на колі тижня 1');
  const style = arc.getAttribute('style');
  const from = Number(/--arc-from:\s*([\d.]+)/.exec(style)[1]);
  const to = Number(/--arc-to:\s*([\d.]+)/.exec(style)[1]);
  assert.ok(Math.abs(from - CIRC * (1 - 0.83)) < 0.1 && Math.abs(to - CIRC * (1 - 0.86)) < 0.1);
  assert.ok(from > to, 'дуга дотягується вперед: offset зменшується');
  assert.equal(arc.getAttribute('stroke'), '#2FBE93', 'кінцевий стан у базових атрибутах — зелений');
  assert.match(style, /--arc-to-color:\s*#2FBE93/i);

  // Верхня смужка й число переходять від кольору ДО переходу ("у процесі" — жовтий) до зеленого.
  const card = document.querySelector('#hero-wrap .hero-card');
  assert.match(card.style.getPropertyValue('--goal-prev-color'), /#F0B94D/i);
  assert.equal(card.style.getPropertyValue('--goal-delay'), '0ms', 'свіжа анімація стартує з нуля');
});

test('перехід НЕ через чекбокс (кнопка "підставити" суму): конфеті летить із центру hero-картки', async () => {
  // Борг не внесено → 80%; кнопка "$150" ставить суму й дає 100%.
  const dom = mountTracker({ now: NOW, fakeTime: true, seed: { weeks: { 1: week(7, { debtAmt: null }) } } });
  mockRects(dom);
  await flush();
  const { document } = dom.window;

  assert.equal(heroScore(document), '80%');
  const fill = [...document.querySelectorAll('#hero-wrap .fill-btn')].find((b) => b.textContent.includes('$'));
  click(dom, fill);
  await flush();

  assert.equal(heroScore(document), '100%');
  assert.equal(dom.canvasLog.created, 1);
  const cv = canvases(document)[0];
  assert.equal(cv.getAttribute('data-origin-x'), '160', 'центр hero-картки: 10 + 300/2');
  assert.equal(cv.getAttribute('data-origin-y'), '320', 'центр hero-картки: 20 + 600/2');
});

// ═══ Конфеті: canvas, частинки, час ═══════════════════════════════════════

test('конфеті: canvas у <body> з pointer-events:none, 55 частинок від точки вильоту, знімається після кінця', async () => {
  const dom = mount(1, { fakeTime: true });
  mockRects(dom);
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1);
  const canvas = canvases(document)[0];
  assert.ok(canvas, 'canvas у document.body');
  assert.equal(canvas.parentNode, document.body, 'поза вузлами, які перебудовує render()');
  assert.equal(canvas.style.pointerEvents, 'none', 'тапи нічого не блокують');
  assert.equal(canvas.style.position, 'fixed');
  assert.equal(canvas.getAttribute('data-count'), '55');
  const ctx = dom.canvasLog.contexts[0];

  // Перший кадр: рівно 55 шматочків, усі поруч із точкою вильоту (один крок ≤ ~10 px).
  dom.clock.advance(16);
  assert.equal(ctx.log.frame.length, 55, 'у кадрі рівно 55 частинок');
  assert.ok(ctx.log.frames >= 1);

  // Прямокутні шматочки 4–8 × ≤11 px (висота множиться на |cos| перевертання).
  ctx.log.frame.forEach((p) => {
    assert.ok(p.w >= 4 && p.w <= 8, `ширина ${p.w}`);
    assert.ok(p.h >= 0 && p.h <= 11, `висота ${p.h}`);
  });

  // Повна непрозорість перші 60% (1.8 с × 0.6 = 1.08 с), потім плавне згасання до 0.
  dom.clock.advance(800); // ≈ 0.82 с
  assert.ok(ctx.log.frame.every((p) => p.alpha === 1), 'у перші 60% часу — повна непрозорість');
  dom.clock.advance(800); // ≈ 1.62 с
  const late = ctx.log.frame.map((p) => p.alpha);
  assert.ok(late.every((a) => a > 0 && a < 1), `у кінці — згасання, отримав ${late[0]}`);
  assert.ok(canvases(document).length === 1, 'ще живе');

  // Час прогнано до кінця (~1.8 с) — canvas знято, кадри більше не плануються.
  dom.clock.advance(400);
  assert.equal(canvases(document).length, 0, 'canvas видалено з DOM після завершення');
  assert.equal(dom.clock.frames.length, 0, 'нових кадрів не заплановано');
});

test('конфеті: частинки вилітають з точки тапу віялом угору (не вбік і не вниз)', async () => {
  const dom = mount(1, { fakeTime: true });
  mockRects(dom);
  await flush();

  await clickCalorie(dom, 1);
  const ctx = dom.canvasLog.contexts[0];
  dom.clock.advance(16);
  ctx.log.frame.forEach((p) => {
    assert.ok(Math.abs(p.px - 116) <= 10 && Math.abs(p.py - 416) <= 10, `перший кадр має бути біля (116, 416): ${p.px}, ${p.py}`);
  });
  // Ще ~130 мс: швидкість вгору (≥ ~2.3 px/кадр) сильніша за гравітацію → усі вище точки вильоту;
  // кут −90° ± 55° дає розліт в обидва боки.
  dom.clock.advance(130);
  assert.ok(ctx.log.frame.every((p) => p.py < 416), 'усі шматочки летять угору');
  assert.ok(ctx.log.frame.some((p) => p.px < 116) && ctx.log.frame.some((p) => p.px > 116), 'віялом в обидва боки');
});

test('z-index canvas: вище за вміст (меню 20), але нижче за обидві модалки (200/210)', async () => {
  const dom = mount(1, { fakeTime: true });
  mockRects(dom);
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1);
  const z = Number(canvases(document)[0].style.zIndex);
  const modals = ['app-modal-overlay', 'goals-overlay'].map((id) => Number(document.getElementById(id).style.zIndex));
  const toastZ = Number(/\.goal-toast-wrap\s*\{[^}]*z-index:\s*(\d+)/.exec(allCss(dom))[1]);

  assert.ok(Number.isFinite(z) && z > 20, `canvas має бути вище за меню (z-index 20), отримав ${z}`);
  modals.forEach((mz) => assert.ok(z < mz, `canvas (${z}) має бути нижче за модалку (${mz}) — інакше конфеті летіло б поверх діалогу`));
  assert.ok(toastZ > 20 && modals.every((mz) => toastZ < mz), `тост (${toastZ}) теж нижче за модалки`);
});

// ═══ Повторні render() ════════════════════════════════════════════════════

test('render() одразу після переходу (синхронізація/поворот) не прибирає тост, не обриває анімацію й нічого не запускає вдруге', async () => {
  const dom = mount(1, { fakeTime: true });
  mockRects(dom);
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1);
  assert.deepEqual(goalClassCounts(document), ALL);

  dom.clock.advance(500);
  await rerender(dom);

  assert.equal(heroScore(document), '86%', 'score не змінився');
  assert.deepEqual(goalClassCounts(document), ALL, 'картка, число й дуга лишаються в анімованому стані');
  // Нові вузли підхоплюють анімацію з того самого місця: від'ємний delay = скільки вже минуло.
  const card = document.querySelector('#hero-wrap .hero-card');
  assert.equal(card.style.getPropertyValue('--goal-delay'), '-500ms', 'анімація продовжується з 0.5 с, а не стартує з нуля');
  const arcStyle = document.querySelector('#journey-wrap .arc-reach').getAttribute('style');
  assert.match(arcStyle, /--goal-delay:\s*-500ms/);
  assert.equal(toasts(document).length, 1, 'тост на місці й не задублювався');
  assert.equal(toasts(document)[0].textContent, TOAST_TEXT);
  assert.equal(canvases(document).length, 1, 'конфеті ще летить, а не перезапущене');
  assert.equal(dom.canvasLog.created, 1, 'жодного другого запуску конфеті');
});

test('після завершення анімації (2.4 с) наступний render() без зміни score нічого не повторює — ні класів, ні конфеті, ні тосту', async () => {
  const dom = mount(1, { fakeTime: true });
  mockRects(dom);
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1);
  assert.deepEqual(goalClassCounts(document), ALL, 'передумова: перший рендер святкує');

  dom.clock.advance(3500); // святкування (2.4 с), конфеті (1.8 с) і тост (3.1 с) відпрацювали
  assert.equal(toasts(document).length, 0, 'тост зник сам');
  assert.equal(canvases(document).length, 0);

  await rerender(dom);
  assert.equal(heroScore(document), '86%', 'score не змінився');
  assert.deepEqual(goalClassCounts(document), NONE, 'анімація одноразова');
  assert.doesNotMatch(document.querySelector('#hero-wrap').textContent, /ціль досягнута/);
  assert.equal(toasts(document).length, 0, 'другого тосту немає');
  assert.equal(dom.canvasLog.created, 1, 'другого конфеті немає');
});

test('перехід між тижнями (і назад) не повторює анімацію', async () => {
  const dom = mount(1, { fakeTime: true });
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1);
  assert.equal(goalClassCounts(document).arcs, 1);

  click(dom, document.querySelector('#hero-wrap [aria-label="Перейти до наступного тижня"]'));
  await flush();
  click(dom, document.querySelector('#hero-wrap [aria-label="Перейти до попереднього тижня"]'));
  await flush();

  assert.match(document.querySelector('#hero-wrap').textContent, /Тиждень 1/);
  assert.deepEqual(goalClassCounts(document), NONE);
  assert.equal(dom.canvasLog.created, 1, 'навігація конфеті не запускає');
});

test('відкриття сторінки з уже досягнутим тижнем (86%) не святкує', async () => {
  const dom = mount(2, { fakeTime: true });
  await flush();
  const { document } = dom.window;

  assert.equal(heroScore(document), '86%');
  assert.deepEqual(goalClassCounts(document), NONE);
  assert.equal(dom.canvasLog.created, 0);
  assert.equal(toasts(document).length, 0);
  // Але сама дуга вже зелена — статичний кінцевий стан без анімації.
  const arc = document.querySelector('#journey-wrap .journey-cell circle:nth-of-type(2)');
  assert.equal(arc.getAttribute('stroke'), '#2FBE93');
});

// ═══ Інші кружечки ════════════════════════════════════════════════════════

test('інші кружечки стрічки класу анімації дуги не отримують', async () => {
  const dom = mount(1, { fakeTime: true });
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1);

  const cells = [...document.querySelectorAll('#journey-wrap .journey-cell')];
  assert.equal(cells.length, 12);
  cells.forEach((cell, idx) => {
    const has = cell.querySelector('.arc-reach') !== null;
    assert.equal(has, idx === 0, `кружечок тижня ${idx + 1}: arc-reach=${has}`);
  });
});

// Реалістичний випадок, де неактивний тиждень перетинає 85% без жодного кліку:
// імпорт JSON. prevScores[2] лишається зі старту (0), а score(2) стає 86%, тож
// без обмеження "лише активний тиждень" дуга тижня 2 анімувалась би одразу і
// далі на КОЖНОМУ render() (prevScores неактивних тижнів ніхто не оновлює).
test('імпорт, що підняв ІНШИЙ тиждень над 85%, нічого не святкує — ні одразу, ні згодом', async () => {
  const dom = mount(1, { fakeTime: true }); // активний тиждень 1, score 83%
  await flush();
  const { document, File } = dom.window;

  const file = new File([JSON.stringify({ week2: week(2) })], 'import.json', { type: 'application/json' });
  const input = document.getElementById('import-file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();

  const cells = [...document.querySelectorAll('#journey-wrap .journey-cell')];
  assert.equal(cells[1].querySelector('.journey-num-inner').textContent, '86', 'передумова: тиждень 2 тепер 86%');
  assert.deepEqual(goalClassCounts(document), NONE, 'імпорт нічого не святкує');
  assert.equal(dom.canvasLog.created, 0);
  assert.equal(toasts(document).length, 0);

  await rerender(dom);
  assert.deepEqual(goalClassCounts(document), NONE);
  assert.equal(dom.canvasLog.created, 0);
});

// ═══ Перехід вниз ═════════════════════════════════════════════════════════

test('перехід 86 → 83 (вниз): жодної святкової анімації, конфеті чи тосту', async () => {
  const dom = mount(2, { fakeTime: true });
  await flush();
  const { document } = dom.window;

  assert.equal(heroScore(document), '86%');
  await clickCalorie(dom, 1); // знімаємо позначку з другого дня

  assert.equal(heroScore(document), '83%');
  assert.deepEqual(goalClassCounts(document), NONE);
  assert.equal(dom.canvasLog.created, 0);
  assert.equal(canvases(document).length, 0);
  assert.equal(toasts(document).length, 0);
  assert.doesNotMatch(document.querySelector('#hero-wrap').textContent, /ціль досягнута/);
});

// ═══ Конфеті — раз на тиждень ═════════════════════════════════════════════

test('зняти й знову поставити галочку: тихі сигнали є, конфеті вдруге НЕ летить; "Скинути тиждень" знімає обмеження', async () => {
  const dom = mount(1, { fakeTime: true });
  mockRects(dom);
  await flush();
  const { document, localStorage } = dom.window;

  await clickCalorie(dom, 1); // 83 → 86: перше досягнення
  assert.equal(dom.canvasLog.created, 1);
  assert.equal(localStorage.getItem('tracker:celebrated:week:1'), '1', 'прапорець тижня виставлено');

  await clickCalorie(dom, 1); // 86 → 83
  assert.deepEqual(goalClassCounts(document), NONE, 'на падінні нічого святкового');
  dom.clock.advance(3500);

  await clickCalorie(dom, 1); // 83 → 86 удруге
  assert.equal(heroScore(document), '86%');
  assert.deepEqual(goalClassCounts(document), ALL, 'картка/число/дуга святкують нову подію, як і раніше');
  assert.equal(toasts(document).length, 1, 'тост (тихий сигнал) показується');
  assert.equal(dom.canvasLog.created, 1, 'конфеті вдруге не летить');
  assert.equal(canvases(document).length, 0);

  // "Скинути тиждень" — через модалку підтвердження.
  dom.clock.advance(3500);
  click(dom, document.querySelector('#hero-wrap [aria-label="Скинути всі дані тижня 1"]'));
  await flush();
  click(dom, document.getElementById('app-modal-ok'));
  await flush();
  assert.equal(heroScore(document), '0%', 'тиждень скинуто');
  assert.equal(localStorage.getItem('tracker:celebrated:week:1'), null, 'скидання тижня знімає прапорець');

  // Проходимо тиждень заново: гроші (2 кнопки "підставити"), weekly-дія, 7 днів обліку, 2 калорійні дні.
  const moneyFill = () => [...document.querySelectorAll('#hero-wrap .fill-btn')].filter((b) => b.textContent.includes('$'));
  click(dom, moneyFill()[0]); await flush();
  click(dom, moneyFill()[1]); await flush();
  click(dom, document.querySelector('#hero-wrap .week-check')); await flush();
  for (let d = 0; d < 7; d++) {
    click(dom, grid(document, LOG_LABEL).querySelectorAll('.day-square')[d]); await flush();
  }
  await clickCalorie(dom, 0);
  assert.equal(heroScore(document), '83%', 'перед останнім кліком — 83%');
  assert.equal(dom.canvasLog.created, 1, 'до перетину порогу конфеті немає');
  await clickCalorie(dom, 1);
  assert.equal(heroScore(document), '86%');
  assert.equal(dom.canvasLog.created, 2, 'після скидання тижня конфеті знову може полетіти');
});

test('тост не дублюється: швидкий повторний перетин, поки перший ще на екрані, другого не створює', async () => {
  const dom = mount(1, { fakeTime: true });
  mockRects(dom);
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1); // 83 → 86
  assert.equal(toasts(document).length, 1);
  await clickCalorie(dom, 1); // 86 → 83
  dom.clock.advance(300);
  await clickCalorie(dom, 1); // 83 → 86, тост ще висить (3.1 с)

  assert.deepEqual(goalClassCounts(document), ALL, 'нова подія святкує');
  assert.equal(toasts(document).length, 1, 'тост один, не два');
});

test('рух конфеті прив\'язаний до часу, а не до кадрів: 60 Гц і 120 Гц дають ту саму траєкторію', async () => {
  // Один і той самий "випадковий" набір шматочків у обох прогонах.
  const seeded = (win) => { let a = 12345; win.Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  async function meanYAfter(stepMs) {
    const dom = mount(1, { fakeTime: true });
    mockRects(dom);
    await flush();
    seeded(dom.window);
    await clickCalorie(dom, 1);
    dom.clock.advance(400, stepMs);
    const frame = dom.canvasLog.contexts[0].log.frame;
    assert.equal(frame.length, 55);
    return frame.reduce((sum, p) => sum + p.py, 0) / frame.length;
  }
  const at60 = await meanYAfter(16);
  const at120 = await meanYAfter(8);
  assert.ok(Math.abs(at60 - at120) < 6,
    `за однакові 400 мс середня висота має збігатись (60 Гц: ${at60.toFixed(1)}, 120 Гц: ${at120.toFixed(1)}); якщо розбіжність велика — рух прив'язано до кадрів`);
  assert.ok(at60 < 416 - 20, 'за 400 мс шматочки таки піднялись угору від точки вильоту');
});

test('прапорець "конфеті було" тільки локальний: у бекенд (storage.set) не йде', async () => {
  const posted = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes('action=getall')) return { json: async () => ({ items: {} }) };
    if (init && init.method === 'POST') { posted.push(JSON.parse(init.body).key); return { json: async () => ({ ok: true }) }; }
    return { json: async () => ({}) };
  };
  const dom = mount(1, { fakeTime: true, weburl: 'https://example.com/exec', fetchImpl });
  mockRects(dom);
  await flush();

  await clickCalorie(dom, 1);
  await flush();
  assert.ok(posted.includes('week:1'), 'дані тижня синхронізуються як завжди');
  assert.ok(posted.every((k) => !/celebrat/.test(k)), `прапорець не має йти в бекенд, отримав: ${posted.join(', ')}`);
  assert.equal(dom.window.localStorage.getItem('tracker:celebrated:week:1'), '1');
});

// ═══ prefers-reduced-motion ═══════════════════════════════════════════════

test('prefers-reduced-motion: конфеті не запускається, тост і кінцевий зелений стан показуються', async () => {
  const dom = mount(1, { fakeTime: true, reducedMotion: true });
  mockRects(dom);
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1);

  assert.equal(heroScore(document), '86%');
  assert.equal(dom.canvasLog.created, 0, 'конфеті не запускається взагалі');
  assert.equal(canvases(document).length, 0);
  assert.equal(toasts(document).length, 1, 'тост показується');
  assert.equal(toasts(document)[0].textContent, TOAST_TEXT);
  // Кінцевий стан — базові стилі (анімації в цьому режимі скорочені до 0.01 мс).
  assert.match(document.querySelector('#hero-wrap .hero-num').getAttribute('style'), /2FBE93|47,\s*190,\s*147/i, 'число зелене');
  assert.match(document.querySelector('#hero-wrap .hero-card').getAttribute('style'), /2FBE93|47,\s*190,\s*147/i, 'верхня смужка зелена');
  assert.match(document.querySelector('#hero-wrap').textContent, /ціль досягнута/);
  assert.equal(document.querySelector('#journey-wrap .arc-reach').getAttribute('stroke'), '#2FBE93', 'дуга зелена');
});
