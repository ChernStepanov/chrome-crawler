'use strict';
/* skript-library.js — сохранённые скрипты в панели (часть этапа 8): предложение
 * «Для этой страницы есть скрипты» над полем ввода и раздел «Скрипты» на экране «Скрипты сайтов».
 * Только предлагает (R5/R6): запускает человек кнопкой. Без модальных окон и innerHTML.
 * Подключение: SkriptLibrary.init({ activeTab, runSaved, busy, startNew, openAll, onChange, openSite }).
 */

const SkriptLibrary = (() => {
  const PERM_LABELS = { read: 'чтение страницы', input: 'ввод (клавиши, мышь)', 'dom-write': 'запись в DOM', 'nav-same-origin': 'навигация по сайту' };
  let deps = null, open = false, seq = 0, expect = '', shownFor = '';
  const dismissed = new Set(); // origin, где предложение скрыто до перезапуска панели
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const button = (label, cls, onclick) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.onclick = onclick; return b; };

  // Только обычные сайты: у chrome:// и т.п. скриптов не бывает.
  function originOf(url) {
    try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch (e) { return ''; }
  }

  async function scriptsFor(url) {
    const all = await SkriptStore.list();
    return SkriptRegistry.match(url, all.filter((s) => s.kind !== 'note'));
  }

  function perms(list) {
    const row = el('div', 'sc-perms');
    for (const p of list || []) row.append(el('span', 'sc-perm' + (p === 'read' ? '' : ' warn'), PERM_LABELS[p] || p));
    return row;
  }

  async function run(id, hint) {
    hint.textContent = '';
    const why = await deps.runSaved(id);
    if (why) { hint.textContent = why; return; }
    open = false;
    refresh();
  }

  // ---- Предложение над полем ввода ----
  async function refresh() {
    if (!deps) return;
    const my = ++seq;
    let tab = null, list = [];
    try { tab = await deps.activeTab(); list = tab ? await scriptsFor(tab.url) : []; } catch (e) { list = []; }
    if (my !== seq) return; // уже идёт более свежее обновление
    const box = $('skriptOffer');
    const origin = originOf(tab && tab.url);
    box.textContent = '';
    if (!list.length || deps.busy() || dismissed.has(origin)) { box.hidden = true; open = false; return; }
    // Другой сайт — снова свёрнуто; пришли кнопкой «Открыть сайт» — сразу раскрыто: осталось нажать «Запустить».
    if (origin !== shownFor) { open = false; shownFor = origin; }
    if (expect && expect === origin) { open = true; expect = ''; }

    // × — скрыть предложение для этого сайта (до перезапуска панели)
    const close = el('button', 'so-x', '×');
    close.type = 'button'; close.title = 'Скрыть для этого сайта'; close.setAttribute('aria-label', 'Скрыть предложение');
    close.onclick = () => { dismissed.add(origin); refresh(); };

    // Свёрнуто — только плашка; раскрыто — только карточка (плашка не дублирует её сверху).
    if (!open) {
      const head = el('div', 'so-head');
      const toggle = el('button', 'so-toggle', `Для этой страницы есть скрипты: ${list.length}`);
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.onclick = () => { open = true; refresh(); };
      head.append(toggle, close);
      box.append(head);
    } else {
      const body = el('div', 'so-list');
      const hint = el('div', 'so-hint');
      const cap = el('div', 'so-cap');
      const fold = el('button', 'so-fold', 'Скрипты для этой страницы');
      fold.type = 'button'; fold.title = 'Свернуть';
      fold.setAttribute('aria-expanded', 'true');
      fold.onclick = () => { open = false; refresh(); };
      cap.append(fold, close);
      body.append(cap);
      for (const s of list) {
        const row = el('div', 'so-row');
        const info = el('div', 'so-info');
        info.append(el('span', 'so-title', s.title), el('span', 'so-meta', (s.permissions || []).map((p) => PERM_LABELS[p] || p).join(', ')));
        row.append(info, button('Запустить', 'primary', () => run(s.id, hint)));
        body.append(row);
      }
      const foot = el('div', 'so-foot');
      foot.append(
        button('Сделать новый', '', () => { open = false; deps.startNew(); refresh(); }),
        button('Все скрипты', '', () => { open = false; deps.openAll(); refresh(); })
      );
      body.append(foot, hint);
      box.append(body);
    }
    box.hidden = false;
  }

  // ---- Раздел «Встроенные навыки»: вкл/выкл и предпочтения (у Onshape — единицы и пожелания) ----
  async function renderBuiltins(root) {
    if (typeof SkriptBuiltin === 'undefined') return;
    const list = await SkriptBuiltin.list();
    if (!list.length) return;
    root.append(el('h3', 'lib-h', 'Встроенные навыки'));
    for (const b of list) {
      const card = el('div', 'card lib-card');
      card.append(el('div', 'note-host', `${b.title} · ${b.site}`), el('div', 'hint', b.enabled ? 'Включён' : 'Выключен'), el('div', 'skill-text', b.description));
      if (b.prefs && 'units' in b.prefs) {
        const units = el('select', 'inp');
        units.setAttribute('aria-label', 'Единицы');
        for (const [v, label] of SkriptOnshape.UNITS) { const o = el('option', '', label); o.value = v; if (v === b.prefs.units) o.selected = true; units.append(o); }
        const notes = el('textarea', 'inp skill-editor lib-notes');
        notes.value = b.prefs.notes || '';
        notes.placeholder = 'Пожелания к моделям: например, «фаски 0.5 мм на внешних рёбрах, деталь от начала координат».';
        notes.maxLength = 600;
        const saved = el('span', 'hint');
        const row = el('div', 'lib-prefs');
        row.append(el('label', 'hint', 'Единицы'), units);
        card.append(row, notes);
        const save = button('Сохранить предпочтения', '', async () => {
          await SkriptBuiltin.savePrefs(b.id, { units: units.value, notes: notes.value.trim() });
          saved.textContent = 'Сохранено';
        });
        const actions = el('div', 'skill-actions');
        actions.append(save, button(b.enabled ? 'Выключить' : 'Включить', '', async () => { await SkriptBuiltin.setEnabled(b.id, !b.enabled); deps.onChange(); }), saved);
        card.append(actions);
      } else {
        const actions = el('div', 'skill-actions');
        actions.append(button(b.enabled ? 'Выключить' : 'Включить', '', async () => { await SkriptBuiltin.setEnabled(b.id, !b.enabled); deps.onChange(); }));
        card.append(actions);
      }
      root.append(card);
    }
  }

  // ---- Раздел «Скрипты» на экране «Скрипты сайтов» ----
  async function renderSection(root) {
    await renderBuiltins(root);
    const all = (await SkriptStore.list()).filter((s) => s.kind !== 'note');
    let tab = null;
    try { tab = await deps.activeTab(); } catch (e) { /* без вкладки запуск недоступен */ }
    const here = originOf(tab && tab.url);
    root.append(el('h3', 'lib-h', 'Скрипты'));
    if (!all.length) {
      root.append(el('div', 'hint lib-empty', 'Сохранённых скриптов пока нет. Запустите задачу с /skript и нажмите «Сохранить для сайта» в карточке скрипта.'));
      return;
    }
    for (const s of all) {
      const on = s.enabled !== false;
      const card = el('div', 'card lib-card');
      const st = s.stats || {};
      card.append(
        el('div', 'note-host', `${s.title} · ${s.scope.origin.replace(/^https?:\/\//, '')}`),
        el('div', 'hint', `${on ? '' : 'Отключён · '}v${s.version || 1} · запусков ${st.runs || 0}, удачных ${st.successes || 0}`),
        perms(s.permissions)
      );
      if (s.description) card.append(el('div', 'skill-text', s.description));
      const det = el('details', 'sc-code');
      det.append(el('summary', '', 'Код скрипта'), el('pre', '', s.code));
      const hint = el('div', 'hint bad');
      const actions = el('div', 'skill-actions');
      // На своём сайте — запуск; на другом — предложить открыть сайт скрипта.
      const there = here === s.scope.origin;
      const target = s.scope.origin + (s.scope.pathPrefix || '/');
      const rb = there
        ? button('Запустить', 'primary', () => run(s.id, hint))
        : button('Открыть сайт', 'primary', () => { expect = s.scope.origin; deps.openSite(target); });
      rb.disabled = !on;
      if (!on) rb.title = 'Скрипт отключён';
      else if (!there) rb.title = `Откроет ${target} в новой вкладке; запустить можно будет оттуда`;
      actions.append(
        rb,
        button(on ? 'Отключить' : 'Включить', '', async () => { await SkriptStore.setEnabled(s.id, !on); deps.onChange(); }),
        button('Удалить', '', async () => { await SkriptStore.remove(s.id); deps.onChange(); })
      );
      card.append(det, actions, hint);
      root.append(card);
    }
  }

  return {
    init(options) { deps = options; refresh(); },
    refresh,
    renderSection,
    originOf
  };
})();
