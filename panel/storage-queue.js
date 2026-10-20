'use strict';
/* storage-queue.js — последовательные «прочитать → изменить → записать» для chrome.storage.local.
 *
 * Панель пишет одни и те же ключи из разных мест: оценка ответа (ratings), заметки сайта (notes),
 * подсказки/скилы (skills). Две параллельные операции читают одно состояние и обе записывают —
 * последняя запись затирает изменения первой (живой случай: две оценки подряд, вторая теряет первую).
 * Очередь выполняет операции по одной; ошибка одной не останавливает следующие.
 *
 * Использование: const storageUpdate = StorageQueue.create(); await storageUpdate(async () => { … });
 */

const StorageQueue = (() => {
  function create() {
    let tail = Promise.resolve();
    return function enqueue(fn) {
      const run = tail.catch(() => {}).then(fn);
      tail = run.catch(() => {});           // хвост не должен «застрять» на ошибке
      return run;
    };
  }
  return { create };
})();
if (typeof module !== 'undefined') module.exports = StorageQueue;
