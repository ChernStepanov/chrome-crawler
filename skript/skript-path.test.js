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

console.log('skript-path.test.js: OK');
