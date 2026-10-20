'use strict';
/* Тест panel/storage-queue.js: операции «прочитать → изменить → записать» идут строго по очереди,
 * ошибка одной не останавливает следующие. Запуск: node panel/storage-queue.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'storage-queue.js'), 'utf8') + '\nglobalThis.Q = StorageQueue;', ctx, { filename: 'storage-queue.js' });
const Q = ctx.Q;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---- 1. Параллельные «чтение-изменение-запись» не теряют изменений ----
  {
    const enqueue = Q.create();
    const store = { value: 0 };
    const bump = () => enqueue(async () => {
      const cur = store.value;
      await sleep(5);                       // имитация асинхронного chrome.storage.local
      store.value = cur + 1;
    });
    await Promise.all([bump(), bump(), bump(), bump(), bump()]);
    assert.equal(store.value, 5, 'все пять операций учтены, а не последняя');
  }

  // ---- 2. Ошибка одной операции не останавливает очередь ----
  {
    const enqueue = Q.create();
    const done = [];
    const fail = enqueue(async () => { done.push('a'); throw new Error('сломалось'); });
    const ok1 = enqueue(async () => { done.push('b'); return 'b'; });
    const ok2 = enqueue(async () => { done.push('c'); return 'c'; });
    await assert.rejects(fail, /сломалось/);
    assert.equal(await ok1, 'b', 'следующая операция выполнилась');
    assert.equal(await ok2, 'c');
    assert.deepEqual(done, ['a', 'b', 'c'], 'порядок сохранён');
  }

  // ---- 3. Порядок строго последовательный, даже если первая дольше второй ----
  {
    const enqueue = Q.create();
    const order = [];
    const slow = enqueue(async () => { await sleep(30); order.push('slow'); });
    const fast = enqueue(async () => { order.push('fast'); });
    await Promise.all([slow, fast]);
    assert.deepEqual(order, ['slow', 'fast'], 'вторая ждёт первую');
  }

  console.log('storage-queue.test.js: OK');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
