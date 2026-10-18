'use strict';
/* Тест panel-extras.js: история ↑/↓ и черновик. Поле ввода — EventTarget-заглушка.
 * Запуск: node panel-extras.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(stored = {}) {
  const mem = JSON.parse(JSON.stringify(stored));
  const storage = { get: async (d) => ({ ...d, ...JSON.parse(JSON.stringify(mem)) }), set: async (o) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); } };
  const doc = new EventTarget();
  doc.openSheet = false;
  doc.querySelector = (sel) => (sel === '.sheet:not([hidden])' && doc.openSheet ? {} : null);
  // Минимальный DOM для кнопок у сообщений.
  const mk = (tag) => {
    const n = { tag, children: [], childNodes: [], attrs: {}, classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } },
      appendChild(c) { this.children.push(c); this.childNodes.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; } };
    return n;
  };
  doc.createElement = mk;
  doc.createElementNS = (ns, tag) => mk(tag);
  const copied = [];
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Event, document: doc, chrome: { storage: { local: storage } },
    navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'panel-extras.js'), 'utf8'), ctx, { filename: 'panel-extras.js' });
  const X = vm.runInContext('PanelExtras', ctx);
  const ta = new EventTarget();
  ta.value = ''; ta.selectionStart = 0; ta.selectionEnd = 0; ta.tagName = 'TEXTAREA'; ta.focused = 0; ta.focus = () => { ta.focused++; };
  const inputs = [];
  ta.addEventListener('input', () => inputs.push(ta.value));
  // Нажатие клавиши на элементе вне поля ввода: событие всплывает до document.
  const pressOn = (target, k, mods = {}) => {
    const e = new Event('keydown', { cancelable: true });
    Object.assign(e, { key: k, isComposing: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });
    Object.defineProperty(e, 'target', { value: target });
    doc.dispatchEvent(e);
    return e.defaultPrevented;
  };
  let chip = null;
  const key = (k, mods = {}) => {
    const e = new Event('keydown', { cancelable: true });
    Object.assign(e, { key: k, isComposing: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
    ta.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const type = (text, caret = text.length) => { ta.value = text; ta.selectionStart = ta.selectionEnd = caret; ta.dispatchEvent(new Event('input')); };
  return { X, ta, mem, key, type, doc, pressOn, inputs, copied, mk, deps: { textarea: ta, chip: () => chip, setChip: (id) => { chip = id; } }, chip: () => chip, setChipRaw: (v) => { chip = v; } };
}

(async () => {
  // ---- 1. Листание ↑/↓, возврат недописанного, без повторов ----
  {
    const s = setup();
    await s.X.init(s.deps);
    assert.equal(s.key('ArrowUp'), false, 'пустая история — стрелка не перехватывается');
    s.X.remember('первая', null);
    s.X.remember('вторая', 'skript');
    s.X.remember('первая', null); // повтор переносится в конец, не дублируется
    s.type('недописано');
    assert.equal(s.key('ArrowUp'), true);
    assert.equal(s.ta.value, 'первая'); assert.equal(s.chip(), null);
    s.key('ArrowUp');
    assert.equal(s.ta.value, 'вторая'); assert.equal(s.chip(), 'skript', 'чип /skript вернулся вместе с текстом');
    assert.equal(s.key('ArrowUp'), false, 'дальше истории нет');
    assert.equal(s.ta.value, 'вторая');
    s.key('ArrowDown'); assert.equal(s.ta.value, 'первая'); assert.equal(s.chip(), null);
    s.key('ArrowDown'); assert.equal(s.ta.value, 'недописано', 'после последней записи — недописанный текст');
    assert.equal(s.key('ArrowDown'), false, 'вне листания ↓ не перехватывается');
    assert.deepEqual(s.mem.taskHistory.map((h) => h.text), ['вторая', 'первая']);
  }

  // ---- 2. Многострочный текст, выделение, модификаторы ----
  {
    const s = setup({ taskHistory: [{ text: 'старое', chip: null }] });
    await s.X.init(s.deps);
    s.type('строка 1\nстрока 2', 12); // курсор во второй строке
    assert.equal(s.key('ArrowUp'), false, 'не с первой строки — обычное движение курсора');
    s.ta.selectionStart = s.ta.selectionEnd = 3;
    assert.equal(s.key('ArrowUp'), true, 'с первой строки — история');
    assert.equal(s.ta.value, 'старое');
    s.type('a\nb', 0);
    s.key('ArrowUp');
    s.type('x\ny', 0); // правка сбрасывает листание
    assert.equal(s.key('ArrowDown'), false);
    s.type('abc', 1); s.ta.selectionEnd = 3;
    assert.equal(s.key('ArrowUp'), false, 'есть выделение — не трогаем');
    s.type('abc', 0);
    assert.equal(s.key('ArrowUp', { shiftKey: true }), false, 'Shift+↑ — выделение, не история');
  }

  // ---- 3. Черновик: сохраняется, восстанавливается, после отправки очищается ----
  {
    const s = setup();
    await s.X.init(s.deps);
    s.setChipRaw('study');
    s.type('изучить сайт');
    await sleep(450);
    assert.deepEqual(s.mem.taskDraft, { text: 'изучить сайт', chip: 'study' });
    const s2 = setup({ taskDraft: s.mem.taskDraft });
    await s2.X.init(s2.deps);
    assert.equal(s2.ta.value, 'изучить сайт', 'черновик вернулся после перезапуска панели');
    assert.equal(s2.chip(), 'study');
    s2.X.remember('изучить сайт', 'study');
    await sleep(450);
    assert.equal(s2.mem.taskDraft, null, 'после отправки черновика нет');
    // пустое поле — черновик пустой
    s2.setChipRaw(null);
    s2.type('');
    await sleep(450);
    assert.equal(s2.mem.taskDraft, null);
    // одна команда без текста — не черновик: панель не должна открываться с /skript
    s2.setChipRaw('skript');
    s2.type('');
    await sleep(450);
    assert.equal(s2.mem.taskDraft, null, 'чип без текста не сохраняется');
  }

  // ---- 4. Лимит 30 ----
  {
    const s = setup();
    await s.X.init(s.deps);
    for (let i = 0; i < 40; i++) s.X.remember('t' + i, null);
    assert.equal(s.mem.taskHistory.length, 30);
    assert.equal(s.mem.taskHistory[0].text, 't10');
  }

  // ---- 5. «/» с любого места панели ----
  {
    const s = setup();
    await s.X.init(s.deps);
    const button = { tagName: 'BUTTON' };
    assert.equal(s.pressOn(button, '/'), true);
    assert.equal(s.ta.focused, 1, 'курсор в поле');
    assert.equal(s.ta.value, '/');
    assert.deepEqual(s.inputs.slice(-1), ['/'], 'input — чтобы открылось меню команд');
    s.type('задача');
    assert.equal(s.pressOn(button, '/'), true);
    assert.equal(s.ta.value, 'задача', 'текст в поле не трогаем, только фокус');
    assert.equal(s.pressOn({ tagName: 'INPUT' }, '/'), false, 'в другом поле «/» — обычный символ');
    assert.equal(s.pressOn(s.ta, '/'), false, 'в самом поле — обычный символ');
    assert.equal(s.pressOn(button, '/', { metaKey: true }), false, 'с модификатором — не наше');
    s.doc.openSheet = true;
    assert.equal(s.pressOn(button, '/'), false, 'открыт экран (настройки, вопрос агента) — не перехватываем');
  }

  // ---- 6. Кнопки у сообщений: «Повторить» и «Копировать» ----
  {
    const s = setup();
    await s.X.init(s.deps);
    s.setChipRaw('skript');
    const row = s.mk('div');
    s.X.decorate(row, 'сделай коробку 40×80×40', { copy: true, repeat: true });
    const tools = row.children[0];
    assert.equal(tools.className, 'msg-tools');
    const [rep, cp] = tools.children;
    assert.equal(rep.attrs['aria-label'], 'Повторить: вставить в поле ввода');
    assert.equal(rep.children[0].children[0].attrs.href, '#i-refresh', 'иконка без текста');
    rep.onclick({ stopPropagation() {} });
    assert.equal(s.ta.value, 'сделай коробку 40×80×40', 'текст в поле, не отправлен');
    assert.equal(s.chip(), 'skript', 'стоящий чип не сбрасывается');
    assert.ok(s.ta.focused >= 1);
    await cp.onclick({ stopPropagation() {} });
    await sleep(0);
    assert.deepEqual(s.copied, ['сделай коробку 40×80×40']);
    assert.ok(cp.classList.set.has('done'), 'отклик «скопировано»');
    const only = s.mk('div');
    s.X.decorate(only, 'ответ агента', { copy: true });
    assert.equal(only.children[0].children.length, 1, 'у ответа агента только «Копировать»');
    const none = s.mk('div');
    s.X.decorate(none, '', { copy: true });
    assert.equal(none.children.length, 0, 'пустое сообщение — без кнопок');
  }

  console.log('panel-extras.test.js: OK');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
