'use strict';
/* Тест склейки skript-run.js: write_script → пробный прогон → карточка → решение человека →
 * запуск → сводка для модели. Страница — vm, DOM — минимальная заглушка. Запуск: node skript-run.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeEl {
  constructor(tag) { this.tag = tag; this.children = []; this._text = ''; this.dataset = {}; this.hidden = false; this.className = ''; this.listeners = {}; }
  append(...n) { for (const c of n) if (c && typeof c === 'object') c.parent = this; this.children.push(...n); }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); this.parent = null; } }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener() {}
  setAttribute(k, v) { this[k] = v; }
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const r = c.find && c.find(pred); if (r) return r; } return null; }
  get scrollHeight() { return 0; }
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Строгие таймеры: Chrome требует правильный this у setTimeout/clearInterval (WindowOrWorkerGlobalScope),
// оторванная ссылка кидает "Illegal invocation"; Node так не делает (см. skript-runner.test.js).
function strictTimers(target) {
  const real = { setTimeout, clearTimeout, setInterval, clearInterval };
  const out = {};
  for (const name of Object.keys(real)) out[name] = function (...a) { if (this !== target) throw new TypeError('Illegal invocation'); return real[name](...a); };
  return out;
}

function setup({ grants = { act: true } } = {}) {
  const pageCtx = vm.createContext({ console, performance, atob });
  Object.assign(pageCtx, strictTimers(vm.runInContext('globalThis', pageCtx)));
  let enabled = false;
  const input = { keys: [] };
  const listeners = { debugger: [] };
  let runnerRef = null;
  pageCtx.__crawlerBridge = (p) => { if (!enabled) return; for (const l of listeners.debugger) l({ tabId: 7 }, 'Runtime.bindingCalled', { name: '__crawlerBridge', payload: p }); };
  const cdp = async (tab, method, params) => {
    if (method === 'Runtime.enable') { enabled = true; return {}; }
    if (method === 'Runtime.compileScript') {
      if (!enabled) throw new Error('Runtime agent is not enabled'); // как в настоящем Chrome
      try { new vm.Script(params.expression); return {}; } catch (e) { return { exceptionDetails: { exception: { description: `${e.name}: ${e.message}` } } }; }
    }
    if (method === 'Runtime.evaluate') {
      if (/^typeof globalThis\.__crawlerBridge/.test(params.expression)) return { result: { value: 'function' } };
      if (/crawler-goal|crawler-rect|scrollY/.test(params.expression)) return { result: { value: vm.runInContext(params.expression, pageCtx) } };
      try { vm.runInContext(params.expression, pageCtx); return { result: {} }; }
      catch (e) { return { exceptionDetails: { exception: { description: `${e.name}: ${e.message}` } } }; }
    }
    return {};
  };
  const flags = { busy: false, released: 0, saved: 0, url: 'https://game.example/play' };
  const mem = {};
  const ctx = vm.createContext({
    console, URL, atob, setTimeout, clearTimeout, setInterval, clearInterval, window: { addEventListener() {} },
    TextEncoder, crypto: { subtle: require('node:crypto').webcrypto.subtle },
    __mem: { get: async (d) => ({ ...d, ...JSON.parse(JSON.stringify(mem)) }), set: async (o) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); } },
    document: { createElement: (t) => new FakeEl(t) },
    chrome: { debugger: { onEvent: { addListener: (f) => listeners.debugger.push(f) } }, tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } } }
  });
  for (const f of ['skript-policy.js', 'skript-access.js', 'skript-contract.js', 'skript-eval.js', 'skript-tools.js', 'skript-runner.js', 'skript-card.js', 'skript-mode.js', 'skript-run.js', 'skript-store.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('SkriptStore.storage = __mem', ctx);
  // грант act: подменяем состояние режима
  vm.runInContext(`SkriptMode.__g = ${JSON.stringify(grants)}; Object.defineProperty(SkriptMode, 'grants', { get() { return SkriptMode.__g; } });`, ctx);
  const container = new FakeEl('div');
  const ac = new AbortController();
  const R = vm.runInContext('SkriptRun', ctx);
  R.__ctxLimits = vm.runInContext('SkriptRunner.LIMITS', ctx); // лимиты раннера этого контекста (для коротких тестов)
  R.init({
    cdp, parseKey: (n) => ({ key: n, code: n, vk: 1, mod: 0 }), pressKey: async (tab, n) => { input.keys.push(n); if (n === 'Space' && flags.spaceScrolls) pageCtx.scrollY = (pageCtx.scrollY || 0) + 600; },
    mouseClick: async () => {}, mouseDrag: async () => {}, sleep, tabUrl: async () => flags.url,
    fail: (text) => ({ text, error: true }), container, signal: () => ac.signal,
    busy: () => flags.busy, activeTabId: async () => 7, onSaved: () => { flags.saved++; },
    release: async () => { flags.released++; },
    onScript: (on) => { (flags.scriptEvents = flags.scriptEvents || []).push(on); },
    onAsk: (on, d) => { (flags.askEvents = flags.askEvents || []).push(on ? 'ждёт' : 'решено:' + d); },
    capture: (...a) => (flags.capture ? flags.capture(...a) : null),
    repair: (text) => { flags.repairText = text; }
  });
  R.begin();
  const clickBtn = (label) => { const b = container.find((e) => e.tag === 'button' && e.textContent === label); assert.ok(b, 'кнопка ' + label); b.onclick(); };
  return { R, container, input, ac, clickBtn, flags, pageCtx, Store: vm.runInContext('SkriptStore', ctx), st: { tabId: 7 } };
}

(async () => {
  const code = `let n = 0; const c = __crawler.loop(() => { n++; __crawler.key("ArrowLeft"); __crawler.report({ score: n * 10 }); if (n >= 4) __crawler.done({ n }); }, { fps: 60 });`;

  // ---- 1. Полный поток: карточка, одобрение, запуск, сводка ----
  {
    const { R, container, input, clickBtn, flags, st } = setup();
    assert.deepEqual(JSON.parse(JSON.stringify(R.tools().map((t) => t.function.name))), ['write_script', 'patch_script', 'screenshot_region', 'run_script', 'stop_script', 'get_telemetry']);
    const p = R.handle('write_script', { title: 'Играть', description: 'играет', code }, st);
    await sleep(1600); // пробный прогон ≤ 1.2 с
    const card = container.children[0];
    assert.ok(card, 'карточка показана');
    assert.ok(card.textContent.includes('Играть') && card.textContent.includes('v1') && card.textContent.includes('ввод'), 'в карточке название, версия, права');
    assert.equal(input.keys.length, 0, 'до нажатия «Запустить» ввода нет (пробный прогон не шлёт события)');
    clickBtn('Запустить');
    const res = await p;
    assert.ok(!res.error, res.text);
    assert.match(res.text, /Script d1 v1 ended: Готово/);
    assert.match(res.text, /"score":40/);
    assert.equal(input.keys.length, 4, 'после одобрения нажато 4 раза');
    assert.equal(card.dataset.state, 'ok');
    assert.deepEqual(flags.scriptEvents, [true, false], 'панель знает, когда скрипт работает (щупальца уходят и возвращаются)');
    assert.deepEqual(flags.askEvents, ['ждёт', 'решено:run'], 'пока карточка ждёт «Запустить», панель показывает ожидание человека, а не «думает»');
    // run_script: версия одобрена → без вопроса
    const again = await R.handle('run_script', {}, st);
    assert.match(again.text, /ended: Готово/);
    assert.equal(input.keys.length, 8, 'повторный запуск одобренной версии без вопроса');
    assert.match((await R.handle('get_telemetry', {}, st)).text, /"reason":"done"/);
  }

  // ---- 2. Отклонение человеком ----
  {
    const { R, container, input, clickBtn, st } = setup();
    const p = R.handle('write_script', { title: 'x', code }, st);
    await sleep(1600);
    clickBtn('Отклонить');
    const res = await p;
    assert.match(res.text, /rejected/);
    assert.equal(input.keys.length, 0);
    assert.equal(container.children[0].dataset.state, 'fail');
  }

  // ---- 3. Отказы до карточки: политика, синтаксис, права, исключение в пробном прогоне ----
  {
    const { R, container, st } = setup();
    assert.match((await R.handle('write_script', { title: 'x', code: 'fetch("/a")' }, st)).text, /fetch/);
    assert.match((await R.handle('write_script', { title: 'x', code: 'const = ;' }, st)).text, /Syntax error/);
    const thrown = await R.handle('write_script', { title: 'x', code: 'throw new Error("сломано")' }, st);
    assert.ok(thrown.error && /Dry run failed.*сломано/.test(thrown.text), thrown.text);
    assert.equal(container.children.length, 0, 'при отказе карточка не показывается');
    // необъявленная глобальная (живой прогон на dinorunner.com: модель угадала Runner) — подсказка, как проверить
    const undef = await R.handle('write_script', { title: 'x', code: 'const r = Runner.instance_;' }, st);
    assert.match(undef.text, /Runner is not defined/);
    assert.match(undef.text, /typeof Runner !== 'undefined'/, 'подсказка про typeof');
    assert.match(undef.text, /canvas/, 'и куда смотреть, если глобальной нет');
    assert.doesNotMatch(thrown.text, /not a global/, 'у обычного исключения подсказки нет');
    // холст в worker (живой прогон 2048): подсказка про __crawler.pixels
    const off = await R.handle('write_script', { title: 'x', code: `throw new Error("Failed to execute 'getContext' on 'HTMLCanvasElement': Cannot get context from a canvas that has transferred its control to offscreen.")` }, st);
    assert.match(off.text, /__crawler\.pixels\(r\.left, r\.top/, off.text);
    assert.doesNotMatch(thrown.text, /__crawler\.pixels/);
    assert.match((await R.handle('patch_script', { code: 'return 1', id: 'нет' }, st)).text, /no such draft/);
    // проверка кода через CDP не должна падать «Runtime agent is not enabled» (регресс из живого запуска)
  }
  {
    const { R, container, st } = setup({ grants: { act: false } });
    const r = await R.handle('write_script', { title: 'x', code }, st);
    assert.ok(r.error && /Действовать/.test(r.text), 'без гранта act скрипт с вводом не принимается');
    assert.equal(container.children.length, 0);
  }

  // ---- 4. Патч: новая версия снова требует одобрения; остановка задачи во время вопроса ----
  {
    const { R, container, input, clickBtn, ac, st } = setup();
    const p1 = R.handle('write_script', { title: 'x', code }, st);
    await sleep(1600); clickBtn('Запустить'); await p1;
    const p2 = R.handle('patch_script', { code: code.replace('n >= 4', 'n >= 2'), reason: 'короче' }, st);
    await sleep(1600);
    assert.equal(container.children.length, 2, 'после патча новая карточка');
    assert.ok(container.children[1].textContent.includes('v2'));
    ac.abort();
    const r2 = await p2;
    assert.match(r2.text, /stopped/, 'остановка задачи во время вопроса');
    assert.equal(input.keys.length, 4, 'запуска v2 не было');
  }

  // ---- 5. Стоп во время работы ----
  {
    const { R, container, st } = setup();
    const p = R.handle('write_script', { title: 'x', code: 'return void __crawler.loop(() => { __crawler.report({ a: 1 }); }, { fps: 30 });' }, st);
    await sleep(1600);
    const stopBtn0 = container.find((e) => e.tag === 'button' && e.textContent === 'Запустить'); stopBtn0.onclick();
    await sleep(150);
    const t0 = Date.now();
    container.find((e) => e.tag === 'button' && e.textContent === 'Стоп').onclick();
    const res = await p;
    assert.ok(Date.now() - t0 < 300);
    assert.match(res.text, /Остановлено вами/);
    assert.match(res.text, /patch_script/, 'модель получает подсказку, что делать дальше');
  }

  // ---- 5б. «Стоп» задачи, пока скрипт работает (живой баг): задача завершается (end) раньше, чем раннер
  //          дозакрыл карточку — карточка оставалась «работающей»: таймер, кнопка стопа, нет «Запустить снова» ----
  {
    const { R, container, ac, clickBtn, flags, st } = setup();
    const btn = (root, label) => root.find((e) => e.tag === 'button' && e.textContent === label);
    const p = R.handle('write_script', { title: 'Цикл', code: 'const c = __crawler.loop(() => { __crawler.report({ a: 1 }); }, { fps: 30 });' }, st);
    await sleep(1600);
    clickBtn('Запустить');
    await sleep(150);
    ac.abort();                // «Стоп» в панели: задача сразу уходит в finally…
    await R.end();             // …и завершает режим, не дожидаясь раннера
    const res = await p;       // раннер дозакрывает карточку уже после end
    assert.ok(!res.error, res.text);
    const card = container.children[0];
    assert.equal(card.dataset.state, 'stopped', 'карточка закрыта («■ остановлен»), а не «работает»');
    assert.deepEqual(flags.scriptEvents, [true, false], 'и по «Стоп» панель узнаёт, что скрипт остановлен');
    assert.ok(btn(card, 'Запустить снова'), 'можно запустить снова');
  }

  // ---- 5в. «Работает»: задача заканчивается, скрипт играет дальше; «Не работает»: модель улучшает ----
  {
    const { R, container, input, clickBtn, flags, st } = setup();
    const loopCode = 'const c = __crawler.loop(() => { __crawler.key("ArrowLeft"); }, { fps: 20 });';
    const p = R.handle('write_script', { title: 'Игрок', code: loopCode }, st);
    await sleep(1600);
    clickBtn('Запустить');
    await sleep(4600);                                   // показал себя: ≥ 4 с и есть ходы — появились кнопки
    clickBtn('Работает');
    const res = await p;
    assert.equal(res.finished, true, 'задача заканчивается без модели');
    assert.equal(res.success, true);
    assert.match(res.summary, /играет дальше сам/);
    await R.end();                                       // конец задачи не останавливает отпущенный скрипт…
    assert.equal(R.keepTab(), 7, '…и панель не отключит отладчик на его вкладке');
    const n = input.keys.length;
    await sleep(300);
    assert.ok(input.keys.length > n, 'скрипт продолжает играть после конца задачи');
    clickBtn('Стоп');                                    // остановить можно из карточки
    await sleep(100);
    const card = container.children[0];
    assert.equal(card.dataset.state, 'stopped');
    assert.equal(R.keepTab(), null);
    assert.equal(flags.released, 1, 'доиграл — отладчик отпущен');
    assert.ok(container.find((e) => e.tag === 'button' && e.textContent === 'Запустить снова'), 'после — «Запустить снова»');
  }
  {
    const { R, container, clickBtn, st } = setup();
    const p = R.handle('write_script', { title: 'Игрок', code: 'const c = __crawler.loop(() => { __crawler.key("ArrowUp"); }, { fps: 20 });' }, st);
    await sleep(1600);
    clickBtn('Запустить');
    await sleep(4600);
    clickBtn('Не работает');
    const res = await p;
    assert.ok(!res.finished, 'модель думает дальше');
    assert.match(res.text, /Не работает.*Improve it with patch_script/);
    assert.equal(container.children[0].dataset.state, 'fail');
  }

  // ---- 6. После «Стоп» и конца задачи: «Запустить снова» без модели, сохранение, запуск сохранённого ----
  {
    const { R, container, input, clickBtn, flags, Store, st } = setup();
    const btn = (root, label) => root.find((e) => e.tag === 'button' && e.textContent === label);
    const loopCode = 'const c = __crawler.loop(() => { __crawler.key("ArrowUp"); }, { fps: 60 });';
    const p = R.handle('write_script', { title: 'Цикл', description: 'жмёт вверх', code: loopCode }, st);
    await sleep(1600);
    clickBtn('Запустить');
    await sleep(120);
    clickBtn('Стоп');
    assert.match((await p).text, /Остановлено вами/);
    await R.end(); // задача закончилась, черновики стёрты — повтор от них не зависит
    const card = container.children[0];
    assert.ok(btn(card, 'Запустить снова') && btn(card, 'Сохранить для сайта'), 'после остановки есть «Запустить снова» и «Сохранить»');

    const n0 = input.keys.length;
    btn(card, 'Запустить снова').onclick();
    await sleep(120);
    assert.ok(input.keys.length > n0, 'повторный запуск после «Стоп» жмёт клавиши');
    btn(card, 'Стоп').onclick();
    await sleep(60);
    assert.equal(card.dataset.state, 'stopped', 'остановлено вручную — отдельное состояние, не ошибка');
    assert.ok(btn(card, 'Запустить снова'), 'и снова можно запустить');
    assert.ok(flags.released >= 1, 'вне задачи отладчик отпускается');

    flags.busy = true;
    const n1 = input.keys.length;
    btn(card, 'Запустить снова').onclick();
    await sleep(60);
    assert.equal(input.keys.length, n1, 'во время задачи агента запуск человеком не идёт');
    assert.match(card.textContent, /выполняется задача/);
    flags.busy = false;

    btn(card, 'Сохранить для сайта').onclick();
    await sleep(60);
    const all = await Store.list();
    assert.equal(all.length, 1, 'скрипт сохранён');
    assert.equal(all[0].scope.origin, 'https://game.example');
    assert.equal(all[0].kind, 'loop');
    assert.equal(all[0].code, loopCode);
    assert.ok(all[0].permissions.includes('input'));
    assert.ok(btn(card, 'Сохранено'), 'кнопка показывает, что уже сохранено');
    assert.equal(flags.saved, 1, 'панель узнаёт о сохранении (обновить предложение)');

    const n2 = input.keys.length;
    assert.equal(await R.runSaved(all[0].id), null);
    await sleep(120);
    assert.equal(container.children.length, 1, 'сохранённый скрипт запускается в той же карточке (раньше — дубль)');
    assert.match(card.textContent, /×3/, 'третий запуск этой карточки');
    assert.ok(input.keys.length > n2, 'сохранённый скрипт жмёт клавиши');
    btn(card, 'Стоп').onclick();
    await sleep(60);
    assert.equal((await Store.get(all[0].id)).stats.runs, 1, 'запуск учтён в статистике');

    flags.url = 'https://other.example/';
    const n3 = input.keys.length;
    assert.equal(await R.runSaved(all[0].id), null);
    await sleep(60);
    assert.equal(input.keys.length, n3, 'на чужом сайте сохранённый скрипт не запускается');
    assert.match(card.textContent, /не на https:\/\/game\.example/, 'причина отказа — в той же карточке');
    flags.busy = true;
    assert.match(await R.runSaved(all[0].id), /выполняется задача/, 'во время задачи — отказ с причиной');
    assert.match(await R.runSaved('нет'), /выполняется задача|не найден/);
    flags.busy = false;
    assert.match(await R.runSaved('нет'), /не найден/);
  }

  // ---- 7. Скрипт перестал действовать → модели объясняют, что не так ----
  {
    const { R, clickBtn, st } = setup();
    R.__ctxLimits.stallMs = 300; R.__ctxLimits.heartbeatMs = 50;
    const p = R.handle('write_script', { title: 'Два шага', code: 'let k = 0; const c = __crawler.loop(() => { if (k++ < 2) __crawler.key("ArrowUp"); }, { fps: 30 });' }, st);
    await sleep(1600);
    clickBtn('Запустить');
    const res = await p;
    assert.match(res.text, /ended: Скрипт перестал действовать/);
    assert.match(res.text, /pressed 2 times, then nothing for/, 'модель знает, сколько сделано и сколько стоит');
    assert.match(res.text, /re-read the state after each move/, 'и что исправлять');
    assert.match(res.text, /patch_script/);
  }

  // ---- Прокрутка страницы клавишами (живой прогон: Space уводил страницу вниз, игра вставала) ----
  {
    const { R, clickBtn, flags, st } = setup();
    flags.spaceScrolls = true;
    const p = R.handle('write_script', { title: 'Старт', code: '__crawler.key("Space"); __crawler.key("Space"); await __crawler.wait(200); __crawler.done({ ok: 1 });' }, st);
    await sleep(1600);
    clickBtn('Запустить');
    const res = await p;
    assert.match(res.text, /page scrolled from y=0 to y=1200/, res.text);
    assert.match(res.text, /Click the game element first/);
  }
  {
    const { R, clickBtn, st } = setup();
    const p = R.handle('write_script', { title: 'Без прокрутки', code: '__crawler.key("ArrowUp"); await __crawler.wait(200); __crawler.done({ ok: 1 });' }, st);
    await sleep(1600);
    clickBtn('Запустить');
    assert.doesNotMatch((await p).text, /page scrolled/, 'страница не двигалась — без предупреждения');
  }

  // ---- Оценка результата: цель читается со страницы, человек правит цель в карточке, сравнение с лучшим ----
  {
    const { R, container, clickBtn, pageCtx, st } = setup();
    pageCtx.__score = 40;
    const goal = { metric: 'score', target: 100, read: 'globalThis.__score' };
    const p = R.handle('write_script', { title: 'Игра', goal, code: '__crawler.key("ArrowUp"); await __crawler.wait(100); __crawler.report({ score: 9999 }); __crawler.done({});' }, st);
    await sleep(1600);
    const cardEl = container.children[container.children.length - 1];
    const target = cardEl.find((n) => n.tag === 'input');
    assert.ok(target, 'в карточке есть поле цели');
    assert.equal(target.value, '100');
    assert.equal(target.disabled, false, 'до решения цель можно править');
    target.value = '50';
    clickBtn('Запустить');
    const res = await p;
    assert.match(res.text, /The user changed the goal before running: score ≥ 100 → ≥ 50/, res.text);
    assert.match(res.text, /score = 40 \(80% of target 50\), read from the page/, 'страница важнее отчёта скрипта (9999)');
    assert.equal(target.disabled, true, 'после решения поле закрыто');
    assert.match(cardEl.textContent, /score 40 \/ 50/, 'оценка в карточке');
    // повторный запуск: лучше прежнего и цель достигнута
    pageCtx.__score = 60;
    const res2 = await R.handle('run_script', {}, st);
    assert.match(res2.text, /score = 60 \(120% of target 50\)/, res2.text);
    assert.match(res2.text, /TARGET REACHED/);
    assert.match(res2.text, /New best \(previous best 40, d\d v1\)/);
    assert.doesNotMatch(res2.text, /changed the goal/, 'о правке цели сообщаем один раз');
    // небезопасный read отклоняется до карточки
    const bad = await R.handle('write_script', { title: 'x', goal: { metric: 'score', read: 'fetch("/x")' }, code: 'return 1' }, st);
    assert.match(bad.text, /not read-only/);
  }

  // ---- screenshot_region: модель смотрит на область без скрипта ----
  {
    const { R, flags, pageCtx, st } = setup();
    Object.assign(pageCtx, { scrollX: 0, scrollY: 30, innerWidth: 800, innerHeight: 600 });
    pageCtx.document = { querySelector: (s) => (s === 'canvas' ? { getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 200 }) } : null) };
    // 4×4 картинка: верхняя половина бежевая, нижняя серая
    const px = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) px.push(...(y < 2 ? [238, 228, 218] : [205, 193, 180]), 255);
    const shots = [];
    flags.capture = async (rect, size) => { shots.push({ rect, size }); return { w: 4, h: 4, b64: Buffer.from(px).toString('base64') }; };
    const r = await R.handle('screenshot_region', { selector: 'canvas', cols: 2, rows: 2 }, st);
    assert.ok(!r.error, r.text);
    assert.match(r.text, /x=100, y=50, w=200, h=200/);
    assert.match(r.text, /row 0: 238,228,218 \| 238,228,218\nrow 1: 205,193,180 \| 205,193,180/);
    assert.match(r.text, /Distinct colours: 238,228,218 ×2; 205,193,180 ×2/);
    assert.match(r.text, /__crawler\.grid\(r\.left, r\.top, r\.width, r\.height, 2, 2\)/);
    assert.deepEqual(plain(shots), [{ rect: { x: 100, y: 80, w: 200, h: 200 }, size: 24 }], 'страница = вьюпорт + прокрутка');
    assert.match((await R.handle('screenshot_region', { selector: '.нет' }, st)).text, /no element matches/);
    assert.match((await R.handle('screenshot_region', { x: 0, y: 900, w: 10, h: 10 }, st)).text, /outside the visible viewport/);
    assert.match((await R.handle('screenshot_region', {}, st)).text, /give a selector or x, y, w, h/);
    flags.capture = async () => null;
    assert.match((await R.handle('screenshot_region', { selector: 'canvas' }, st)).text, /capture failed/);
  }

  // ---- Снимков на ход слишком много — модель узнаёт об этом из сводки ----
  {
    const { R, clickBtn, flags, st } = setup();
    R.__ctxLimits.pixelsPerSecond = 1000;
    flags.capture = async () => ({ w: 1, h: 1, b64: Buffer.from([1, 2, 3, 255]).toString('base64') });
    const p = R.handle('write_script', { title: 'Часто', code: 'for (let i = 0; i < 6; i++) { for (let k = 0; k < 4; k++) await __crawler.pixels(0, 0, 4, 4); __crawler.key("ArrowUp"); } await __crawler.wait(100); __crawler.done({});' }, st);
    await sleep(1600);
    clickBtn('Запустить');
    const res = await p;
    assert.match(res.text, /"pixelCaptures":24,"capturesPerAction":4/, res.text);
    assert.match(res.text, /took 4 screenshots per action/);
  }

  // ---- «Починить»: сохранённый скрипт упал → новая задача /skript с ним черновиком d1 → правка → «Обновить в библиотеке» ----
  {
    const { R, container, clickBtn, flags, Store, st } = setup();
    flags.url = 'https://game.example/play';
    const saved = await Store.save({ title: 'Динозаврик', kind: 'action', code: '__crawler.key("ArrowUp"); throw new Error("Runner is not defined");',
      permissions: ['read', 'input'], scope: { origin: 'https://game.example' }, author: 'model' });
    assert.equal(await R.runSaved(saved.skill.id), null);
    await sleep(200);
    const failed = container.children[container.children.length - 1];
    assert.match(failed.textContent, /Ошибка в скрипте/);
    const fix = failed.find((n) => n.tag === 'button' && n.textContent === 'Починить');
    assert.ok(fix, 'после неудачи в карточке есть «Починить»');
    fix.onclick();
    assert.match(flags.repairText, /^Почини скрипт «Динозаврик» — последний запуск: Ошибка в скрипте: .*Runner is not defined/);
    // новая задача: скрипт уже черновик d1, модель видит код и ошибку
    R.begin();
    const addon = R.promptAddon();
    assert.match(addon, /REPAIR: the user asks to fix the script "Динозаврик" saved in the site library/);
    assert.match(addon, /loaded as draft d1 \(v1\): change it with patch_script id "d1"/);
    assert.match(addon, /Runner is not defined/);
    assert.match(addon, /__crawler\.key\("ArrowUp"\)/, 'код в промпте');
    const p = R.handle('patch_script', { id: 'd1', code: '__crawler.key("ArrowUp"); await __crawler.wait(50); __crawler.done({ fixed: true });', reason: 'no Runner' }, st);
    await sleep(1600);
    clickBtn('Запустить');
    const res = await p;
    assert.match(res.text, /ended: Готово/, res.text);
    const fixedCard = container.children[container.children.length - 1];
    const upd = fixedCard.find((n) => n.tag === 'button' && n.textContent === 'Обновить в библиотеке');
    assert.ok(upd && !upd.disabled, 'починенный сохранённый скрипт предлагают обновить, а не сохранить копию');
    assert.ok(!fixedCard.find((n) => n.tag === 'button' && n.textContent === 'Починить'), 'после удачи «Починить» нет');
    await upd.onclick();
    await sleep(50);
    const all = await Store.list();
    assert.equal(all.length, 1, 'копия не создана');
    assert.match(all[0].code, /fixed: true/, 'в библиотеке новая версия кода');
    assert.ok(fixedCard.find((n) => n.tag === 'button' && n.textContent === 'Сохранено'));
    // следующая задача без «Починить» — черновиков из прошлого нет
    R.begin();
    assert.equal(R.promptAddon(), '');
  }

  // ---- Одна карточка на скрипт: 10 циклов «Запустить → Стоп → Запустить снова» и запуск из библиотеки ----
  {
    const { R, container, flags, Store } = setup();
    flags.url = 'https://game.example/play';
    const saved = await Store.save({ title: 'Цикл', kind: 'loop', code: 'const c = __crawler.loop(() => { __crawler.key("ArrowUp"); }, { fps: 20 });',
      permissions: ['read', 'input'], scope: { origin: 'https://game.example' }, author: 'model' });
    const cardsNow = () => container.children.filter((n) => /skript-card/.test(n.className));
    const btn2 = (root, label) => root.find((e) => e.tag === 'button' && e.textContent === label);
    assert.equal(await R.runSaved(saved.skill.id), null);
    await sleep(80);
    const card = cardsNow()[0];
    for (let i = 0; i < 10; i++) {
      if (!btn2(card, 'Стоп')) throw new Error('нет «Стоп» на шаге ' + i + ': ' + card.textContent);
      btn2(card, 'Стоп').onclick();
      await sleep(40);
      if (i % 2) { assert.equal(await R.runSaved(saved.skill.id), null); }   // через библиотеку
      else btn2(card, 'Запустить снова').onclick();                       // кнопкой в карточке
      await sleep(60);
    }
    btn2(card, 'Стоп').onclick();
    await sleep(40);
    assert.equal(cardsNow().length, 1, 'одна карточка на скрипт, без дублей');
    assert.match(card.textContent, /×11/, 'счётчик запусков в шапке');
    assert.equal(card.dataset.state, 'stopped');
    assert.equal(container.children.filter((n) => /sc-slot/.test(n.className)).length, 0, 'висячих якорей нет');
  }

  // ---- Сохранение черновика и повторный запуск: библиотечная запись не дублируется ----
  {
    const { R, container, clickBtn, Store, st } = setup();
    const btn = (root, label) => root.find((e) => e.tag === 'button' && e.textContent === label);
    const code = '__crawler.key("ArrowUp"); __crawler.done({ ok: true });';
    const p = R.handle('write_script', { title: 'Разовый', code }, st);
    await sleep(1600);
    clickBtn('Запустить');
    assert.match((await p).text, /Готово/);
    const card = container.children[0];
    btn(card, 'Сохранить для сайта').onclick();
    await sleep(60);
    assert.equal((await Store.list()).length, 1, 'скрипт сохранён');
    assert.ok(btn(card, 'Сохранено'), 'после сохранения кнопка это показывает');
    // повторный запуск того же черновика (моделью через run_script) помнит библиотечную запись
    const again = await R.handle('run_script', {}, st);
    assert.match(again.text, /Готово/);
    assert.ok(btn(card, 'Сохранено'), 'черновик помнит id библиотечной записи');
    assert.equal((await Store.list()).length, 1, 'дубль не создан');
  }

  console.log('skript-run.test.js: OK');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
