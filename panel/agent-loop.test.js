'use strict';
/* Тест agent-loop.js: когда снимать скриншот, сжатие старой истории, ответ после click_at. Запуск: node agent-loop.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'agent-loop.js'), 'utf8') + '\nglobalThis.L = AgentLoop;', ctx, { filename: 'agent-loop.js' });
const L = vm.runInContext('L', ctx);

// ---- 1. Скриншот ----
const page = { textLen: 2000, count: 40 };   // обычная страница с текстом и элементами
const shot = (o) => L.wantShot({ mode: 'both', step: 3, ...page, ...o });
assert.equal(L.wantShot({ mode: 'structure', step: 1, ...page }), false, '«Структура» — никогда');
assert.equal(L.wantShot({ mode: 'image', step: 7, ...page, vision: 'off' }), true, '«Изображение» — всегда');
assert.equal(shot({ step: 1 }), true, '«Вместе»: первый шаг — смотрим');
assert.equal(shot({}), false, '«Вместе»: дальше на обычной странице — без снимка (раньше был на каждом шаге)');
assert.equal(shot({ needShot: true }), true, 'после неудачного действия — смотрим');
assert.equal(shot({ once: true }), true, 'vision once');
assert.equal(shot({ vision: 'on' }), true, 'vision on — каждый шаг (игры, canvas)');
assert.equal(shot({ vision: 'off', step: 1 }), false, 'vision off — даже на первом шаге');
assert.equal(shot({ vision: 'off', needShot: true }), true, 'но после неудачи — всё равно смотрим');
assert.equal(shot({ textLen: 120 }), true, 'мало текста (canvas, картинка) — смотрим');
assert.equal(shot({ count: 1 }), true, 'почти нет элементов — смотрим');
assert.equal(shot({ visual: 0.45 }), true, 'крупный canvas при обычном тексте вокруг (2048) — смотрим каждый шаг');
assert.equal(shot({ visual: 0.05 }), false, 'маленький canvas (график, баннер) — не повод');
assert.equal(shot({ visual: 0.45, vision: 'off' }), false, 'модель сказала off — уважаем');

// ---- 2. Сжатие истории ----
{
  const big = 'x'.repeat(9000);
  const mk = () => ({ msgs: [{ role: 'user', content: 'obs' }, { role: 'assistant', content: null, tool_calls: [{ id: '1' }] }, { role: 'tool', tool_call_id: '1', content: big }] });
  const groups = [mk(), mk(), mk(), mk()];
  groups[0].msgs[0].content = 'Tool results:\n' + 'y'.repeat(5000) + '\n\n[earlier page state omitted]';
  const saved = L.trimHistory(groups, 2, 600);
  assert.ok(saved > 16000, 'сэкономлено ' + saved);
  assert.ok(groups[0].msgs[2].content.length < 700 && /сокращено/.test(groups[0].msgs[2].content), 'старый результат обрезан с пометкой');
  assert.ok(groups[0].msgs[0].content.length < 1300, 'JSON-режим: результаты в префиксе наблюдения тоже');
  assert.equal(groups[2].msgs[2].content.length, 9000, 'последние 2 шага — целиком');
  assert.equal(groups[3].msgs[2].content.length, 9000);
  assert.equal(groups[1].msgs[1].tool_calls[0].id, '1', 'пары tool_calls/tool не тронуты');
  assert.equal(L.trimHistory(groups, 2, 600), 0, 'повторный вызов ничего не меняет');
  const short = [{ msgs: [{ role: 'tool', content: 'ok' }] }, { msgs: [] }, { msgs: [] }];
  L.trimHistory(short, 2, 600);
  assert.equal(short[0].msgs[0].content, 'ok', 'короткое не трогаем');
}

// ---- 3. Ответ после click_at ----
assert.equal(L.clickAtText(10, 20, { ok: true, tag: 'a', label: 'Показать ответ' }), 'Clicked at (10, 20) on a "Показать ответ".');
assert.equal(L.clickAtText(1, 2, { ok: true, tag: 'div', label: 'Купить', clickable: true }), 'Clicked at (1, 2) on div "Купить".', 'div-кнопка с курсором-рукой');
const miss = L.clickAtText(600, 600, { ok: true, tag: 'div', label: '' });
assert.match(miss, /not a link or button, the click may have done nothing/, 'клик в пустоту (живой прогон ЕГЭ)');
assert.match(miss, /click the element by id/);
assert.match(L.clickAtText(5, 5, { ok: false }), /nothing was found at that point/);

// ---- 4. Ссылки в ответе по объявлениям extract_items (живой прогон: модель прислала строки без ссылок) ----
{
  const items = [
    { title: 'Велосипед Pinarello Dogma 2', price: 74900, url: 'https://www.avito.ru/tolyatti/1' },
    { title: 'Pinarello Dogma 65.1 Disk', price: 88350, url: 'https://www.avito.ru/moskva/2' },
    { title: 'Pinarello Dogma F10', price: 90000, url: 'https://www.avito.ru/izberbash/3' },
    { title: 'Карбоновый шоссейный велосипед', price: 90000, url: 'https://www.avito.ru/samara/4' },
    { title: 'Рама Pinarello Dogma F14', price: 79990, url: 'https://www.avito.ru/moskva/5' }
  ];
  const ans = [
    'Топ-5:',
    '- Велосипед Pinarello Dogma 2 (Тольятти) — **74 900 ₽**',
    '- Pinarello Dogma 65.1 Disk (Москва) — **88 350 ₽** · Campagnolo',
    '- Pinarello Dogma F10 (Избербаш) — **90 000 ₽**',
    '- Карбоновый шоссейный (Самара) — **90 000 ₽**',
    '- Pinarello Dogma F 2025 (Москва) — **97 000 ₽**',
    '- [Уже со ссылкой](https://x.ru/1) — **74 900 ₽**'
  ].join('\n');
  const out = L.linkItems(ans, items).split('\n');
  assert.equal(out[0], 'Топ-5:', 'не список — как есть');
  assert.equal(out[1], '- [Велосипед Pinarello Dogma 2 (Тольятти)](https://www.avito.ru/tolyatti/1) — **74 900 ₽**');
  assert.equal(out[2], '- [Pinarello Dogma 65.1 Disk (Москва)](https://www.avito.ru/moskva/2) — **88 350 ₽** · Campagnolo', 'детали после цены сохраняются');
  assert.match(out[3], /\(https:\/\/www\.avito\.ru\/izberbash\/3\)/, 'та же цена у двух — по словам названия');
  assert.match(out[4], /\(https:\/\/www\.avito\.ru\/samara\/4\)/);
  assert.equal(out[5], '- Pinarello Dogma F 2025 (Москва) — **97 000 ₽**', 'цены нет среди объявлений — не угадываем');
  assert.equal(out[6], '- [Уже со ссылкой](https://x.ru/1) — **74 900 ₽**', 'ссылка уже есть — не трогаем');
  // одинаковая цена, ни одного общего слова — не угадываем
  assert.equal(L.linkItems('- Что-то другое — **88 350 ₽**', items), '- Что-то другое — **88 350 ₽**');
  assert.equal(L.linkItems('- без цены', items), '- без цены');
  // живой прогон: весь топ одной строкой «1) …; 2) …» — разбить на пункты, выделить цены и поставить ссылки
  const inline = 'Топ-5 дешёвых Pinarello Dogma на Авито: 1) Dogma 2 Pina — 74 900 ₽ (Тольятти); 2) Dogma 65.1 рама disk brake — 88 350 ₽; ' +
    '3) Dogma F10 — 90 000 ₽ (Избербаш); 4) Dogma 651 XL — 100 000 ₽ (Махачкала)';
  const lines = L.linkItems(inline, items).split('\n');
  assert.equal(lines[0], 'Топ-5 дешёвых Pinarello Dogma на Авито:');
  assert.equal(lines[1], '- [Dogma 2 Pina](https://www.avito.ru/tolyatti/1) — **74 900 ₽** (Тольятти)');
  assert.equal(lines[2], '- [Dogma 65.1 рама disk brake](https://www.avito.ru/moskva/2) — **88 350 ₽**', '«65.1» в названии — не номер пункта');
  assert.equal(lines[3], '- [Dogma F10](https://www.avito.ru/izberbash/3) — **90 000 ₽** (Избербаш)');
  assert.equal(lines[4], '- Dogma 651 XL — **100 000 ₽** (Махачкала)', 'цены нет среди объявлений — пункт без ссылки');
  assert.equal(lines.length, 5);
  // нумерованные строки — тоже пункты
  assert.equal(L.listify('1. Dogma F10 — 90 000 ₽\n2. Dogma 2 — **74 900 ₽**'), '- Dogma F10 — **90 000 ₽**\n- Dogma 2 — **74 900 ₽**');
  // проза с номерами, но без цен — как есть
  const prose = 'Шаги: 1) открыть сайт; 2) отсортировать по цене.';
  assert.equal(L.listify(prose), prose);
}

// ---- 6. Список не в том поле (живой прогон Авито: в ответе только заголовок, список — в пояснении) ----
{
  const r = L.salvageList('Топ-5 самых дешёвых объявлений Pinarello Dogma',
    'Отсортировал выдачу по цене.\n1. Pinarello Dogma 2 — 74 900 ₽\n2. Dogma 65.1 Disk — 88 350 ₽\nРамы исключил.', '');
  assert.match(r.answer, /^Топ-5 самых дешёвых объявлений Pinarello Dogma\n- Pinarello Dogma 2 — \*\*74 900 ₽\*\*\n- Dogma 65\.1 Disk — \*\*88 350 ₽\*\*$/, 'строки списка — в ответ');
  assert.equal(r.reasoning, 'Отсортировал выдачу по цене.\nРамы исключил.', 'из пояснения убраны — без дубля');
  // список «в строку» тоже находится
  assert.match(L.salvageList('Топ-2:', 'Нашёл: 1) Dogma F — 210 000 ₽; 2) Dogma F12 — 299 000 ₽', '').answer, /- Dogma F — \*\*210 000 ₽\*\*\n- Dogma F12/);
  // в ответе уже есть список — ничего не трогаем
  const ok = L.salvageList('- Dogma 2 — **74 900 ₽**', '1. X — 1 000 ₽\n2. Y — 2 000 ₽', '');
  assert.equal(ok.answer, '- Dogma 2 — **74 900 ₽**');
  assert.equal(ok.reasoning, '1. X — 1 000 ₽\n2. Y — 2 000 ₽');
  // одна строка с ценой в пояснении — не список, не трогаем; список в summary — тоже переносится
  assert.equal(L.salvageList('**128**', 'Посчитал: 100 ₽ + 28 ₽', '').answer, '**128**');
  assert.match(L.salvageList('Итог', '', '- A — 1 000 ₽\n- B — 2 000 ₽').answer, /^Итог\n- A — \*\*1 000 ₽\*\*\n- B/);
}

console.log('agent-loop.test.js: OK');
