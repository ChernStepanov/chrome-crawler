'use strict';
/* Тест skript-path.js: лестница путей, стратегия «Изучить сайт», проба каналов (на заглушке DOM).
 * Запуск: node skript-path.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'skript-path.js'), 'utf8'), ctx, { filename: 'skript-path.js' });
const P = vm.runInContext('SkriptPath', ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- 1. Промпт стратегии: цель, лестница, недоверие к странице ----
{
  const m = P.strategyMessages({ goal: 'создавать модели деталей', origin: 'https://cad.onshape.com', path: '/documents/1', probe: { editors: ['Monaco'] }, snapshot: 'Feature Studio\nSketch' });
  assert.equal(m.length, 2);
  assert.match(m[0].content, /1\. the site's own scripting/, 'лестница в системном сообщении');
  assert.match(m[0].content, /untrusted data/);
  assert.match(m[0].content, /"level":1-5/);
  assert.match(m[1].content, /Goal: создавать модели деталей/);
  assert.match(m[1].content, /Monaco/);
  assert.match(m[1].content, /Feature Studio/);
}

// ---- 2. Разбор ответа ----
{
  const raw = '<think>хм</think>```json\n' + JSON.stringify({
    title: 'Модели через FeatureScript', level: 1, path: 'FeatureScript', why: 'Модель кодом быстрее и точнее',
    rejected: [{ level: 4, why: 'клики медленные' }, 'мусор'], needs: ['аккаунт Onshape'], steps: ['Создать Feature Studio', 'Написать фичу'],
    verify: 'Фича появляется в Part Studio', confidence: 'medium', unknowns: ['версия FeatureScript']
  }) + '\n```';
  const s = plain(P.parseStrategy(raw));
  assert.equal(s.level, 1);
  assert.equal(s.path, 'FeatureScript');
  assert.deepEqual(s.rejected, [{ level: 4, why: 'клики медленные' }], 'мусор в rejected отброшен');
  assert.equal(s.confidence, 'medium');
  const text = P.formatStrategy('создавать модели деталей', s);
  assert.match(text, /^Цель: создавать модели деталей/);
  assert.match(text, /Путь: 1 — FeatureScript \(Язык или автоматизация самого сайта; уверенность: средняя\)/);
  assert.match(text, /Отброшено: 4 — клики медленные/);
  assert.match(text, /Шаги:\n1\. Создать Feature Studio\n2\. Написать фичу/);
  assert.match(text, /Проверить на сайте: версия FeatureScript/);
  assert.ok(text.length <= 3000);

  assert.throws(() => P.parseStrategy('не json'), /формате JSON/);
  assert.throws(() => P.parseStrategy('{"level": 7}'), /level 1–5/);
  assert.equal(P.parseStrategy('{"level": 3, "confidence": "огромная"}').confidence, 'low', 'неизвестная уверенность → low');
  // Минимальный ответ тоже оформляется без «undefined».
  const min = P.formatStrategy('играть', P.parseStrategy('{"level": 3}'));
  assert.ok(!/undefined|null/.test(min), min);
}

// ---- 3. Проба каналов: исполняется «в странице» (vm с заглушкой DOM), только читает ----
{
  const el = (props) => ({ innerText: '', getAttribute: (k) => (props.attrs || {})[k] ?? null, getBoundingClientRect: () => props.rect || { width: 0, height: 0 }, ...props });
  const nodes = {
    '.monaco-editor': [el({})],
    'textarea[spellcheck="false"]': [],
    '[role="menuitem"], [role="tab"], button, a, [role="button"]': [el({ innerText: 'Feature Studio' }), el({ innerText: 'Import' }), el({ innerText: 'Share' }), el({ innerText: 'Import' })],
    'a[href]': [el({ innerText: 'FeatureScript docs', attrs: { href: 'https://cad.onshape.com/FsDoc/' } }), el({ innerText: 'Home', attrs: { href: '/' } }), el({ innerText: 'x', attrs: { href: 'javascript:void 0' } })],
    'input[type="file"]': [el({ attrs: { accept: '.step,.stl' } })],
    canvas: [el({ rect: { width: 500, height: 400 } })]
  };
  let mutated = false;
  const page = vm.createContext({ innerWidth: 1000, innerHeight: 800 });
  // Как в Chrome: document — геттер окна, а не data-свойство.
  const doc = { title: 'Onshape', querySelectorAll: (s) => nodes[s] || [], createElement() { mutated = true; }, body: { appendChild() { mutated = true; } } };
  vm.runInContext('(d) => Object.defineProperty(globalThis, "document", { get: () => d, enumerable: true })', page)(doc);
  vm.runInContext('globalThis.appState = { doc: 1 }; globalThis.onshapeApi = function () {}; globalThis.someFlag = true;', page);
  const r = plain(vm.runInContext(`(${P.probe.toString()})()`, page));
  assert.deepEqual(r.editors, ['Monaco']);
  assert.ok(r.globals.includes('appState') && r.globals.includes('onshapeApi'), 'глобалы приложения найдены: ' + r.globals);
  assert.ok(!r.globals.includes('someFlag'), 'примитивы не считаются каналом');
  assert.ok(!r.globals.includes('document') && !r.globals.includes('innerWidth'));
  assert.deepEqual(r.menus, ['Feature Studio', 'Import'], 'меню по ключевым словам, без повторов');
  assert.deepEqual(r.docs, ['FeatureScript docs → https://cad.onshape.com/FsDoc/'], 'ссылки на документацию, без javascript:');
  assert.deepEqual(r.fileInputs, ['.step,.stl']);
  assert.equal(r.canvasPercent, 25);
  assert.equal(mutated, false, 'проба ничего не создаёт и не меняет');
}

// ---- 4. Источник состояния: проба «в странице» и вывод — кодом, не догадкой модели ----
{
  // заглушка страницы: localStorage, глобалы, DOM-элементы с классами/текстом/размером, canvas
  const mkPage = ({ storage = {}, globals = '', els = [], canvas = null }) => {
    const page = vm.createContext({ innerWidth: 1000, innerHeight: 800 });
    const keys = Object.keys(storage);
    let mutated = false;
    const ls = { get length() { return keys.length; }, key: (i) => keys[i], getItem: (k) => storage[k] ?? null, setItem() { mutated = true; } };
    const node = (e) => ({ tagName: (e.tag || 'div').toUpperCase(), children: e.kids || [], textContent: e.text || '',
      getAttribute: (k) => (k === 'class' ? e.cls || null : k === 'id' ? e.id || null : null),
      getBoundingClientRect: () => e.rect || { left: 10, top: 10, right: 60, bottom: 60, width: 50, height: 50 } });
    const all = els.map(node);
    const doc = {
      querySelectorAll: (sel) => sel === 'body *' ? all : sel === 'canvas' ? (canvas ? [node({ tag: 'canvas', rect: canvas })] : [])
        : sel.includes('score') ? all.filter((n) => /score/i.test(n.getAttribute('class') || '')) : [],
      createElement() { mutated = true; }
    };
    vm.runInContext('(d, l) => { Object.defineProperty(globalThis, "document", { get: () => d, enumerable: true }); Object.defineProperty(globalThis, "localStorage", { get: () => l }); }', page)(doc, ls);
    if (globals) vm.runInContext(globals, page);
    return { run: () => plain(vm.runInContext(`(${P.probeState.toString()})()`, page)), mutated: () => mutated };
  };

  // 2048 в браузере: состояние в localStorage, плитки в DOM — выигрывает JS/хранилище (точнее DOM)
  const tiles = Array.from({ length: 6 }, (_, i) => ({ cls: 'tile-inner', text: String(2 ** (i + 1)) }));
  const g2048 = mkPage({ storage: { gameState: JSON.stringify({ grid: { size: 4, cells: [[null, { value: 2 }, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]] }, score: 120, over: false, won: false }), bestScore: '2048', theme: 'dark' },
    els: [...tiles, { cls: 'score-container', text: '120' }] });
  const r1 = g2048.run();
  assert.deepEqual(r1.storage.map((s) => s.key), ['gameState', 'bestScore'], 'ключи состояния, без посторонних (theme)');
  assert.deepEqual(r1.storage[0].fields, ['grid', 'score', 'over', 'won'], 'имена полей — да, значений — нет');
  assert.ok(!JSON.stringify(r1).includes('120,') && !JSON.stringify(r1.storage).includes('120'), 'значения из хранилища не уходят');
  assert.equal(r1.dom[0].sig, 'div.tile-inner');
  assert.equal(g2048.mutated(), false, 'проба только читает');
  const v1 = P.stateVerdict(r1);
  assert.equal(v1.kind, 'js');
  assert.match(v1.text, /localStorage\["gameState"\] \{grid, score, over, won\}/);
  assert.match(v1.text, /prefer it over pixels/);
  // устройство сохранённого состояния (без значений): модель знает, что grid — объект с cells, а не массив
  assert.equal(r1.storage[0].shape, '{grid: {size: number, cells: array[4] of array[4] of {value: number} or null}, score: number, over: boolean, won: boolean}');
  assert.match(v1.text, /Its exact structure \(types only\): __crawler\.saved\("gameState"\) = \{grid: \{size: number, cells: array\[4\]/);
  assert.ok(!/120|"value":2/.test(r1.storage[0].shape), 'в схеме только типы, без значений');
  // пустая первая строка доски не прячет устройство клетки
  const r1b = mkPage({ storage: { gameState: JSON.stringify({ grid: { cells: [[null, null], [null, { position: { x: 1, y: 1 }, value: 4 }]] } }) } }).run();
  assert.match(r1b.storage[0].shape, /cells: array\[2\] of array\[2\] of \{position: \{x: number, y: number\}, value: number\} or null/);

  // переменные страницы с полями состояния
  const v2 = P.stateVerdict(mkPage({ globals: 'globalThis.game = { board: [[0, 2], [4, 0]], score: 0, level: 1, speed: 2 }; globalThis.cfg = { a: 1 };' }).run());
  assert.equal(v2.kind, 'js');
  assert.match(v2.text, /window\.game \{board, score, level\}/);

  // только DOM: клетки с числами
  const v3 = P.stateVerdict(mkPage({ els: Array.from({ length: 9 }, (_, i) => ({ tag: 'td', cls: 'cell', text: String(i) })) }).run());
  assert.equal(v3.kind, 'dom');
  assert.match(v3.text, /9 × <td\.cell>/);

  // canvas-игра без читаемого состояния — пиксели
  const v4 = P.stateVerdict(mkPage({ canvas: { left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }, els: [{ tag: 'a', text: 'Меню' }] }).run());
  assert.equal(v4.kind, 'pixels');
  assert.match(v4.text, /canvas \(45% of the screen\).*__crawler\.pixels\/__crawler\.grid/);

  // play2048.co: игра в Web Worker на OffscreenCanvas; в localStorage может остаться только старый gameState
  // классической версии (сайт берёт его лишь для импорта) — «проверить одним ходом», а не «читай хранилище»
  const canvasRect = { left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 };
  const vCo = P.stateVerdict(mkPage({ storage: { gameState: JSON.stringify({ grid: { size: 4, cells: [[null, null, null, null], [], [], []] }, score: 8 }), bestScore: '512' }, canvas: canvasRect }).run());
  assert.equal(vCo.kind, 'check');
  assert.match(vCo.text, /make ONE move, read again.*if not — ignore it and read the board with __crawler\.pixels/);
  assert.match(vCo.text, /__crawler\.saved\("bestScore"\) \(for evaluation only\)/);
  assert.match(v1.text, /__crawler\.saved\(key\) for localStorage — direct localStorage is not allowed/, 'модели — разрешённый путь, а не запрещённый localStorage');
  // .co с чистым хранилищем, только рекорд — пиксели (рекорд — пометкой, не путь)
  const vCo2 = P.stateVerdict(mkPage({ storage: { bestScore: '2048' }, canvas: canvasRect }).run());
  assert.equal(vCo2.kind, 'pixels');
  assert.match(vCo2.ru, /рекорд — в localStorage\["bestScore"\]/);
  // живое состояние в переменной — доверяем даже при canvas
  const vLive = P.stateVerdict(mkPage({ globals: 'globalThis.game = { board: [[2, 0, 0, 0], [0, 0, 0, 0]], score: 0 };', canvas: canvasRect }).run());
  assert.equal(vLive.kind, 'js');
  assert.match(vLive.text, /if this state turns out empty, not the board.*read the board from pixels.*do not give up/, 'при canvas — всегда запасной путь');
  // play2048.co (живой провал): служебный объект с полями «map»/«field»/«state», но без доски — не состояние, а пиксели
  const vFake = P.stateVerdict(mkPage({ globals: 'globalThis.appConfig = { map: {}, field: "x", state: "ready", game: 1 };', canvas: canvasRect }).run());
  assert.equal(vFake.kind, 'pixels', 'имя поля без доски внутри — не доска');
  // объект без доски (настройки) — не состояние
  assert.equal(P.stateVerdict(mkPage({ globals: 'globalThis.settings = { level: 1, game: "x", sound: true };' }).run()).kind, 'ui');

  // обычная страница
  assert.equal(P.stateVerdict(mkPage({ els: [{ tag: 'p', text: 'Привет' }] }).run()).kind, 'ui');
  assert.equal(P.stateVerdict(null).kind, 'ui');
}

console.log('skript-path.test.js: OK');
