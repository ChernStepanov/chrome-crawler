'use strict';
/* skript-ui.js — меню «/», чип команды и полоска доступа режима /skript (этап 4).
 * Только DOM-привязка: вся логика в SkriptMode/SkriptAccess. Без innerHTML и модальных окон.
 * Подключение: SkriptUI.init({ textarea, openLibrary }) в конце sidepanel.js.
 */

const SkriptUI = (() => {
  const VALUE_LABELS = {
    nav: [['none', 'Нет'], ['same-origin', 'Сайт'], ['any', 'Везде']],
    askHuman: [['never', 'Никогда'], ['needed', 'Если нужно'], ['often', 'Часто']],
    bool: [[false, 'Выкл'], [true, 'Вкл']]
  };

  let ta, deps, chip = null, menuItems = [], menuIndex = 0, popFor = null, locked = false, rememberOn = false;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  // ---- Меню «/» ----
  function hideMenu() { const m = $('skriptMenu'); m.hidden = true; m.textContent = ''; menuItems = []; }

  function renderMenu() {
    const m = $('skriptMenu');
    m.textContent = '';
    menuItems.forEach((c, i) => {
      const b = el('button', i === menuIndex ? 'on' : '');
      b.type = 'button'; b.setAttribute('role', 'option');
      b.append(el('span', '', c.label), el('span', 'hint', c.hint));
      b.onmousedown = (e) => { e.preventDefault(); choose(c.id); };
      m.append(b);
    });
    m.hidden = !menuItems.length;
  }

  function updateMenu() {
    if (chip || !ta) { hideMenu(); return; }
    const next = SkriptMode.matchCommands(ta.value);
    menuIndex = next.length === menuItems.length ? Math.min(menuIndex, Math.max(0, next.length - 1)) : 0;
    menuItems = next;
    renderMenu();
  }

  function choose(id) {
    hideMenu();
    if (id === 'lib') { ta.value = ''; ta.dispatchEvent(new Event('input')); deps.openLibrary(); return; }
    setChip(id);
  }

  // ---- Чип ----
  async function setChip(id) {
    chip = id;
    ta.value = ta.value.replace(/^\/\S*\s*/, '');
    ta.dispatchEvent(new Event('input'));
    $('skriptChip').firstChild.textContent = '/' + id;
    $('skriptChipRow').hidden = false;
    ta.focus();
    await SkriptMode.arm();
    if (chip) { renderBar(); $('skriptBar').hidden = false; }
  }

  function removeChip() {
    chip = null;
    popFor = null;
    SkriptMode.disarm();
    $('skriptChipRow').hidden = true;
    $('skriptBar').hidden = true;
    $('skriptPop').hidden = true;
    ta.dispatchEvent(new Event('input'));   // черновик поля пересохраняется уже без чипа
    ta.focus();
  }

  // ---- Полоска доступа ----
  // Полоска доступа — одна кнопка «Доступ: пресет» рядом с чипом; всё остальное в карточке над полем ввода.
  function renderBar() {
    const grants = SkriptMode.grants;
    if (!grants) return;
    const bar = $('skriptToggles');
    bar.textContent = '';
    const preset = SkriptAccess.PRESETS[SkriptMode.preset];
    const on = SkriptAccess.BAR_TOGGLES.filter((item) => SkriptAccess.grantOn(grants, item.id));
    const pb = el('button', 'preset', `Доступ: ${preset ? preset.label : SkriptMode.preset}`);
    pb.type = 'button';
    pb.title = on.length ? `Включено: ${on.map((item) => item.label.toLowerCase()).join(', ')}.` : 'Только просмотр страницы.';
    pb.setAttribute('aria-expanded', String(!!popFor));
    if (preset && preset.warn) { const d = el('span', 'warn-dot'); d.title = 'Свободный режим: действия необратимы'; pb.append(d); }
    pb.append(el('span', 'chev', '▾'));
    pb.onclick = () => { popFor = popFor ? null : 'all'; renderBar(); };
    bar.append(pb);
    renderPop();
  }

  // Значок «i»: пояснение всплывает при наведении и фокусе, в разметке не занимает места.
  function info(text) {
    const i = el('span', 'info', 'i');
    i.tabIndex = 0; i.dataset.tip = text; i.setAttribute('aria-label', text);
    return i;
  }

  function renderPop() {
    const pop = $('skriptPop');
    pop.textContent = '';
    if (!popFor) { pop.hidden = true; return; }
    const grants = SkriptMode.grants;
    const remember = el('input'); remember.type = 'checkbox'; remember.id = 'skriptRemember';
    remember.checked = rememberOn; remember.onchange = () => { rememberOn = remember.checked; };
    const rememberLabel = el('label', 'remember'); rememberLabel.append(remember, document.createTextNode('запомнить в настройках'));

    const preset = SkriptAccess.PRESETS[SkriptMode.preset];
    const presets = el('div', 'seg');
    for (const [id, p] of Object.entries(SkriptAccess.PRESETS)) {
      const b = el('button', id === SkriptMode.preset ? 'on' : '', p.label);
      b.type = 'button';
      b.onclick = async () => { await SkriptMode.setPreset(id, remember.checked); renderBar(); };
      presets.append(b);
    }
    const head = el('h4', '', 'Доступ');
    if (preset) head.append(info(preset.hint));
    pop.append(head, presets);

    const list = el('div', 'acc-list');
    // Сначала выбор из трёх значений, затем переключатели вкл/выкл.
    const multi = (item) => item.id === 'nav' || item.id === 'askHuman';
    for (const item of [...SkriptAccess.BAR_TOGGLES].sort((a, b) => multi(b) - multi(a))) {
      const meta = SkriptAccess.GRANT_META[item.id];
      const row = el('div', 'acc-row');
      const text = el('div', 'acc-text');
      text.append(el('span', '', item.label), info(meta.hint));
      row.append(text);
      if (item.id === 'nav' || item.id === 'askHuman') {
        const vals = el('div', 'seg');
        for (const [v, label] of VALUE_LABELS[item.id]) {
          const b = el('button', v === grants[item.id] ? 'on' : '', label);
          b.type = 'button';
          b.onclick = async () => { await SkriptMode.setGrant(item.id, v, remember.checked); renderBar(); };
          vals.append(b);
        }
        row.classList.add('multi');
        row.append(vals);
      } else {
        const sw = el('input', 'sw'); sw.type = 'checkbox';
        sw.checked = SkriptAccess.grantOn(grants, item.id);
        sw.setAttribute('aria-label', item.label);
        sw.onchange = async () => { await SkriptMode.setGrant(item.id, sw.checked ? item.on : item.off, remember.checked); renderBar(); };
        row.append(sw);
      }
      list.append(row);
    }
    pop.append(list, rememberLabel);
    pop.hidden = false;
  }

  // ---- Подключение ----
  function init(options) {
    deps = options;
    ta = options.textarea;
    $('skriptChip').onclick = removeChip;
    ta.addEventListener('input', () => {
      // «/skript задача» набрано целиком — превращаем в чип.
      const typed = !chip && /^\/(skript|script|study)\s/i.exec(ta.value);
      if (typed) { setChip(typed[1].toLowerCase() === 'study' ? 'study' : 'skript'); return; }
      updateMenu();
    });
    // capture: срабатывает раньше обработчика Enter из sidepanel.js
    ta.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (menuItems.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopImmediatePropagation();
          menuIndex = (menuIndex + (e.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length;
          renderMenu();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault(); e.stopImmediatePropagation();
          choose(menuItems[menuIndex].id);
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopImmediatePropagation();
          hideMenu();
        }
        return;
      }
      if (e.key === 'Backspace' && chip && !ta.value && !locked) { e.preventDefault(); removeChip(); }
    }, true);
    ta.addEventListener('blur', () => setTimeout(hideMenu, 120));
  }

  return {
    init,
    chip: () => chip,
    // Запуск: полоска блокируется (набор инструментов фиксируется на время задачи).
    lock() { locked = true; popFor = null; $('skriptPop').hidden = true; $('skriptBar').classList.add('locked'); },
    // Конец задачи: чип снимается, режим разоружается.
    finish() { locked = false; $('skriptBar').classList.remove('locked'); if (chip) removeChip(); },
    clearText() { ta.value = ''; ta.dispatchEvent(new Event('input')); },
    use(id) { if (!locked) setChip(id); },
    // Чип по записи истории/черновика: id — поставить, null — убрать (во время задачи не трогаем).
    set(id) { if (locked || id === chip) return; if (id) setChip(id); else if (chip) removeChip(); }
  };
})();
