'use strict';
// Цикли: дата старту, автозбереження підсумку завершеного циклу в архів,
// перегляд архіву, старт нового циклу, повний бекап (експорт/імпорт) і
// синхронізація. Навіщо: 12-й тиждень закінчується 18.10.2026 — дані мусять
// лишитись доступними, а новий цикл не має затерти старий.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush, readLocal } = require('./helpers/tracker');

const IN_CYCLE = new Date(2026, 7, 2, 12);      // 02.08.2026 — кінець тижня 1
const AFTER_END = new Date(2026, 9, 19, 12);    // 19.10.2026 — наступного дня після 12-го тижня
const DAYS_OFF = [false, false, false, false, false, false, false];
const ALL_DAYS = [true, true, true, true, true, true, true];

function week(over = {}) {
  return Object.assign({
    weight: null, debtAmt: null, capitalAmt: null, checks: {},
    logDays: DAYS_OFF.slice(), calorieDays: DAYS_OFF.slice(), custom: {},
  }, over);
}
// Тиждень із даними: вага, суми, кілька відміток.
const W1 = week({ weight: 83.2, debtAmt: 150, capitalAmt: 150, checks: { w1: true }, logDays: ALL_DAYS.slice() });
const W2 = week({ weight: 82.4, debtAmt: 150, capitalAmt: 100, checks: { w1: true }, logDays: ALL_DAYS.slice(), calorieDays: ALL_DAYS.slice() });
const SEEDED = { weeks: { 1: W1, 2: W2 } };

const doc = (dom) => dom.window.document;
const $ = (dom, id) => doc(dom).getElementById(id);
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const text = (dom, id) => $(dom, id).textContent;
const visible = (dom, id) => $(dom, id).style.display !== 'none';

// fetch, що запам'ятовує POST-и по порядку; getall віддає remoteItems.
function recordingFetch(remoteItems = {}) {
  const posts = [];
  const impl = async (url, init) => {
    if (String(url).includes('action=getall')) return { json: async () => ({ items: remoteItems }) };
    if (init && init.method === 'POST') { const b = JSON.parse(init.body); posts.push({ key: b.key, value: b.value }); return { json: async () => ({ ok: true }) }; }
    return { json: async () => ({}) };
  };
  return { impl, posts };
}

// Перехоплює файл, який застосунок "завантажує" (Blob + <a download>).
function captureDownloads(dom) {
  const files = [];
  dom.window.URL.createObjectURL = (blob) => { files.push(blob); return 'blob:test'; };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { files[files.length - 1].filename = this.download; };
  return files;
}

async function importJson(dom, payload) {
  const file = new dom.window.File([typeof payload === 'string' ? payload : JSON.stringify(payload)], 'import.json', { type: 'application/json' });
  const input = $(dom, 'import-file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
}

// ═══ Дата старту і заголовок ═══════════════════════════════════════════════

test('без ключа cycle: цикл 1 зі стартом 27.07.2026, заголовок як раніше, банера нема, нічого зайвого не пишеться', async () => {
  const dom = mountTracker({ now: IN_CYCLE });
  await flush();
  assert.equal(text(dom, 'cycle-range'), '27 липня — 18 жовтня 2026');
  assert.equal($(dom, 'cycle-banner').children.length, 0);
  assert.equal(dom.window.localStorage.getItem('tracker:cycle'), null, 'старі користувачі не отримують нових ключів без потреби');
  assert.equal(dom.window.localStorage.getItem('tracker:archive:1'), null);
});

test('ключ cycle задає старт: заголовок, тижні й підписи рахуються від нової дати', async () => {
  const dom = mountTracker({
    now: new Date(2026, 10, 5, 12), // 05.11.2026 — тиждень 1 нового циклу
    seed: { raw: { cycle: JSON.stringify({ id: 2, start: '2026-11-02' }) } },
  });
  await flush();
  assert.equal(text(dom, 'cycle-range'), 'Цикл 2 · 2 листопада 2026 — 24 січня 2027');
  assert.match(doc(dom).querySelector('#hero-wrap').textContent, /Тиждень 1/);
  assert.match(doc(dom).querySelector('#hero-wrap').textContent, /02\.11 – 08\.11/, 'дати тижня йдуть від нового старту');
});

test('пошкоджений або нереальний ключ cycle ігнорується — працює цикл за замовчуванням', async () => {
  for (const bad of ['сміття', JSON.stringify({ id: 0, start: '2026-11-02' }), JSON.stringify({ id: 2, start: '2026-02-31' }), JSON.stringify({ id: 'x', start: '2026-11-02' })]) {
    const dom = mountTracker({ now: IN_CYCLE, seed: { raw: { cycle: bad } } });
    await flush();
    assert.equal(text(dom, 'cycle-range'), '27 липня — 18 жовтня 2026', `для "${bad}"`);
    assert.doesNotMatch(doc(dom).getElementById('tracker-root').innerHTML, /не зміг відобразитись/);
  }
});

test('цикл ще не стартував: банер "стартує …"', async () => {
  const dom = mountTracker({ now: new Date(2026, 9, 25, 12), seed: { raw: { cycle: JSON.stringify({ id: 2, start: '2026-11-02' }) } } });
  await flush();
  assert.match($(dom, 'cycle-banner').textContent, /Цикл 2 стартує 2 листопада 2026/);
  assert.equal($(dom, 'banner-new-cycle'), null, 'кнопка нового циклу тут не потрібна');
});

// ═══ Автозбереження підсумку ═══════════════════════════════════════════════

test('цикл у розпалі: ні архіву, ні банера', async () => {
  const dom = mountTracker({ now: IN_CYCLE, seed: SEEDED });
  await flush();
  assert.equal(dom.window.localStorage.getItem('tracker:archive:1'), null);
  assert.equal($(dom, 'cycle-banner').children.length, 0);
});

test('цикл завершився і є дані: знімок archive:1 створюється сам, з тижнями, цілями, діями й замороженими відсотками', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: Object.assign({ goals: { weightStart: 84, weightEnd: 78, debtStart: 0, debtEnd: 1800, capitalStart: 0, capitalEnd: 1800 } }, SEEDED) });
  await flush();

  const snap = readLocal(dom, 'archive:1');
  assert.ok(snap, 'archive:1 має бути записано');
  assert.equal(snap.v, 1);
  assert.equal(snap.id, 1);
  assert.equal(snap.start, '2026-07-27');
  assert.equal(snap.end, '2026-10-18');
  assert.equal(snap.endedEarly, false);
  assert.equal(snap.weeks['1'].weight, 83.2);
  assert.equal(snap.weeks['2'].capitalAmt, 100);
  assert.equal(snap.goals.weightEnd, 78);
  assert.ok(snap.tactics.some((t) => t.id === 'logDays'), 'список дій у знімку');
  assert.equal(snap.scores.length, 12);
  assert.ok(snap.scores[0] > 0 && snap.scores[1] >= snap.scores[0], 'відсотки пораховані й збережені');
  assert.match($(dom, 'cycle-banner').textContent, /Цикл 1 завершено/);
  assert.match($(dom, 'cycle-banner').textContent, /Підсумок збережено в архів/);
  assert.ok($(dom, 'banner-open-archive') && $(dom, 'banner-new-cycle'));
});

test('цикл завершився, але записів не було: архів не створюється, банер чесно це каже', async () => {
  const dom = mountTracker({ now: AFTER_END });
  await flush();
  assert.equal(dom.window.localStorage.getItem('tracker:archive:1'), null);
  assert.match($(dom, 'cycle-banner').textContent, /не було записів/);
  assert.equal($(dom, 'banner-open-archive'), null);
});

test('автознімок іде і в хмару рівно один раз; наступні render() без змін його не дублюють', async () => {
  const rec = recordingFetch({});
  const dom = mountTracker({ now: AFTER_END, seed: SEEDED, weburl: 'https://example.com/exec', fetchImpl: rec.impl });
  await flush();
  const first = rec.posts.filter((p) => p.key === 'archive:1').length;
  assert.ok(first >= 1, 'знімок відправлено в хмару');
  const before = rec.posts.length;
  // render() без зміни даних (blur поля ваги з тим самим значенням)
  const row = [...doc(dom).querySelectorAll('.metric-row')].find((r) => r.querySelector('.metric-label')?.textContent === 'Вага');
  row.querySelector('.stepper input').dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
  await flush();
  assert.equal(rec.posts.filter((p) => p.key === 'archive:1').length, first, 'без змін — без нових відправок знімка');
  assert.ok(rec.posts.length >= before);
});

test('знімок уже актуальний (збігається з живими даними) — при відкритті в хмару не відправляється знову', async () => {
  const first = mountTracker({ now: AFTER_END, seed: SEEDED });
  await flush();
  const stored = first.window.localStorage.getItem('tracker:archive:1');
  const rec = recordingFetch({ 'archive:1': stored }); // у хмарі вже та сама версія
  mountTracker({ now: AFTER_END, seed: Object.assign({ raw: { 'archive:1': stored } }, SEEDED), weburl: 'https://example.com/exec', fetchImpl: rec.impl });
  await flush(12);
  assert.equal(rec.posts.filter((p) => p.key === 'archive:1').length, 0, 'нічого не змінилось — нічого й не шлемо');
});

test('якщо в завершений цикл дописали дані, знімок оновлюється при наступному відкритті', async () => {
  const stale = JSON.stringify({ v: 1, id: 1, start: '2026-07-27', end: '2026-10-18', endedEarly: false, savedAt: '2026-10-19T08:00:00.000Z',
    goals: {}, tactics: [], weeks: { 1: W1 }, scores: [50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  const dom = mountTracker({ now: AFTER_END, seed: Object.assign({ raw: { 'archive:1': stale } }, SEEDED) });
  await flush();
  const snap = readLocal(dom, 'archive:1');
  assert.equal(snap.weeks['2'].weight, 82.4, 'знімок оновився живими даними');
  assert.notEqual(snap.savedAt, '2026-10-19T08:00:00.000Z');
});

test('зіпсований archive:N не ламає застосунок і не потрапляє в список', async () => {
  const dom = mountTracker({ now: IN_CYCLE, seed: { raw: { 'archive:1': '{не json', 'archive:2': JSON.stringify({ v: 1, id: 2, start: 'ніколи', weeks: {} }) } } });
  await flush();
  assert.doesNotMatch(doc(dom).getElementById('tracker-root').innerHTML, /не зміг відобразитись/);
  click(dom, $(dom, 'open-archive'));
  await flush();
  assert.match(text(dom, 'archive-body'), /Поки що порожньо/);
});

// ═══ Перегляд архіву ═══════════════════════════════════════════════════════

test('архів: порожній стан, пояснює, коли з\'явиться підсумок', async () => {
  const dom = mountTracker({ now: IN_CYCLE });
  await flush();
  click(dom, $(dom, 'open-archive'));
  await flush();
  assert.ok(visible(dom, 'archive-overlay'));
  assert.match(text(dom, 'archive-body'), /Поки що порожньо/);
  assert.match(text(dom, 'archive-body'), /12-й тиждень/);
});

test('архів: список → деталі з підсумком, діаграмами й тижнями → назад → закрити', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: SEEDED });
  await flush();
  click(dom, $(dom, 'open-archive'));
  await flush();

  const items = [...doc(dom).querySelectorAll('#archive-body .arch-item')];
  assert.equal(items.length, 1);
  assert.match(items[0].textContent, /Цикл 1/);
  assert.match(items[0].textContent, /27 липня — 18 жовтня 2026/);
  assert.match(items[0].textContent, /82,4 кг|82\.4 кг/, 'остання вага в картці списку');

  click(dom, items[0]);
  await flush();
  const body = text(dom, 'archive-body');
  const snap = readLocal(dom, 'archive:1');
  assert.equal(text(dom, 'archive-title'), 'Цикл 1');
  assert.match(body, /середнє виконання тижня/);
  assert.match(body, /82\.4 кг/, 'остання вага в підсумку');
  assert.match(body, /\$300/, 'борг: 150 + 150');
  assert.match(body, /\$250/, 'капітал: 150 + 100');
  assert.match(body, new RegExp('Тиждень 1 · 27\\.07 – 02\\.08'));
  assert.equal(doc(dom).querySelectorAll('#archive-body svg[role="img"]').length, 3, 'три діаграми: вага, борг, капітал');
  assert.equal(doc(dom).querySelectorAll('#archive-body .arch-ring').length, 12, '12 кілець виконання');
  assert.equal(doc(dom).querySelectorAll('#archive-body details.arch-week').length, 12);
  const w2 = doc(dom).querySelectorAll('#archive-body details.arch-week')[1].textContent;
  assert.match(w2, /82\.4 кг/);
  assert.match(w2, /Облік їжі кожного дня7\/7/);
  assert.match(w2, new RegExp(snap.scores[1] + '%'));

  click(dom, $(dom, 'archive-back'));
  await flush();
  assert.equal(text(dom, 'archive-title'), 'Архів циклів');
  assert.equal(doc(dom).querySelectorAll('#archive-body .arch-item').length, 1);

  click(dom, $(dom, 'archive-close'));
  assert.ok(!visible(dom, 'archive-overlay'));
});

test('архів: кнопка в банері відкриває одразу підсумок завершеного циклу', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: SEEDED });
  await flush();
  click(dom, $(dom, 'banner-open-archive'));
  await flush();
  assert.ok(visible(dom, 'archive-overlay'));
  assert.equal(text(dom, 'archive-title'), 'Цикл 1');
});

test('діаграми грошей в архіві не мають від\'ємної осі (мінус перед сумою читається як помилка)', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: SEEDED });
  await flush();
  click(dom, $(dom, 'banner-open-archive'));
  const labels = [...doc(dom).querySelectorAll('#archive-body svg[role="img"] text')].map((t) => t.textContent);
  assert.equal(labels.length, 6);
  assert.ok(labels.every((l) => !l.startsWith('-')), `підписи осей: ${labels.join(', ')}`);
});

test('архів: "Завантажити JSON циклу" віддає знімок цього циклу', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: SEEDED });
  const files = captureDownloads(dom);
  await flush();
  click(dom, $(dom, 'banner-open-archive'));
  click(dom, $(dom, 'archive-export'));
  const blob = files[0];
  assert.equal(blob.filename, '12-week-tracker-cycle-1.json');
  const parsed = JSON.parse(await blob.text());
  assert.equal(parsed.id, 1);
  assert.equal(parsed.weeks['1'].weight, 83.2);
});

test('архів показує достроково завершений цикл із позначкою і назви дій екрануються', async () => {
  const snap = {
    v: 1, id: 1, start: '2026-07-27', end: '2026-10-18', endedEarly: true, endedAt: '2026-09-14', savedAt: '2026-09-14T10:00:00.000Z',
    goals: { weightStart: 84, weightEnd: 78, debtStart: 0, debtEnd: 1800, capitalStart: 0, capitalEnd: 1800 },
    tactics: [{ id: 'a_x', label: 'Пити <b>2л</b> води', type: 'weekly', goal: 'general', createdWeek: 1, archivedWeek: null }],
    weeks: { 1: Object.assign(week(), { custom: { a_x: true } }) }, scores: [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  const dom = mountTracker({ now: IN_CYCLE, seed: { raw: { 'archive:1': JSON.stringify(snap) } } });
  await flush();
  click(dom, $(dom, 'open-archive'));
  assert.match(text(dom, 'archive-body'), /достроково/);
  click(dom, doc(dom).querySelector('#archive-body .arch-item'));
  assert.match(text(dom, 'archive-body'), /завершено достроково 14\.09\.2026/);
  assert.ok(![...doc(dom).querySelectorAll('#archive-body .arch-week-body b')].length, 'HTML із назви дії не став розміткою');
  assert.match(text(dom, 'archive-body'), /Пити <b>2л<\/b> води/);
});

// ═══ Новий цикл ════════════════════════════════════════════════════════════

async function openNewCycle(dom, viaBanner = true) {
  click(dom, viaBanner ? $(dom, 'banner-new-cycle') : $(dom, 'new-cycle'));
  await flush();
}
async function confirmNewCycle(dom, iso) {
  $(dom, 'cycle-start-input').value = iso;
  click(dom, $(dom, 'cycle-confirm'));
  await flush(12);
}

test('новий цикл: модалка пропонує найближчий понеділок, перевіряє дату й не закривається при помилці', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: SEEDED });
  await flush();
  await openNewCycle(dom);
  assert.ok(visible(dom, 'cycle-overlay'));
  assert.equal($(dom, 'cycle-start-input').value, '2026-10-19', 'сьогодні понеділок — пропонується сьогодні');
  assert.match(text(dom, 'cycle-info'), /збережеться в архів/);

  await confirmNewCycle(dom, '2026-10-20'); // вівторок
  assert.match(text(dom, 'cycle-error'), /з понеділка/);
  assert.ok(visible(dom, 'cycle-overlay'), 'модалка лишається відкритою');

  await confirmNewCycle(dom, '2026-07-27'); // не пізніше за старт поточного
  assert.match(text(dom, 'cycle-error'), /пізнішою за початок поточного/);

  await confirmNewCycle(dom, '2026-02-31'); // неіснуюча дата → порожнє значення в date-полі
  assert.match(text(dom, 'cycle-error'), /Вкажи дату|з понеділка|пізнішою/);

  assert.equal(dom.window.localStorage.getItem('tracker:cycle'), null, 'жодних змін, поки дата не пройшла перевірку');
});

test('новий цикл: архів старого лишається, живі дані чисті, цілі й дії перенесено, дата й номер оновлено', async () => {
  const tactics = [
    { id: 'w1', label: 'Зважування в понеділок зранку', type: 'weekly', goal: 'weight', createdWeek: 1, archivedWeek: null, builtin: true },
    { id: 'logDays', label: 'Облік їжі кожного дня', type: 'daily', goal: 'weight', createdWeek: 1, archivedWeek: null, builtin: true },
    { id: 'calorieDays', label: 'Не більше 2000 ккал/день', type: 'daily', goal: 'weight', createdWeek: 1, archivedWeek: null, builtin: true },
    { id: 'a_keep', label: 'Білок 120г', type: 'daily', goal: 'weight', createdWeek: 5, archivedWeek: null, builtin: false },
    { id: 'a_old', label: 'Стара дія', type: 'weekly', goal: 'general', createdWeek: 1, archivedWeek: 3, builtin: false },
  ];
  const dom = mountTracker({
    now: AFTER_END,
    seed: Object.assign({ goals: { weightStart: 84, weightEnd: 78, debtStart: 0, debtEnd: 1800, capitalStart: 0, capitalEnd: 1800, debtClosedWeek: 9 }, tactics,
      raw: { 'celebrated:week:1': '1', 'celebrated:week:7': '1' } }, SEEDED),
  });
  await flush();
  const archivedBefore = readLocal(dom, 'archive:1');
  assert.ok(archivedBefore);

  await openNewCycle(dom);
  await confirmNewCycle(dom, '2026-11-02');

  // цикл
  assert.deepEqual(readLocal(dom, 'cycle'), { id: 2, start: '2026-11-02' });
  assert.equal(text(dom, 'cycle-range'), 'Цикл 2 · 2 листопада 2026 — 24 січня 2027');
  // архів старого циклу цілий
  const archivedAfter = readLocal(dom, 'archive:1');
  assert.equal(archivedAfter.weeks['1'].weight, 83.2);
  assert.equal(archivedAfter.weeks['2'].weight, 82.4);
  assert.equal(archivedAfter.endedEarly, false);
  // живі дані порожні
  for (let n = 1; n <= 12; n++) {
    const w = readLocal(dom, 'week:' + n);
    assert.equal(w.weight, null, `тиждень ${n}`);
    assert.ok(!w.checks.w1 && !w.logDays.some(Boolean), `тиждень ${n} без відміток`);
  }
  // цілі: вага старту = остання записана, борг/капітал з нуля, закриття знято, ціль-кінець збережена
  const goals = readLocal(dom, 'goals');
  assert.equal(goals.weightStart, 82.4);
  assert.equal(goals.weightEnd, 78);
  assert.equal(goals.debtStart, 0);
  assert.equal(goals.debtClosedWeek, null);
  // дії: активні лишились і діють з тижня 1, архівована зникла
  const t = readLocal(dom, 'tactics');
  assert.deepEqual(t.map((x) => x.id).sort(), ['a_keep', 'calorieDays', 'logDays', 'w1']);
  assert.ok(t.every((x) => x.createdWeek === 1 && x.archivedWeek === null));
  // прапорці "конфеті було" з минулого циклу не мають діяти на новий
  assert.equal(dom.window.localStorage.getItem('tracker:celebrated:week:1'), null);
  assert.equal(dom.window.localStorage.getItem('tracker:celebrated:week:7'), null);
  // банер завершення зник (новий цикл ще не стартував → інший банер)
  assert.match($(dom, 'cycle-banner').textContent, /Цикл 2 стартує 2 листопада 2026/);
  // і далі пропонується задати цілі
  assert.ok(visible(dom, 'app-modal-overlay'));
  assert.match(text(dom, 'app-modal-message'), /Цикл 2 створено/);
  click(dom, $(dom, 'app-modal-ok'));
  await flush();
  assert.ok(visible(dom, 'goals-overlay'), 'відкрились налаштування цілей');
  assert.equal($(dom, 'goal-weight-start').value, '82.4');
});

test('новий цикл: старий архів потрапляє в архів-список поруч із новим, а відкритий архів показує старі дані', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: SEEDED });
  await flush();
  await openNewCycle(dom);
  await confirmNewCycle(dom, '2026-10-26');
  click(dom, $(dom, 'app-modal-ok'));
  click(dom, $(dom, 'goals-cancel'));
  await flush();
  click(dom, $(dom, 'open-archive'));
  const items = doc(dom).querySelectorAll('#archive-body .arch-item');
  assert.equal(items.length, 1);
  click(dom, items[0]);
  assert.match(text(dom, 'archive-body'), /82\.4 кг/);
});

test('новий цикл ДОСТРОКОВО (старий ще йде): знімок позначено endedEarly, пояснення в модалці чесне', async () => {
  const dom = mountTracker({ now: IN_CYCLE, seed: SEEDED });
  await flush();
  await openNewCycle(dom, false);
  assert.match(text(dom, 'cycle-info'), /ще не закінчився/);
  assert.match(text(dom, 'cycle-info'), /достроково завершений/);
  await confirmNewCycle(dom, '2026-08-10');

  const snap = readLocal(dom, 'archive:1');
  assert.equal(snap.endedEarly, true);
  assert.equal(snap.endedAt, '2026-08-02');
  assert.equal(snap.weeks['2'].weight, 82.4);
  assert.deepEqual(readLocal(dom, 'cycle'), { id: 2, start: '2026-08-10' });
});

test('новий цикл при порожньому поточному: архів не створюється', async () => {
  const dom = mountTracker({ now: IN_CYCLE });
  await flush();
  await openNewCycle(dom, false);
  assert.match(text(dom, 'cycle-info'), /порожній/);
  await confirmNewCycle(dom, '2026-08-10');
  assert.equal(dom.window.localStorage.getItem('tracker:archive:1'), null);
  assert.deepEqual(readLocal(dom, 'cycle'), { id: 2, start: '2026-08-10' });
});

test('новий цикл: у хмару СПЕРШУ йде знімок старого циклу, і лише потім скидаються живі тижні', async () => {
  const rec = recordingFetch({});
  const dom = mountTracker({ now: IN_CYCLE, seed: SEEDED, weburl: 'https://example.com/exec', fetchImpl: rec.impl });
  await flush();
  rec.posts.length = 0;
  await openNewCycle(dom, false);
  await confirmNewCycle(dom, '2026-08-10');
  await flush(12);

  const keys = rec.posts.map((p) => p.key);
  const iArchive = keys.indexOf('archive:1');
  const iWeek = keys.indexOf('week:1');
  assert.ok(iArchive !== -1 && iWeek !== -1, `очікував archive:1 і week:1 у ${keys.join(', ')}`);
  assert.ok(iArchive < iWeek, 'знімок має піти раніше за перезапис тижнів');
  assert.ok(keys.includes('cycle') && keys.includes('goals') && keys.includes('tactics'));
  assert.equal(JSON.parse(rec.posts.find((p) => p.key === 'week:1').value).weight, null);
});

test('кнопка закриття архіву має іконку (вона поза #tracker-root, тож заповнюється окремим селектором)', async () => {
  const dom = mountTracker({ now: IN_CYCLE });
  await flush();
  assert.ok($(dom, 'archive-close').querySelector('svg'), 'у кнопці закриття має бути svg-іконка');
});

test('аркуші архіву й нового циклу лежать під модалкою підтвердження (z-index)', async () => {
  const dom = mountTracker({ now: IN_CYCLE });
  await flush();
  const css = [...doc(dom).querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const z = Number(/\.sheet-overlay\s*\{[^}]*z-index:\s*(\d+)/.exec(css)[1]);
  assert.ok(z < Number($(dom, 'app-modal-overlay').style.zIndex), 'підтвердження поверх аркуша');
  assert.ok(z >= Number($(dom, 'goals-overlay').style.zIndex), 'не нижче за налаштування');
  assert.ok($(dom, 'archive-overlay').classList.contains('sheet-overlay') && $(dom, 'cycle-overlay').classList.contains('sheet-overlay'));
});

// ═══ Синхронізація ═════════════════════════════════════════════════════════

test('синхр.: у хмарі СТАРІШИЙ цикл — новий локальний не затирається, а штовхається в хмару', async () => {
  const oldRemote = { 'week:1': JSON.stringify(W1), 'week:2': JSON.stringify(W2), goals: JSON.stringify({ weightStart: 84, weightEnd: 78 }) }; // ключа cycle нема = цикл 1
  const rec = recordingFetch(oldRemote);
  const dom = mountTracker({
    now: new Date(2026, 10, 5, 12), weburl: 'https://example.com/exec', fetchImpl: rec.impl,
    seed: { raw: { cycle: JSON.stringify({ id: 2, start: '2026-11-02' }) } },
  });
  await flush(12);
  assert.equal(readLocal(dom, 'week:1') === null || readLocal(dom, 'week:1').weight === null, true, 'тиждень 1 нового циклу не отримав вагу зі старого');
  assert.equal(text(dom, 'cycle-range').startsWith('Цикл 2'), true);
  const keys = rec.posts.map((p) => p.key);
  assert.ok(keys.includes('cycle') && keys.includes('week:1'), `локальне має піти в хмару, отримав: ${keys.join(', ')}`);
  assert.equal(JSON.parse(rec.posts.find((p) => p.key === 'cycle').value).id, 2);
});

test('синхр.: у хмарі НОВІШИЙ цикл (створений на іншому пристрої) — застосовується', async () => {
  const remote = {
    cycle: JSON.stringify({ id: 2, start: '2026-11-02' }),
    goals: JSON.stringify({ weightStart: 80, weightEnd: 75, debtStart: 0, debtEnd: 500, capitalStart: 0, capitalEnd: 500 }),
    'week:1': JSON.stringify(week({ weight: 79.5 })),
  };
  const rec = recordingFetch(remote);
  const dom = mountTracker({ now: new Date(2026, 10, 5, 12), weburl: 'https://example.com/exec', fetchImpl: rec.impl });
  await flush(12);
  assert.equal(text(dom, 'cycle-range'), 'Цикл 2 · 2 листопада 2026 — 24 січня 2027');
  assert.equal(readLocal(dom, 'goals').weightStart, 80);
  assert.equal(readLocal(dom, 'week:1').weight, 79.5);
});

test('синхр.: архіви з хмари з\'являються локально, а локальні, яких нема в хмарі, відправляються туди', async () => {
  const mk = (id, savedAt) => JSON.stringify({ v: 1, id, start: '2026-07-27', end: '2026-10-18', endedEarly: false, savedAt,
    goals: {}, tactics: [], weeks: { 1: W1 }, scores: [70, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  const rec = recordingFetch({ 'archive:1': mk(1, '2026-10-19T09:00:00.000Z') });
  const dom = mountTracker({ now: IN_CYCLE, weburl: 'https://example.com/exec', fetchImpl: rec.impl, seed: { raw: { 'archive:3': mk(3, '2026-10-20T09:00:00.000Z') } } });
  await flush(12);
  assert.ok(readLocal(dom, 'archive:1'), 'архів із хмари збережено локально');
  assert.ok(rec.posts.some((p) => p.key === 'archive:3'), 'локальний архів 3 відправлено в хмару');
  assert.ok(!rec.posts.some((p) => p.key === 'archive:1'), 'архів 1 уже є в хмарі — не дублюємо');
});

// ═══ Бекап: експорт / імпорт ═══════════════════════════════════════════════

test('експорт JSON — повний: цикл, цілі, дії, тижні й архіви (а не лише тижні)', async () => {
  const dom = mountTracker({ now: AFTER_END, seed: Object.assign({ goals: { weightStart: 84, weightEnd: 77, debtStart: 0, debtEnd: 900, capitalStart: 0, capitalEnd: 800 } }, SEEDED) });
  const files = captureDownloads(dom);
  await flush();
  click(dom, $(dom, 'export-json'));
  const data = JSON.parse(await files[0].text());
  assert.equal(files[0].filename, '12-week-tracker.json');
  assert.equal(data.format, '12-week-tracker');
  assert.equal(data.version, 2);
  assert.deepEqual(data.cycle, { id: 1, start: '2026-07-27' });
  assert.equal(data.goals.weightEnd, 77);
  assert.ok(Array.isArray(data.tactics) && data.tactics.length >= 3);
  assert.equal(data.week1.weight, 83.2);
  assert.equal(data.archives['1'].weeks['2'].weight, 82.4, 'завершений цикл теж у бекапі');
});

test('бекап → чистий пристрій: після імпорту все збігається (круговий обхід)', async () => {
  const src = mountTracker({
    now: AFTER_END,
    seed: Object.assign({ goals: { weightStart: 84, weightEnd: 77, debtStart: 0, debtEnd: 900, capitalStart: 0, capitalEnd: 800 },
      tactics: [{ id: 'w1', label: 'Зважування в понеділок зранку', type: 'weekly', goal: 'weight', createdWeek: 1, archivedWeek: null, builtin: true },
        { id: 'a_z', label: 'Прогулянка', type: 'daily', goal: 'general', createdWeek: 2, archivedWeek: null, builtin: false }],
      raw: { cycle: JSON.stringify({ id: 2, start: '2026-07-27' }) } }, SEEDED),
  });
  const files = captureDownloads(src);
  await flush();
  click(src, $(src, 'export-json'));
  const backup = await files[0].text();

  const dst = mountTracker({ now: AFTER_END });
  await flush();
  await importJson(dst, backup);

  assert.deepEqual(readLocal(dst, 'cycle'), { id: 2, start: '2026-07-27' }, 'номер і дата циклу з бекапу');
  assert.equal(text(dst, 'cycle-range'), 'Цикл 2 · 27 липня — 18 жовтня 2026');
  assert.equal(readLocal(dst, 'goals').weightEnd, 77);
  assert.equal(readLocal(dst, 'goals').debtEnd, 900);
  assert.deepEqual(readLocal(dst, 'tactics').map((t) => t.id), ['w1', 'a_z']);
  assert.equal(readLocal(dst, 'week:1').weight, 83.2);
  assert.equal(readLocal(dst, 'week:2').capitalAmt, 100);
  assert.equal(readLocal(dst, 'archive:2').weeks['2'].weight, 82.4, 'завершений цикл теж доїхав');
});

test('імпорт старого формату (лише week1…12) не чіпає цілі, дії й цикл', async () => {
  const dom = mountTracker({ now: IN_CYCLE, seed: { goals: { weightStart: 90, weightEnd: 80, debtStart: 0, debtEnd: 100, capitalStart: 0, capitalEnd: 100 }, raw: { cycle: JSON.stringify({ id: 1, start: '2026-07-27' }) } } });
  await flush();
  await importJson(dom, { week1: W1 });
  assert.equal(readLocal(dom, 'week:1').weight, 83.2);
  assert.equal(readLocal(dom, 'goals').weightStart, 90);
  assert.deepEqual(readLocal(dom, 'cycle'), { id: 1, start: '2026-07-27' });
});

test('імпорт: сміттєві цілі/дії/архіви відсіюються, а не ламають застосунок', async () => {
  const dom = mountTracker({ now: IN_CYCLE });
  await flush();
  await importJson(dom, {
    week1: W1,
    goals: { weightStart: 'abc', weightEnd: -5, debtEnd: 1e12, capitalEnd: 700, debtClosedWeek: 99 },
    tactics: [{ id: 5, label: 'x' }, { id: 'ok', label: '  Валідна  ', type: 'daily', goal: 'нема-такої', createdWeek: 99 }, 'рядок'],
    archives: { 1: { v: 1, id: 'x' }, 2: 'не обʼєкт' },
  });
  const goals = readLocal(dom, 'goals');
  assert.equal(goals.weightStart, 84, 'нечислове → за замовчуванням');
  assert.equal(goals.weightEnd, 78, 'відʼємне → за замовчуванням');
  assert.equal(goals.debtEnd, 1800, 'нереально велике → за замовчуванням');
  assert.equal(goals.capitalEnd, 700, 'нормальне значення лишається');
  assert.equal(goals.debtClosedWeek, null);
  const tactics = readLocal(dom, 'tactics');
  assert.equal(tactics.length, 1);
  assert.equal(tactics[0].label, 'Валідна');
  assert.equal(tactics[0].goal, 'general');
  assert.equal(tactics[0].createdWeek, 1);
  assert.equal(listKeys(dom, 'tracker:archive:').length, 0);
  assert.doesNotMatch(doc(dom).getElementById('tracker-root').innerHTML, /не зміг відобразитись/);
});
function listKeys(dom, prefix) {
  const out = [];
  for (let i = 0; i < dom.window.localStorage.length; i++) { const k = dom.window.localStorage.key(i); if (k.indexOf(prefix) === 0) out.push(k); }
  return out;
}

test('імпорт знімка одного циклу (файл з архіву) іде ЛИШЕ в архів, живі дані не чіпає', async () => {
  const src = mountTracker({ now: AFTER_END, seed: SEEDED });
  const files = captureDownloads(src);
  await flush();
  click(src, $(src, 'banner-open-archive'));
  click(src, $(src, 'archive-export'));
  const snapFile = await files[0].text();

  const dst = mountTracker({ now: IN_CYCLE, seed: { weeks: { 3: week({ weight: 70 }) } } });
  await flush();
  await importJson(dst, snapFile);
  assert.equal(readLocal(dst, 'archive:1').weeks['1'].weight, 83.2);
  assert.equal(readLocal(dst, 'week:3').weight, 70, 'живі дані на місці');
  assert.equal(readLocal(dst, 'week:1'), null, 'тиждень 1 живого циклу не заповнився з архіву');
});

test('імпорт бекапу ІНШОГО циклу: поточний спершу зберігається в архів — нічого не губиться мовчки', async () => {
  // Цикл ще йде (IN_CYCLE): автознімок завершеного циклу тут не втручається,
  // тож архів archive:2 може з'явитись лише з самого імпорту.
  const dom = mountTracker({ now: IN_CYCLE, seed: { raw: { cycle: JSON.stringify({ id: 2, start: '2026-07-27' }) }, weeks: { 1: week({ weight: 77.7, debtAmt: 10 }) } } });
  await flush();
  assert.equal(dom.window.localStorage.getItem('tracker:archive:2'), null, 'передумова: архіву ще нема');
  await importJson(dom, { cycle: { id: 1, start: '2026-04-27' }, week1: week({ weight: 90 }) });
  assert.deepEqual(readLocal(dom, 'cycle'), { id: 1, start: '2026-04-27' });
  assert.equal(readLocal(dom, 'week:1').weight, 90);
  assert.equal(readLocal(dom, 'archive:2').weeks['1'].weight, 77.7, 'поточний цикл 2 збережено в архів перед заміною');
  assert.equal(readLocal(dom, 'archive:2').endedEarly, true, 'цикл ще йшов — позначено достроково');
});

test('імпорт не святкує "досягнення тижня" (відсотки стрибнули від самих даних)', async () => {
  const dom = mountTracker({ now: IN_CYCLE, fakeTime: true });
  await flush();
  const full = week({ weight: 80, debtAmt: 150, capitalAmt: 150, checks: { w1: true }, logDays: ALL_DAYS.slice(), calorieDays: ALL_DAYS.slice() });
  await importJson(dom, { week1: full });
  assert.equal(doc(dom).querySelector('#hero-wrap .hero-num').textContent, '100%');
  assert.equal(doc(dom).querySelectorAll('.goal-reached, .celebrate, .arc-reach').length, 0);
  assert.equal(dom.canvasLog.created, 0, 'конфеті не летить');
});

// ═══ Картка циклу в списку архіву ═════════════════════════════════════════

test('картка циклу: кільце середнього, 12 стовпчиків тижнів, прогрес по трьох цілях і статус', async () => {
  const snap = {
    v: 1, id: 1, start: '2026-07-27', end: '2026-10-18', endedEarly: false, savedAt: '2026-10-19T09:00:00.000Z',
    goals: { weightStart: 84, weightEnd: 78, debtStart: 0, debtEnd: 1800, capitalStart: 0, capitalEnd: 1800 },
    tactics: [], scores: [90, 70, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    weeks: { 1: week({ weight: 80, debtAmt: 900, capitalAmt: 1000 }), 2: week({ weight: 77.5, debtAmt: 300, capitalAmt: 900 }), 3: week({ debtAmt: 0, capitalAmt: 0, checks: { w1: true } }) },
  };
  const dom = mountTracker({ now: IN_CYCLE, seed: { raw: { 'archive:1': JSON.stringify(snap) } } });
  await flush();
  click(dom, $(dom, 'open-archive'));
  const card = doc(dom).querySelector('#archive-body .arch-item');

  // середнє лише по тижнях із даними: (90 + 70 + 100) / 3 = 87
  assert.match(card.querySelector('.arch-card-ring').textContent, /^87%$/);
  assert.match(card.querySelector('.arch-pill').textContent, /^завершено$/);
  const bars = [...card.querySelectorAll('.arch-bar')];
  assert.equal(bars.length, 12);
  assert.deepEqual(bars.slice(0, 4).map((b) => b.className), ['arch-bar hit', 'arch-bar', 'arch-bar hit', 'arch-bar empty']);
  assert.match(card.textContent, /2 з 12 тижнів 85%\+/);

  const goals = [...card.querySelectorAll('.arch-goals > div')].map((g) => g.textContent);
  assert.match(goals[0], /84 → 77\.5 кг/);
  assert.match(goals[0], /✓/, 'вага 77.5 при цілі 78 — досягнута');
  assert.match(goals[1], /\$1,?\s?200 з \$1,?\s?800/);
  assert.doesNotMatch(goals[1], /✓/, 'борг 1200 з 1800 — ні');
  assert.match(goals[2], /✓/, 'капітал 1900 з 1800 — так');
  const fills = [...card.querySelectorAll('.arch-goal-fill')].map((f) => f.style.width);
  assert.deepEqual(fills, ['100%', '67%', '100%'], 'смужки прогресу обмежені 100%');
  assert.match(card.querySelector('.arch-card-foot').textContent, /Пік — тиждень 3 \(100%\)/);
  assert.match(card.getAttribute('aria-label'), /Цикл 1, 27 липня — 18 жовтня 2026/);
});

test('картка циклу: достроково завершений — інша позначка, порожня вага — прочерк без падіння', async () => {
  const snap = {
    v: 1, id: 2, start: '2026-11-02', end: '2027-01-24', endedEarly: true, endedAt: '2026-11-20', savedAt: '2026-11-20T09:00:00.000Z',
    goals: { weightStart: 80, weightEnd: 75, debtStart: 0, debtEnd: 600, capitalStart: 0, capitalEnd: 600 },
    tactics: [], scores: Array(12).fill(0), weeks: { 1: week({ debtAmt: 50 }) },
  };
  const dom = mountTracker({ now: IN_CYCLE, seed: { raw: { 'archive:2': JSON.stringify(snap) } } });
  await flush();
  click(dom, $(dom, 'open-archive'));
  const card = doc(dom).querySelector('#archive-body .arch-item');
  assert.equal(card.querySelector('.arch-pill').textContent, 'завершено достроково');
  assert.ok(!card.querySelector('.arch-pill').classList.contains('ok'));
  assert.match(card.querySelectorAll('.arch-goals > div')[0].textContent, /Вага—/);
  assert.equal(card.querySelectorAll('.arch-goal-fill')[0].style.width, '0%');
});
