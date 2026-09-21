'use strict';
// Анімація досягнення цілі тижня (score перетнув 85%). Раніше картка на 1.2 с
// спалахувала майже білим (#E1F5EE) на темному тлі, а число стрибало
// 1 → 1.15 → 0.95 → 1. Тепер: м'яка зелена підсвітка (.goal-reached), легкий
// пульс числа (.celebrate) і дуга кружечка тижня, що дотягується до нового
// значення (.arc-reach). Усе одноразове: render() будує DOM з нуля, тож клас
// має ставитись лише в тому рендері, де перехід справді стався (той самий
// урок, що й just-toggled у checkbox-animation-scope.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush } = require('./helpers/tracker');

// Неділя першого тижня: усі 7 днів уже не "майбутні", отже клікабельні.
const NOW = new Date(2026, 7, 2, 12);
const DAYS_OFF = [false, false, false, false, false, false, false];
const ALL_DAYS = [true, true, true, true, true, true, true];
const CALORIE_LABEL = 'Не більше 2000 ккал/день';
// r=19 у renderJourney: CIRC = 2π·19.
const CIRC = 2 * Math.PI * 19;

// 5 дій по 20%: борг і капітал виконані повністю (150 = план тижня 1), w1 і
// "облік їжі" теж; калорійні дні — k із 7. Score = (4 + k/7) / 5:
//   k=1 → 83%,  k=2 → 86% — рівно один клік через поріг 85%.
function week(calorieTrue) {
  const calorieDays = DAYS_OFF.map((_, i) => i < calorieTrue);
  return {
    weight: null, debtAmt: 150, capitalAmt: 150,
    checks: { w1: true }, logDays: ALL_DAYS.slice(), calorieDays, custom: {},
  };
}

function mount(calorieTrue) {
  return mountTracker({ now: NOW, seed: { weeks: { 1: week(calorieTrue) } } });
}

function calorieSquare(document, idx) {
  const grid = [...document.querySelectorAll('.daily-grid')]
    .find((g) => g.getAttribute('aria-label') === CALORIE_LABEL);
  assert.ok(grid, 'денна сітка калорій має бути в картці тижня 1');
  return grid.querySelectorAll('.day-square')[idx];
}

async function clickCalorie(dom, idx) {
  // Вузол перезапитуємо щоразу: render() після кліку заміняє весь DOM.
  calorieSquare(dom.window.document, idx)
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
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

// Витягує тіло першого блоку, що починається з header (з урахуванням вкладених {}).
function cssBlock(css, header) {
  const start = css.indexOf(header);
  assert.notEqual(start, -1, `у CSS не знайдено "${header}"`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`не закрито блок "${header}"`);
}

// --- а) CSS ---------------------------------------------------------------

test('CSS: білого спалаху #E1F5EE і flashBg/.flash більше немає', async () => {
  const dom = mount(1);
  await flush();
  const css = [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');

  assert.doesNotMatch(css, /#E1F5EE/i, 'літерал майже білого кольору має зникнути з CSS');
  assert.doesNotMatch(css, /flashBg/, 'keyframes flashBg має бути видалено');
  assert.doesNotMatch(css, /\.flash\b/, 'клас .flash має бути видалено');
});

test('CSS: анімації досягнення не мають світлого/літерального фону, лише токени', async () => {
  const dom = mount(1);
  await flush();
  const css = [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');

  const blocks = {
    'goalGlow keyframes': cssBlock(css, '@keyframes goalGlow'),
    '.goal-reached::after': cssBlock(css, '.hero-card.goal-reached::after'),
    'celebratePulse keyframes': cssBlock(css, '@keyframes celebratePulse'),
    '.celebrate': cssBlock(css, '.celebrate {'),
    'arcReach keyframes': cssBlock(css, '@keyframes arcReach'),
    '.arc-reach': cssBlock(css, '.arc-reach {'),
  };
  for (const [name, body] of Object.entries(blocks)) {
    assert.doesNotMatch(body, /background-color/i, `${name}: не повинно бути background-color`);
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, `${name}: жодних hex-літералів кольору`);
    assert.doesNotMatch(body, /\b(rgba?|hsla?)\(/i, `${name}: жодних rgb()/hsl() літералів`);
    assert.doesNotMatch(body, /\b(white|#fff)\b/i, `${name}: жодного білого`);
  }
  assert.match(blocks['.goal-reached::after'], /var\(--accent-(soft|glow)\)/,
    'підсвітка бере колір з токена --accent-soft або --accent-glow');
});

test('CSS: пульс числа не перескакує вище 1.04 і не йде нижче 1', async () => {
  const dom = mount(1);
  await flush();
  const css = [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');

  const scales = [...cssBlock(css, '@keyframes celebratePulse').matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.ok(scales.length >= 3, 'очікував кілька кроків scale у celebratePulse');
  assert.equal(Math.max(...scales), 1.04);
  assert.ok(Math.min(...scales) >= 1, 'без відскоку нижче 1');
});

test('CSS: prefers-reduced-motion гасить і ::before/::after (там живе підсвітка)', async () => {
  const dom = mount(1);
  await flush();
  const css = [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');

  const reduced = cssBlock(css, '@media (prefers-reduced-motion: reduce)');
  assert.match(reduced, /#tracker-root \*::after/, 'селектор `*` не зачіпає псевдоелементи — вони мають бути перелічені окремо');
  assert.match(reduced, /animation-duration:\s*0\.01ms/);
});

// --- б) перехід через поріг -------------------------------------------------

test('перехід 83 → 86: картка, число і дуга САМЕ цього тижня отримують класи анімації', async () => {
  const dom = mount(1);
  await flush();
  const { document } = dom.window;

  assert.equal(heroScore(document), '83%', 'стартовий score має бути 83% (тест-дані)');
  assert.deepEqual(goalClassCounts(document), { glow: 0, pulse: 0, arcs: 0 }, 'до кліку жодної анімації');

  await clickCalorie(dom, 1);

  assert.equal(heroScore(document), '86%');
  assert.deepEqual(goalClassCounts(document), { glow: 1, pulse: 1, arcs: 1 });
  assert.match(document.querySelector('#hero-wrap').textContent, /· 🎉 ціль досягнута!/, 'текст лишився');

  // дуга — у кружечку тижня 1 (перший у стрічці)
  const cells = document.querySelectorAll('#journey-wrap .journey-cell');
  assert.ok(cells[0].querySelector('circle.arc-reach'), 'клас дуги — на колі тижня 1');

  // Змінні анімації: "було" 83% → "стало" 86%, дуга росте, тобто offset спадає.
  const arc = cells[0].querySelector('circle.arc-reach');
  const style = arc.getAttribute('style');
  const from = Number(/--arc-from:\s*([\d.]+)/.exec(style)[1]);
  const to = Number(/--arc-to:\s*([\d.]+)/.exec(style)[1]);
  assert.ok(Math.abs(from - CIRC * (1 - 0.83)) < 0.1, `--arc-from має відповідати 83% (отримав ${from})`);
  assert.ok(Math.abs(to - CIRC * (1 - 0.86)) < 0.1, `--arc-to має відповідати 86% (отримав ${to})`);
  assert.ok(from > to, 'дуга дотягується вперед: offset зменшується');

  // Кінцевий стан у базових атрибутах — саме його видно, коли анімацію вимкнено
  // (prefers-reduced-motion): зелена дуга нового розміру, без жодної анімації.
  assert.equal(arc.getAttribute('stroke'), '#2FBE93', 'кінцевий колір — зелений');
  assert.ok(Math.abs(Number(arc.getAttribute('stroke-dashoffset')) - to) < 0.1, 'базовий offset = кінцевий');
  assert.match(style, /--arc-from-color:\s*#[0-9A-Fa-f]{6}/);
  assert.match(style, /--arc-to-color:\s*#2FBE93/i, 'анімація закінчується тим самим зеленим, що й атрибут');
});

// --- в) одноразовість -----------------------------------------------------

test('наступний render() без зміни score не повторює жодного класу анімації', async () => {
  const dom = mount(1);
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1);
  assert.deepEqual(goalClassCounts(document), { glow: 1, pulse: 1, arcs: 1 }, 'передумова: перший рендер святкує');

  // Вага не входить у score, а blur поля викликає повний render().
  const weightRow = [...document.querySelectorAll('.metric-row')]
    .find((r) => r.querySelector('.metric-label')?.textContent === 'Вага');
  const input = weightRow.querySelector('.stepper input');
  input.value = '80';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
  await flush();

  assert.equal(heroScore(document), '86%', 'score не змінився');
  assert.deepEqual(goalClassCounts(document), { glow: 0, pulse: 0, arcs: 0 }, 'анімація одноразова');
  assert.doesNotMatch(document.querySelector('#hero-wrap').textContent, /ціль досягнута/,
    'текст "ціль досягнута" теж лише в момент переходу — як і раніше');
});

test('перехід між тижнями (і назад) не повторює анімацію', async () => {
  const dom = mount(1);
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1);
  assert.equal(goalClassCounts(document).arcs, 1);

  document.querySelector('#hero-wrap [aria-label="Перейти до наступного тижня"]')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();
  document.querySelector('#hero-wrap [aria-label="Перейти до попереднього тижня"]')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();

  assert.match(document.querySelector('#hero-wrap').textContent, /Тиждень 1/);
  assert.deepEqual(goalClassCounts(document), { glow: 0, pulse: 0, arcs: 0 });
});

test('відкриття сторінки з уже досягнутим тижнем (86%) не святкує', async () => {
  const dom = mount(2);
  await flush();
  const { document } = dom.window;

  assert.equal(heroScore(document), '86%');
  assert.deepEqual(goalClassCounts(document), { glow: 0, pulse: 0, arcs: 0 });
  // Але сама дуга вже зелена — статичний кінцевий стан без анімації.
  const arc = document.querySelector('#journey-wrap .journey-cell circle:nth-of-type(2)');
  assert.equal(arc.getAttribute('stroke'), '#2FBE93');
});

// --- г) інші кружечки -----------------------------------------------------

test('інші кружечки стрічки класу анімації дуги не отримують', async () => {
  const dom = mount(1);
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
test('імпорт, що підняв ІНШИЙ тиждень над 85%, не запускає анімацію його дуги — ні одразу, ні згодом', async () => {
  const dom = mount(1); // активний тиждень 1, score 83%
  await flush();
  const { document, File } = dom.window;

  const file = new File([JSON.stringify({ week2: week(2) })], 'import.json', { type: 'application/json' });
  const input = document.getElementById('import-file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();

  const cells = [...document.querySelectorAll('#journey-wrap .journey-cell')];
  assert.equal(cells[1].querySelector('.journey-num-inner').textContent, '86', 'передумова: тиждень 2 тепер 86%');
  assert.deepEqual(goalClassCounts(document), { glow: 0, pulse: 0, arcs: 0 }, 'імпорт нічого не святкує');

  // Ще один render() (blur поля ваги) — так само тихо.
  const weightRow = [...document.querySelectorAll('.metric-row')]
    .find((r) => r.querySelector('.metric-label')?.textContent === 'Вага');
  const weightInput = weightRow.querySelector('.stepper input');
  weightInput.value = '80';
  weightInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  weightInput.dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
  await flush();
  assert.deepEqual(goalClassCounts(document), { glow: 0, pulse: 0, arcs: 0 });
});

// --- ґ) перехід вниз ------------------------------------------------------

test('перехід 86 → 83 (вниз): жодної святкової анімації і тексту', async () => {
  const dom = mount(2);
  await flush();
  const { document } = dom.window;

  assert.equal(heroScore(document), '86%');
  await clickCalorie(dom, 1); // знімаємо позначку з другого дня

  assert.equal(heroScore(document), '83%');
  assert.deepEqual(goalClassCounts(document), { glow: 0, pulse: 0, arcs: 0 });
  assert.doesNotMatch(document.querySelector('#hero-wrap').textContent, /ціль досягнута/);
});

test('повторний перехід вгору після падіння знову святкує (нова подія, не "раз і назавжди")', async () => {
  const dom = mount(2);
  await flush();
  const { document } = dom.window;

  await clickCalorie(dom, 1); // 86 → 83
  assert.deepEqual(goalClassCounts(document), { glow: 0, pulse: 0, arcs: 0 });
  await clickCalorie(dom, 1); // 83 → 86
  assert.deepEqual(goalClassCounts(document), { glow: 1, pulse: 1, arcs: 1 });
});
