'use strict';
/* Тесты skript-contract.js и skript-tools.js (этап 5). Запуск: node skript-contract.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { console, URL };
vm.createContext(ctx);
for (const f of ['skript-policy.js', 'skript-contract.js', 'skript-eval.js', 'skript-tools.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}
const C = vm.runInContext('SkriptContract', ctx);
const T = vm.runInContext('SkriptTools', ctx);
const P = vm.runInContext('SkriptPolicy', ctx);
const lintRun = (code) => P.lint(code, 'run');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// ---- Контракт ----
const docs = C.docs();
for (const a of C.API) {
  assert.ok(docs.includes(a.sig), `docs содержит сигнатуру ${a.name}`);
}
assert.equal(new Set(C.API.map((a) => a.name)).size, C.API.length, 'имена API уникальны');
for (const n of ['loop', 'key', 'click', 'move', 'drag', 'wait', 'report', 'log', 'done', 'stopped', 'limits']) {
  assert.ok(C.API.some((a) => a.name === n), `в контракте есть ${n}`);
}
assert.ok(docs.includes('async (args, __crawler)'), 'сигнатура тела');

// Пример-каркас должен проходить собственную проверку и быть валидным JS (иначе модель получит отказ на примере).
const sk = lintRun(C.SKELETON);
assert.ok(sk.ok, 'каркас проходит профиль run: ' + sk.error);
assert.doesNotThrow(() => new AsyncFunction('args', '__crawler', C.SKELETON), 'каркас синтаксически корректен');
assert.ok(!/2048|dino|tile/i.test(C.SKELETON + docs), 'в контракте нет готовых решений конкретных игр');

// Каждое правило из docs действительно ловится проверкой
const mustReject = [
  'fetch("/x")', 'new XMLHttpRequest()', 'localStorage.getItem("a")', 'document.cookie', 'chrome.runtime.id',
  'eval("1")', '(()=>{}).constructor("x")()', 'setTimeout(f, 10)', 'setInterval(f, 10)', 'requestAnimationFrame(f)',
  'location = "/x"', 'window.open("/x")', 'window.score = 1', 'window["a"]', 'handlers[name]()', 'fns[0]()'
];
for (const code of mustReject) assert.equal(lintRun(code).ok, false, `отклоняется: ${code}`);
const mustAllow = [
  'const el = document.querySelector(".a"); const r = el.getBoundingClientRect(); __crawler.click(r.x + 5, r.y + 5);',
  'let n = 0; n++; const cells = [...document.querySelectorAll(".c")].map((c) => c.textContent.trim()); return cells.length;',
  'await __crawler.wait(100); return globalThis_free;'.replace('globalThis_free', '1')
];
for (const code of mustAllow) assert.ok(lintRun(code).ok, `разрешается: ${code}`);

// Права
const perms = (code) => C.declaredPermissions(code).join(',');
assert.equal(perms('return document.title'), 'read');
assert.equal(perms('__crawler.key("ArrowUp")'), 'read,input');
assert.equal(perms('__crawler.click(1,2); __crawler.drag(1,2,3,4)'), 'read,input');
assert.equal(perms('document.querySelector("a").textContent = "x"'), 'read,dom-write');
assert.equal(perms('el.click()'), 'read,dom-write');
assert.equal(perms('el.value == "x"'), 'read', 'сравнение — не запись');
assert.equal(perms('const s = "__crawler.key(1)"; return s'), 'read', 'в строке — не использование');
assert.equal(perms('__crawler.key("a"); el.style.top = "1px"'), 'read,input,dom-write');

// ---- Инструменты ----
const names = T.DEFS.map((t) => t.function.name);
assert.deepEqual(JSON.parse(JSON.stringify(names)), ['write_script', 'patch_script', 'run_script', 'screenshot_region', 'stop_script', 'get_telemetry']);
assert.equal(new Set(names).size, names.length);
assert.deepEqual(JSON.parse(JSON.stringify(T.build(['get_telemetry', 'write_script']).map((t) => t.function.name))), ['get_telemetry', 'write_script'], 'набор по именам, в заданном порядке');
assert.throws(() => T.build(['write_script', 'нет']), /неизвестный/);
for (const t of T.DEFS) {
  assert.equal(t.type, 'function');
  assert.ok(t.function.description.length > 20, t.function.name + ': описание');
  assert.equal(t.function.parameters.type, 'object');
  for (const r of t.function.parameters.required || []) assert.ok(r in t.function.parameters.properties, `${t.function.name}: required ${r} описан`);
}

// ---- Черновики ----
const D = T.createDrafts();
assert.equal(D.write({ code: 'return 1' }).ok, false, 'без title отказ');
assert.equal(D.write({ title: 'x', code: '' }).ok, false, 'пустой код');
const rej = D.write({ title: 'x', code: 'fetch("/a")' });
assert.equal(rej.ok, false); assert.match(rej.error, /fetch/, 'причина отказа возвращается модели');
assert.equal(D.write({ title: 'x', code: 'return 1', params: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 } }).ok, false, 'больше 6 параметров');
assert.equal(D.write({ title: 'x', code: 'return 1', params: { a: { type: 'object' } } }).ok, false, 'только простые типы');
const w = D.write({ title: 'Играть', description: 'играет', code: '__crawler.key("a"); return 1', params: { turns: { type: 'integer', description: 'ходов' } } });
assert.ok(w.ok && w.id === 'd1' && w.version === 1 && w.permissions.includes('input'));
assert.equal(D.get().params.properties.turns.type, 'integer');
assert.equal(D.approve(), true);
assert.equal(D.get().approved, true);
const p1 = D.patch({ code: 'return 2', reason: 'fix' });
assert.ok(p1.ok && p1.version === 2 && p1.patchesLeft === 4);
assert.equal(p1.permissionsChanged, true, 'права изменились (input убран)');
assert.equal(D.get().approved, false, 'после патча нужно новое одобрение');
assert.equal(D.patch({ code: 'fetch(1)' }).ok, false, 'патч с запрещённым кодом отклонён');
assert.equal(D.get().version, 2, 'отклонённый патч версию не меняет');
for (let i = 0; i < 4; i++) assert.ok(D.patch({ code: 'return ' + (i + 3) }).ok);
const lim = D.patch({ code: 'return 99' });
assert.equal(lim.ok, false); assert.match(lim.error, /limit/);
assert.equal(D.get().version, 6);
const rb = D.rollback('d1', 1);
assert.ok(rb.ok && D.get().code.includes('__crawler.key'), 'откат вернул первую версию как новую');
assert.equal(D.rollback('d1', 42).ok, false);
assert.equal(D.patch({ id: 'нет', code: 'return 1' }).ok, false, 'неизвестный id');
assert.equal(D.list().length, 1);

console.log('skript-contract.test.js: OK');
