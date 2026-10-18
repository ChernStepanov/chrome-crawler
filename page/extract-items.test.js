'use strict';
/* Тест extract-items.js на поддельном DOM: цены, JSON-LD, microdata (как у объявлений Авито),
 * повторяющиеся карточки без разметки, сортировка и формат для модели. Запуск: node extract-items.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---- Минимальный DOM: только то, что использует извлечение ----
class El {
  constructor(tag, attrs = {}, kids = []) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parentElement = null; this.kids = [];
    for (const k of kids) this.add(k);
  }
  add(k) { if (typeof k === 'string') this.kids.push(k); else { k.parentElement = this; this.kids.push(k); } return this; }
  get children() { return this.kids.filter((k) => typeof k !== 'string'); }
  get textContent() { return this.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join(' '); }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? String(this.attrs[n]) : null; }
  all() { const out = []; for (const c of this.children) { out.push(c, ...c.all()); } return out; }
  matches(sel) {
    return sel.split(',').map((s) => s.trim()).some((one) => {
      const m = /^([a-z0-9]*)((?:\[[^\]]+\])*)$/i.exec(one);
      if (!m) throw new Error('селектор не поддержан тестом: ' + one);
      if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
      for (const g of m[2].matchAll(/\[([\w-]+)(?:=("|')?([^"'\]]*)\2?)?\]/g)) {
        const a = this.getAttribute(g[1]);
        if (a === null) return false;
        if (g[3] !== undefined && a !== g[3]) return false;
      }
      return true;
    });
  }
  querySelectorAll(sel) {
    if (sel === 'body *') { const b = this.tagName === 'BODY' ? this : this.all().find((e) => e.tagName === 'BODY'); return b ? b.all() : []; }
    return this.all().filter((e) => e.matches(sel));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const h = (tag, attrs, ...kids) => new El(tag, attrs || {}, kids.flat());

const ctx = vm.createContext({ console, URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'extract-items.js'), 'utf8'), ctx, { filename: 'extract-items.js' });
const X = vm.runInContext('globalThis.__crawlerExtract', ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
const BASE = 'https://www.avito.ru/moskva/tovary?q=aula';

// ---- 1. Цены ----
assert.deepEqual(plain(X.parsePrice('12 490 ₽')), { price: 12490, currency: 'RUB', text: '12 490 ₽' });
assert.equal(X.parsePrice('цена 15 000 руб.').price, 15000);
assert.deepEqual(plain(X.parsePrice('$1,299.99')), { price: 1299.99, currency: 'USD', text: '$1,299.99' });
assert.equal(X.parsePrice('1.299 €').price, 1299);
assert.equal(X.parsePrice('12,5 €').price, 12.5);
assert.equal(X.parsePrice('договорная'), null);

// ---- 2. JSON-LD: ItemList из Product с offers ----
{
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: [
    { '@type': 'ListItem', item: { '@type': 'Product', name: 'Клавиатура AULA F75', url: '/p/1', image: ['https://img.example/1.jpg'], offers: { '@type': 'Offer', price: '5990', priceCurrency: 'RUB' }, aggregateRating: { ratingValue: 4.8, reviewCount: 120 } } },
    { '@type': 'ListItem', item: { '@type': 'Product', name: 'AULA F75 Pro', url: '/p/2', offers: [{ '@type': 'Offer', price: 7490, priceCurrency: 'RUB' }] } }
  ] };
  const doc = h('html', {}, h('head', {}, h('script', { type: 'application/ld+json' }, JSON.stringify(ld))), h('body', {}));
  const r = X.items(doc, 'https://shop.example/search', 40);
  assert.equal(r.method, 'json-ld');
  assert.deepEqual(plain(r.items.map((i) => [i.title, i.price, i.currency, i.url, i.rating, i.reviews])), [
    ['Клавиатура AULA F75', 5990, 'RUB', 'https://shop.example/p/1', 4.8, 120],
    ['AULA F75 Pro', 7490, 'RUB', 'https://shop.example/p/2', null, null]
  ]);
  assert.equal(r.items[0].image, 'https://img.example/1.jpg', 'картинка из JSON-LD (массив)');
}

// ---- 3. Microdata, как размечены объявления Авито ----
{
  const card = (id, name, price, place) => h('div', { 'data-marker': 'item', itemscope: '', itemtype: 'http://schema.org/Product' },
    h('img', { src: 'data:image/gif;base64,R0lG', 'data-src': `https://00.img.avito.st/${id}.jpg` }),
    h('a', { itemprop: 'url', href: `/moskva/tovary/${id}` }, h('h3', { itemprop: 'name' }, name)),
    h('div', { itemprop: 'offers', itemscope: '', itemtype: 'http://schema.org/Offer' },
      h('meta', { itemprop: 'priceCurrency', content: 'RUB' }), h('meta', { itemprop: 'price', content: String(price) }),
      h('span', {}, `${price.toLocaleString('ru-RU')} ₽`)),
    h('div', {}, place));
  const doc = h('html', {}, h('body', {}, h('div', { class: 'items' },
    card('aula_f75_1', 'AULA F75 новая', 4500, 'Москва, м. Сокол · 2 дня назад'),
    card('aula_f75_2', 'AULA F75 б/у', 3200, 'Химки · сегодня'),
    card('aula_f75_3', 'Клавиатура AULA F75 Gasket', 5100, 'Москва · вчера'))));
  const r = X.items(doc, BASE, 40);
  assert.equal(r.method, 'microdata');
  assert.equal(r.total, 3, 'вложенный Offer не даёт дублей');
  assert.deepEqual(plain(r.items[1]).url, 'https://www.avito.ru/moskva/tovary/aula_f75_2');
  assert.equal(r.items[1].price, 3200);
  assert.equal(r.items[1].currency, 'RUB');
  assert.match(r.items[1].details, /Химки · сегодня/, 'город и дата попадают в детали');
  assert.equal(r.items[1].image, 'https://00.img.avito.st/aula_f75_2.jpg', 'ленивая картинка: data-src, а не заглушка data:');
  assert.doesNotMatch(X.format(r, 'none'), /img\.avito/, 'ссылки на картинки модели не отправляются');
  const text = X.format(r, 'price_asc');
  assert.match(text, /^Found 3 item\(s\) via microdata:/);
  assert.match(text, /1\. 3 200 RUB \| AULA F75 б\/у \| .*Химки.* \| https:\/\/www\.avito\.ru\/moskva\/tovary\/aula_f75_2/);
  assert.match(text.split('\n')[3], /^3\. 5 100 RUB/, 'сортировка по цене');
  assert.equal(X.items(doc, BASE, 2).items.length, 2, 'лимит');
}

// ---- 4. Без разметки: повторяющиеся карточки с ценой ----
{
  const card = (t, p, href) => h('li', { class: 'card x1' }, h('img', { srcset: `/i${href}.webp 1x, /i${href}@2.webp 2x` }), h('a', { href }, t), h('span', { class: 'price' }, p), h('span', {}, 'Доставка завтра'));
  const doc = h('html', {}, h('body', {},
    h('header', {}, h('a', { href: '/' }, 'Главная'), h('span', {}, 'Корзина 0 ₽')),
    h('ul', { class: 'grid' }, card('Мышь Logitech G102', '1 290 ₽', '/m/1'), card('Мышь Razer Viper', '2 990 ₽', '/m/2'), card('Мышь ARDOR', '890 ₽', '/m/3'))));
  const r = X.items(doc, 'https://shop.example/', 40);
  assert.equal(r.method, 'cards');
  assert.deepEqual(plain(r.items.map((i) => [i.title, i.price, i.url])), [
    ['Мышь Logitech G102', 1290, 'https://shop.example/m/1'],
    ['Мышь Razer Viper', 2990, 'https://shop.example/m/2'],
    ['Мышь ARDOR', 890, 'https://shop.example/m/3']
  ], 'шапка с «Корзина 0 ₽» не принята за товар');
  assert.match(r.items[0].details, /Доставка завтра/);
  assert.equal(r.items[0].image, 'https://shop.example/i/m/1.webp', 'картинка из srcset');
}

// ---- 5. Пустая страница ----
assert.deepEqual(plain(X.items(h('html', {}, h('body', {}, h('p', {}, 'Ничего не найдено'))), BASE, 40)), { method: 'none', total: 0, items: [] });

// ---- 6. Описание продавца из JSON-LD и пометка «сильно дешевле медианы» (запчасть среди товаров) ----
{
  const ld = X.fromJsonLd({ '@type': 'ItemList', itemListElement: [
    { '@type': 'ListItem', item: { '@type': 'Product', name: 'Рама для велосипеда 29', category: 'Запчасти и аксессуары',
      description: 'Только рама,   без колёс и руля. Алюминий, размер L.', offers: { price: 2500, priceCurrency: 'RUB' }, url: '/r' } }
  ] }, BASE);
  assert.equal(ld[0].details, 'Запчасти и аксессуары · Только рама, без колёс и руля. Алюминий, размер L.', 'категория и описание продавца в details');

  const item = (title, price, details = '') => ({ title, price, currency: 'RUB', url: BASE + encodeURIComponent(title), rating: null, reviews: null, details });
  const r = { method: 'json-ld', total: 6, items: [
    item('Велосипед Stels Navigator', 18000), item('Велосипед Forward Sporting', 24000), item('Велосипед Merida Big Nine', 41000),
    item('Велосипед Stinger Element', 21000), item('Рама для велосипеда 29', 2500, 'Только рама'), item('Велосипед горный Author', 30000)
  ] };
  const text = X.format(r, 'price_asc');
  assert.match(text, /median price 24 000/, 'медиана в заголовке');
  const lines = text.split('\n');
  const frame = lines.find((l) => /Рама/.test(l));
  assert.match(frame, /⚠ much cheaper than most/, 'рама за 2 500 среди велосипедов помечена');
  assert.equal(lines.filter((l) => /⚠ much cheaper/.test(l)).length, 1, 'обычные велосипеды не помечены');
  assert.match(text, /1 item\(s\) marked ⚠: read their details/, 'итоговая подсказка — одна строка');
  assert.match(frame, /Только рама/, 'описание рядом с пометкой — модель видит, что это');

  // мало цен (меньше 5) — медианы нет, пометок нет: не на чем судить
  const few = X.format({ method: 'cards', total: 3, items: r.items.slice(3, 6) }, 'none');
  assert.doesNotMatch(few, /⚠|median/);
  // дешёвый товар без выброса (все цены близки) — без пометки
  assert.doesNotMatch(X.format({ method: 'x', total: 5, items: [1000, 1100, 900, 1200, 800].map((p, i) => item('Мышь ' + i, p)) }, 'none'), /⚠/);
}

// ---- 7. Все способы: разметка дала 2 товара, на экране 4 карточки — берём карточки ----
{
  const card = (t, p, href) => h('li', { class: 'card x1' }, h('a', { href }, t), h('span', { class: 'price' }, p));
  const ld = JSON.stringify({ '@type': 'ItemList', itemListElement: [
    { '@type': 'ListItem', item: { '@type': 'Product', name: 'Велосипед A', offers: { price: 10000 }, url: '/a' } },
    { '@type': 'ListItem', item: { '@type': 'Product', name: 'Велосипед B', offers: { price: 12000 }, url: '/b' } }
  ] });
  const doc = h('html', {}, h('head', {}, h('script', { type: 'application/ld+json' }, ld)), h('body', {},
    h('ul', {}, card('Велосипед A', '10 000 ₽', '/a'), card('Велосипед B', '12 000 ₽', '/b'), card('Велосипед C', '9 000 ₽', '/c'), card('Велосипед D', '15 000 ₽', '/d'))));
  const r = X.items(doc, BASE, 100);
  assert.equal(r.method, 'cards', 'карточек больше, чем в разметке — берём карточки (раньше до них не доходило)');
  assert.equal(r.total, 4);
  // равенство — разметка точнее
  const doc2 = h('html', {}, h('head', {}, h('script', { type: 'application/ld+json' }, ld)), h('body', {}, h('ul', {}, card('Велосипед A', '10 000 ₽', '/a'), card('Велосипед B', '12 000 ₽', '/b'))));
  assert.equal(X.items(doc2, BASE, 100).method, 'json-ld');
}

// ---- 8. Бюджет: сначала короче описания, потом меньше объявлений — и честно «showing N» ----
{
  const item = (i) => ({ title: 'Велосипед модель ' + i, price: 10000 + i * 100, currency: 'RUB', url: 'https://www.avito.ru/item/' + i, rating: null, reviews: null, details: 'Описание '.repeat(25) });
  const r = { method: 'json-ld', total: 60, items: Array.from({ length: 60 }, (_, i) => item(i)) };
  const full = X.format(r, 'none', 1e9);
  assert.match(full, /Описание Описание Описание/, 'без ограничения — полные описания');
  const t = X.format(r, 'none', 9000);
  assert.ok(t.length <= 9000, 'влезает в бюджет: ' + t.length);
  const shown = t.split('\n').filter((l) => /^\d+\. /.test(l)).length;
  assert.ok(shown >= 50, `описания сокращены раньше, чем объявления (${shown} из 60)`);
  if (shown < 60) assert.match(t, new RegExp(`showing ${shown}[,:]`), 'честно сказано, сколько показано');
  assert.ok(!/\| [^|\n]*$/.test(t.split('\n').pop()) || /avito/.test(t.split('\n').pop()), 'последняя строка не обрезана посередине');
  const tiny = X.format(r, 'none', 1500);
  const n = tiny.split('\n').filter((l) => /^\d+\. /.test(l)).length;
  assert.match(tiny, new RegExp(`showing ${n}[,:]`));
  assert.ok(tiny.length <= 1500);
}

// ---- 9. Обрезка без сортировки: сказано, сколько скрыто и по каким ценам; с сортировкой — что дальше по порядку ----
{
  // по порядку страницы дешёвые — в конце (как у выдачи «по релевантности»)
  const item = (i, price) => ({ title: 'Pinarello Dogma объявление номер ' + i, price, currency: 'RUB', url: 'https://www.avito.ru/item/' + i, rating: null, reviews: null, details: '' });
  const items = Array.from({ length: 100 }, (_, i) => item(i, i < 90 ? 200000 + i * 1000 : 74900 + (i - 90) * 1000));
  const r = { method: 'json-ld', total: 100, items };
  const t = X.format(r, 'none', 6000);
  assert.match(t, /\d+ more item\(s\) not shown \(prices 74 900–/, 'скрытые дешёвые видны по диапазону цен');
  assert.match(t, /sort=price_asc/, 'подсказка повторить с сортировкой');
  const sorted = X.format(r, 'price_asc', 6000);
  assert.match(sorted.split('\n')[1], /^1\. 74 900/, 'с сортировкой дешёвые первыми');
  assert.match(sorted, /come after these in the same order/);
  assert.doesNotMatch(X.format(r, 'price_asc', 1e9), /not shown/, 'всё влезло — без примечания');
}

// ---- 10. Сортировка — только внутри страницы: подсказка включить сортировку сайта ----
{
  const it = (i, p) => ({ title: 'Товар ' + i, price: p, currency: 'RUB', url: 'https://x.ru/' + i, rating: null, reviews: null, details: '' });
  const r = { method: 'cards', total: 3, items: [it(1, 300), it(2, 100), it(3, 200)] };
  assert.match(X.format(r, 'price_asc'), /Sorted within this page only\..*the cheapest come first/);
  assert.match(X.format(r, 'price_desc'), /most expensive come first/);
  assert.doesNotMatch(X.format(r, 'none'), /Sorted within this page/, 'без сортировки — без подсказки');
}

console.log('extract-items.test.js: OK');
