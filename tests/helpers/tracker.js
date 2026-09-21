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
 * @param {boolean} [opts.reducedMotion] - що поверне matchMedia('(prefers-reduced-motion: reduce)').
 * @param {boolean} [opts.fakeTime] - підмінити requestAnimationFrame / setTimeout /
 *   performance.now керованим годинником (dom.clock.advance(ms)). Потрібно тестам
 *   конфеті й тосту: інакше довелось би чекати справжні 2–3 секунди.
 * @returns {JSDOM} з додатковими полями: dom.clock (лише при fakeTime) і
 *   dom.canvasLog — { created: скільки разів запитано 2d-контекст, contexts: [ctx…] }.
 */
function mountTracker({
  now = new Date(2026, 6, 27, 12, 0, 0), // понеділок 12:00, перший тиждень (START = 27.07.2026)
  seed = {},
  reducedMotion = false,
  fakeTime = false,
  weburl = '',
  fetchImpl = null,
  clientWidth = 600,
} = {}) {
  const html = '<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>';

  const canvasLog = { created: 0, contexts: [] };
  const clock = fakeTime ? createClock() : null;

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

      // jsdom не має matchMedia. Тест сам вирішує, чи "користувач попросив
      // менше руху"; решта запитів (не reduced-motion) — завжди false.
      window.matchMedia = (query) => ({
        matches: reducedMotion && /prefers-reduced-motion:\s*reduce/.test(query),
        media: query,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      });

      // jsdom без пакета canvas не малює (getContext → null + шум у консолі).
      // Мок-контекст лише РЕЄСТРУЄ виклики: ctx.log.frame — fillRect поточного
      // кадру (px/py — позиція шматочка) (обнуляється на clearRect), ctx.log.frames — скільки кадрів
      // намальовано. Так тест бачить і кількість шматочків, і що анімація йде.
      window.HTMLCanvasElement.prototype.getContext = function (type) {
        if (type !== '2d') return null;
        canvasLog.created++;
        const log = { frame: [], frames: 0 };
        const ctx = {
          log, canvas: this, globalAlpha: 1, fillStyle: '', tx: 0, ty: 0,
          setTransform() {}, save() {}, restore() {}, rotate() {},
          // Шматочок малюється як translate(позиція) + fillRect(-w/2, -h/2, w, h),
          // тож світову позицію (px, py) беремо з останнього translate.
          translate(x, y) { ctx.tx = x; ctx.ty = y; },
          clearRect() { log.frames++; log.frame = []; },
          fillRect(x, y, w, h) { log.frame.push({ px: ctx.tx, py: ctx.ty, w, h, alpha: ctx.globalAlpha, color: ctx.fillStyle }); },
        };
        canvasLog.contexts.push(ctx);
        return ctx;
      };

      if (clock) clock.install(window);

      window.fetch = fetchImpl || (() => Promise.reject(new Error(
        'fetch вимкнено в тесті: передай fetchImpl у mountTracker(), якщо тест перевіряє синхронізацію'
      )));
    },
  });

  dom.canvasLog = canvasLog;
  dom.clock = clock;
  return dom;
}

/**
 * Керований годинник для тестів анімацій. Підміняє те, чим користується
 * застосунок: requestAnimationFrame, setTimeout/clearTimeout, performance.now.
 * clock.advance(ms, step) рухає час кроками по step мс (типово 16 — кадри 60 Гц): на кожному кроці
 * спершу спрацьовують таймери, що настали, потім кадри анімації.
 */
function createClock() {
  const clock = { now: 1000, timers: [], frames: [], nextId: 1 };
  clock.install = (window) => {
    window.setTimeout = (fn, ms = 0) => {
      const id = clock.nextId++;
      clock.timers.push({ id, at: clock.now + Math.max(0, ms), fn });
      return id;
    };
    window.clearTimeout = (id) => { clock.timers = clock.timers.filter((t) => t.id !== id); };
    window.requestAnimationFrame = (fn) => { const id = clock.nextId++; clock.frames.push({ id, fn }); return id; };
    window.cancelAnimationFrame = (id) => { clock.frames = clock.frames.filter((f) => f.id !== id); };
    Object.defineProperty(window, 'performance', { value: { now: () => clock.now }, configurable: true });
  };
  // step — довжина кадру в мс: 16 ≈ 60 Гц (типово), 8 ≈ 120 Гц.
  clock.advance = (ms, step = 16) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now = Math.min(clock.now + step, end);
      const due = clock.timers.filter((t) => t.at <= clock.now).sort((a, b) => a.at - b.at);
      clock.timers = clock.timers.filter((t) => t.at > clock.now);
      due.forEach((t) => t.fn());
      const frames = clock.frames;
      clock.frames = [];
      frames.forEach((f) => f.fn(clock.now));
    }
  };
  return clock;
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
