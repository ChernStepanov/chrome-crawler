'use strict';
/* llm-retry.js — повтор запроса к модели при временных сбоях сервера.
 * 429 (лимит), 408 и 5xx (в т.ч. 503 «temporarily unavailable») и обрыв сети: до 3 повторов
 * с паузами 2 / 5 / 10 с, заголовок Retry-After важнее (не дольше 30 с). Остановка задачи прерывает ожидание.
 * Подключение: LlmRetry.fetch(() => fetch(...), { signal, onWait }) в callLLM (sidepanel.js). */

const LlmRetry = (() => {
  const DELAYS = [2000, 5000, 10000];
  const MAX_WAIT = 30000;

  const retryable = (status) => status === 408 || status === 429 || (status >= 500 && status <= 599);

  // Retry-After: секунды или HTTP-дата. Без заголовка — по таблице пауз.
  function delayFor(attempt, retryAfter, now = Date.now()) {
    const base = DELAYS[Math.min(attempt, DELAYS.length - 1)];
    if (retryAfter == null || retryAfter === '') return base;
    const sec = Number(retryAfter);
    const ms = Number.isFinite(sec) ? sec * 1000 : Date.parse(retryAfter) - now;
    return Number.isFinite(ms) && ms >= 0 ? Math.min(MAX_WAIT, Math.max(ms, 500)) : base;
  }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortError()); return; }
      const t = globalThis.setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      function onAbort() { globalThis.clearTimeout(t); reject(abortError()); }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function abortError() {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    return e;
  }

  // send() каждый раз делает новый запрос. Ответ без повода к повтору возвращается как есть (вызывающий сам
  // разбирает 400 и пр.); после исчерпания попыток — последний ответ или последняя сетевая ошибка.
  async function retryFetch(send, { signal, onWait, sleep = wait } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res = null, err = null;
      try { res = await send(); } catch (e) {
        if ((signal && signal.aborted) || e.name === 'AbortError') throw e;
        err = e;
      }
      if (res && !retryable(res.status)) return res;
      if (attempt >= DELAYS.length) { if (res) return res; throw err; }
      const ms = delayFor(attempt, res && res.headers && res.headers.get ? res.headers.get('retry-after') : null);
      if (res && res.body && res.body.cancel) res.body.cancel().catch(() => {});
      if (onWait) onWait({ attempt: attempt + 1, of: DELAYS.length, ms, status: res ? res.status : 0, error: err });
      await sleep(ms, signal);
    }
  }

  return { fetch: retryFetch, retryable, delayFor, DELAYS };
})();
