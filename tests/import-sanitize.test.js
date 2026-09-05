'use strict';
// Регрес: "Q3" — валідний JSON з неочікуваною структурою (weight: "abc")
// раніше мовчки протікав через Object.assign у NaN, який далі розповзався
// по score/темпу/графіках без жодного повідомлення. sanitizeWeek() має
// відкидати такі поля поіменно, а не падати чи вставляти сміття.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush, readLocal } = require('./helpers/tracker');

function triggerImport(dom, payload) {
  const { document, File } = dom.window;
  const file = new File([JSON.stringify(payload)], 'import.json', { type: 'application/json' });
  const input = document.getElementById('import-file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

test('імпорт з некоректним weight ("abc") не записує NaN у стан тижня', async () => {
  const dom = mountTracker();
  await flush();

  triggerImport(dom, {
    week1: { weight: 'abc', debtAmt: 100, checks: {}, logDays: [true, false, false, false, false, false, false] },
  });
  await flush();

  const week1 = readLocal(dom, 'week:1');
  assert.ok(week1, 'тиждень 1 має бути збережений після імпорту');
  assert.notEqual(week1.weight, 'abc');
  assert.ok(!Number.isNaN(Number(week1.weight)) , 'weight не повинен перетворитись на NaN');
  assert.equal(week1.weight, null, 'некоректне значення відкидається, а не підставляється як є');
  assert.equal(week1.debtAmt, 100, 'коректні поля поруч із некоректним усе одно імпортуються');
});

test('імпорт файлу без жодного тижня показує сповіщення, а не мовчки нічого не робить', async () => {
  const dom = mountTracker();
  await flush();
  const { document } = dom.window;

  triggerImport(dom, { notAWeek: true });
  await flush();

  const alertOverlay = document.getElementById('app-modal-overlay');
  assert.notEqual(alertOverlay.style.display, 'none', 'має зʼявитись модалка з поясненням, що тижнів не знайдено');
});

test('імпорт з logDays неправильної довжини (не 7) відкидає саме це поле', async () => {
  const dom = mountTracker();
  await flush();

  triggerImport(dom, {
    week2: { logDays: [true, false, true] }, // 3 замість 7
  });
  await flush();

  const week2 = readLocal(dom, 'week:2');
  assert.ok(week2, 'тиждень 2 усе одно імпортується (інші поля відсутні, але ключ week2 існував)');
  assert.equal(week2.logDays.length, 7, 'logDays завжди лишається масивом з рівно 7 елементів (дефолтний, бо вхідний відкинуто)');
});
