'use strict';
// Регрес: "кома як десятковий роздільник відкидалась на iOS" (f151ca7).
// Поле ваги — text+inputmode="decimal" з ручним parseLocal(), що має
// приймати і кому, і крапку. Перевіряємо саме через реальний DOM-інпут,
// не викликом parseLocal напряму (вона не експортована й не мала б бути).

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush, readLocal } = require('./helpers/tracker');

function findWeightInput(document) {
  const rows = [...document.querySelectorAll('.metric-row')];
  const row = rows.find((r) => r.querySelector('.metric-label')?.textContent === 'Вага');
  assert.ok(row, 'рядок метрики "Вага" має бути в DOM');
  const input = row.querySelector('.stepper input');
  assert.ok(input, 'поле вводу ваги має бути всередині .stepper');
  return input;
}

test('вага: кома "84,5" приймається так само, як крапка', async () => {
  const dom = mountTracker();
  await flush();
  const { document } = dom.window;

  const input = findWeightInput(document);
  input.value = '84,5';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
  await flush();

  const week1 = readLocal(dom, 'week:1');
  assert.equal(week1.weight, 84.5, 'кома мала розпізнатись як десятковий роздільник');
});

test('вага: крапка "84.5" так само працює (не лише кома)', async () => {
  const dom = mountTracker();
  await flush();
  const { document } = dom.window;

  const input = findWeightInput(document);
  input.value = '84.5';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
  await flush();

  const week1 = readLocal(dom, 'week:1');
  assert.equal(week1.weight, 84.5);
});

test('вага: сміття в полі не записується як NaN', async () => {
  const dom = mountTracker();
  await flush();
  const { document } = dom.window;

  const input = findWeightInput(document);
  input.value = 'абв';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
  await flush();

  const week1 = readLocal(dom, 'week:1');
  assert.ok(week1 === null || !Number.isNaN(week1.weight), 'NaN не повинен потрапити у збережений тиждень');
});
