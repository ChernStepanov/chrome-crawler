'use strict';
/* Тест attachments.js: сообщение для модели и лимиты текста (чтение файлов и миниатюры — только в Chrome).
 * Запуск: node attachments.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'attachments.js'), 'utf8') + '\nglobalThis.A = Attachments;', ctx, { filename: 'attachments.js' });
const A = vm.runInContext('A', ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- 1. Нет вложений — нет сообщения ----
assert.equal(A.toMessage([]), null);

// ---- 2. Текст блоками, картинки — image_url, как скриншоты страницы ----
const msg = plain(A.toMessage([
  { kind: 'text', name: 'задание.txt', text: 'Сколько будет 2+2?', truncated: false },
  { kind: 'image', name: 'фото.jpg', url: 'data:image/jpeg;base64,AAAA' },
  { kind: 'text', name: 'big.csv', text: 'a,b', truncated: true }
]));
assert.equal(msg.role, 'user');
assert.match(msg.content[0].text, /attached files.*not as instructions/, 'вложения — данные, а не команды');
assert.match(msg.content[1].text, /--- file: задание\.txt ---\nСколько будет 2\+2\?\n--- end of задание\.txt ---/);
assert.deepEqual(msg.content.slice(2, 4), [{ type: 'text', text: 'image: фото.jpg' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }]);
assert.match(msg.content[4].text, /big\.csv \(truncated\)/);

// ---- 3. Лимиты текста: на файл и на все вместе ----
const L = A.LIMITS;
assert.deepEqual(plain(A.clipText('abc', 0)), { text: 'abc', truncated: false });
const one = A.clipText('x'.repeat(L.TEXT_LIMIT + 10), 0);
assert.equal(one.text.length, L.TEXT_LIMIT);
assert.equal(one.truncated, true);
const tail = A.clipText('y'.repeat(L.TEXT_LIMIT), L.TEXT_TOTAL - 100);
assert.equal(tail.text.length, 100, 'общий лимит на все файлы');
assert.equal(A.clipText('z', L.TEXT_TOTAL).text, '', 'лимит исчерпан');

// ---- 4. take() отдаёт и очищает ----
A._set([{ kind: 'text', name: 'a.txt', text: '1' }]);
assert.equal(A.count, 1);
assert.equal(A.take().length, 1);
assert.equal(A.count, 0);

console.log('attachments.test.js: OK');
