'use strict';
/* Тест skript-eval.js: цель, значение метрики, журнал задачи (лучший, хуже/лучше/шум), тексты. Запуск: node skript-eval.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console });
for (const f of ['skript-policy.js', 'skript-eval.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
const E = vm.runInContext('SkriptEval', ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
const sum = (metrics, extra = {}) => ({ reason: 'manual', ok: false, metrics, errors: [], dropped: 0, result: null, ...extra });

// ---- 1. Цель: проверка ----
assert.deepEqual(plain(E.cleanGoal(undefined)), { ok: true, goal: null });
assert.deepEqual(plain(E.cleanGoal({ metric: 'score', target: 10000 })).goal, { metric: 'score', target: 10000, better: 'higher', read: null });
assert.equal(E.cleanGoal({ metric: 'my score' }).ok, false, 'имя метрики без пробелов');
assert.equal(E.cleanGoal({ metric: 'ms', better: 'more' }).ok, false);
assert.equal(E.cleanGoal({ metric: 'ms', target: 'много' }).ok, false);
assert.equal(E.cleanGoal({ metric: 'score', read: 'Number(document.querySelector(".score").textContent)' }).ok, true, 'чтение DOM разрешено');
const evil = E.cleanGoal({ metric: 'score', read: 'fetch("/steal")' });
assert.equal(evil.ok, false, 'read только для чтения: сеть запрещена');
assert.match(evil.error, /not read-only/);
assert.equal(E.cleanGoal({ metric: 'score', read: 'x'.repeat(301) }).ok, false);

// ---- 2. Значение метрики: страница важнее отчёта скрипта ----
const g = (o) => E.cleanGoal({ metric: 'score', target: 1000, ...o }).goal;
assert.deepEqual(plain(E.goalValue(g({ read: 'Number(1)' }), sum({ score: { min: 0, max: 9999, last: 9999 } }), [10, 340, 200])), { value: 340, source: 'page' }, 'скрипт врёт — верим странице');
assert.deepEqual(plain(E.goalValue(g({ read: 'Number(1)' }), sum({}), [])), { value: null, source: 'page' });
assert.deepEqual(plain(E.goalValue(g({}), sum({ score: { min: 3, max: 50, last: 40 } }), [])), { value: 50, source: 'script' });
assert.deepEqual(plain(E.goalValue(g({ better: 'lower' }), sum({ score: { min: 3, max: 50, last: 40 } }), [])), { value: 3, source: 'script' });
assert.deepEqual(plain(E.goalValue(g({}), sum({}, { result: { score: 77 } }), [])), { value: 77, source: 'script' }, 'из результата done()');

// ---- 3. Журнал: лучший, хуже, шум, достижение цели ----
{
  const L = E.createLedger();
  const goal = g({});
  const r1 = L.record({ id: 'd1', version: 1, goal }, sum({ score: { min: 0, max: 120, last: 120 } }));
  assert.equal(r1.value, 120);
  assert.match(E.text(r1, L), /score = 120 \(12% of target 1000\), as reported by the script/);
  assert.doesNotMatch(E.text(r1, L), /History/, 'одна попытка — без истории');
  const r2 = L.record({ id: 'd1', version: 2, goal }, sum({ score: { min: 0, max: 520, last: 520 } }));
  assert.equal(r2.improved, true);
  assert.match(E.text(r2, L), /New best \(previous best 120, d1 v1\)/);
  const r3 = L.record({ id: 'd2', version: 1, goal }, sum({ score: { min: 0, max: 300, last: 300 } }), [], { scrolled: true });
  assert.equal(r3.improved, false);
  const t3 = E.text(r3, L);
  assert.match(t3, /WORSE than the best so far: 520 by d1 v2\. Build on that version/, 'новый черновик сравнивается с лучшим за задачу');
  assert.match(t3, /Health: scrolled the page/);
  assert.match(t3, /History: d1 v1: 120 · d1 v2: 520 · d2 v1: 300/);
  assert.match(E.line(r3, L), /score 300 \/ 1000 · хуже лучшего \(520\) · со слов скрипта/);
  const r4 = L.record({ id: 'd2', version: 2, goal }, sum({ score: { min: 0, max: 540, last: 540 } }));
  assert.equal(r4.noise, true, '540 против 520 — в пределах шума');
  assert.match(E.text(r4, L), /within noise/);
  assert.equal(L.best.value, 540, 'лучший всё равно обновлён');
  const r5 = L.record({ id: 'd2', version: 3, goal }, sum({ score: { min: 0, max: 1200, last: 1200 } }, { reason: 'done', ok: true }));
  assert.equal(r5.reached, true);
  assert.match(E.text(r5, L), /TARGET REACHED/);
  assert.match(E.line(r5, L), /цель достигнута/);
}

// ---- 4. Без цели и с проблемами здоровья ----
{
  const L = E.createLedger();
  const r = L.record({ id: 'd1', version: 1, goal: null }, sum({}, { reason: 'stalled', errors: ['x'] }));
  assert.deepEqual(plain(r.problems), ['stopped acting', '1 error(s)']);
  assert.match(E.text(r, L), /no goal declared.*pass goal = \{ metric, target, read \}/);
  assert.equal(E.line(r, L), 'без цели · 2 проблем(ы)');
  // цель не прочитана: подсказка, что чинить
  const goal = g({ read: 'Number(document.title)' });
  const r2 = L.record({ id: 'd1', version: 2, goal }, sum({}), []);
  assert.match(E.text(r2, L), /could not be read by your goal\.read expression/);
  assert.equal(E.line(r2, L), 'score: не прочитано');
}

// ---- 5. Живой прогон 2048: read весь запуск 0, скрипт сделал 300 ходов ----
{
  const L = E.createLedger();
  const goal = g({ read: 'Number(document.querySelector(".score").textContent)' });
  const r = L.record({ id: 'd1', version: 3, goal }, sum({ score: { min: 0, max: 1372, last: 1372 } }, { actions: 355 }), [0, 0, 0, 0, 0]);
  assert.equal(r.stuck, 0);
  const t = E.text(r, L);
  assert.match(t, /goal\.read returned the same value \(0\) for the whole run while the script acted 355 times/);
  assert.match(t, /Your script itself reported score up to 1372/);
  assert.match(E.line(r, L), /score 0 \/ 1000 · не меняется — проверьте, откуда читается score/);
  // мало действий — не тревога (игра могла не начаться)
  assert.equal(L.record({ id: 'd1', version: 4, goal }, sum({}, { actions: 2 }), [0, 0, 0]).stuck, undefined);
  // значение двигалось — не тревога
  assert.equal(L.record({ id: 'd1', version: 5, goal }, sum({}, { actions: 50 }), [0, 4, 8]).stuck, undefined);
}
// ---- 6. 0 против 0 — «прогресса нет», а не «как лучший» ----
{
  const L = E.createLedger();
  const goal = g({});
  L.record({ id: 'd1', version: 1, goal }, sum({ score: { min: 0, max: 0, last: 0 } }));
  const r = L.record({ id: 'd1', version: 2, goal }, sum({ score: { min: 0, max: 0, last: 0 } }));
  assert.equal(r.flat, true);
  assert.equal(r.noise, false);
  assert.match(E.text(r, L), /No progress: still 0\./);
  assert.match(E.line(r, L), /без прогресса/);
}

console.log('skript-eval.test.js: OK');
