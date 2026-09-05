'use strict';
// Регрес: "галочка ставилась і за частку секунди сама зникала" (bfba8e0).
// Причина була в тому, що фоновий getall-запит, який летів при відкритті
// сторінки, приходив ЗАСТАРІЛИМ (без щойно поставленої галочки) і
// беззастережно перезаписував стан. editedDuringSync має від цього рятувати:
// тиждень, змінений ПОКИ запит ще в польоті, пропускається при мержі.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush, readLocal } = require('./helpers/tracker');

test('тап під час фонової синхронізації не відкочується застарілою відповіддю', async () => {
  const staleWeek1 = JSON.stringify({
    weight: null, debtAmt: null, capitalAmt: null, checks: {},
    logDays: [false, false, false, false, false, false, false],
    calorieDays: [false, false, false, false, false, false, false],
    custom: {},
  });

  let releaseGetAll;
  const getAllGate = new Promise((resolve) => { releaseGetAll = resolve; });
  const postBodies = [];

  const fetchImpl = async (url, init) => {
    if (String(url).includes('action=getall')) {
      await getAllGate; // тримаємо відповідь "у польоті", доки тест сам не відпустить
      return { json: async () => ({ items: { 'week:1': staleWeek1 } }) };
    }
    if (init && init.method === 'POST') {
      postBodies.push(JSON.parse(init.body));
      return { json: async () => ({ ok: true }) };
    }
    return { json: async () => ({}) };
  };

  const dom = mountTracker({ weburl: 'https://example.com/exec', fetchImpl });
  const { document } = dom.window;

  // Сторінка вже намальована з локального кешу (крок 1 load()); getall ще висить.
  await flush();

  const square = document.querySelector('.daily-grid .day-square');
  assert.ok(square, 'має бути хоча б один денний чекбокс (дефолтні тактики)');
  assert.equal(square.getAttribute('aria-checked'), 'false', 'початково не позначено');

  // Користувач тапає ПОКИ getall ще не відповів.
  square.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();

  const afterTap = document.querySelector('.daily-grid .day-square');
  assert.equal(afterTap.getAttribute('aria-checked'), 'true', 'тап мав одразу позначити день');

  // Тепер відпускаємо застарілу відповідь getall — вона прилітає ПІСЛЯ тапу.
  releaseGetAll();
  await flush();

  const afterSync = document.querySelector('.daily-grid .day-square');
  assert.equal(afterSync.getAttribute('aria-checked'), 'true',
    'застаріла відповідь синхронізації не повинна стирати свіжий локальний тап'
  );

  const week1 = readLocal(dom, 'week:1');
  assert.ok(week1.logDays.includes(true) || week1.calorieDays.includes(true) || Object.values(week1.checks || {}).some(Boolean),
    'позначений день має лишитись у збереженому стані тижня 1'
  );
});
