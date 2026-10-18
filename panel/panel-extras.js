'use strict';
/* panel-extras.js — удобства панели (не только /skript):
 *   - ↑/↓ в поле ввода: история отправленного (30 последних, вместе с чипом /skript, /study);
 *   - черновик поля переживает закрытие панели;
 *   - «/» с любого места панели: курсор в поле и меню команд;
 *   - у сообщений: «Копировать» (чат) и «Повторить» (ваши сообщения — текст в поле для правки).
 * Подключение: PanelExtras.init({ textarea, chip, setChip }) в конце sidepanel.js,
 * PanelExtras.remember(text, chip) — при отправке.
 */

const PanelExtras = (() => {
  const HIST_KEY = 'taskHistory';
  const DRAFT_KEY = 'taskDraft';
  const HIST_MAX = 30;
  let ta = null, deps = null, hist = [], pos = -1, stash = null, applying = false, draftTimer = 0;

  const stor = () => chrome.storage.local;

  // Показать запись в поле: сначала чип (он сам чистит поле), потом текст, курсор в конец.
  function show(entry) {
    applying = true;
    try {
      deps.setChip(entry.chip || null);
      ta.value = entry.text || '';
      ta.dispatchEvent(new Event('input'));
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    } finally { applying = false; }
  }

  // Черновик — только недописанный текст (команда сохраняется вместе с ним). Одна команда без текста
  // черновиком не считается, иначе панель открывалась бы с /skript. Пустое поле пишется сразу:
  // панель могут закрыть раньше, чем сработает задержка.
  function saveDraft() {
    clearTimeout(draftTimer);
    const write = () => {
      const text = ta.value;
      const v = text.trim() ? { text, chip: deps.chip() || null } : null;
      stor().set({ [DRAFT_KEY]: v }).catch(() => {});
    };
    if (!ta.value.trim()) write(); else draftTimer = setTimeout(write, 400);
  }

  // Отправлено: в историю (без повторов подряд того же), черновик больше не нужен.
  function remember(text, chip) {
    const t = String(text || '').trim();
    if (!t) return;
    const c = chip || null;
    hist = hist.filter((h) => !(h.text === t && (h.chip || null) === c));
    hist.push({ text: t, chip: c });
    hist = hist.slice(-HIST_MAX);
    pos = -1; stash = null;
    clearTimeout(draftTimer);
    stor().set({ [HIST_KEY]: hist, [DRAFT_KEY]: null }).catch(() => {});
  }

  function onKey(e) {
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (ta.selectionStart !== ta.selectionEnd) return;
    // Многострочный текст: стрелки ходят по строкам, историю листаем только с первой/последней строки.
    if (e.key === 'ArrowUp') {
      if (ta.value.slice(0, ta.selectionStart).includes('\n') || !hist.length) return;
      if (pos === -1) { stash = { text: ta.value, chip: deps.chip() || null }; pos = hist.length; }
      if (pos === 0) return;
      e.preventDefault();
      pos--;
      show(hist[pos]);
    } else {
      if (ta.value.slice(ta.selectionEnd).includes('\n') || pos === -1) return;
      e.preventDefault();
      pos++;
      if (pos >= hist.length) { pos = -1; show(stash || { text: '', chip: null }); stash = null; }
      else show(hist[pos]);
    }
  }

  // «/» вне полей ввода и без открытых экранов → в поле ввода; пустое поле получает «/» (меню команд).
  function onGlobalKey(e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target;
    if (t === ta || (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable))) return;
    if (document.querySelector('.sheet:not([hidden])')) return;
    e.preventDefault();
    ta.focus();
    if (!ta.value && !deps.chip()) { ta.value = '/'; ta.dispatchEvent(new Event('input')); }
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }

  // Иконка-кнопка без текста: textContent сообщения (и «Скопировать лог») не меняется.
  function iconButton(icon, label, onclick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'msg-tool'; b.title = label; b.setAttribute('aria-label', label);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ic');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + icon);
    svg.appendChild(use);
    b.appendChild(svg);
    b.onclick = (e) => { e.stopPropagation(); onclick(b); };
    return b;
  }

  async function copyText(text, b) {
    try { await navigator.clipboard.writeText(text); b.title = 'Скопировано'; b.classList.add('done'); }
    catch (e) { b.title = 'Не удалось скопировать'; }
    setTimeout(() => { b.title = 'Копировать'; b.classList.remove('done'); }, 1200);
  }

  // Текст в поле для правки (не отправляем); чип, если стоит, остаётся.
  function put(text) {
    ta.value = String(text || '');
    ta.dispatchEvent(new Event('input'));
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }

  // Кнопки у сообщения. opts: { copy, repeat }.
  function decorate(row, text, opts = {}) {
    if (typeof document === 'undefined' || !text) return;
    const tools = document.createElement('span');
    tools.className = 'msg-tools';
    if (opts.repeat) tools.appendChild(iconButton('i-refresh', 'Повторить: вставить в поле ввода', () => put(text)));
    if (opts.copy) tools.appendChild(iconButton('i-copy', 'Копировать', (b) => copyText(text, b)));
    if (tools.childNodes.length) row.appendChild(tools);
  }

  async function init(options) {
    deps = options;
    ta = options.textarea;
    ta.addEventListener('keydown', onKey);
    if (typeof document !== 'undefined') document.addEventListener('keydown', onGlobalKey);
    ta.addEventListener('input', () => {
      if (!applying) { pos = -1; stash = null; } // начали править — листание истории закончено
      saveDraft();
    });
    let r = {};
    try { r = await stor().get({ [HIST_KEY]: [], [DRAFT_KEY]: null }); } catch (e) { /* без истории */ }
    hist = (Array.isArray(r[HIST_KEY]) ? r[HIST_KEY] : []).filter((h) => h && typeof h.text === 'string').slice(-HIST_MAX);
    const d = r[DRAFT_KEY];
    if (d && typeof d.text === 'string' && !ta.value && !deps.chip()) show(d);
  }

  return { init, remember, decorate, put };
})();
