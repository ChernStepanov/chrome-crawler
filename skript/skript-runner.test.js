'use strict';
/* Тесты skript-runner.js (этап 6). Страничная часть (skriptPageSide) исполняется в vm
 * ТАК ЖЕ, как в странице: мост __crawlerBridge ведёт в настоящий раннер, моком остаётся
 * только CDP (evaluate/compile/binding) и физический ввод. Запуск: node skript-runner.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lib = vm.createContext({ console, URL, setTimeout, clearTimeout, setInterval, clearInterval });
for (const f of ['skript-policy.js', 'skript-contract.js', 'skript-runner.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), lib, { filename: f });
}
// Таймеры панели тоже строгие: раннер по умолчанию берёт их отсюда (живой баг: "Illegal invocation" в write_script).
Object.assign(lib, strictTimers(vm.runInContext('globalThis', lib)));
const Runner = vm.runInContext('SkriptRunner', lib);
const Contract = vm.runInContext('SkriptContract', lib);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Строгие таймеры: в Chrome setTimeout/clearInterval и т.п. (WindowOrWorkerGlobalScope) требуют,
// чтобы this был самим глобальным объектом; оторванная ссылка (const f = window.setTimeout) кидает
// ровно "Illegal invocation". Node так не делает, поэтому обычный мок такой регресс не ловит.
// target — внутренний globalThis контекста (vm.runInContext('globalThis', page)), а не внешняя
// ссылка page: Node оборачивает контекст в прокси, снаружи и изнутри это разные объекты (!==).
function strictTimers(target) {
  const real = { setTimeout, clearTimeout, setInterval, clearInterval };
  const out = {};
  for (const name of Object.keys(real)) {
    out[name] = function (...a) {
      if (this !== target) throw new TypeError('Illegal invocation');
      return real[name](...a);
    };
  }
  return out;
}

// «Страница»: отдельный vm-контекст со своими globalThis, таймерами и мостом.
function makePage(opt = {}) {
  const calls = [];
  const input = { keys: [], clicks: [], moves: [], drags: [] };
  const state = { enabled: false, runner: null, dropHb: false, bridgeType: 'function', bindingAdded: false };
  const page = vm.createContext({ console, performance, atob });
  Object.assign(page, strictTimers(vm.runInContext('globalThis', page)));
  Object.assign(page, {
    __crawlerBridge: (payload) => {
      if (!state.enabled || (state.dropHb && /"t":"hb"/.test(payload))) return; // события моста приходят только при Runtime.enable
      state.runner && state.runner._onBinding(payload);
    }
  });
  const cdp = async (method, params) => {
    calls.push(method);
    if (method === 'Runtime.enable') { state.enabled = true; return {}; }
    if (method === 'Runtime.removeBinding') return {};
    if (method === 'Runtime.addBinding') { state.bindingAdded = true; return {}; }
    if (method === 'Runtime.compileScript') {
      if (!state.enabled) throw new Error('Runtime agent is not enabled'); // как в настоящем Chrome
      try { new vm.Script(params.expression); return {}; }
      catch (e) { return { exceptionDetails: { text: 'Uncaught', exception: { description: `${e.name}: ${e.message}` } } }; }
    }
    if (method === 'Runtime.evaluate') {
      if (/^typeof globalThis\.__crawlerBridge/.test(params.expression)) return { result: { value: state.bridgeType } };
      try { vm.runInContext(params.expression, page); return { result: {} }; }
      catch (e) { return { exceptionDetails: { text: 'Uncaught', exception: { description: `${e.name}: ${e.message}` } } }; }
    }
    return {};
  };
  const runner = Runner.create({
    cdp,
    input: {
      key: async (n, h) => { input.keys.push([n, h]); },
      click: async (x, y) => { input.clicks.push([x, y]); },
      move: async (x, y) => { input.moves.push([x, y]); },
      drag: async (...a) => { input.drags.push(a); }
    },
    ...(opt.capture ? { capture: opt.capture } : {}),
    limits: { heartbeatMs: 20, heartbeatTimeoutMs: 120, reportEveryMs: 10, ...(opt.limits || {}) }
  });
  state.runner = runner;
  return { runner, page, input, calls, state, G: (expr) => vm.runInContext(expr, page) };
}

(async () => {
  // ---- 1. Обёртка реализует весь контракт ----
  {
    const { runner } = makePage();
    const r = await runner.run({ code: 'return Object.keys(__crawler);', approved: true, permissions: ['read'] });
    assert.equal(r.reason, 'done');
    for (const a of Contract.API) assert.ok(r.result.includes(a.name), `обёртка реализует ${a.name}`);
    assert.equal(r.result.length, Contract.API.length, 'в обёртке нет лишнего вне контракта');
  }

  // ---- 2. Нормальный цикл: клавиши, report, done ----
  {
    const { runner, input, G } = makePage();
    const r = await runner.run({
      approved: true, permissions: ['read', 'input'], args: { max: 5 },
      code: `let n = 0; const stop = __crawler.loop(() => { n++; __crawler.key("ArrowUp"); __crawler.report({ n, nested: { a: 1 }, s: "x" });
             if (n >= args.max) { __crawler.done({ n }); } }, { fps: 60 });`
    });
    assert.equal(r.reason, 'done'); assert.equal(r.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(r.result)), { n: 5 });
    assert.equal(input.keys.length, 5, 'ровно 5 нажатий дошли до ввода');
    assert.deepEqual(JSON.parse(JSON.stringify(input.keys[0])), ['ArrowUp', 0]);
    assert.equal(r.actions, 5);
    assert.deepEqual(JSON.parse(JSON.stringify(r.lastReport)), { n: 5, s: 'x' }, 'report сплющен: вложенные объекты отброшены');
    assert.equal(r.metrics.n.max, 5);
    assert.equal(G('typeof globalThis.__crawlerStop'), 'undefined', 'после остановки обработчик стопа удалён');
  }

  // ---- 3. Стоп: быстро, цикл гаснет ----
  {
    const { runner, G } = makePage();
    G('globalThis.ticks = 0');
    const p = runner.run({ approved: true, permissions: ['read'], code: 'return void __crawler.loop(() => { globalThis.ticks++; }, { fps: 100 });' });
    await sleep(120);
    const before = G('ticks');
    assert.ok(before > 3, 'цикл работает: ' + before);
    const t0 = Date.now();
    const s = await runner.stop('manual');
    const ms = Date.now() - t0;
    assert.ok(s.stopped && ms < 200, `стоп быстрее 200 мс (${ms})`);
    const r = await p;
    assert.equal(r.reason, 'manual'); assert.equal(r.ok, false);
    const after = G('ticks');
    await sleep(100);
    assert.equal(G('ticks'), after, 'после стопа тики не растут');
    assert.equal((await runner.stop('manual')).stopped, false, 'повторный стоп безвреден');
  }

  // ---- 4. Лимит ввода ----
  {
    const { runner, input } = makePage({ limits: { actionsPerSecond: 5 } });
    const p = runner.run({ approved: true, permissions: ['read', 'input'], maxMs: 300, code: 'return void __crawler.loop(() => { __crawler.key("a"); }, { fps: 120 });' });
    const r = await p;
    assert.ok(input.keys.length <= 5, 'не больше лимита дошло до ввода: ' + input.keys.length);
    assert.ok(r.dropped > 0, 'лишнее отброшено и посчитано');
    assert.ok(r.errors.some((e) => /Лимит ввода/.test(e)));
  }

  // ---- 5. Права: ввод без разрешения блокируется ----
  {
    const { runner, input } = makePage();
    const r = await runner.run({ approved: true, permissions: ['read'], maxMs: 150, code: '__crawler.key("a"); __crawler.click(1, 2); return void __crawler.loop(() => {}, { fps: 10 });' });
    assert.equal(input.keys.length + input.clicks.length, 0, 'ввод не прошёл');
    assert.ok(r.errors.some((e) => /Blocked/.test(e)) && r.dropped === 2);
  }

  // ---- 6. Подделка сообщений: чужой nonce игнорируется ----
  {
    const { runner, input } = makePage();
    const p = runner.run({ approved: true, permissions: ['read', 'input'], maxMs: 150, code: 'return void __crawler.loop(() => {}, { fps: 10 });' });
    await sleep(30);
    await runner._onBinding(JSON.stringify({ t: 'key', name: 'x', n: 'forged' }));
    await runner._onBinding(JSON.stringify({ t: 'key', name: 'x' }));
    await runner._onBinding('не json');
    await p;
    assert.equal(input.keys.length, 0, 'поддельные сообщения не создают ввод');
  }

  // ---- 7. Пробный прогон ----
  {
    const { runner, input } = makePage();
    const r = await runner.run({ dryRun: true, maxMs: 120, permissions: ['read'], code: 'return void __crawler.loop(() => { __crawler.key("a"); }, { fps: 100 });' });
    assert.equal(r.reason, 'dry-end'); assert.equal(r.ok, true);
    assert.equal(input.keys.length, 0, 'при dryRun события не отправляются');
    assert.ok(r.dryActions > 0, 'действия посчитаны');
  }

  // ---- 7б. Сохранённое состояние: __crawler.saved — только ключи из пробы; __crawler.dry в пробном прогоне ----
  {
    const { runner, page } = makePage();
    const store = { gameState: JSON.stringify({ grid: [[2, 0], [0, 4]], score: 36 }), token: 'секрет', bestScore: '512' };
    page.localStorage = { getItem: (k) => (k in store ? store[k] : null) };
    const code = 'return { s: __crawler.saved("gameState"), best: __crawler.saved("bestScore"), t: __crawler.saved("token"), dry: __crawler.dry };';
    const r = await runner.run({ code, approved: true, savedKeys: ['gameState', 'bestScore'] });
    const v = JSON.parse(JSON.stringify(r.result));
    assert.deepEqual(v.s, { grid: [[2, 0], [0, 4]], score: 36 }, 'разрешённый ключ — разобранный JSON');
    assert.equal(v.best, 512);
    assert.equal(v.t, null, 'ключ не из пробы (токен) — не читается');
    assert.equal(v.dry, false);
    const d = await runner.run({ code, dryRun: true, maxMs: 300, permissions: ['read'], savedKeys: ['gameState'] });
    assert.equal(JSON.parse(JSON.stringify(d.result)).dry, true, 'в пробном прогоне скрипт знает, что ввода нет');
  }

  // ---- 8. Первый запуск без одобрения ----
  {
    const { runner, calls } = makePage();
    const r = await runner.run({ code: 'return 1' });
    assert.equal(r.reason, 'not-approved');
    assert.equal(calls.length, 0, 'без одобрения к странице никто не обращался');
  }

  // ---- 9. Синтаксис и исключения ----
  {
    const { runner } = makePage();
    const c = await runner.check('const = ;');
    assert.equal(c.ok, false); assert.match(c.error, /SyntaxError/);
    assert.equal((await runner.check('return 1')).ok, true);
    const r = await runner.run({ approved: true, code: 'const = ;' });
    assert.equal(r.reason, 'syntax');
    const r2 = await runner.run({ approved: true, code: 'throw new Error("бум")' });
    assert.equal(r2.reason, 'error'); assert.ok(r2.errors.some((e) => /бум/.test(e)));
    assert.ok(r2.errors.some((e) => /\n.*at /.test(e)), 'при синхронном сбое видна часть стека, не только первая строка');
    const r3 = await runner.run({ approved: true, permissions: ['read'], code: 'return void __crawler.loop(() => { throw new Error("tick"); }, { fps: 120 });' });
    assert.equal(r3.reason, 'error', '5 ошибок подряд в цикле останавливают скрипт');
    assert.ok(r3.errors.some((e) => /\n.*at /.test(e)), 'сбой внутри __crawler.loop тоже приходит со стеком');
  }

  // ---- 9б. check() сам включает Runtime (регресс: «Runtime agent is not enabled») ----
  {
    const { runner } = makePage();
    assert.equal((await runner.check('return 1')).ok, true, 'check работает на свежем раннере без предварительного run');
  }

  // ---- 10. Heartbeat и watchdog ----
  {
    const { runner, state } = makePage();
    state.dropHb = true;
    const r = await runner.run({ approved: true, permissions: ['read'], code: 'return void __crawler.loop(() => {}, { fps: 10 });' });
    assert.equal(r.reason, 'heartbeat', 'нет heartbeat → стоп');
    const b = makePage();
    const r2 = await b.runner.run({ approved: true, permissions: ['read'], maxMs: 100, code: 'return void __crawler.loop(() => {}, { fps: 10 });' });
    assert.equal(r2.reason, 'max-time');
  }

  // ---- 11. Тело завершилось, цикл жив → работаем до done/отмены цикла ----
  {
    const { runner } = makePage();
    const r = await runner.run({ approved: true, permissions: ['read'], code: 'let c = 0; const cancel = __crawler.loop(() => { if (++c === 3) cancel(); }, { fps: 100 }); return "итог";' });
    assert.equal(r.reason, 'done'); assert.equal(r.result, 'итог', 'результат тела отдан после отмены последнего цикла');
  }

  // ---- 12. Результат ограничен по размеру, wait возвращается при стопе ----
  {
    const { runner } = makePage();
    const r = await runner.run({ approved: true, code: 'return "x".repeat(100000);' });
    assert.ok(r.result && typeof r.result.clipped === 'string' && r.result.clipped.length <= 4100, 'большой результат обрезан');
    const b = makePage();
    const p = b.runner.run({ approved: true, code: 'await __crawler.wait(60000); return 1;' });
    await sleep(60);
    const t0 = Date.now();
    await b.runner.stop('manual');
    assert.ok(Date.now() - t0 < 200);
    assert.equal((await p).reason, 'manual');
  }

  // ---- 13. Смена origin и недоступный мост ----
  {
    const { runner } = makePage();
    const p = runner.run({ approved: true, permissions: ['read'], expectedOrigin: 'https://a.com', code: 'return void __crawler.loop(() => {}, { fps: 10 });' });
    await sleep(40);
    assert.equal(runner.checkOrigin('https://a.com/other'), false);
    assert.equal(runner.checkOrigin('https://evil.com/'), true);
    assert.equal((await p).reason, 'origin-changed');
    const b = makePage();
    b.state.bridgeType = 'undefined';
    assert.equal((await b.runner.run({ approved: true, code: 'return 1' })).reason, 'bridge-unavailable');
  }

  // ---- 13a. «Тормозит»: код держит главный поток страницы → стоп с причиной slow и цифрами ----
  {
    const busyCode = 'const c = __crawler.loop(() => { const t = Date.now(); while (Date.now() - t < 60) {} }, { fps: 60 });';
    const { runner } = makePage({ limits: { lagProbeMs: 10, heartbeatMs: 50, heartbeatTimeoutMs: 2000, slowWindows: 2 } });
    const t0 = Date.now();
    const r = await runner.run({ approved: true, permissions: ['read'], code: busyCode });
    assert.equal(r.reason, 'slow', 'занятая страница → slow, а не ожидание до лимита времени');
    assert.ok(Date.now() - t0 < 1500, 'остановлен быстро');
    assert.ok(r.pageBusyPercent >= 60, 'в сводке доля занятости: ' + r.pageBusyPercent);
    assert.ok(r.longestFreezeMs >= 30, 'в сводке самая долгая заморозка: ' + r.longestFreezeMs);

    // Фоновая вкладка: Chrome сам замедляет таймеры — это не повод останавливать.
    const bg = makePage({ limits: { lagProbeMs: 10, heartbeatMs: 50, heartbeatTimeoutMs: 2000, slowWindows: 2 } });
    bg.G('globalThis.document = { hidden: true }');
    const p = bg.runner.run({ approved: true, permissions: ['read'], code: busyCode });
    await sleep(700);
    await bg.runner.stop('manual');
    assert.equal((await p).reason, 'manual', 'в скрытой вкладке slow не срабатывает');

    // Лёгкий цикл не трогается.
    const ok = makePage({ limits: { lagProbeMs: 10, heartbeatMs: 50, heartbeatTimeoutMs: 2000, slowWindows: 2 } });
    const p2 = ok.runner.run({ approved: true, permissions: ['read'], code: 'const c = __crawler.loop(() => {}, { fps: 30 });' });
    await sleep(500);
    await ok.runner.stop('manual');
    assert.equal((await p2).reason, 'manual', 'быстрый цикл не считается тормозящим');
  }

  // ---- 13b. «Перестал действовать»: нажимал и замолчал, цикл крутится → stalled ----
  {
    const { runner, input } = makePage({ limits: { stallMs: 200, heartbeatTimeoutMs: 2000 } });
    const r = await runner.run({ approved: true, permissions: ['read', 'input'],
      code: 'let k = 0; const c = __crawler.loop(() => { if (k++ < 2) __crawler.key("ArrowUp"); }, { fps: 30 });' });
    assert.equal(r.reason, 'stalled');
    assert.equal(input.keys.length, 2);
    assert.ok(r.secondsSinceLastAction >= 0.2, 'в сводке пауза после последнего действия');
    // Только чтение (без ввода) — не «перестал действовать».
    const ro = makePage({ limits: { stallMs: 100, heartbeatTimeoutMs: 2000 } });
    const p = ro.runner.run({ approved: true, permissions: ['read'], code: 'const c = __crawler.loop(() => {}, { fps: 30 });' });
    await sleep(400);
    await ro.runner.stop('manual');
    assert.equal((await p).reason, 'manual');
  }

  const plain = (v) => JSON.parse(JSON.stringify(v)); // значения из другого vm-контекста
  // ---- 15. pixels(): снимок экрана для холстов, которые страница сама не читает (живой прогон: 2048 на OffscreenCanvas) ----
  {
    // 2×2: красный, зелёный / синий, белый
    const b64 = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]).toString('base64');
    const shots = [];
    const { runner, G } = makePage({ capture: async (rect, size, smooth) => { shots.push({ rect, size, smooth }); return { w: 2, h: 2, b64 }; } });
    G('globalThis.scrollX = 10; globalThis.scrollY = 100;');
    const s = await runner.run({ approved: true, code: `
      const img = await __crawler.pixels(0, 0, 20, 20, { size: 2 });
      __crawler.done({ w: img.width, h: img.height, len: img.data.length, tl: img.at(1, 1), tr: img.at(15, 2), bl: img.at(3, 18), br: img.at(19, 19), out: img.at(99, -5),
        p00: img.px(0, 0), p10: img.px(1, 0), p11: img.px(1, 1), pOut: img.px(2, 0) });` });
    assert.equal(s.reason, 'done', JSON.stringify(s.errors));
    assert.deepEqual(plain(s.result), { w: 2, h: 2, len: 16, tl: [255, 0, 0], tr: [0, 255, 0], bl: [0, 0, 255], br: [255, 255, 255], out: [0, 255, 0],
      p00: [255, 0, 0], p10: [0, 255, 0], p11: [255, 255, 255], pOut: null }, 'px — координаты картинки, at — экрана');
    assert.deepEqual(plain(shots), [{ rect: { x: 10, y: 100, w: 20, h: 20 }, size: 2, smooth: true }], 'координаты страницы = вьюпорт + прокрутка');
    assert.equal(s.pixelCaptures, 1);
    assert.equal(G('typeof globalThis.__crawlerPix'), 'undefined', 'после стопа приёмник убран');
  }
  {
    // размер по умолчанию = размер области, но не больше 256; smooth:false доходит до панели
    const shots = [];
    const { runner } = makePage({ capture: async (rect, size, smooth) => { shots.push([size, smooth]); return null; } });
    const s = await runner.run({ approved: true, code: `const a = await __crawler.pixels(0, 0, 40, 30, { smooth: false }); const b = await __crawler.pixels(0, 0, 900, 500); __crawler.done({ a, b });` });
    assert.deepEqual(plain(shots), [[40, false], [256, true]]);
    assert.deepEqual(plain(s.result), { a: null, b: null }, 'пустой снимок — null, скрипт не ждёт таймаута');
  }
  {
    // сбой снимка — null и понятная ошибка; без capture — тоже null
    const { runner } = makePage({ capture: async () => { throw new Error('Not attached'); } });
    const s = await runner.run({ approved: true, code: `__crawler.done({ img: await __crawler.pixels(0, 0, 5, 5) });` });
    assert.deepEqual(plain(s.result), { img: null });
    assert.ok(s.errors.some((e) => /pixels: Not attached/.test(e)), s.errors.join('|'));
    const r2 = await makePage().runner.run({ approved: true, code: `__crawler.done({ img: await __crawler.pixels(0, 0, 5, 5) });` });
    assert.deepEqual(plain(r2.result), { img: null });
    // неверные аргументы — сразу null, без снимка
    let n = 0;
    const r3 = await makePage({ capture: async () => { n++; return null; } }).runner.run({ approved: true, code: `__crawler.done({ a: await __crawler.pixels(0, 0, 0, 5), b: await __crawler.pixels('x', 0, 5, 5) });` });
    assert.deepEqual(plain(r3.result), { a: null, b: null });
    assert.equal(n, 0);
  }
  {
    // лимит снимков в секунду: лишние сразу null
    let n = 0;
    const { runner } = makePage({ capture: async () => { n++; return null; }, limits: { pixelsPerSecond: 2 } });
    const s = await runner.run({ approved: true, code: `for (let i = 0; i < 4; i++) await __crawler.pixels(0, 0, 5, 5); __crawler.done(1);` });
    assert.equal(n, 2);
    assert.ok(s.errors.some((e) => /лимит 2 снимков/.test(e)));
  }
  {
    // чужой код страницы не может подсунуть картинку без nonce
    const b64 = Buffer.from([1, 2, 3, 255]).toString('base64');
    const { runner } = makePage({ capture: async () => { await sleep(30); return { w: 1, h: 1, b64 }; } });
    const s = await runner.run({ approved: true, code: `
      const p = __crawler.pixels(0, 0, 4, 4);
      globalThis.__crawlerPix('fake', 1, { w: 9, h: 9, b64: 'AAAAAA==' });
      const img = await p; __crawler.done({ w: img.width, px: img.at(0, 0) });` });
    assert.deepEqual(plain(s.result), { w: 1, px: [1, 2, 3] });
  }
  {
    // стоп во время ожидания снимка: pixels отдаёт null, скрипт не висит
    const { runner } = makePage({ capture: () => new Promise(() => {}) });
    const p = runner.run({ approved: true, code: `const img = await __crawler.pixels(0, 0, 5, 5); __crawler.log('after ' + img); await __crawler.wait(5000);` });
    await sleep(40);
    const st = await runner.stop('manual');
    assert.equal(st.stopped, true);
    assert.equal((await p).reason, 'manual');
  }

  // ---- 15г. grid(): средний цвет клеток, края клеток пропускаются ----
  {
    // 8×4: левая половина красная, правая синяя, по краю — белая рамка в 1 px
    const W = 8, H = 4, px = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      px.push(...(edge ? [255, 255, 255] : x < 4 ? [200, 0, 0] : [0, 0, 200]), 255);
    }
    const b64 = Buffer.from(px).toString('base64');
    const sizes = [];
    const { runner } = makePage({ capture: async (rect, size) => { sizes.push(size); return { w: W, h: H, b64 }; } });
    const s = await runner.run({ approved: true, code: `
      const g = await __crawler.grid(0, 0, 80, 40, 2, 1, { inset: 0.3 });
      const raw = await __crawler.grid(0, 0, 80, 40, 2, 1, { inset: 0 });
      __crawler.done({ cols: g.cols, rows: g.rows, left: g.at(0, 0), right: g.at(1, 0), none: g.at(5, 5), rawLeft: raw.at(0, 0), bad: await __crawler.grid(0, 0, 80, 40, 0, 1) });` });
    assert.equal(s.reason, 'done', JSON.stringify(s.errors));
    assert.deepEqual(plain(s.result), { cols: 2, rows: 1, left: [200, 0, 0], right: [0, 0, 200], none: null, rawLeft: [234, 159, 159], bad: null });
    assert.deepEqual(sizes, [16, 16], 'размер снимка по числу клеток');
    // та же функция в панели даёт те же числа
    assert.deepEqual(plain(Runner.gridColors(Buffer.from(px), W, H, 2, 1, 0.3)), [[[200, 0, 0], [0, 0, 200]]]);
  }

  // ---- 15б. Скрипт закончился раньше ответа evaluate: сторож и heartbeat не заводятся после стопа ----
  {
    const { runner } = makePage();
    const s = await runner.run({ approved: true, code: `__crawler.done(await Promise.resolve(7));` });
    assert.equal(s.reason, 'done');
    assert.equal(runner._watchdog, null, 'сторож не висит после остановки');
    assert.equal(runner._hb, null, 'heartbeat не висит после остановки');
  }

  // ---- 15в. Скрипт, сохранённый до переименования (__clodex), работает и получает права на ввод ----
  {
    const { runner, input } = makePage();
    const code = '__clodex.key("ArrowUp"); __clodex.done({ old: true });';
    assert.deepEqual([...vm.runInContext('SkriptContract', lib).declaredPermissions(code)], ['read', 'input']);
    const s = await runner.run({ approved: true, permissions: ['read', 'input'], code });
    assert.equal(s.reason, 'done', JSON.stringify(s.errors));
    assert.equal(input.keys.length, 1);
  }

  // ---- 14. Текст ошибок и причин ----
  for (const r of ['done', 'manual', 'max-time', 'heartbeat', 'error', 'origin-changed', 'syntax', 'slow', 'stalled']) assert.ok(Runner.REASONS[r], 'описание причины ' + r);

  console.log('skript-runner.test.js: OK');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
