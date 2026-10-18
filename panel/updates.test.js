'use strict';
/* Тест updates.js: сравнение версий, репозиторий из homepage_url, проверка не чаще раза в 6 часов,
 * сеть недоступна — без обновления и без ошибок. Запуск: node panel/updates.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console, URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'updates.js'), 'utf8') + '\nglobalThis.U = Updates;', ctx, { filename: 'updates.js' });
const U = vm.runInContext('U', ctx);

// ---- 1. Версии ----
assert.equal(U.newer('0.7', '0.6'), true);
assert.equal(U.newer('0.6.1', '0.6'), true);
assert.equal(U.newer('0.6', '0.6'), false);
assert.equal(U.newer('0.6', '0.6.0'), false, '0.6 == 0.6.0');
assert.equal(U.newer('0.10', '0.9'), true, 'числа, а не строки');
assert.equal(U.newer('0.5', '0.6'), false, 'на GitHub старее — не предлагаем');
assert.equal(U.newer('', '0.6'), false);

// ---- 2. Репозиторий ----
assert.equal(U.repoOf('https://github.com/ir00nman/chrome-crawler'), 'ir00nman/chrome-crawler');
assert.equal(U.repoOf('https://github.com/ir00nman/chrome-crawler.git'), 'ir00nman/chrome-crawler');
assert.equal(U.repoOf('https://example.com/x/y'), null);
assert.equal(U.repoOf(undefined), null);

// ---- 3. Проверка ----
function env(remoteVersion, { fail = false } = {}) {
  const store = {}, calls = [];
  let now = 1_000_000;
  return {
    calls, store, tick: (ms) => { now += ms; },
    deps: {
      manifest: { version: '0.6', homepage_url: 'https://github.com/ir00nman/chrome-crawler' },
      now: () => now,
      storage: { get: async (d) => ({ ...d, ...store }), set: async (o) => Object.assign(store, o) },
      fetch: async (url) => {
        calls.push(url);
        if (fail) throw new Error('offline');
        if (url.includes('raw.githubusercontent.com')) return { ok: true, json: async () => ({ version: remoteVersion }) };
        return { ok: true, json: async () => ({ commit: { message: 'Мозг: хватает курсор' } }) };
      }
    }
  };
}

(async () => {
  {
    const e = env('0.7');
    const r = await U.check(e.deps);
    assert.equal(r.version, '0.7');
    assert.equal(r.current, '0.6');
    assert.equal(r.message, 'Мозг: хватает курсор');
    assert.equal(r.zip, 'https://github.com/ir00nman/chrome-crawler/archive/refs/heads/main.zip');
    assert.match(e.calls[0], /^https:\/\/raw\.githubusercontent\.com\/ir00nman\/chrome-crawler\/main\/manifest\.json/);
    // повторно в течение 6 часов — без сети, из сохранённого
    const n = e.calls.length;
    assert.equal((await U.check(e.deps)).version, '0.7');
    assert.equal(e.calls.length, n, 'не чаще раза в 6 часов');
    e.tick(U.CHECK_MS + 1);
    await U.check(e.deps);
    assert.ok(e.calls.length > n, 'через 6 часов — проверка снова');
  }
  {
    const e = env('0.6');
    assert.equal(await U.check(e.deps), null, 'та же версия — обновления нет');
    assert.equal(e.calls.filter((u) => u.includes('api.github.com')).length, 0, 'описание не запрашиваем зря');
  }
  {
    const e = env('0.7', { fail: true });
    assert.equal(await U.check(e.deps), null, 'нет сети — тихо, без ошибки');
  }
  {
    const e = env('0.7');
    e.deps.manifest.homepage_url = '';
    assert.equal(await U.check(e.deps), null, 'без homepage_url — не проверяем');
    assert.equal(e.calls.length, 0);
  }
  console.log('updates.test.js: ok');
})().catch((err) => { console.error(err); process.exit(1); });
