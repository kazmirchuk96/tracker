'use strict';
// Доредагування тижнів в архіві: деталі циклу, форма правки, два шляхи
// збереження (старий цикл → правиться знімок; ще "живий" завершений цикл →
// правиться живий тиждень, а знімок оновлюється з нього). Навіщо: користувач
// забув внести вагу за 12-й тиждень — це має бути можливо без втрати даних
// і без того, щоб автознімок затер правку живими даними.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush, readLocal } = require('./helpers/tracker');

const AFTER_END = new Date(2026, 9, 19, 12);    // 19.10.2026 — цикл 1 завершено
const IN_CYCLE2 = new Date(2026, 10, 5, 12);    // 05.11.2026 — триває цикл 2
const DAYS_OFF = [false, false, false, false, false, false, false];
const ALL_DAYS = [true, true, true, true, true, true, true];
const GOALS = { weightStart: 84, weightEnd: 78, debtStart: 0, debtEnd: 1800, capitalStart: 0, capitalEnd: 1800 };

function week(over = {}) {
  return Object.assign({
    weight: null, debtAmt: null, capitalAmt: null, checks: {},
    logDays: DAYS_OFF.slice(), calorieDays: DAYS_OFF.slice(), custom: {},
  }, over);
}
const TACTICS = [
  { id: 'w1', label: 'Зважування в понеділок зранку', type: 'weekly', goal: 'weight', createdWeek: 1, archivedWeek: null, builtin: true },
  { id: 'logDays', label: 'Облік їжі кожного дня', type: 'daily', goal: 'weight', createdWeek: 1, archivedWeek: null, builtin: true },
  { id: 'calorieDays', label: 'Не більше 2000 ккал/день', type: 'daily', goal: 'weight', createdWeek: 1, archivedWeek: null, builtin: true },
];

// Живі тижні 1..11 з вагою, 12-й — порожній (реальний випадок користувача).
function weeksWithoutLast() {
  const weeks = {};
  for (let i = 1; i <= 11; i++) weeks[i] = week({ weight: 84 - i * 0.5, checks: { w1: true }, logDays: ALL_DAYS.slice() });
  return weeks;
}
const SEED_B = () => ({ goals: GOALS, weeks: weeksWithoutLast() });

// Знімок старого циклу 1 (живий цикл — 2). Відсотки навмисно "нереальні"
// (7, 11, 3…) — так видно, що перерахувався лише відредагований тиждень.
const SENTINEL = [7, 11, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function oldSnap(extra = {}) {
  return Object.assign({
    v: 1, id: 1, start: '2026-07-27', end: '2026-10-18', endedEarly: false, savedAt: '2026-10-19T08:00:00.000Z',
    goals: GOALS, tactics: TACTICS,
    weeks: {
      1: week({ weight: 83.2, debtAmt: 150, capitalAmt: 150, checks: { w1: false }, logDays: ALL_DAYS.slice() }),
      2: week({ weight: 82.4, debtAmt: 150, capitalAmt: 100, checks: { w1: true }, logDays: ALL_DAYS.slice() }),
      3: week({ weight: 82.0 }),
    },
    scores: SENTINEL.slice(),
  }, extra);
}
const SEED_A = (snap = oldSnap()) => ({ raw: { cycle: JSON.stringify({ id: 2, start: '2026-11-02' }), 'archive:1': JSON.stringify(snap) } });

const doc = (dom) => dom.window.document;
const $ = (dom, id) => doc(dom).getElementById(id);
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const q = (dom, sel) => doc(dom).querySelector(sel);
const qa = (dom, sel) => [...doc(dom).querySelectorAll(sel)];

function recordingFetch(remoteItems = {}) {
  const posts = [];
  const impl = async (url, init) => {
    if (String(url).includes('action=getall')) return { json: async () => ({ items: remoteItems }) };
    if (init && init.method === 'POST') { const b = JSON.parse(init.body); posts.push({ key: b.key, value: b.value }); return { json: async () => ({ ok: true }) }; }
    return { json: async () => ({}) };
  };
  return { impl, posts };
}

// Меню → архів → картка цикла → сторінка деталей.
async function openDetail(dom) {
  click(dom, $(dom, 'open-archive'));
  await flush();
  click(dom, q(dom, '#archive-body .arch-item'));
  await flush();
}
// Відкриває форму правки тижня n (вузли щоразу перезапитуємо — render мертвить старі).
function openEdit(dom, n) { click(dom, q(dom, `[data-edit-week="${n}"]`)); }
function setField(dom, key, value) { q(dom, `.arch-edit [data-field="${key}"]`).value = value; }
async function save(dom, n) { click(dom, q(dom, `[data-edit-save="${n}"]`)); await flush(12); }
const weekScore = (dom, n) => q(dom, `details.arch-week[data-week="${n}"] .arch-score`);

// ═══ Реальний випадок: живий завершений цикл (шлях B) ═══════════════════════

test('шлях B: забута вага 12-го тижня — підказка зникає, правка йде в живий тиждень і в архів, деталі показують 76 кг', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: SEED_B() });
  await flush();
  await openDetail(dom);

  const goalCards = qa(dom, '.arch-goal-card');
  assert.match(goalCards[0].querySelector('.arch-goal-note').textContent, /Останнє зважування на тижні 11/);
  assert.match(goalCards[0].querySelector('.arch-goal-result').textContent, /78\.5 кг/, 'до правки остання вага — з тижня 11');

  openEdit(dom, 12);
  assert.ok(q(dom, '.arch-edit[data-week="12"]'), 'форма відкрилась');
  setField(dom, 'weight', '76');
  await save(dom, 12);

  assert.equal(readLocal(dom, 'week:12').weight, 76, 'правка потрапила в ЖИВИЙ тиждень');
  assert.equal(readLocal(dom, 'archive:1').weeks['12'].weight, 76, 'знімок оновлено з живих даних');
  assert.equal(readLocal(dom, 'week:11').weight, 78.5, 'сусідні тижні не зачеплено');

  // Сторінка деталей перемальована, 12-й тиждень відкритий
  assert.equal(q(dom, '.arch-edit'), null, 'форми вже нема');
  const d12 = q(dom, 'details.arch-week[data-week="12"]');
  assert.ok(d12.open, 'тиждень 12 лишається відкритим');
  assert.match(d12.textContent, /76 кг/);
  const firstCard = qa(dom, '.arch-goal-card')[0];
  assert.equal(firstCard.querySelector('.arch-goal-note'), null, 'підказка про забуте зважування зникла');
  assert.match(firstCard.querySelector('.arch-goal-result').textContent, /76 кг/);
});

test('шлях B: після правки перезавантаження сторінки не затирає її автознімком', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: SEED_B() });
  await flush();
  await openDetail(dom);
  openEdit(dom, 12);
  setField(dom, 'weight', '76');
  await save(dom, 12);
  // Нова "сесія" з тим, що лежить у localStorage
  const seed = { raw: {} };
  for (let k = 0; k < dom.window.localStorage.length; k++) {
    const key = dom.window.localStorage.key(k);
    if (key.indexOf('tracker:') === 0) seed.raw[key.slice('tracker:'.length)] = dom.window.localStorage.getItem(key);
  }
  const dom2 = mountTracker({ now: AFTER_END, seed });
  await flush();
  assert.equal(readLocal(dom2, 'archive:1').weeks['12'].weight, 76);
  assert.equal(readLocal(dom2, 'week:12').weight, 76);
});

test('кома як десятковий роздільник: "75,5" зберігається як 75.5', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: SEED_B() });
  await flush();
  await openDetail(dom);
  openEdit(dom, 12);
  setField(dom, 'weight', '75,5');
  await save(dom, 12);
  assert.equal(readLocal(dom, 'week:12').weight, 75.5);
  assert.equal(readLocal(dom, 'archive:1').weeks['12'].weight, 75.5);
  assert.match(q(dom, 'details.arch-week[data-week="12"]').textContent, /75\.5 кг/);
});

// ═══ Старий цикл (шлях A) ═══════════════════════════════════════════════════

test('шлях A: правиться сам знімок — вага, день щоденної дії, борг; відсоток перераховано лише для цього тижня, живі ключі не чіпаються', async () => {
  const dom = mountTracker({ now: IN_CYCLE2, seed: SEED_A() });
  await flush();
  await openDetail(dom);
  const before = readLocal(dom, 'archive:1');

  openEdit(dom, 3);
  setField(dom, 'weight', '81,2');
  setField(dom, 'debtAmt', '200');
  const day = q(dom, '.arch-edit .arch-toggle[data-tactic="calorieDays"][data-day="2"]');
  assert.equal(day.getAttribute('aria-checked'), 'false');
  click(dom, day);
  assert.equal(q(dom, '.arch-edit .arch-toggle[data-tactic="calorieDays"][data-day="2"]').getAttribute('aria-checked'), 'true', 'перемикач перемкнувся');
  await save(dom, 3);

  const after = readLocal(dom, 'archive:1');
  assert.equal(after.weeks['3'].weight, 81.2);
  assert.equal(after.weeks['3'].debtAmt, 200);
  assert.deepEqual(after.weeks['3'].calorieDays, [false, false, true, false, false, false, false]);
  assert.notEqual(after.savedAt, before.savedAt, 'savedAt оновлено — за ним хмара обирає новішу версію');
  assert.ok(Date.parse(after.savedAt) > Date.parse(before.savedAt));
  assert.notEqual(after.scores[2], SENTINEL[2], 'відсоток тижня 3 перераховано');
  assert.deepEqual(after.scores.filter((_, idx) => idx !== 2), SENTINEL.filter((_, idx) => idx !== 2), 'решта відсотків заморожена');
  assert.deepEqual(after.weeks['1'], before.weeks['1'], 'інші тижні не змінились');
  for (let n = 1; n <= 12; n++) assert.equal(dom.window.localStorage.getItem('tracker:week:' + n), null, `живий week:${n} не створено`);
});

test('шлях A: відмітка щотижневої дії піднімає відсоток саме цього тижня', async () => {
  const dom = mountTracker({ now: IN_CYCLE2, seed: SEED_A() });
  await flush();
  await openDetail(dom);

  // Крок 1: зберегти без змін — відсоток лишається замороженим (нічого не змінилось)
  openEdit(dom, 1);
  await save(dom, 1);
  assert.equal(readLocal(dom, 'archive:1').scores[0], SENTINEL[0], 'без змін — без перерахунку');

  // Крок 2: ставимо w1 (у тижня 1 він був вимкнений) → перерахунок
  openEdit(dom, 1);
  const w1 = q(dom, '.arch-edit .arch-toggle[data-tactic="w1"]');
  assert.equal(w1.getAttribute('aria-checked'), 'false');
  click(dom, w1);
  assert.equal(q(dom, '.arch-edit .arch-toggle[data-tactic="w1"]').textContent, '✓');
  await save(dom, 1);
  const withTick = readLocal(dom, 'archive:1');
  assert.equal(withTick.weeks['1'].checks.w1, true);

  // Крок 3: знімаємо w1 → перерахунок за тими самими правилами, відсоток нижчий
  openEdit(dom, 1);
  click(dom, q(dom, '.arch-edit .arch-toggle[data-tactic="w1"]'));
  await save(dom, 1);
  const after = readLocal(dom, 'archive:1');
  assert.equal(after.weeks['1'].checks.w1, false);
  assert.ok(withTick.scores[0] > after.scores[0], `з відміткою вище: ${withTick.scores[0]} > ${after.scores[0]}`);
  assert.equal(after.scores[1], SENTINEL[1]);
  assert.equal(after.scores[2], SENTINEL[2]);
});

test('шлях A: відредагований знімок іде в хмару (POST archive:1 з новими даними)', async () => {
  const rec = recordingFetch({});
  const dom = mountTracker({ now: IN_CYCLE2, seed: SEED_A(), weburl: 'https://example.com/exec', fetchImpl: rec.impl });
  await flush(12);
  await openDetail(dom);
  const sentBefore = rec.posts.length;
  openEdit(dom, 3);
  setField(dom, 'weight', '80');
  await save(dom, 3);

  const sent = rec.posts.slice(sentBefore).filter((p) => p.key === 'archive:1');
  assert.ok(sent.length >= 1, 'правка відправлена в хмару');
  const payload = JSON.parse(sent[sent.length - 1].value);
  assert.equal(payload.weeks['3'].weight, 80);
  assert.equal(payload.id, 1);
});

// ═══ Валідація, скасування, очищення ════════════════════════════════════════

test('некоректне введення ("абв", "-5", "600") — помилка в .sheet-error, нічого не збережено, форма лишається відкритою', async () => {
  const dom = mountTracker({ now: IN_CYCLE2, seed: SEED_A() });
  await flush();
  await openDetail(dom);
  const before = dom.window.localStorage.getItem('tracker:archive:1');

  for (const [field, bad] of [['weight', 'абв'], ['debtAmt', '-5'], ['capitalAmt', '1,2,3'], ['weight', '600']]) {
    if (q(dom, '.arch-edit')) click(dom, q(dom, '[data-edit-cancel="2"]')); // свіжа форма для кожного значення
    openEdit(dom, 2);
    setField(dom, field, bad);
    await save(dom, 2);
    assert.ok(q(dom, '.arch-edit[data-week="2"]'), `форма лишилась для "${bad}"`);
    assert.ok(q(dom, '.arch-edit .sheet-error').textContent.trim().length > 0, `текст помилки для "${bad}"`);
    assert.equal(dom.window.localStorage.getItem('tracker:archive:1'), before, `архів не змінено для "${bad}"`);
  }
});

test('скасування повертає перегляд без збереження', async () => {
  const dom = mountTracker({ now: IN_CYCLE2, seed: SEED_A() });
  await flush();
  await openDetail(dom);
  const before = dom.window.localStorage.getItem('tracker:archive:1');

  openEdit(dom, 2);
  setField(dom, 'weight', '70');
  click(dom, q(dom, '[data-edit-cancel="2"]'));
  assert.equal(q(dom, '.arch-edit'), null, 'форма закрилась');
  assert.ok(q(dom, '[data-edit-week="2"]'), 'кнопка правки повернулась');
  assert.match(q(dom, 'details.arch-week[data-week="2"]').textContent, /82\.4 кг/, 'у перегляді стара вага');
  assert.equal(dom.window.localStorage.getItem('tracker:archive:1'), before);
});

test('порожнє поле зберігається як null (вагу можна прибрати)', async () => {
  const dom = mountTracker({ now: IN_CYCLE2, seed: SEED_A() });
  await flush();
  await openDetail(dom);
  openEdit(dom, 2);
  setField(dom, 'weight', '');
  setField(dom, 'debtAmt', '   ');
  await save(dom, 2);
  const w = readLocal(dom, 'archive:1').weeks['2'];
  assert.equal(w.weight, null);
  assert.equal(w.debtAmt, null);
  assert.equal(w.capitalAmt, 100, 'незаймане поле збереглось');
});

test('форма правки екранує назви дій (HTML у назві не стає елементом)', async () => {
  const snap = oldSnap({ tactics: TACTICS.concat([{ id: 'c1', label: 'Дія <b>x</b>', type: 'weekly', goal: 'weight', createdWeek: 1, archivedWeek: null, builtin: false }]) });
  const dom = mountTracker({ now: IN_CYCLE2, seed: SEED_A(snap) });
  await flush();
  await openDetail(dom);
  openEdit(dom, 1);
  const box = q(dom, '.arch-edit');
  assert.equal(box.querySelector('b'), null, 'тег <b> не створено у формі');
  assert.ok(box.textContent.includes('Дія <b>x</b>'), 'текст показано буквально');
  assert.equal(q(dom, 'details.arch-week[data-week="1"] .arch-week-body b'), null);
  // і кастомна дія зберігається в custom
  click(dom, box.querySelector('.arch-toggle[data-tactic="c1"]'));
  await save(dom, 1);
  assert.equal(readLocal(dom, 'archive:1').weeks['1'].custom.c1, true);
});

// ═══ Структура сторінки деталей ═════════════════════════════════════════════

test('сторінка деталей: кільце, 12 стовпчиків і цифр, 3 картки цілей, 12 тижнів; порожні — "—", тижні 85%+ — .ok', async () => {
  const snap = oldSnap({ scores: [90, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  const dom = mountTracker({ now: IN_CYCLE2, seed: SEED_A(snap) });
  await flush();
  await openDetail(dom);

  assert.ok(q(dom, '.arch-hero .arch-card-ring'));
  assert.equal(qa(dom, '.arch-bars .arch-bar').length, 12);
  const nums = qa(dom, '.arch-bars-nums span').map((s) => s.textContent);
  assert.deepEqual(nums, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
  assert.equal(qa(dom, '.arch-goal-card').length, 3);
  assert.equal(qa(dom, 'details.arch-week').length, 12);

  assert.ok(weekScore(dom, 1).classList.contains('ok'), '90% → .ok');
  assert.equal(weekScore(dom, 1).textContent, '90%');
  assert.ok(!weekScore(dom, 2).classList.contains('ok'), '40% — не .ok');
  for (const n of [4, 12]) {
    assert.ok(weekScore(dom, n).classList.contains('empty'), `тиждень ${n} порожній`);
    assert.equal(weekScore(dom, n).textContent, '—');
  }
});

test('після збереження відсоток у заголовку тижня збігається зі збереженим у знімку', async () => {
  const dom = mountTracker({ now: IN_CYCLE2, seed: SEED_A() });
  await flush();
  await openDetail(dom);
  openEdit(dom, 3);
  setField(dom, 'weight', '80');
  click(dom, q(dom, '.arch-edit .arch-toggle[data-tactic="w1"]'));
  await save(dom, 3);
  const snap = readLocal(dom, 'archive:1');
  assert.equal(weekScore(dom, 3).textContent, snap.scores[2] + '%');
  assert.ok(!weekScore(dom, 3).classList.contains('empty'));
  // нетронутий тиждень 1 показує свій заморожений відсоток
  assert.equal(weekScore(dom, 1).textContent, SENTINEL[0] + '%');
});

test('старий цикл: якщо змінено ЛИШЕ вагу, заморожений відсоток тижня не перераховується', async () => {
  // Свідомо "нереальний" відсоток 63: перерахунок за сьогоднішньою датою дав би інше число.
  const snap = {
    v: 1, id: 1, start: '2026-07-27', end: '2026-10-18', endedEarly: false, savedAt: '2026-10-19T09:00:00.000Z',
    goals: { weightStart: 84, weightEnd: 78, debtStart: 0, debtEnd: 1800, capitalStart: 0, capitalEnd: 1800 },
    tactics: [{ id: 'w1', label: 'Зважування в понеділок зранку', type: 'weekly', goal: 'weight', createdWeek: 1, archivedWeek: null, builtin: true }],
    scores: [50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 63],
    weeks: { 12: { weight: null, debtAmt: 50, capitalAmt: 150, checks: { w1: false }, logDays: Array(7).fill(false), calorieDays: Array(7).fill(false), custom: {} } },
  };
  const { mountTracker, flush, readLocal } = require('./helpers/tracker');
  const dom = mountTracker({ now: new Date(2026, 10, 18, 12), seed: { raw: { cycle: JSON.stringify({ id: 2, start: '2026-11-02' }), 'archive:1': JSON.stringify(snap) } } });
  await flush();
  const d = dom.window.document;
  const ck = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  ck(d.getElementById('open-archive'));
  ck(d.querySelector('#archive-body .arch-item'));
  ck(d.querySelector('[data-edit-week="12"]'));
  d.querySelector('.arch-edit [data-field="weight"]').value = '76';
  ck(d.querySelector('[data-edit-save="12"]'));
  await flush(12);
  const a = readLocal(dom, 'archive:1');
  assert.equal(a.weeks['12'].weight, 76);
  assert.equal(a.scores[11], 63, 'відсоток лишився замороженим');
});

test('у CSS немає загального правила ".arch-week-body div" — воно розкладало форму редагування в рядок', async () => {
  const { mountTracker, flush } = require('./helpers/tracker');
  const dom = mountTracker();
  await flush();
  const css = [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  assert.doesNotMatch(css, /\.arch-week-body div\s*\{/);
});
