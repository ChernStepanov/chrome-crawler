'use strict';
/* Тест skript-library.js: предложение «Для этой страницы есть скрипты» и раздел на экране.
 * DOM — минимальная заглушка, хранилище — в памяти. Запуск: node skript-library.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeEl {
  constructor(tag) { this.tag = tag; this.children = []; this._text = ''; this.hidden = false; this.className = ''; this.attrs = {}; }
  append(...n) { this.children.push(...n); }
  appendChild(n) { this.children.push(n); }
  setAttribute(k, v) { this.attrs[k] = v; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const r = c.find(pred); if (r) return r; } return null; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const offer = new FakeEl('div');
  const mem = {};
  const ctx = vm.createContext({
    console, URL, TextEncoder, crypto: { subtle: require('node:crypto').webcrypto.subtle },
    document: { createElement: (t) => new FakeEl(t), getElementById: (id) => (id === 'skriptOffer' ? offer : null) },
    __mem: { get: async (d) => ({ ...d, ...JSON.parse(JSON.stringify(mem)) }), set: async (o) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); } }
  });
  for (const f of ['skript-store.js', 'skript-registry.js', 'skript-library.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('SkriptStore.storage = __mem', ctx);
  const Store = vm.runInContext('SkriptStore', ctx);
  const L = vm.runInContext('SkriptLibrary', ctx);

  const state = { url: 'https://game.example/play', busy: false, ran: [], why: null, started: 0, opened: 0, changed: 0, sites: [] };
  const btn = (root, label) => root.find((e) => e.tag === 'button' && e.textContent === label);
  const rec = (title, origin, extra = {}) => ({ title, kind: 'loop', code: '__crawler.loop(() => {}, { fps: 5 });', permissions: ['read', 'input'], scope: { origin }, ...extra });

  // До init — без падений (панель вызывает refresh раньше, чем подключит библиотеку).
  await L.refresh();

  L.init({
    activeTab: async () => ({ id: 7, url: state.url }),
    runSaved: async (id) => { state.ran.push(id); return state.why; },
    busy: () => state.busy,
    startNew: () => { state.started++; },
    openAll: () => { state.opened++; },
    onChange: () => { state.changed++; },
    openSite: (url) => { state.sites.push(url); }
  });
  await sleep(10);
  assert.equal(offer.hidden, true, 'без сохранённых скриптов предложения нет');

  const a = (await Store.save(rec('Играть 2048', 'https://game.example'))).skill;
  await Store.save(rec('Чужой', 'https://other.example'));
  await Store.save({ title: 'Заметка', kind: 'note', description: 'текст', scope: { origin: 'https://game.example' } });
  await L.refresh();
  assert.equal(offer.hidden, false, 'на сайте со скриптом предложение показано');
  assert.match(offer.textContent, /Для этой страницы есть скрипты: 1/, 'считаются только скрипты этого сайта, без заметок');
  assert.equal(state.ran.length, 0, 'само ничего не запускает');

  btn(offer, 'Для этой страницы есть скрипты: 1').onclick();
  await sleep(10);
  assert.match(offer.textContent, /Играть 2048/, 'раскрытие показывает список');
  btn(offer, 'Запустить').onclick();
  await sleep(10);
  assert.deepEqual(state.ran, [a.id], 'запуск — по кнопке человека');

  // Отказ с причиной остаётся видимым рядом с кнопкой.
  state.why = 'Сейчас выполняется задача';
  btn(offer, 'Для этой страницы есть скрипты: 1').onclick();
  await sleep(10);
  btn(offer, 'Запустить').onclick();
  await sleep(10);
  assert.match(offer.textContent, /выполняется задача/);
  state.why = null;
  btn(offer, 'Сделать новый').onclick();
  assert.equal(state.started, 1);

  // Во время задачи предложение скрыто.
  state.busy = true; await L.refresh(); assert.equal(offer.hidden, true, 'во время задачи скрыто');
  state.busy = false; await L.refresh(); assert.equal(offer.hidden, false);

  // Отключённый скрипт не предлагается; «×» скрывает для сайта.
  await Store.setEnabled(a.id, false); await L.refresh(); assert.equal(offer.hidden, true, 'отключённый не предлагается');
  await Store.setEnabled(a.id, true); await L.refresh(); assert.equal(offer.hidden, false);
  btn(offer, '×').onclick(); await sleep(10); assert.equal(offer.hidden, true, '«×» скрывает предложение для сайта');
  state.url = 'https://other.example/x'; await L.refresh(); assert.equal(offer.hidden, false, 'на другом сайте — свои скрипты');
  assert.match(offer.textContent, /: 1/);
  state.url = 'chrome://extensions'; await L.refresh(); assert.equal(offer.hidden, true, 'служебная страница');

  // Раздел на экране: все скрипты, запуск только на своём сайте, удаление.
  state.url = 'https://game.example/';
  const root = new FakeEl('div');
  await L.renderSection(root);
  assert.match(root.textContent, /Скрипты/);
  const cards = root.children.filter((c) => /lib-card/.test(c.className));
  assert.equal(cards.length, 2, 'на экране все скрипты, заметки — нет');
  const mine = cards.find((c) => /Играть 2048/.test(c.textContent));
  const other = cards.find((c) => /Чужой/.test(c.textContent));
  assert.equal(btn(mine, 'Запустить').disabled, false, 'свой сайт — можно запустить');
  assert.equal(btn(other, 'Запустить'), null, 'чужой сайт — не запускать здесь');
  btn(other, 'Открыть сайт').onclick();
  assert.deepEqual(state.sites, ['https://other.example/'], 'предлагает открыть сайт скрипта');
  // Пришли на сайт — предложение над полем ввода сразу раскрыто.
  state.url = 'https://other.example/'; await L.refresh();
  assert.ok(btn(offer, 'Запустить'), 'после «Открыть сайт» список скриптов уже раскрыт');
  state.url = 'https://game.example/';
  await btn(other, 'Удалить').onclick();
  assert.equal(state.changed, 1);
  assert.equal((await Store.list()).filter((s) => s.kind !== 'note').length, 1, 'удалено');
  const empty = new FakeEl('div');
  await Store.remove(a.id);
  await L.renderSection(empty);
  assert.match(empty.textContent, /Сохранённых скриптов пока нет/);

  console.log('skript-library.test.js: OK');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
