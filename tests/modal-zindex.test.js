'use strict';
// Регрес: "модалка підтвердження була прихована за модалкою налаштувань"
// (e9e8131). При рівному z-index порядок промальовки в DOM вирішує, хто
// зверху — не порядок відкриття через JS. Ця перевірка статична (парсить
// inline style), бо в jsdom немає візуального рендеру для composited layers.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mountTracker, flush } = require('./helpers/tracker');

function zIndexOf(el) {
  return Number(el.style.zIndex);
}

test('модалка підтвердження (app-modal) має вищий z-index за модалку налаштувань (goals)', async () => {
  const dom = mountTracker();
  await flush();
  const { document } = dom.window;

  const appModal = document.getElementById('app-modal-overlay');
  const goalsModal = document.getElementById('goals-overlay');
  assert.ok(appModal && goalsModal, 'обидві модалки мають бути в DOM');

  const appZ = zIndexOf(appModal);
  const goalsZ = zIndexOf(goalsModal);
  assert.ok(Number.isFinite(appZ) && Number.isFinite(goalsZ), 'z-index має бути заданий явно, не successором каскаду');
  assert.ok(appZ > goalsZ,
    `app-modal-overlay (z-index:${appZ}) має перекривати goals-overlay (z-index:${goalsZ}), ` +
    'інакше підтвердження всередині налаштувань знову опиниться позаду'
  );
});
