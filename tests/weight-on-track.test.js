'use strict';
// Регрес: користувач помітив, що вага 78.6 кг при плані 78.5 кг (тобто ГІРШЕ
// плану — ціль на схуднення) все одно позначалась зеленим бейджем "у графіку".
// Причина: computeSnapshot() мав прихований допуск +0.15 кг на випадок шуму
// ваги. За прямим проханням користувача допуск прибрано повністю — будь-яке
// перевищення плану, навіть на 0.1 кг, тепер чесно рахується як "позаду".

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush } = require('./helpers/tracker');

// Дефолтні цілі: weightStart=84, weightEnd=78, 12 тижнів →
// expWeight(i) = 84 - 0.5*i. Після 1 завершеного тижня (paceWeekWeight=1)
// план становить expWeight(1) = 83.5 кг. START трекера — 27.07.2026
// (понеділок), тож будь-яка дата в межах 03.08–09.08.2026 — це тиждень 2,
// і completedWeeks (=paceWeekWeight) там дорівнює 1.

function weightBadgeText(document) {
  const cards = [...document.querySelectorAll('#stat-cards .stat-card')];
  const weightCard = cards.find((c) => c.textContent.includes('Вага'));
  assert.ok(weightCard, 'картка "Вага" має бути серед stat-cards');
  const badge = weightCard.querySelector('.badge');
  return badge ? badge.textContent.trim() : null;
}

test('вага трохи вище плану (83.6 при плані 83.5) — тепер "позаду", не "у графіку"', async () => {
  const now = new Date(2026, 7, 5, 12); // 05.08.2026, у межах тижня 2 → completedWeeks=1
  const dom = mountTracker({
    now,
    seed: { weeks: { 1: { weight: 83.6, debtAmt: null, capitalAmt: null, checks: {}, logDays: [false,false,false,false,false,false,false], calorieDays: [false,false,false,false,false,false,false], custom: {} } } },
  });
  await flush();
  const { document } = dom.window;

  const badgeText = weightBadgeText(document);
  assert.equal(badgeText, 'позаду', `очікував "позаду" для 83.6 кг при плані 83.5 кг, отримав "${badgeText}"`);
});

test('вага рівно за планом (83.5 при плані 83.5) — все ще "у графіку"', async () => {
  const now = new Date(2026, 7, 5, 12);
  const dom = mountTracker({
    now,
    seed: { weeks: { 1: { weight: 83.5, debtAmt: null, capitalAmt: null, checks: {}, logDays: [false,false,false,false,false,false,false], calorieDays: [false,false,false,false,false,false,false], custom: {} } } },
  });
  await flush();
  const { document } = dom.window;

  const badgeText = weightBadgeText(document);
  assert.equal(badgeText, 'у графіку', `точне влучання в план не повинно рахуватись як "позаду", отримав "${badgeText}"`);
});

test('вага нижче плану (83.0 при плані 83.5) — "у графіку" (не "позаду")', async () => {
  const now = new Date(2026, 7, 5, 12);
  const dom = mountTracker({
    now,
    seed: { weeks: { 1: { weight: 83.0, debtAmt: null, capitalAmt: null, checks: {}, logDays: [false,false,false,false,false,false,false], calorieDays: [false,false,false,false,false,false,false], custom: {} } } },
  });
  await flush();
  const { document } = dom.window;

  const badgeText = weightBadgeText(document);
  assert.notEqual(badgeText, 'позаду');
});
