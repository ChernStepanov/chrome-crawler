'use strict';
/* model-switch.js — быстрый выбор модели по клику на её название в шапке (вместо похода в настройки).
 * Всплывающий список под названием: поиск, «Недавние» (в том числе у других провайдеров — выбор переключает
 * и провайдера, ключи берутся из его сохранённого профиля), модели текущего провайдера с сервера,
 * внизу — «Настройки подключения…». Закрывается кликом мимо, Esc или выбором; ↑/↓ и Enter — с клавиатуры.
 * Подключение: ModelSwitch.init({ anchor, current, providers, models, choose, openSettings }):
 *   current() → { provider, model }; providers — PROVIDERS; models() → Promise<[{ id, loaded?, vision? }]>
 *   (модели текущего провайдера); choose(provider, model) — переключить; openSettings() — открыть настройки.
 */

const ModelSwitch = (() => {
  const KEY = 'recentModels', RECENT_MAX = 6;
  let deps = null, pop = null, recent = [];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  // Недавние: свежие первыми, без повторов; хранятся между запусками.
  function remember(provider, model) {
    if (!provider || !model) return;
    recent = [{ provider, model }, ...recent.filter((r) => !(r.provider === provider && r.model === model))].slice(0, RECENT_MAX);
    try { chrome.storage.local.set({ [KEY]: recent }); } catch (e) { /* без памяти — только в этой сессии */ }
  }

  function close() {
    if (!pop) return;
    pop.remove(); pop = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    deps.anchor.setAttribute('aria-expanded', 'false');
  }
  function onOutside(e) { if (pop && !pop.contains(e.target) && !deps.anchor.contains(e.target)) close(); }
  function onKey(e) {
    if (!pop) return;
    const items = [...pop.querySelectorAll('.ms-item')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); deps.anchor.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, at + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (at <= 0) pop.querySelector('.ms-search').focus(); else items[at - 1].focus(); }
    else if (e.key === 'Enter' && document.activeElement === pop.querySelector('.ms-search')) { e.preventDefault(); items[0]?.click(); }
  }

  function item(label, hint, on, act) {
    const b = el('button', 'ms-item' + (on ? ' on' : ''));
    b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(!!on));
    b.append(el('span', 'ms-name', label));
    if (hint) b.append(el('small', 'ms-hint', hint));
    b.onclick = () => { close(); act(); };
    return b;
  }

  async function open() {
    if (pop) return close();
    const cur = deps.current(), P = deps.providers;
    pop = el('div', 'ms-pop');
    pop.setAttribute('role', 'listbox'); pop.setAttribute('aria-label', 'Выбор модели');
    const search = el('input', 'ms-search');
    search.type = 'text'; search.placeholder = 'Найти модель…'; search.setAttribute('aria-label', 'Найти модель');
    const recentBox = el('div', 'ms-group'), listBox = el('div', 'ms-group');
    const foot = item('Настройки подключения…', '', false, () => deps.openSettings());
    foot.classList.add('ms-foot');
    pop.append(search, recentBox, listBox, foot);
    document.body.appendChild(pop);
    // под названием модели, не выходя за края панели
    const a = deps.anchor.getBoundingClientRect(), w = Math.min(300, innerWidth - 16);
    Object.assign(pop.style, { width: w + 'px', left: Math.min(Math.max(8, a.left), innerWidth - w - 8) + 'px', top: a.bottom + 6 + 'px', maxHeight: Math.max(160, innerHeight - a.bottom - 20) + 'px' });
    deps.anchor.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);

    let models = null, failed = '';
    const paint = () => {
      const q = search.value.trim().toLocaleLowerCase();
      const hit = (s) => !q || s.toLocaleLowerCase().includes(q);
      recentBox.textContent = ''; listBox.textContent = '';
      // недавние; текущая — с галочкой, у другого провайдера — с его названием
      const rs = recent.filter((r) => P[r.provider] && hit(`${r.model} ${P[r.provider].label}`));
      if (rs.length) {
        recentBox.append(el('div', 'ms-cap', 'Недавние'));
        for (const r of rs) {
          const on = r.provider === cur.provider && r.model === cur.model;
          recentBox.append(item(r.model, r.provider === cur.provider ? '' : P[r.provider].label, on, () => deps.choose(r.provider, r.model)));
        }
      }
      listBox.append(el('div', 'ms-cap', P[cur.provider] ? P[cur.provider].label : 'Модели'));
      if (!models) { listBox.append(el('div', 'ms-note', failed || 'Загружаю список…')); return; }
      const ms = models.filter((m) => hit(m.id));
      for (const m of ms.slice(0, 40)) {
        const tags = [m.loaded === true ? 'в памяти' : null, m.vision ? 'vision' : null].filter(Boolean).join(' · ');
        listBox.append(item(m.id, tags, m.id === cur.model, () => deps.choose(cur.provider, m.id)));
      }
      if (!ms.length) listBox.append(el('div', 'ms-note', models.length ? 'Ничего не найдено.' : 'Сервер не вернул моделей.'));
    };
    search.oninput = paint;
    paint();
    search.focus({ preventScroll: true });
    try { models = await deps.models(); } catch (e) { failed = `Список не получен: ${String(e.message || e).slice(0, 80)}. Откройте настройки подключения.`; }
    if (pop) paint();
  }

  async function init(d) {
    deps = d;
    deps.anchor.setAttribute('aria-haspopup', 'listbox');
    deps.anchor.setAttribute('aria-expanded', 'false');
    deps.anchor.title = 'Сменить модель';
    deps.anchor.onclick = open;
    try { const r = (await chrome.storage.local.get({ [KEY]: [] }))[KEY]; if (Array.isArray(r)) recent = r.filter((x) => x && x.provider && x.model); } catch (e) { /* без памяти */ }
  }

  return { init, open, close, remember };
})();
