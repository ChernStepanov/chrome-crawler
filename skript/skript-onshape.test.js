'use strict';
/* Тест встроенного навыка Onshape (skript-onshape.js) и реестра (skript-builtin.js).
 * REST API Onshape — мок: проверяем порядок вызовов, тела запросов, сохранение параметров
 * при обновлении и разбор ошибок. Живой Onshape этим тестом НЕ проверяется.
 * Запуск: node skript-onshape.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeEl {
  constructor(tag) { this.tag = tag; this.children = []; this._text = ''; this.dataset = {}; this.hidden = false; this.className = ''; }
  append(...n) { for (const c of n) if (c && typeof c === 'object') c.parent = this; this.children.push(...n); }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); this.parent = null; } }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener() {}
  removeEventListener() {}
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const r = c.find && c.find(pred); if (r) return r; } return null; }
  get scrollHeight() { return 0; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (v) => JSON.parse(JSON.stringify(v));

const DID = 'a'.repeat(24), WID = 'b'.repeat(24), EID = 'c'.repeat(24), FS = 'f'.repeat(24);
const URL_PS = `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`;
const HEAD = 'FeatureScript 2384;\nimport(path : "onshape/std/common.fs", version : "2384.0");\n';
const CODE = `FeatureScript 1;
import(path : "onshape/std/common.fs", version : "1.0");
const SIZE = { (millimeter) : [1, 40, 10000] } as LengthBoundSpec;
annotation { "Feature Type Name" : "Box" }
export const crawlerBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { annotation { "Name" : "Length" } isLength(definition.length, SIZE); }
    { fCuboid(context, id + "cuboid1", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(1, 1, 1) * definition.length }); });`;

// Мок Onshape: маршруты → ответы; журнал вызовов.
function fakeOnshape(over = {}) {
  const calls = [];
  const state = { features: [], fsContents: HEAD, ...over.state };
  const route = async (method, url, body) => {
    const p = url.replace('/api/v6', '');
    if (over[`${method} ${p.split('?')[0]}`]) return over[`${method} ${p.split('?')[0]}`](body);
    if (method === 'GET' && p.startsWith(`/documents/d/${DID}/w/${WID}/elements`)) return [{ id: EID, elementType: 'PARTSTUDIO' }];
    if (method === 'POST' && p === `/featurestudios/d/${DID}/w/${WID}`) return { id: FS };
    if (method === 'GET' && p === `/featurestudios/d/${DID}/w/${WID}/e/${FS}`) return { contents: state.fsContents, serializationVersion: '1.2', sourceMicroversion: 'smv1' };
    if (method === 'POST' && p === `/featurestudios/d/${DID}/w/${WID}/e/${FS}`) { state.fsContents = body.contents; return { notices: [] }; }
    if (method === 'GET' && p === `/featurestudios/d/${DID}/w/${WID}/e/${FS}/featurespecs`) return { featureSpecs: [{ featureType: 'crawlerBox' }] };
    if (method === 'GET' && p === `/documents/d/${DID}/w/${WID}/currentmicroversion`) return { microversion: 'mv7' };
    if (method === 'GET' && p === `/partstudios/d/${DID}/w/${WID}/e/${EID}/features`) return { features: state.features, featureStates: state.featureStates || {} };
    if (method === 'POST' && p === `/partstudios/d/${DID}/w/${WID}/e/${EID}/features`) { const f = { ...body.feature, featureId: 'F1' }; state.features.push(f); return { feature: f, featureState: { featureStatus: 'OK' } }; }
    if (method === 'POST' && p.startsWith(`/partstudios/d/${DID}/w/${WID}/e/${EID}/features/featureid/`)) return { feature: body.feature, featureState: { featureStatus: 'OK' } };
    if (method === 'DELETE' && p.startsWith(`/partstudios/d/${DID}/w/${WID}/e/${EID}/features/featureid/`)) { state.features = state.features.filter((f) => !p.endsWith('/' + f.featureId)); return {}; }
    return { __status: 404, text: 'not found' };
  };
  const fetch = async (url, opt) => {
    const body = opt.body ? JSON.parse(opt.body) : undefined;
    calls.push({ method: opt.method, url: url.replace('/api/v6', '').split('?')[0], body, headers: opt.headers });
    const r = await route(opt.method, url, body);
    const status = r && r.__status ? r.__status : 200;
    const text = r && r.__status ? r.text : JSON.stringify(r);
    return { ok: status < 300, status, text: async () => text };
  };
  return { fetch, calls, state };
}

const mem = {};
const storage = { get: async (d) => ({ ...d, ...JSON.parse(JSON.stringify(mem)) }), set: async (o) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); } };
const copied = [];
const ctx = vm.createContext({ console, URL, setTimeout, clearTimeout, document: { createElement: (t) => new FakeEl(t) }, chrome: { storage: { local: storage } }, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } } });
for (const f of ['skript-card.js', 'skript-onshape.js', 'skript-builtin.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
const O = vm.runInContext('SkriptOnshape', ctx);
const B = vm.runInContext('SkriptBuiltin', ctx);

// Исполнение функции «в странице»: отдельный контекст с fetch и cookie (как executeScript).
async function inPage(fake, args, cookie = 'a=1; XSRF-TOKEN=tok%3D1') {
  const page = vm.createContext({ console, setTimeout, fetch: fake.fetch, document: { cookie } });
  const fn = vm.runInContext(`(${O.apply.toString()})`, page);
  return plain(await fn(args));
}
const base = { api: '/api/v6', did: DID, wid: WID, eid: EID, studioName: 'Crawler: Box', pollMs: [0, 1], statePollMs: [0, 1] };

(async () => {
  // ---- 1. URL ----
  assert.deepEqual(plain(O.parseUrl(URL_PS)), { origin: 'https://cad.onshape.com', did: DID, wid: WID, eid: EID });
  assert.match(O.parseUrl('https://example.com/').error, /не страница Onshape/);
  assert.match(O.parseUrl('https://cad.onshape.com/documents').error, /Part Studio/);
  assert.match(O.parseUrl(`https://cad.onshape.com/documents/${DID}/v/${WID}/e/${EID}`).error, /рабочую ветку/);
  assert.ok(!O.parseUrl(`https://company.onshape.com/documents/${DID}/w/${WID}/e/${EID}`).error, 'корпоративный поддомен');

  // ---- 2. Подготовка кода ----
  const prep = plain(O.prepare(CODE));
  assert.equal(prep.featureType, 'crawlerBox');
  assert.equal(prep.title, 'Box');
  assert.ok(!/FeatureScript 1;|onshape\/std\/common/.test(prep.body), 'заголовок модели убран (версия берётся из Onshape)');
  assert.match(prep.body, /^const SIZE/);
  assert.match(O.prepare('').error, /Empty/);
  assert.match(O.prepare('function f() {}').error, /defineFeature/);

  // ---- 2a. Локальная проверка: код из живого лога (три ошибки модели) ----
  {
    const fromLog = `const LENGTH_BOUNDS = { (millimeter) : [1, 100, 10000] } as LengthBoundSpec;
annotation { "Feature Type Name" : "Box" }
export const crawlerBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { annotation { "Name" : "Длина" } isLength(definition.length, LENGTH_BOUNDS); }
    {
        fCuboid(context, id + "outer", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(definition.length, definition.width, definition.height) });
        fCuboid(context, id + "inner", { "corner1" : vector(definition.wall, definition.wall, definition.wall) * millimeter,
                "corner2" : vector(definition.length - definition.wall, definition.width - definition.wall, definition.height + 1 * millimeter) });
        opBoolean(context, id + "cut", { "tools" : makeQuery(context, id + "inner"), "targets" : makeQuery(context, id + "outer"), "operationType" : BooleanOperationType.SUBTRACTION });
    });`;
    const issues = plain(O.lint(fromLog));
    assert.ok(issues.some((x) => /LENGTH_BOUNDS" is already defined/.test(x)), 'переопределение стандартного имени');
    assert.ok(issues.some((x) => /makeQuery/.test(x)), 'makeQuery');
    assert.ok(issues.some((x) => /vector\(definition\.wall/.test(x)), 'параметр с единицами умножен на millimeter');
    assert.equal(issues.length, 3, issues.join('\n'));
    // Образцы из шпаргалки и тестовый код проходят проверку (нет ложных срабатываний).
    const pattern = O.prompt().split('\n').filter((l) => /^ {2}/.test(l)).join('\n').replace('Sketch + extrude:', '');
    assert.deepEqual(plain(O.lint(pattern)), [], 'шпаргалка проходит собственную проверку');
    assert.deepEqual(plain(O.lint(prep.body)), []);
    // живой Onshape: ADD вместо UNION и точка без единиц — фича падала при перестроении
    const live = plain(O.lint('precondition {} opBoolean(context, id + "u", { "operationType" : BooleanOperationType.ADD }); ' +
      'fCylinder(context, id + "c", { "bottomCenter" : vector(0, 0, 0), "topCenter" : vector(0, 0, 1) * millimeter, "radius" : 2 * millimeter });'));
    assert.equal(live.length, 2, live.join('\n'));
    assert.match(live[0], /BooleanOperationType\.ADD does not exist.*BooleanOperationType\.UNION/);
    assert.match(live[1], /"bottomCenter" : vector\(0, 0, 0\) has no units/);
    assert.match(O.lint('export const a = defineFeature(function(context is Context, id is Id, definition is map) { fCuboid(context, id + "x", {}); fCuboid(context, id + "x", {}); });').join(' '), /used 2 times.*No precondition|No precondition.*used 2 times|used 2 times/);
    assert.ok(O.lint('x * millimeter; definition.length * millimeter;').some((s) => /already has units/.test(s)));
  }

  // ---- 3. Промпт навыка ----
  const pr = O.prompt({ units: 'inch', notes: 'фаски 0.5 мм' });
  assert.match(pr, /onshape_featurescript/);
  assert.match(pr, /SAME name/);
  assert.match(pr, /units inch; фаски 0\.5 мм/);
  assert.match(O.prompt(), /units millimeter\./);

  // ---- 4. Новая деталь: полный поток API ----
  {
    const fake = fakeOnshape();
    const r = await inPage(fake, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null, explicit: [{ parameterId: 'length', kind: 'length', expression: '50 mm' }], defaults: [{ parameterId: 'length', kind: 'length', expression: '40 mm' }], declared: ['length'] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.status, 'OK');
    assert.equal(r.fsEid, FS);
    assert.equal(r.featureId, 'F1');
    assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.url}`), [
      `GET /documents/d/${DID}/w/${WID}/elements`,
      `POST /featurestudios/d/${DID}/w/${WID}`,
      `GET /featurestudios/d/${DID}/w/${WID}/e/${FS}`,
      `POST /featurestudios/d/${DID}/w/${WID}/e/${FS}`,
      `GET /featurestudios/d/${DID}/w/${WID}/e/${FS}/featurespecs`,
      `POST /partstudios/d/${DID}/w/${WID}/e/${EID}/featurescript`,   // твёрдых тел до (для разбора неудачи)
      `GET /documents/d/${DID}/w/${WID}/currentmicroversion`,
      `POST /partstudios/d/${DID}/w/${WID}/e/${EID}/features`
    ]);
    assert.equal(fake.calls[0].headers['X-XSRF-TOKEN'], 'tok=1', 'XSRF из cookie');
    const write = fake.calls[3].body;
    assert.ok(write.contents.startsWith('FeatureScript 2384;\nimport(path : "onshape/std/common.fs", version : "2384.0");\n\nconst SIZE'), 'актуальный заголовок Onshape + код модели');
    assert.equal(write.sourceMicroversion, 'smv1');
    const feat = fake.calls[7].body.feature;
    assert.equal(feat.namespace, `e${FS}::mmv7`);
    assert.equal(feat.featureType, 'crawlerBox');
    assert.deepEqual(feat.parameters, [{ btType: 'BTMParameterQuantity-147', parameterId: 'length', expression: '50 mm', isInteger: false }]);
  }

  // ---- 5. Ошибка компиляции → модель исправляет ----
  {
    const fake = fakeOnshape({ [`POST /featurestudios/d/${DID}/w/${WID}/e/${FS}`]: () => ({ notices: [{ level: 'ERROR', message: { message: 'Line 3: undefined variable foo' } }, { level: 'INFO', message: { message: 'ok' } }] }) });
    const r = await inPage(fake, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'compile');
    assert.deepEqual(r.errors, ['Line 3: undefined variable foo']);
    assert.equal(r.fsEid, FS, 'Feature Studio запомнена: исправление пойдёт в неё же');
    // без notices, но фича не появилась в featurespecs — тоже компиляция
    const fake2 = fakeOnshape({ [`GET /featurestudios/d/${DID}/w/${WID}/e/${FS}/featurespecs`]: () => ({ featureSpecs: [] }) });
    const r2 = await inPage(fake2, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r2.stage, 'compile');
    assert.match(r2.errors[0], /not available after compiling.*no readable error text/);
    assert.match(r2.debug, /^update=.*featurespecs=\{"featureSpecs":\[\]\}/, 'сырой ответ Onshape для диагностики');
    // другой формат ответа: ошибки под ключом *error* со строкой
    const fake3 = fakeOnshape({
      [`POST /featurestudios/d/${DID}/w/${WID}/e/${FS}`]: () => ({ compileErrors: [{ message: 'Symbol LENGTH_BOUNDS already defined', line: 3 }] }),
      [`GET /featurestudios/d/${DID}/w/${WID}/e/${FS}/featurespecs`]: () => ({ featureSpecs: [] })
    });
    const r3 = await inPage(fake3, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.deepEqual(r3.errors, ['line 3: Symbol LENGTH_BOUNDS already defined'], 'текст и строка ошибки дошли до модели');
    // перестроение с ошибкой: статус и сырое состояние
    const fake4 = fakeOnshape({ [`POST /partstudios/d/${DID}/w/${WID}/e/${EID}/features`]: () => ({ feature: { featureId: 'F9' }, featureState: { featureStatus: 'ERROR' } }) });
    const r4 = await inPage(fake4, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r4.ok, false); assert.equal(r4.stage, 'regen'); assert.equal(r4.status, 'ERROR');
    assert.match(r4.debug, /featureState=\{"featureStatus":"ERROR"\}/);
    assert.equal(r4.bodiesBefore, null, 'счёт тел недоступен (404) — неизвестно, а не «0»'); assert.equal(r4.bodiesAfter, null);
    // ERROR: тел до и после столько же; предупреждение Feature Studio доходит до модели
    const probes = [];
    let n = 3;
    const fake5 = fakeOnshape({ state: { featureStates: { F9: { featureStatus: 'ERROR' } } },
      [`POST /featurestudios/d/${DID}/w/${WID}/e/${FS}`]: () => ({ notices: [{ level: 'WARNING', message: 'Invalid enum access: BooleanOperationType.ADD', line: 41 }] }),
      [`POST /partstudios/d/${DID}/w/${WID}/e/${EID}/features`]: () => ({ feature: { featureId: 'F9' }, featureState: { featureStatus: 'ERROR' } }),
      [`POST /partstudios/d/${DID}/w/${WID}/e/${EID}/featurescript`]: (b) => { probes.push(b.script); return { result: { btType: 'BTFSValueNumber', value: n } }; } });
    const r5 = await inPage(fake5, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r5.ok, false); assert.equal(r5.bodiesBefore, 3); assert.equal(r5.bodiesAfter, 3);
    assert.match(probes[0], /qBodyType\(qEverything\(EntityType\.BODY\), BodyType\.SOLID\)/, 'считаем все твёрдые тела Part Studio');
    assert.deepEqual(r5.warnings, ['line 41: Invalid enum access: BooleanOperationType.ADD'], 'предупреждение компиляции сохранено');
  }

  // ---- 5c. Живой случай: ответ на добавление — ERROR, а в дереве фича OK (деталь построилась) ----
  {
    const live = fakeOnshape({
      state: { featureStates: { F1: { featureStatus: 'OK' } } },
      [`POST /partstudios/d/${DID}/w/${WID}/e/${EID}/features`]: () => ({ feature: { featureId: 'F1' }, featureState: { featureStatus: 'ERROR' } })
    });
    const r = await inPage(live, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r.ok, true, 'верим дереву, а не раннему статусу: ' + JSON.stringify(r));
    assert.equal(r.status, 'OK');
    assert.ok(r.steps.includes('status in the answer ERROR, in the feature tree OK'));
    // В дереве тоже ERROR — тогда это настоящая ошибка.
    const bad = fakeOnshape({
      state: { featureStates: { F1: { featureStatus: 'ERROR' } } },
      [`POST /partstudios/d/${DID}/w/${WID}/e/${EID}/features`]: () => ({ feature: { featureId: 'F1' }, featureState: { featureStatus: 'ERROR' } })
    });
    const r2 = await inPage(bad, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r2.ok, false); assert.equal(r2.status, 'ERROR');
  }

  // ---- 5b. Компиляция с задержкой: фича появляется в списке не сразу — ждём, а не сдаёмся ----
  {
    let n = 0;
    const slow = fakeOnshape({ [`GET /featurestudios/d/${DID}/w/${WID}/e/${FS}/featurespecs`]: () => (++n < 3 ? { featureSpecs: [] } : { featureSpecs: [{ featureType: 'crawlerBox' }] }) });
    const r = await inPage(slow, { ...base, pollMs: [0, 1, 1, 1], body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(n, 3, 'опрос до появления фичи');
    assert.ok(r.steps.includes('feature specs polled 3 times'));
    let m = 0;
    const never = fakeOnshape({ [`GET /featurestudios/d/${DID}/w/${WID}/e/${FS}/featurespecs`]: () => { m++; return { featureSpecs: [] }; } });
    const r2 = await inPage(never, { ...base, pollMs: [0, 1, 1], body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r2.stage, 'compile'); assert.equal(m, 3); assert.match(r2.errors[0], /waited 3 checks/);
    // Имя фичи как у стандартной — отклоняем до отправки; шпаргалка сама так не называет.
    assert.ok(O.lint('export const box = defineFeature(function(context is Context, id is Id, definition is map) precondition {} { });').some((x) => /may clash.*crawlerBox/.test(x)));
    assert.ok(!/export const box\b/.test(O.prompt()), 'образец в шпаргалке не учит модель имени box');
  }

  // ---- 5a. Onshape переключился на Feature Studio: деталь всё равно идёт в Part Studio ----
  {
    const els = (list) => ({ [`GET /documents/d/${DID}/w/${WID}/elements`]: () => list });
    const PS2 = 'd'.repeat(24);
    const one = fakeOnshape(els([{ id: EID, name: 'Part Studio 1', elementType: 'PARTSTUDIO' }, { id: FS, name: 'Crawler: Box', elementType: 'FEATURESTUDIO' }]));
    const r = await inPage(one, { ...base, eid: FS, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.psEid, EID); assert.equal(r.psName, 'Part Studio 1');
    assert.ok(one.calls.some((c) => c.url === `/partstudios/d/${DID}/w/${WID}/e/${EID}/features`), 'добавлено в единственную Part Studio');
    const many = [{ id: EID, name: 'Корпус', elementType: 'PARTSTUDIO' }, { id: PS2, name: 'Крышка', elementType: 'PARTSTUDIO' }, { id: FS, name: 'Crawler: Box', elementType: 'FEATURESTUDIO' }];
    const r2 = await inPage(fakeOnshape(els(many)), { ...base, eid: FS, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r2.stage, 'element');
    assert.match(r2.errors[0], /2 Part Studios \(Корпус, Крышка\)/, 'несколько — спросить пользователя, с названиями');
    const r3 = await inPage(fakeOnshape(els(many)), { ...base, eid: FS, fallbackEid: EID, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r3.psEid, EID, 'запомненная Part Studio');
  }

  // ---- 6. Обновление только значений: параметры пользователя сохраняются ----
  {
    const fake = fakeOnshape({ state: { features: [{ btType: 'BTMFeature-134', featureId: 'F1', nodeId: 'N1', name: 'Box', namespace: 'eold::mold', featureType: 'crawlerBox', parameters: [{ btType: 'BTMParameterQuantity-147', parameterId: 'length', expression: '40 mm' }, { btType: 'BTMParameterQuantity-147', parameterId: 'width', expression: '12 mm' }] }] } });
    const r = await inPage(fake, { ...base, body: null, featureType: null, featureName: 'Box', existing: { fsEid: FS, featureId: 'F1', psEid: EID, featureType: 'crawlerBox' }, explicit: [{ parameterId: 'length', kind: 'length', expression: '55 mm' }] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(!fake.calls.some((c) => c.method === 'POST' && c.url.startsWith('/featurestudios')), 'код не переписывается');
    const last = fake.calls[fake.calls.length - 1];
    assert.equal(last.url, `/partstudios/d/${DID}/w/${WID}/e/${EID}/features/featureid/F1`);
    assert.deepEqual(last.body.feature.parameters.map((p) => `${p.parameterId}=${p.expression}`), ['length=55 mm', 'width=12 mm'], 'новое значение + настроенная пользователем ширина');
    assert.equal(last.body.feature.nodeId, 'N1', 'обновляется существующая фича целиком (живой Onshape: «Feature does not match» на собранной заново)');
    assert.equal(last.body.feature.namespace, `e${FS}::mmv7`);

    // Onshape всё равно отверг обновление (400) → удалить и добавить заново с теми же значениями.
    const rej = fakeOnshape({
      state: { features: [{ btType: 'BTMFeature-134', featureId: 'F1', nodeId: 'N1', featureType: 'crawlerBox', parameters: [{ btType: 'BTMParameterQuantity-147', parameterId: 'length', expression: '33 mm' }] }] },
      [`POST /partstudios/d/${DID}/w/${WID}/e/${EID}/features/featureid/F1`]: () => ({ __status: 400, text: '{"message":"Feature does not match"}' })
    });
    const rr = await inPage(rej, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: { fsEid: FS, featureId: 'F1', psEid: EID, featureType: 'crawlerBox' },
      explicit: [], defaults: [{ parameterId: 'length', kind: 'length', expression: '40 mm' }], declared: ['length'] });
    assert.equal(rr.ok, true, JSON.stringify(rr));
    const seq = rej.calls.slice(-3).map((c) => `${c.method} ${c.url.replace(/.*\/features/, '/features')}`);
    assert.deepEqual(seq, ['POST /features/featureid/F1', 'DELETE /features/featureid/F1', 'POST /features']);
    assert.equal(rej.calls[rej.calls.length - 1].body.feature.parameters[0].expression, '33 mm', 'значение пользователя перенесено, а не сброшено к умолчанию');
    assert.equal(rr.featureId, 'F1', 'новый id фичи из ответа');
    assert.ok(rr.steps.some((x) => /re-added/.test(x)));
  }

  // ---- 6a. Параметры из кода: значения по умолчанию, единицы, обязательность ----
  {
    const code = 'const BOX_SIZE_BOUNDS = { (millimeter) : [1, 40, 10000] } as LengthBoundSpec;\nconst N_BOUNDS = { (unitless) : [1, 6, 50] } as IntegerBoundSpec;\n' +
      'annotation { "Feature Type Name" : "Box" }\nexport const crawlerBox = defineFeature(function(context is Context, id is Id, definition is map)\n precondition\n {\n' +
      ' annotation { "Name" : "Width" } isLength(definition.width, BOX_SIZE_BOUNDS);\n annotation { "Name" : "Count" } isInteger(definition.n, N_BOUNDS);\n' +
      ' annotation { "Name" : "Hollow", "Default" : false } definition.hollow is boolean;\n annotation { "Name" : "Angle" } isAngle(definition.a, ANGLE_360_BOUNDS);\n }\n { });';
    const d = plain(O.declared(code));
    assert.deepEqual(d, [{ id: 'width', kind: 'length', def: '40 mm' }, { id: 'n', kind: 'integer', def: '6' }, { id: 'a', kind: 'angle', def: null }, { id: 'hollow', kind: 'boolean', def: 'false' }]);
    const all = plain(O.values(d, { width: 80, a: 30 }, 'inch', true));
    assert.equal(all.missing, undefined);
    assert.deepEqual(all.specs.map((p) => `${p.parameterId}:${p.kind}:${p.expression ?? p.value}`), ['width:length:80 in', 'n:integer:6', 'a:angle:30 deg', 'hollow:boolean:false'], 'числа получают единицы из предпочтений');
    assert.deepEqual(plain(O.values(d, {}, 'millimeter', true).missing), ['a'], 'у угла со стандартными границами нет известного умолчания');
  }

  // ---- 7. Ошибки окружения ----
  {
    const asm = fakeOnshape({ [`GET /documents/d/${DID}/w/${WID}/elements`]: () => [{ elementType: 'ASSEMBLY' }] });
    const r = await inPage(asm, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r.stage, 'element');
    const denied = fakeOnshape({ [`GET /documents/d/${DID}/w/${WID}/elements`]: () => ({ __status: 403, text: 'Forbidden: XSRF' }) });
    const r2 = await inPage(denied, { ...base, body: prep.body, featureType: 'crawlerBox', featureName: 'Box', existing: null });
    assert.equal(r2.stage, 'api');
    assert.match(r2.errors[0], /HTTP 403: Forbidden: XSRF/, 'ответ API дословно — для отладки в живом Onshape');
    const noCode = await inPage(fakeOnshape(), { ...base, body: null, featureType: null, featureName: 'Box', existing: null, explicit: [{ parameterId: 'a', kind: 'length', expression: '1 mm' }] });
    assert.equal(noCode.stage, 'params');
  }

  // ---- 8. Склейка в панели: карточка, одобрение, запоминание связки, повторный вызов ----
  {
    const fake = fakeOnshape();
    const container = new FakeEl('div');
    const ac = new AbortController();
    let url = URL_PS;
    const logs = [];
    const opened = [];
    O.init({
      tabUrl: async () => url, fail: (text) => ({ text, error: true }), container, signal: () => ac.signal, log: (k, t) => logs.push([k, t]),
      openUrl: (tabId, u) => opened.push([tabId, u]),
      exec: async (tabId, func, args) => {
        const page = vm.createContext({ console, setTimeout, fetch: fake.fetch, document: { cookie: '' } });
        return [{ result: plain(await vm.runInContext(`(${func.toString()})`, page)(...args)) }];
      }
    });
    const btn = (label) => container.find((e) => e.tag === 'button' && e.textContent === label);
    const p = O.handle({ name: 'Box', code: CODE }, { tabId: 1 });
    await sleep(10);
    assert.ok(container.textContent.includes('Onshape: Box') && container.textContent.includes('новая деталь'), 'карточка с названием');
    assert.ok(container.textContent.includes('fCuboid'), 'в карточке код');
    await btn('Копировать').onclick();
    assert.ok(copied[0].includes('fCuboid') && !copied[0].includes('FeatureScript 1;'), 'кнопка копирует код карточки');
    assert.ok(btn('Скопировано'), 'отклик на кнопке');
    btn('Создать в Onshape').onclick();
    // построено — проверка человеком в Onshape до того, как модель пойдёт дальше
    for (let i = 0; i < 100 && !btn('Работает'); i++) await sleep(10);
    assert.ok(btn('Работает') && btn('Не работает'), 'после первой построенной версии — «Работает» / «Не работает»');
    btn('Работает').onclick();
    const res = await p;
    assert.ok(!res.error, res.text);
    assert.match(res.text, /created in the Part Studio, status OK/);
    assert.equal(res.finished, true, '«Работает» — задача закончена без модели');
    assert.match(res.summary, /готова .*проверено вами в Onshape/);
    btn('Открыть Feature Studio').onclick();
    assert.deepEqual(opened, [[1, `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${FS}`]], 'та же вкладка, адрес Feature Studio');
    assert.deepEqual(plain(mem.onshapeParts[DID].Box).fsEid, FS);
    assert.ok(mem.onshapeParts[DID].Box.body.includes('fCuboid') && mem.onshapeParts[DID].Box.lastOk === true, 'код детали запомнен для следующих задач');
    assert.deepEqual(plain(mem.onshapeVerified.fCuboid), { keys: ['corner1', 'corner2'], ok: 1, fail: 0, at: mem.onshapeVerified.fCuboid.at }, 'успех записан в память проверенного');
    assert.match((await B.forUrl(URL_PS)).prompt, /- fCuboid \{ corner1, corner2 \} ×1/, 'и попадает в промпт следующей задачи');
    // Следующая задача в этом документе видит деталь и её код — «скругли рёбра» дополнит её, а не создаст вторую.
    const next = (await B.forUrl(URL_PS)).prompt;
    assert.match(next, /PARTS ALREADY MADE IN THIS DOCUMENT/);
    assert.match(next, /- name "Box" \(feature crawlerBox\):\nconst SIZE/);
    assert.match(next, /EXTEND ITS CODE below and call onshape_featurescript with the SAME name/);
    assert.ok(!/PARTS ALREADY MADE/.test((await B.forUrl(`https://cad.onshape.com/documents/${'9'.repeat(24)}/w/${WID}/e/${EID}`)).prompt), 'в другом документе — нет');
    assert.equal(mem.onshapeParts[DID].Box.featureId, 'F1');

    // Второй вызов с тем же именем — обновление той же фичи, кнопка «Обновить».
    const p2 = O.handle({ name: 'Box', params: { length: '70 mm' } }, { tabId: 1 });
    await sleep(10);
    assert.ok(btn('Обновить в Onshape'), 'повторный вызов — обновление');
    btn('Обновить в Onshape').onclick();
    for (let i = 0; i < 100 && !btn('Работает'); i++) await sleep(10);
    btn('Работает').onclick();                                   // каждая построенная версия — проверка человеком
    assert.match((await p2).text, /updated/);
    assert.match(fake.calls[fake.calls.length - 1].url, /featureid\/F1$/);

    // Отклонение: ничего не меняется.
    const n = fake.calls.length;
    const p3 = O.handle({ name: 'Box', params: { length: '1 mm' } }, { tabId: 1 });
    await sleep(10);
    btn('Отклонить').onclick();
    assert.match((await p3).text, /rejected/);
    assert.equal(fake.calls.length, n, 'после отклонения запросов к Onshape нет');

    // Заведомо плохой код не доходит до карточки и Onshape.
    const before = container.children.length, nCalls = fake.calls.length;
    const bad = await O.handle({ name: 'Box', code: 'const LENGTH_BOUNDS = 1;\nexport const crawlerBox = defineFeature(function(context is Context, id is Id, definition is map) precondition {} { });' }, { tabId: 1 });
    assert.ok(bad.error && /already defined in the Onshape standard library/.test(bad.text), bad.text);
    assert.equal(container.children.length, before, 'без карточки');
    assert.equal(fake.calls.length, nCalls, 'без запросов к Onshape');

    // Ошибка компиляции: сырой ответ уходит в лог целиком и модели.
    const compFake = fakeOnshape({ [`GET /featurestudios/d/${DID}/w/${WID}/e/${FS}/featurespecs`]: () => ({ featureSpecs: [] }) });
    O.init({ tabUrl: async () => url, fail: (text) => ({ text, error: true }), container, signal: () => ac.signal, log: (k, t) => logs.push([k, t]),
      exec: async (tabId, func, args) => { const page = vm.createContext({ console, setTimeout, fetch: compFake.fetch, document: { cookie: '' } }); return [{ result: plain(await vm.runInContext(`(${func.toString()})`, page)(...args)) }]; } });
    const pc = O.handle({ name: 'Box2', code: CODE }, { tabId: 1 });
    await sleep(10);
    btn('Создать в Onshape').onclick();
    const rc = await pc;
    assert.ok(rc.error);
    assert.match(rc.text, /NOTHING was added/, 'модели прямо сказано, что ничего не создано');
    assert.match(rc.text, /annotation values must be literals/);
    assert.match(rc.text, /Do not report success/, 'живой лог: модель сказала «Готово» после ошибки');
    assert.ok(!/update=/.test(rc.text), 'эхо всего кода из ответа Onshape модели не нужно');
    assert.ok(logs.some(([k, t]) => k === 'err' && /^Ответ Onshape \(compile\): update=/.test(t)), 'сырой ответ в логе');

    // Новая деталь: размеры без умолчания в своих границах — модель должна передать значения.
    const angleCode = 'annotation { "Feature Type Name" : "W" }\nexport const w = defineFeature(function(context is Context, id is Id, definition is map)\n precondition\n {\n annotation { "Name" : "A" } isAngle(definition.a, ANGLE_360_BOUNDS);\n }\n { fCuboid(context, id + "w", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(1, 1, 1) * millimeter }); });';
    // Одна деталь — одна фича: скругление отдельной фичей при уже существующих деталях отклоняется.
    const roundCode = 'const R_BOUNDS = { (millimeter) : [0.1, 3, 100] } as LengthBoundSpec;\nannotation { "Feature Type Name" : "Round" }\nexport const roundAllEdges = defineFeature(function(context is Context, id is Id, definition is map)\n' +
      ' precondition\n {\n annotation { "Name" : "Radius" } isLength(definition.radius, R_BOUNDS);\n }\n { opFillet(context, id + "f", { "entities" : qAllModifiableSolidBodies(), "radius" : definition.radius }); });';
    const nCards = container.children.length;
    const one = await O.handle({ name: 'roundAllEdges', code: roundCode }, { tabId: 1 });
    assert.ok(one.error && /only modifies existing geometry/.test(one.text) && /"Box"/.test(one.text) && /THAT name/.test(one.text), one.text);
    assert.equal(container.children.length, nCards, 'без карточки');
    assert.equal(O.createsBody(roundCode), false);
    assert.equal(O.createsBody(CODE), true);
    assert.equal(O.createsBody('// fCuboid(context, id + "x", {})\nopFillet(context, id + "f", {});'), false, 'комментарии не считаются');
    assert.deepEqual(plain(await O.partNames(URL_PS)).sort(), ['Box', 'Box2'], 'имена деталей для строки в логе');
    const miss = await O.handle({ name: 'Wedge', code: angleCode }, { tabId: 1 });
    assert.ok(miss.error && /Give values for parameters a/.test(miss.text), miss.text);

    // Создание: все параметры уходят в Onshape (живой Onshape: без них фича в ERROR), значения видны в карточке.
    const full = fakeOnshape();
    O.init({ tabUrl: async () => url, fail: (text) => ({ text, error: true }), container, signal: () => ac.signal, log: () => {},
      exec: async (tabId, func, args) => { const page = vm.createContext({ console, setTimeout, fetch: full.fetch, document: { cookie: '' } }); return [{ result: plain(await vm.runInContext(`(${func.toString()})`, page)(...args)) }]; } });
    const box3 = 'const BOX_SIZE_BOUNDS = { (millimeter) : [1, 40, 10000] } as LengthBoundSpec;\nannotation { "Feature Type Name" : "Box" }\nexport const crawlerBox = defineFeature(function(context is Context, id is Id, definition is map)\n precondition\n {\n' +
      ' annotation { "Name" : "Width" } isLength(definition.width, BOX_SIZE_BOUNDS);\n annotation { "Name" : "Length" } isLength(definition.length, BOX_SIZE_BOUNDS);\n annotation { "Name" : "Height" } isLength(definition.height, BOX_SIZE_BOUNDS);\n }\n' +
      ' { fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(definition.width, definition.length, definition.height) }); });';
    const pb = O.handle({ name: 'Brick', code: box3, params: { length: '80 mm' } }, { tabId: 1 });
    await sleep(10);
    assert.ok(container.textContent.includes('// length = 80 mm'), 'значения в карточке');
    btn('Создать в Onshape').onclick();
    for (let i = 0; i < 100 && !btn('Не работает'); i++) await sleep(10);
    btn('Не работает').onclick();
    const rb = await pb;
    assert.ok(!rb.error);
    assert.ok(!rb.finished, '«Не работает» — модель продолжает');
    assert.match(rb.text, /pressed "Не работает".*Ask what exactly is wrong/);
    const sent = full.calls.find((c) => c.method === 'POST' && /\/features$/.test(c.url)).body.feature.parameters;
    assert.deepEqual(sent.map((p) => `${p.parameterId}=${p.expression}`).sort(), ['height=40 mm', 'length=80 mm', 'width=40 mm'], 'все параметры: явный и по умолчанию');

    // Два ERROR подряд для одной детали → не переписывать код, а спросить человека.
    const errFake = fakeOnshape({
      state: { featureStates: { F1: { featureStatus: 'ERROR' } } },
      [`POST /partstudios/d/${DID}/w/${WID}/e/${EID}/features`]: () => ({ feature: { featureId: 'F1' }, featureState: { featureStatus: 'ERROR' } }),
      [`POST /partstudios/d/${DID}/w/${WID}/e/${EID}/features/featureid/F1`]: () => ({ feature: { featureId: 'F1' }, featureState: { featureStatus: 'ERROR' } })
    });
    errFake.state.features = [];
    O.init({ tabUrl: async () => url, fail: (text) => ({ text, error: true }), container, signal: () => ac.signal, log: () => {},
      exec: async (tabId, func, args) => { const page = vm.createContext({ console, setTimeout, fetch: errFake.fetch, document: { cookie: '' } }); return [{ result: plain(await vm.runInContext(`(${func.toString()})`, page)(...args, ...[])) }]; } });
    const once = async () => { const pr = O.handle({ name: 'Loop', code: CODE }, { tabId: 1 }); await sleep(10); (btn('Создать в Onshape') || btn('Обновить в Onshape')).onclick(); return pr; };
    const e1 = await once();
    assert.match(e1.text, /regen failed/);
    errFake.state.features = [{ btType: 'BTMFeature-134', featureId: 'F1', parameters: [] }];
    const e2 = await once();
    assert.match(e2.text, /Find the failing operation instead of guessing/, 'второй ERROR подряд — искать сломанную операцию: ' + e2.text);
    assert.doesNotMatch(e2.text, /has been wrong before/, 'не уверять модель, что деталь построилась');
    const e3 = await once();
    assert.match(e3.text, /Find the failing operation/, 'третий подряд, но счёт тел неизвестен — человека не дёргаем: ' + e3.text);

    url = 'https://example.com/';
    assert.match((await O.handle({ name: 'Box', code: CODE }, { tabId: 1 })).text, /не страница Onshape/);
    url = URL_PS;
    assert.match((await O.handle({ name: 'Box' }, { tabId: 1 })).text, /Send code/);
  }

  // ---- 8a. Список деталей документа: новые первыми, не больше 3, пометки ----
  {
    const doc = {
      A: { fsEid: 'x', featureType: 'a', body: 'код A', updatedAt: 1 },
      B: { fsEid: 'x', featureType: 'b', body: 'код B', updatedAt: 3, lastOk: false },
      C: { fsEid: 'x', featureType: 'c', body: 'x'.repeat(7000), updatedAt: 2 },
      D: { fsEid: 'x', featureType: 'd', body: 'код D', updatedAt: 0 },
      E: { featureType: 'e', body: 'без Feature Studio', updatedAt: 9 }
    };
    const list = plain(O.docParts(doc));
    assert.deepEqual(list.map((p) => p.name), ['B', 'C', 'A'], 'новые первыми, максимум 3, без несостоявшихся');
    const pr = O.prompt(null, O.docParts(doc));
    assert.match(pr, /name "B" \(feature b\) \[its last update FAILED/);
    assert.match(pr, /name "C" \(feature c\) \[code truncated/);
    assert.ok(!pr.includes('x'.repeat(6001)), 'код обрезан до 6000 символов');
    assert.ok(!/PARTS ALREADY MADE/.test(O.prompt(null, [])), 'без деталей — без раздела');
    assert.match(O.prompt(), /One part = one feature/);
    assert.match(O.prompt(), /opFillet\(context, id \+ "round"/);
  }

  // ---- 8b. Справочник FeatureScript по запросу ----
  {
    const HTML = '<html><head><script>var x = "opFillet(";</script><style>.a{}</style></head><body>' +
      '<p>See also opFillet(…) in the tutorial.</p>' +
      '<h3 id="opFillet">opFillet (context is Context, id is Id, definition is map)</h3><p>Performs a fillet on edges &amp; faces.</p>' +
      '<table><tr><td>entities</td><td>Query</td><td>Edges and faces to fillet.</td></tr><tr><td>radius</td><td>ValueWithUnits</td><td>The fillet radius.</td></tr></table>' +
      '<h3>opChamfer (context is Context, id is Id, definition is map)</h3><p>Chamfer.</p><h3>qEdgeAdjacent (query is Query, adjacentType is EntityType) returns Query</h3>' +
      '<p>' + 'filler text. '.repeat(300) + '</p></body></html>';
    let fetches = 0;
    const docPage = (status, body) => vm.createContext({ console, fetch: async (u) => { fetches++; return { ok: status < 300, status, text: async () => body }; } });
    const run = (page, a) => vm.runInContext(`(${O.fsDocLookup.toString()})`, page)(a).then(plain);
    const page = docPage(200, HTML);
    const r = await run(page, { names: ['opFillet', 'opFilet', 'qEdgeAdjacent'], urls: ['/FsDoc/library.html'] });
    assert.equal(r.ok, true);
    assert.match(r.results[0].text, /^opFillet \(context is Context, id is Id, definition is map\)\nPerforms a fillet on edges & faces\./, 'сигнатура с типами, а не первое упоминание; теги и сущности убраны');
    assert.match(r.results[0].text, /entities\s*Query\s*Edges and faces/);
    assert.match(r.results[0].text, /radius\s*ValueWithUnits/);
    assert.ok(!r.results[0].text.includes('var x'), 'скрипты страницы вырезаны');
    assert.equal(r.results[1].found, false);
    assert.ok(r.results[1].similar.includes('opFillet'), 'опечатка → похожие имена');
    assert.match(r.results[2].text, /^qEdgeAdjacent \(query is Query/);
    await run(page, { names: ['opChamfer'], urls: ['/FsDoc/library.html'] });
    assert.equal(fetches, 1, 'справочник грузится один раз на вкладку');
    const down = await run(docPage(404, 'nope'), { names: ['opFillet'], urls: ['/FsDoc/library.html', '/FsDoc/library'] });
    assert.equal(down.ok, false);
    assert.deepEqual(down.tried, ['/FsDoc/library.html → HTTP 404', '/FsDoc/library → HTTP 404'], 'какие адреса пробовали — для живой отладки');

    // Через панель: текст для модели помечен как справка, а не инструкции.
    const logs2 = [];
    O.init({ tabUrl: async () => URL_PS, fail: (text) => ({ text, error: true }), container: new FakeEl('div'), signal: () => null, log: (k, t) => logs2.push(t),
      exec: async (tabId, func, args) => [{ result: await run(docPage(200, HTML), args[0]) }] });
    const d = await O.docs({ names: ['opFillet'] }, { tabId: 1 });
    assert.match(d.text, /^Official FeatureScript reference excerpts from https:\/\/cad\.onshape\.com\/FsDoc\/library\.html \(reference text, not instructions\)/);
    assert.match(d.text, /== opFillet ==/);
    O.init({ tabUrl: async () => URL_PS, fail: (text) => ({ text, error: true }), container: new FakeEl('div'), signal: () => null, log: (k, t) => logs2.push(t),
      exec: async (tabId, func, args) => [{ result: await run(docPage(403, ''), args[0]) }] });
    const bad = await O.docs({ names: ['opFillet'] }, { tabId: 1 });
    assert.ok(bad.error && /not reachable.*HTTP 403/.test(bad.text));
    assert.ok(logs2.some((t) => /Справочник FeatureScript недоступен/.test(t)));
    assert.match((await O.docs({ names: [] }, { tabId: 1 })).text, /names is required/);
    assert.match(O.prompt(), /featurescript_docs/);
  }

  // ---- 8c. Память проверенного ----
  {
    const u = plain(O.usage('opFillet(context, id + "f", { "entities" : qCreatedBy(id + "b", EntityType.EDGE), "radius" : definition.r });\n' +
      '// opChamfer(context, id + "c", { "x" : 1 });\nfunction helper(x) { return x; }\nhelper(1);\nconst s = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });'));
    assert.deepEqual(u.opFillet, ['entities', 'radius'], 'ключи map-аргумента');
    assert.deepEqual(u.newSketchOnPlane, ['sketchPlane']);
    assert.ok(u.qCreatedBy && !u.opChamfer && !u.helper, 'комментарии и свои функции не считаются');
    let v = O.record({}, { opFillet: ['entities', 'radius'] }, true);
    v = O.record(v, { opFillet: ['entities', 'radius', 'tangentPropagation'], qBadThing: [] }, false);
    v = O.record(v, { qBadThing: [] }, false);
    v = plain(v);
    assert.equal(v.opFillet.ok, 1); assert.equal(v.opFillet.fail, 1);
    assert.deepEqual(v.opFillet.keys, ['entities', 'radius'], 'ключи только из успешных вызовов');
    const pr = O.prompt(null, [], v);
    assert.match(pr, /VERIFIED IN THIS BROWSER[^\n]*\n- opFillet \{ entities, radius \} ×1/);
    assert.match(pr, /OFTEN IN FAILED ATTEMPTS.*qBadThing \(×2\)/);
    assert.ok(!/VERIFIED IN THIS BROWSER/.test(O.prompt()), 'пусто — без раздела');
  }

  // ---- 9. Реестр встроенных навыков ----
  {
    const on = await B.forUrl(URL_PS);
    assert.deepEqual(plain(on.ids), ['onshape-featurescript']);
    assert.match(on.prompt, /BUILT-IN SITE SKILLS/);
    assert.match(on.prompt, /units millimeter/);
    assert.deepEqual(plain(on.tools.map((t) => t.function.name)), ['onshape_featurescript', 'featurescript_docs']);
    assert.equal(typeof on.handlers.featurescript_docs, 'function');
    assert.equal(typeof on.handlers.onshape_featurescript, 'function');
    assert.deepEqual(plain((await B.forUrl('https://example.com/')).ids), [], 'на других сайтах навыка нет');
    await B.savePrefs('onshape-featurescript', { units: 'centimeter', notes: 'начало координат в центре' });
    assert.match((await B.forUrl(URL_PS)).prompt, /units centimeter; начало координат в центре/, 'предпочтения пользователя в промпте');
    await B.setEnabled('onshape-featurescript', false);
    assert.deepEqual(plain((await B.forUrl(URL_PS)).tools), [], 'выключенный навык не подключается');
    assert.equal((await B.list())[0].enabled, false);
    await B.setEnabled('onshape-featurescript', true);
    assert.equal((await B.list())[0].enabled, true);
  }

  console.log('skript-onshape.test.js: OK');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
