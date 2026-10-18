'use strict';
/* Тест llm-retry.js: какие ответы повторяются, паузы и Retry-After, сетевые ошибки, остановка.
 * Запуск: node llm-retry.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Строгие таймеры, как в Chrome: оторванный setTimeout кидает «Illegal invocation».
const ctx = vm.createContext({ console, Date, AbortController, Promise });
const g = vm.runInContext('globalThis', ctx);
for (const name of ['setTimeout', 'clearTimeout']) {
  const real = globalThis[name];
  g[name] = function (...a) { if (this !== g) throw new TypeError('Illegal invocation'); return real(...a); };
}
vm.runInContext(fs.readFileSync(path.join(__dirname, 'llm-retry.js'), 'utf8') + '\nglobalThis.LlmRetry = LlmRetry;', ctx, { filename: 'llm-retry.js' });
const R = g.LlmRetry;

const resp = (status, headers = {}) => ({ status, ok: status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
const noSleep = async () => {};

(async () => {
  // ---- 1. Что повторяется ----
  for (const s of [408, 429, 500, 502, 503, 504]) assert.ok(R.retryable(s), `${s} повторяется`);
  for (const s of [200, 400, 401, 403, 404, 422]) assert.ok(!R.retryable(s), `${s} не повторяется`);

  // ---- 2. 503 из живого прогона, потом успех: задача не обрывается ----
  {
    const seq = [resp(503), resp(503), resp(200)], waits = [];
    let calls = 0;
    const r = await R.fetch(async () => seq[calls++], { sleep: noSleep, onWait: (w) => waits.push(w) });
    assert.equal(r.status, 200);
    assert.equal(calls, 3);
    assert.deepEqual(waits.map((w) => [w.attempt, w.ms, w.status]), [[1, 2000, 503], [2, 5000, 503]]);
  }

  // ---- 3. Не больше 3 повторов; после них — последний ответ (его разберёт вызывающий) ----
  {
    let calls = 0;
    const r = await R.fetch(async () => { calls++; return resp(503); }, { sleep: noSleep });
    assert.equal(calls, 4, '1 запрос + 3 повтора');
    assert.equal(r.status, 503);
  }

  // ---- 4. Ошибки клиента не повторяются ----
  {
    let calls = 0;
    const r = await R.fetch(async () => { calls++; return resp(400); }, { sleep: noSleep });
    assert.equal(calls, 1);
    assert.equal(r.status, 400);
  }

  // ---- 5. Обрыв сети: повтор, после исчерпания — та же ошибка ----
  {
    let calls = 0;
    const r = await R.fetch(async () => { if (calls++ < 1) throw new TypeError('Failed to fetch'); return resp(200); }, { sleep: noSleep });
    assert.equal(r.status, 200);
    calls = 0;
    await assert.rejects(R.fetch(async () => { calls++; throw new TypeError('Failed to fetch'); }, { sleep: noSleep }), /Failed to fetch/);
    assert.equal(calls, 4);
  }

  // ---- 6. Retry-After: секунды, дата, потолок 30 с, мусор ----
  assert.equal(R.delayFor(0, '7'), 7000);
  assert.equal(R.delayFor(0, '600'), 30000, 'не дольше 30 с');
  assert.equal(R.delayFor(1, new Date(Date.UTC(2026, 0, 1, 0, 0, 12)).toUTCString(), Date.UTC(2026, 0, 1, 0, 0, 0)), 12000);
  assert.equal(R.delayFor(2, 'потом'), 10000, 'непонятный заголовок — по таблице');
  {
    const waits = [];
    let calls = 0;
    await R.fetch(async () => (calls++ ? resp(200) : resp(429, { 'retry-after': '3' })), { sleep: noSleep, onWait: (w) => waits.push(w.ms) });
    assert.deepEqual(waits, [3000]);
  }

  // ---- 7. Остановка задачи во время паузы — сразу AbortError, без новых запросов ----
  {
    const ac = new AbortController();
    let calls = 0;
    const p = R.fetch(async () => { calls++; return resp(503); }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    const t0 = Date.now();
    await assert.rejects(p, (e) => e.name === 'AbortError');
    assert.ok(Date.now() - t0 < 1000, 'ожидание 2 с прервано');
    assert.equal(calls, 1);
  }
  // fetch, прерванный остановкой, не повторяется
  {
    const ac = new AbortController();
    ac.abort();
    let calls = 0;
    await assert.rejects(R.fetch(async () => { calls++; const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, { signal: ac.signal }), (e) => e.name === 'AbortError');
    assert.equal(calls, 1);
  }

  console.log('llm-retry.test.js: OK');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
