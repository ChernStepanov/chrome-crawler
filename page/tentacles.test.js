'use strict';
/* Тест кэша целей tentacles.js: список кандидатов сканируется не чаще CAND_TTL,
 * а разные виды («крупные» и «обычные») кэшируются отдельно. Запуск: node page/tentacles.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Файл при загрузке трогает только window и addEventListener; DOM нужен лишь внутри функций.
const ctx = vm.createContext({ console, window: {}, addEventListener() {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'tentacles.js'), 'utf8'), ctx, { filename: 'tentacles.js' });
const S = ctx.window.__crawlerSuck;

assert.ok(S && S.v, 'window.__crawlerSuck установлен');
assert.ok(S._candCache, 'кэш кандидатов доступен');

let builds = 0;
const build = () => { builds++; return [{ el: {}, rect: { x: 0, y: 0, w: 10, h: 10 }, at: { x: 0, y: 0 }, w: 1 }]; };

const a = S._candCache.get(true, build, 1000);
assert.equal(builds, 1, 'первый запрос сканирует');
const b = S._candCache.get(true, build, 1100);
assert.equal(builds, 1, 'в пределах TTL список берётся из кэша');
assert.equal(a, b, 'отдаётся тот же список');

S._candCache.get(true, build, 1000 + 900);
assert.equal(builds, 2, 'после TTL — новое сканирование');

S._candCache.get(false, build, 1000 + 905);
assert.equal(builds, 3, 'другой вид целей кэшируется отдельно');

assert.equal(S._candCache.scans, 3, 'счётчик сканирований');

console.log('tentacles.test.js: OK');
