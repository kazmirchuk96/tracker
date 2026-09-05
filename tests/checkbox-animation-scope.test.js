'use strict';
// Регрес: "checkPop анімація програвалась на ВСІХ чекбоксах з однаковим
// aria-checked, а не лише щойно натиснутому" (ad39b78). Клас just-toggled
// має стояти рівно на одному дневному квадратику одразу після кліку.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush } = require('./helpers/tracker');

test('day-square: клас just-toggled ставиться лише на щойно клікнутий квадратик', async () => {
  // Тактики за замовчуванням (defaultTactics()) дають хоча б одну щоденну
  // дію ("логувати їжу") — цього досить, щоб мати денну сітку в тижні 1.
  const dom = mountTracker();
  await flush();
  const { document } = dom.window;

  const squares = [...document.querySelectorAll('.daily-grid .day-square')];
  assert.ok(squares.length >= 2, 'потрібно принаймні 2 денних квадратики для цього тесту');

  // Клікаємо на перший — стає checked.
  squares[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();

  let allSquares = [...document.querySelectorAll('.daily-grid .day-square')];
  let toggled = allSquares.filter((el) => el.classList.contains('just-toggled'));
  assert.equal(toggled.length, 1, 'одразу після кліку рівно один квадратик має just-toggled');
  assert.equal(toggled[0].getAttribute('aria-checked'), 'true');

  // Клікаємо на другий, зараз ще не позначений — теж стане checked=true,
  // тобто збіжиться станом з першим. just-toggled все одно має лишитись
  // лише на другому (щойно клікнутому), не на обох.
  allSquares[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();

  allSquares = [...document.querySelectorAll('.daily-grid .day-square')];
  toggled = allSquares.filter((el) => el.classList.contains('just-toggled'));
  assert.equal(toggled.length, 1, 'після другого кліку just-toggled так само лишається на ОДНОМУ елементі');
});
