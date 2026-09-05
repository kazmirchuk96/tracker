'use strict';
// Базова перевірка, що трекер взагалі піднімається і малює перший тиждень
// без даних — якщо цей тест ламається, ламається все інше в файлі.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush } = require('./helpers/tracker');

test('порожній стан: рендериться картка "Тиждень 1" без падіння в error-екран', async () => {
  const dom = mountTracker();
  await flush();
  const { document } = dom.window;

  const root = document.getElementById('tracker-root');
  assert.ok(root, '#tracker-root має існувати');
  assert.doesNotMatch(root.innerHTML, /не зміг відобразитись через помилку/,
    'render() не повинен впасти в catch-гілку на порожніх даних');

  const heroWrap = document.getElementById('hero-wrap');
  assert.match(heroWrap.textContent, /Тиждень 1/, 'активний тиждень за замовчуванням — перший');
});
