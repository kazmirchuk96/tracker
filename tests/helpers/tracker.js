'use strict';
// Спільний каркас для jsdom-тестів трекера.
//
// Підхід — чорна скринька: тести не чіпають внутрішні функції з IIFE
// у body.html (score(), sanitizeWeek() тощо звідти НЕ дістати — вони не
// експортовані на window, і так і мало лишитись, аби тест не тримався за
// деталі реалізації). Замість цього тести: (1) заздалегідь кладуть дані
// в localStorage — так само, як це робить сама сторінка між сесіями,
// (2) піднімають body.html у jsdom з підміненими Date/fetch/clientWidth,
// (3) клікають/вводять текст у реальний DOM, (4) перевіряють або відрендерений
// текст, або те, що застосунок сам записав назад у localStorage.
//
// Чому підміняти саме ці три речі:
//  - Date: score()/currentWeek()/todayIndexIn() рахують відносно "зараз" —
//    без фіксованої дати тест ламався б 27 жовтня і при кожному новому тижні.
//  - fetch: за замовчуванням синхронізація вимкнена (немає tracker:weburl),
//    тож fetch узагалі не має бути викликаний — стаб, що кидає помилку,
//    ловить регресію, якщо хтось випадково зробить виклик безумовним.
//  - clientWidth: jsdom не рахує layout, тому будь-який .clientWidth === 0.
//    Графіки (chartWidth_) на це розраховують і мовчки малюють 0-ширини
//    SVG — стаб повертає реалістичне число.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const BODY_HTML_PATH = path.join(__dirname, '..', '..', 'body.html');
const bodyHtml = fs.readFileSync(BODY_HTML_PATH, 'utf8');

/**
 * @param {object} opts
 * @param {Date} [opts.now] - зафіксований "поточний момент" для Date/Date.now().
 * @param {object} [opts.seed] - { goals, tactics, weeks: { [weekNum]: weekObj } }
 *   попередньо кладеться в localStorage під тими ж ключами, що й сама сторінка.
 * @param {string} [opts.weburl] - якщо задано, вмикає гілку синхронізації
 *   (tracker:weburl у localStorage) — тоді треба передати й fetchImpl.
 * @param {Function} [opts.fetchImpl] - мок window.fetch(url, init).
 * @param {number} [opts.clientWidth] - фіксована ширина для будь-якого елемента.
 * @returns {JSDOM}
 */
function mountTracker({
  now = new Date(2026, 6, 27, 12, 0, 0), // понеділок 12:00, перший тиждень (START = 27.07.2026)
  seed = {},
  weburl = '',
  fetchImpl = null,
  clientWidth = 600,
} = {}) {
  const html = '<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>';

  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (weburl) window.localStorage.setItem('tracker:weburl', weburl);
      if (seed.goals) window.localStorage.setItem('tracker:goals', JSON.stringify(seed.goals));
      if (seed.tactics) window.localStorage.setItem('tracker:tactics', JSON.stringify(seed.tactics));
      if (seed.weeks) {
        Object.keys(seed.weeks).forEach((n) => {
          window.localStorage.setItem('tracker:week:' + n, JSON.stringify(seed.weeks[n]));
        });
      }

      const RealDate = window.Date;
      class FixedDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) { super(now.getTime()); return; }
          // eslint-disable-next-line constructor-super
          super(...args);
        }
        static now() { return new RealDate(now).getTime(); }
      }
      window.Date = FixedDate;

      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get() { return clientWidth; },
      });

      window.fetch = fetchImpl || (() => Promise.reject(new Error(
        'fetch вимкнено в тесті: передай fetchImpl у mountTracker(), якщо тест перевіряє синхронізацію'
      )));
    },
  });

  return dom;
}

/** Чекає кілька мікро/макро-тіків — досить, щоб await-ланцюжки (load(), saveWeek()) розсмокталися. */
async function flush(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function readLocal(dom, key) {
  const raw = dom.window.localStorage.getItem('tracker:' + key);
  return raw ? JSON.parse(raw) : null;
}

module.exports = { mountTracker, flush, readLocal };
