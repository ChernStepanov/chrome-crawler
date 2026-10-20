'use strict';
/* agent-loop.js — чистая логика главного цикла задачи (без DOM, CDP и chrome.*), вынесена из sidepanel.js
 * ради тестов: когда снимать скриншот, как сжимать старую историю, что сказать модели после click_at.
 */

const AgentLoop = (() => {
  // Мало текста или элементов в снимке страницы — вероятно, canvas, картинка или видео: без скриншота модель слепа.
  const SPARSE_TEXT = 300, SPARSE_ELEMENTS = 3;

  // Нужен ли скриншот на этом шаге.
  //   mode: 'structure' | 'image' | 'both' — выбор пользователя («Видит»);
  //   vision: 'auto' | 'on' | 'off' — просьба модели через инструмент vision (только в «Вместе»);
  //   once — модель попросила один снимок (vision once), needShot — прошлое действие не удалось.
  // В «Вместе» по умолчанию снимаем на первом шаге, после неудачи, по просьбе и на «пустых» страницах —
  // а не на каждом шаге, как раньше (это была главная статья расхода токенов).
  // visual — доля экрана под canvas/video: от 10% — поле игры или редактора, без снимка модель слепа,
  // сколько бы текста ни было вокруг (живой прогон 2048: счёт и меню есть, поля в тексте нет).
  const VISUAL_SHARE = 0.1;
  function wantShot({ mode, step, vision = 'auto', once = false, needShot = false, textLen = 0, count = 0, visual = 0 }) {
    if (mode === 'structure') return false;
    if (mode === 'image') return true;
    if (once) return true;
    if (vision === 'on') return true;
    if (vision === 'off') return !!needShot;
    return step === 1 || !!needShot || visual >= VISUAL_SHARE || textLen < SPARSE_TEXT || count < SPARSE_ELEMENTS;
  }

  // Сжатие истории: в группах старше последних keepFull длинные результаты инструментов
  // (extract_items до 9000 символов, fetch_page до 7000…) обрезаются до maxLen — модель получала их
  // дословно на каждом следующем шаге. Идемпотентно; пары tool_calls/tool не трогаются, только текст.
  const MARK = ' …[сокращено: старый результат]';
  function cut(text, maxLen) {
    return typeof text === 'string' && text.length > maxLen && !text.endsWith(MARK) ? text.slice(0, maxLen) + MARK : text;
  }
  function trimHistory(groups, keepFull = 2, maxLen = 600) {
    let saved = 0;
    for (let i = 0; i < groups.length - keepFull; i++) {
      for (const m of groups[i].msgs) {
        if (m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string')) {
          const before = m.content.length;
          // заглушка наблюдения хранит префикс (в JSON-режиме там результаты инструментов) — режем с запасом
          m.content = cut(m.content, m.role === 'tool' ? maxLen : maxLen * 2);
          saved += before - m.content.length;
        }
      }
    }
    return saved;
  }

  // Ответ модели после click_at: что оказалось под курсором. Раньше всегда «Clicked at (x, y).» —
  // и клик в пустое место модель считала успехом.
  const INTERACTIVE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL|OPTION)$/;
  function clickAtText(x, y, d) {
    if (!d || !d.ok) return `Clicked at (${x}, ${y}), but nothing was found at that point. Check the coordinates (they may be outside the page) or click an element by id.`;
    const tag = String(d.tag || '').toUpperCase();
    const label = String(d.label || '').trim();
    const what = `${tag.toLowerCase() || 'element'}${label ? ` "${label.slice(0, 80)}"` : ''}`;
    if (INTERACTIVE.test(tag) || d.role || d.clickable) return `Clicked at (${x}, ${y}) on ${what}.`;
    return `Clicked at (${x}, ${y}) on ${what} — not a link or button, the click may have done nothing. ` +
      'Re-observe; if nothing changed, click the element by id (query_dom lists links and buttons) instead of guessing coordinates.';
  }

  // Ссылки в ответе: модель не всегда пишет «- [название](ссылка) — **цена**» (живой прогон Авито: строки без ссылок).
  // Строка списка без ссылки, где есть цена, сопоставляется с объявлениями из extract_items этой задачи:
  // та же цена и больше всего общих слов в названии — название строки становится ссылкой. Не угадываем:
  // нет общей цены или ни одного общего слова — строка остаётся как есть; одна ссылка — на одну строку.
  const words = (t) => new Set(String(t).toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]{2,}/g) || []);
  const priceIn = (t) => {
    const m = /\*\*([^*\n]+)\*\*/.exec(t) || /(\d[\d\s\u00a0]{2,}\d)\s*(?:₽|руб|rub|\$|€)/i.exec(t);
    if (!m) return null;
    const n = Number(String(m[1]).replace(/[^\d]/g, ''));
    return n > 0 ? n : null;
  };
  // Список — в пункты «- …»: только их панель показывает списком и карточками (renderAnswer), только в них linkItems
  // ставит ссылки. Живой прогон Авито: «Топ-5: 1) Dogma 2 — 74 900 ₽ (Тольятти); 2) …» — одной строкой, без ссылок.
  // Нумерованные строки «1. …» и перечисление «1) …; 2) …» в одной строке (номера подряд с 1, хотя бы два пункта с ценой)
  // становятся пунктами; цена пункта без **…** выделяется. Строки без цен не трогаем: это не список объявлений.
  const PRICE_RE = /(\d[\d\s\u00a0]{2,}\d)\s*(₽|руб\.?|rub|\$|€)/i;
  const boldPrice = (t) => (/\*\*[^*\n]+\*\*/.test(t) ? t : t.replace(PRICE_RE, (m) => `**${m.trim()}**`));
  function listify(answer) {
    const out = [];
    for (const line of String(answer).split('\n')) {
      const num = /^(\s*)\d{1,2}[.)]\s+(.+)$/.exec(line);
      if (num && PRICE_RE.test(num[2])) { out.push(`${num[1]}- ${boldPrice(num[2].replace(/[;,]\s*$/, ''))}`); continue; }
      // номера пунктов внутри строки: 1) … 2) … — только подряд с 1, после начала строки, пробела, «;», «:» или «,»
      const marks = [];
      for (const m of line.matchAll(/(^|[\s;:,])(\d{1,2})[.)]\s/g)) if (Number(m[2]) === marks.length + 1) marks.push(m.index + m[1].length);
      if (marks.length >= 2) {
        const parts = marks.map((at, i) => line.slice(at, marks[i + 1] ?? line.length).replace(/^\d{1,2}[.)]\s+/, '').trim().replace(/[;,]\s*$/, '').trim());
        if (parts.filter((x) => PRICE_RE.test(x)).length >= 2) {
          const head = line.slice(0, marks[0]).trim().replace(/[\s:—–-]+$/, '');
          if (head) out.push(head + ':');
          for (const x of parts) out.push(`- ${PRICE_RE.test(x) ? boldPrice(x) : x}`);
          continue;
        }
      }
      const b = /^(\s*[-•*]\s+)(.+)$/.exec(line);
      out.push(b && PRICE_RE.test(b[2]) ? b[1] + boldPrice(b[2]) : line);
    }
    return out.join('\n');
  }

  function linkItems(answer, items) {
    answer = listify(answer);
    if (!items || !items.length) return answer;
    const used = new Set();
    for (const m of String(answer).matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)) used.add(m[1]);
    return String(answer).split('\n').map((line) => {
      const b = /^(\s*[-•*]\s+)(.+)$/.exec(line);
      if (!b || /\]\(https?:\/\//.test(b[2])) return line;
      const price = priceIn(b[2]);
      if (!price) return line;
      const lw = words(b[2]);
      let best = null, bestScore = 0;
      for (const it of items) {
        if (it.price !== price || !it.url || used.has(it.url)) continue;
        let sc = 0;
        for (const w of words(it.title)) if (lw.has(w)) sc++;
        if (sc > bestScore) { best = it; bestScore = sc; }
      }
      if (!best) return line;
      used.add(best.url);
      // название — до разделителя « — » (или до цены); остальное как было
      const body = b[2];
      const cut = body.search(/\s[—–-]\s|\*\*/);
      const name = (cut > 0 ? body.slice(0, cut) : body).trim().replace(/[\[\]]/g, '');
      const rest = cut > 0 ? body.slice(cut) : '';
      return `${b[1]}[${name}](${best.url})${rest.startsWith(' ') || !rest ? '' : ' '}${rest}`;
    }).join('\n');
  }

  // Список не в том поле: модель положила в answer только заголовок («Топ-5 дешёвых…»), а сам список — в reasoning
  // или summary (живой прогон Авито: в карточке ответа один заголовок). Если в ответе нет ни одной строки списка
  // с ценой, а в пояснении (после listify — в любом виде: «- », «1.», «1) … 2) …») их хотя бы две — переносим их
  // в ответ, а из пояснения убираем, чтобы не дублировать.
  const priced = (l) => /^\s*[-•*]\s+\S/.test(l) && PRICE_RE.test(l);
  function salvageList(answer, reasoning, summary) {
    const out = { answer: String(answer || ''), reasoning: String(reasoning || ''), summary: String(summary || '') };
    if (listify(out.answer).split('\n').some(priced)) return out;
    for (const key of ['reasoning', 'summary']) {
      const lines = listify(out[key]).split('\n'), items = lines.filter(priced);
      if (items.length < 2) continue;
      out.answer = (out.answer.trim() ? out.answer.trim() + '\n' : '') + items.map((l) => l.trim()).join('\n');
      out[key] = lines.filter((l) => !priced(l)).join('\n').trim();
      return out;
    }
    return out;
  }

  // ---- Разбор «Команд в ответе» (JSON-протокол) ----
  // Вынесено из sidepanel.js, чтобы можно было проверить набор инструментов: в /skript и /study
  // разрешены не только базовые TOOLS, но и write_script/run_script/… и встроенные навыки.
  function safeJson(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }

  // Достаём первый сбалансированный JSON-объект/массив из текста ответа.
  function extractJsonBlock(text) {
    if (!text) return null;
    // «думающие» модели (qwen3, deepseek-r1) пишут рассуждения в <think>…</think>
    let t = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '');
    if (t.includes('</think>')) t = t.slice(t.lastIndexOf('</think>') + 8);
    t = t.trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    const start = t.search(/[\[{]/);
    if (start < 0) return null;
    const open = t[start], close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) { end = i; break; }
    }
    if (end < 0) return null;
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { return null; }
  }

  // Приводим сбалансированный JSON к списку вызовов инструментов. tools — массив определений
  // (function.name) или имён; всё, чего нет в наборе, отбрасываем.
  function parseActions(text, tools) {
    const obj = extractJsonBlock(text);
    if (!obj) return [];
    const list = Array.isArray(obj) ? obj : Array.isArray(obj.actions) ? obj.actions : (obj.tool || obj.name || obj.function) ? [obj] : [];
    const names = new Set((tools || []).map((t) => (typeof t === 'string' ? t : t && t.function && t.function.name)).filter(Boolean));
    return list.map((a, i) => {
      const name = a.tool || a.name || a.function?.name || a.action;
      let args = a.args || a.arguments || a.parameters || a.input || a.function?.arguments || {};
      if (typeof args === 'string') args = safeJson(args);
      return { id: 'j' + i, name, args };
    }).filter((c) => names.has(c.name));
  }

  return { wantShot, trimHistory, clickAtText, linkItems, listify, salvageList, safeJson, extractJsonBlock, parseActions, SPARSE_TEXT, SPARSE_ELEMENTS };
})();
