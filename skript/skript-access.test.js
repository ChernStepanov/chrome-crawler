'use strict';
/* Тесты слоя доступа /skript: пресеты по таблице R2 (SKRIPT_SPEC.md),
 * filterTools, classifyRisk, жёсткие запреты R3, бюджеты. Гейт R2 (SkriptMode.gate), toggle и confirmHard
 * в sidepanel.js вернутся вместе с skript-mode.js и хуками (этап 4).
 * Запуск: node skript-access.test.js — без внешних зависимостей. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const FILES = ['skript-policy.js', 'skript-access.js'];

// Мок chrome.storage.local (in-memory) + загрузка модулей в общую vm-область.
function makeCtx() {
 const store = {};
 const ctx = {
 console, URL,
 chrome: {
 storage: {
 local: {
 async get(def) {
 const out = { ...def };
 for (const k of Object.keys(def)) if (k in store) out[k] = store[k];
 return out;
 },
 async set(v) { Object.assign(store, v); }
 }
 }
 }
 };
 vm.createContext(ctx);
 for (const f of FILES) {
 vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
 }
 return ctx;
}

// Верхнеуровневые const не становятся свойствами глобального объекта —
// в панели их видят остальные <script>, в тесте забираем выражением.
const load = (ctx, name) => vm.runInContext(name, ctx);

async function main() {
 const ctx = makeCtx();
 const A = () => load(ctx, 'SkriptAccess');

 // ----1. Дефолты пресетов = таблица R2 из SKRIPT_SPEC.md ----
 const spec = {
 explorer: {
 see: true, act: true, nav: 'same-origin', web: true, tabs: true,
 tabCopy: false, evalFree: true, askHuman: 'needed',
 writeLibrary: true, executorCanPatch: false
 },
 cautious: {
 see: true, act: false, nav: 'none', web: false, tabs: false,
 tabCopy: false, evalFree: false, askHuman: 'never',
 writeLibrary: false, executorCanPatch: false
 },
 free: {
 see: true, act: true, nav: 'any', web: true, tabs: true,
 tabCopy: false, evalFree: true, askHuman: 'needed',
 writeLibrary: true, executorCanPatch: false
 }
 };
 for (const [preset, expected] of Object.entries(spec)) {
 const grants = A().resolveGrants(preset, null);
 for (const [g, v] of Object.entries(expected)) {
 assert.equal(grants[g], v, `пресет ${preset}: грант ${g} должен быть ${String(v)}, получено ${String(grants[g])}`);
 }
 }
 // Грант «Видеть» нельзя выключить даже оверрайдом (R2: всегда вкл).
 assert.equal(A().grantOn({ ...spec.cautious, see: false }, 'see'), true, 'see всегда включён');

 // ----2. «Осторожный»: filterTools не даёт ни одного инструмента воздействия ----
 const allNames = ['click', 'type_text', 'press_keys', 'scroll', 'navigate', 'fetch_page',
 'web_search', 'new_tab', 'eval_free', 'ask_human', 'ask_user', 'probe_globals',
 'query_dom', 'write_script', 'finish_skript', 'wait'];
 const allTools = allNames.map((n) => ({ function: { name: n } }));
 const cautiousTools = A().filterTools(allTools, A().resolveGrants('cautious', null))
 .map((t) => t.function.name);
 for (const banned of ['click', 'type_text', 'press_keys', 'scroll', 'navigate',
 'fetch_page', 'web_search', 'new_tab', 'eval_free', 'ask_human', 'ask_user']) {
 assert.ok(!cautiousTools.includes(banned), `«Осторожный»: ${banned} не должен попадать в набор`);
 }
 for (const kept of ['probe_globals', 'query_dom', 'write_script', 'finish_skript']) {
 assert.ok(cautiousTools.includes(kept), `«Осторожный»: ${kept} должен остаться`);
 }

 // ----3. classifyRisk ----
 const R = (name, args = {}, info = undefined, host = 'example.com') =>
 A().classifyRisk({ name, args, info, host });
 // Необратимые подписи → R2
 for (const label of ['Купить', 'Оплатить', 'Удалить', 'Отправить', 'Выйти']) {
 const r = R('click', {}, { label });
 assert.equal(r.cls, 'R2', `подпись «${label}» должна давать R2, получено ${r.cls}`);
 }
 // POST-форма → R2
 assert.equal(R('click', {}, { isSubmit: true }).cls, 'R2', 'кнопка отправки формы → R2');
 assert.equal(R('click', {}, { inForm: true }, 'example.com') && R('click', { submit: true }, { inForm: true }).cls, 'R2', 'submit формы → R2');
 assert.equal(R('fetch_page', { method: 'POST' }).cls, 'R2', 'fetch_page POST → R2');
 // Обратимое/чтение → R0/R1
 assert.equal(R('click', {}, { label: 'Подробнее' }).cls, 'R1', 'клик по ссылке → R1');
 assert.equal(R('scroll').cls, 'R1', 'скролл → R1');
 assert.equal(R('query_dom').cls, 'R0', 'чтение DOM → R0');
 // Заниженный риск от модели игнорируется (класс только повышается)
 assert.equal(R('click', { risk: 'R0' }, { label: 'Купить' }).cls, 'R2', 'args.risk не может занизить класс');
 assert.equal(R('click', { risk: 'R1', risky: false }, { label: 'Оплатить' }).cls, 'R2', 'risky=false не может занизить класс');
 // Модель может только повысить
 assert.equal(R('click', { risk: 'R2' }, { label: 'Подробнее' }).cls, 'R2', 'args.risk повышает класс');

 // ----5. R3 и жёсткие запреты ----
 assert.equal(R('click', {}, { label: 'ОК' }, 'paypal.com').cls, 'R3', 'чувствительный домен → R3');
 assert.equal(R('type_text', {}, { label: 'Пароль', isPassword: true }).cls, 'R3', 'поле пароля → R3');
 assert.equal(R('type_text', {}, { label: 'Номер карты' }).cls, 'R3', 'платёжное поле → R3');
 assert.ok(A().skriptBannedHost('mail.google.com'), 'почтовый домен banned');
 assert.ok(!A().skriptBannedHost('paymentwall-news.example.com'), 'лейбл на границе домена не банится');
 assert.ok(A().skriptHardBan({ host: 'sberbank.ru' }), 'банк → hardBan');
 assert.ok(A().skriptHardBan({ host: 'example.com', info: { label: 'Пароль', isPassword: true } }), 'поле пароля → hardBan');
 assert.equal(A().skriptHardBan({ host: 'example.com', info: { label: 'Подробнее' } }), null, 'обычная кнопка не банится');

 assert.equal(R('navigate', { url: 'https://paypal.com/x' }, undefined, 'example.com').cls, 'R3', 'переход на чувствительный домен → R3');
 assert.notEqual(R('navigate', { url: 'https://example.org/x' }, undefined, 'example.com').cls, 'R3', 'обычный переход не R3');
 // ---- Этап 2 v3: ложные срабатывания «пин» и код черновиков ----
 for (const label of ['Спинер', 'Опинионы', 'Pin this', 'Pinterest']) {
 assert.notEqual(R('click', {}, { label }).cls, 'R3', `«${label}» не должен считаться секретным полем`);
 }
 for (const label of ['PIN', 'ПИН-код', 'Введите PIN code', 'CVV']) {
 assert.equal(R('type_text', {}, { label }).cls, 'R3', `«${label}» — секретное поле → R3`);
 }
 assert.equal(R('write_script', { code: 'fetch("/x")' }).cls, 'R3', 'write_script с fetch → R3');
 assert.equal(R('draft_script', { code: 'window["fetch"](1)' }).cls, 'R3', 'draft_script с обходом → R3');
 assert.equal(R('patch_script', { code: 'const a = 1; return a;' }).cls, 'R0', 'чистый код → R0');

 // ----6. Бюджет: шаги и время ----
 const b = new (A().Budget)({ steps:60, minutes:10 });
 let stop = null;
 for (let i =0; i <59 && !stop; i++) stop = b.tick(0);
 assert.equal(stop, null, '59 шагов бюджета — ещё не исчерпан');
 stop = b.tick(0);
 assert.equal(stop && stop.reason, 'steps', '60-й шаг останавливает сессию (steps)');
 assert.equal(stop.limit,60, 'лимит шагов =60');
 // Время: подменяем таймер в vm-контексте (сохраняем и восстанавливаем).
 const b2 = new (A().Budget)({ steps:500, minutes:10 });
 b2.ms =60_000;
 const realNow = Date.now;
 try {
 vm.runInContext(`Date.now = () => ${realNow()} +120000;`, ctx); // +2 мин за лимитом
 const t = b2.tick(0);
 assert.equal(t && t.reason, 'time', 'истёкшее время останавливает сессию (time)');
 } finally {
 Date.now = realNow;
 ctx.__realNow = realNow;
 vm.runInContext('Date.now = __realNow; delete __realNow;', ctx);
 }
 // Поиски
 const b3 = new (A().Budget)({ steps:500, minutes:10, searches:2 });
 assert.equal(b3.search(1), null);
 assert.equal(b3.search(1) && b3.search(1).reason, 'searches', 'исчерпание поисков останавливает сессию');

 console.log(`skript-access.test.js: OK (${spec.explorer ?3 :0} пресета, R2/R3, бюджеты)`);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });