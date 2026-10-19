'use strict';
/* skript-card.js — карточка скрипта (этап 6): код, права, «Запустить/Отклонить», «Стоп», телеметрия, итог.
 * Только DOM, textContent, токены панели.
 *
 * Жизненный цикл:
 *   - запуск (running) — карточка «переползает» в док над полем ввода; в логе остаётся якорь «Скрипт · у поля ввода ↓»;
 *   - итог (finish) — карточка ОСТАЁТСЯ в доке в компактном режиме «итог» (✓ / ■ остановлен / × ошибка),
 *     с кнопками offer() и «×»;
 *   - уходит из дока в лог (на место якоря): «×», въезд другой карточки (в доке одна), новая задача;
 *     «Новый запуск» очищает док без анимации;
 *   - повторный запуск той же карточки — счётчик «×N» в шапке, DOM не дублируется;
 *   - заменённая версия кода сворачивается в строку «vN → заменён vM».
 * Все переходы идемпотентны: повторные dock/undock/finish в любом порядке не оставляют висячих якорей.
 */

const SkriptCard = (() => {
  const PERM_LABELS = { read: 'чтение страницы', input: 'ввод (клавиши, мышь)', 'dom-write': 'запись в DOM' };
  const BADGE = { ok: '✓ готово', stopped: '■ остановлен', fail: '× ошибка' };
  const EASE_LUX = 'cubic-bezier(0.16, 1, 0.3, 1)';             // --ease-lux панели (в WAAPI переменные CSS не работают)
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  // classList есть не у всех узлов (заглушки тестов) — переключаем класс через className
  const cls = (n, name, on) => {
    if (n.classList) { n.classList.toggle(name, on); return; }
    const set = new Set(String(n.className || '').split(/\s+/).filter(Boolean));
    if (on) set.add(name); else set.delete(name);
    n.className = [...set].join(' ');
  };
  const reduced = () => typeof matchMedia === 'function' && (matchMedia('(prefers-reduced-motion: reduce)').matches ||
    (typeof document.documentElement !== 'undefined' && document.documentElement && document.documentElement.dataset && document.documentElement.dataset.motion === 'off'));
  const dockEl = () => (typeof document.getElementById === 'function' ? document.getElementById('skriptDock') : null);

  let docked = null;                                            // карточка, что сейчас в доке (одна)

  // Высота дока меняется плавно (FLIP по высоте): поле ввода не прыгает.
  function smoothDock(change) {
    const d = dockEl();
    if (!d || !d.animate || reduced()) { change(); return; }
    const h0 = d.offsetHeight;
    change();
    const h1 = d.offsetHeight;
    if (h0 !== h1) d.animate([{ height: h0 + 'px', overflow: 'hidden' }, { height: h1 + 'px', overflow: 'hidden' }], { duration: 480, easing: EASE_LUX });
  }

  // Перенос с анимацией «переползания» (FLIP): элемент уже на новом месте, анимация ведёт его от старого.
  // transformOrigin — стилем элемента (опцией animate() его не задать); без мигания прозрачности.
  function crawl(root, parent, before) {
    const a = root.isConnected && root.getBoundingClientRect ? root.getBoundingClientRect() : null;
    parent.insertBefore(root, before || null);
    if (!a || !root.animate || reduced()) return;
    const b = root.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
    root.style.transformOrigin = 'top left';
    root.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transform: `translate(${dx * 0.32}px, ${dy * 0.32}px) scale(${(sx + 1) / 2 * 1.03}, ${(sy + 1) / 2 * 0.93})`, offset: 0.55 },
      { transform: 'none' }
    ], { duration: 300, easing: 'cubic-bezier(.3,.7,.2,1)' });
  }

  function create({ container, title, version, permissions, code, goal }) {
    const root = el('div', 'msg skript-card');
    const head = el('div', 'sc-head');
    const runsEl = el('span', 'sc-runs');
    const badge = el('span', 'sc-badge');
    head.append(el('span', 'sc-title', title), el('span', 'sc-ver', typeof version === 'number' ? 'v' + version : String(version)), runsEl, badge);
    const perms = el('div', 'sc-perms');
    for (const p of permissions) perms.append(el('span', 'sc-perm' + (p === 'read' ? '' : ' warn'), PERM_LABELS[p] || p));
    // Копировать код (скрипт или FeatureScript) — например, чтобы вставить в редактор или прислать.
    const copy = el('button', 'sc-copy', 'Копировать');
    copy.type = 'button';
    copy.title = 'Скопировать код в буфер обмена';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(code); copy.textContent = 'Скопировано'; }
      catch (e) { copy.textContent = 'Не удалось'; }
      setTimeout(() => { copy.textContent = 'Копировать'; }, 1200);
    };
    // «×» — убрать карточку из дока обратно в лог (видна только в доке)
    const dismiss = el('button', 'sc-dismiss', '×');
    dismiss.type = 'button';
    dismiss.title = 'Убрать из поля ввода в лог';
    dismiss.setAttribute && dismiss.setAttribute('aria-label', 'Убрать из поля ввода');
    head.append(copy, dismiss);
    // Цель скрипта (критерий оценки): число и направление человек правит до «Запустить»; read — только показ.
    let goalRow = null, goalInput = null, goalDir = null;
    if (goal) {
      goalRow = el('div', 'sc-goal');
      goalInput = el('input', 'inp sc-goal-target');
      goalInput.type = 'number'; goalInput.step = 'any';
      goalInput.value = goal.target === null || goal.target === undefined ? '' : String(goal.target);
      goalInput.placeholder = 'без цели';
      goalInput.setAttribute('aria-label', `Цель: ${goal.metric}`);
      goalDir = el('select', 'inp sc-goal-dir');
      for (const [v, label] of [['higher', 'больше — лучше'], ['lower', 'меньше — лучше']]) {
        const o = el('option', '', label); o.value = v; if (v === goal.better) o.selected = true; goalDir.append(o);
      }
      goalDir.value = goal.better;
      goalInput.disabled = goalDir.disabled = true;
      goalRow.append(el('span', 'sc-goal-label', `Цель: ${goal.metric}`), goalInput, goalDir,
        el('span', 'sc-goal-src', goal.read ? 'читает расширение со страницы' : 'со слов скрипта'));
      if (goal.read) goalRow.title = `Как читается: ${goal.read}`;
    }
    const det = el('details', 'sc-code');
    det.append(el('summary', '', 'Код скрипта'), el('pre', '', code));
    const actions = el('div', 'sc-actions');
    const tele = el('div', 'sc-tele');
    const result = el('div', 'sc-result');
    tele.hidden = result.hidden = true;
    root.append(head, perms, ...(goalRow ? [goalRow] : []), det, actions, tele, result);
    container.append(root);
    container.scrollTop = container.scrollHeight;

    let slot = null, runs = 0, collapsed = false;

    // якорь в логе на месте карточки: клик подсвечивает её в доке
    const makeSlot = () => {
      const s = el('div', 'sc-slot', `Скрипт «${title}» · у поля ввода ↓`);
      s.title = 'Показать карточку у поля ввода';
      s.onclick = () => api.flash();
      return s;
    };

    const api = {
      root,
      get collapsed() { return collapsed; },
      get docked() { return docked === api; },

      // В док (над полем ввода). Другая карточка из дока уходит в лог. Повторный вызов — ничего.
      dock() {
        const place = dockEl();
        if (!place || collapsed || docked === api || !root.parentNode) return;
        if (docked) docked.toLog(true);
        slot = makeSlot();
        root.parentNode.insertBefore(slot, root);
        smoothDock(() => crawl(root, place));
        cls(root, 'docked', true);
        docked = api;
      },

      // Из дока в лог — на место якоря (якоря нет — в конец лога). Повторный вызов — ничего.
      toLog(animated = true) {
        if (docked !== api) return;
        docked = null;
        cls(root, 'docked', false);
        const back = () => {
          if (slot && slot.isConnected) slot.parentNode.insertBefore(root, slot); else container.append(root);
        };
        if (animated) smoothDock(() => { if (slot && slot.isConnected) crawl(root, slot.parentNode, slot); else crawl(root, container); });
        else back();
        if (slot) { slot.remove(); slot = null; }
        container.scrollTop = container.scrollHeight;
      },

      // Подсветить карточку (клик по якорю в логе)
      flash() {
        if (!root.animate) return;
        root.animate([{ outlineColor: 'transparent' }, { outlineColor: 'var(--accent)', offset: 0.3 }, { outlineColor: 'transparent' }],
          { duration: 900, easing: EASE_LUX });
      },

      // Ждём решения человека. signal — остановка всей задачи; runLabel — подпись кнопки одобрения.
      ask(signal, runLabel = 'Запустить') {
        return new Promise((resolve) => {
          const done = (v) => {
            actions.textContent = '';
            if (goalInput) goalInput.disabled = goalDir.disabled = true;
            signal && signal.removeEventListener('abort', onAbort);
            resolve(v);
          };
          if (goalInput) goalInput.disabled = goalDir.disabled = false;
          const onAbort = () => done('abort');
          actions.textContent = '';
          actions.append(
            button(runLabel, 'primary', () => done('run')),
            button('Отклонить', '', () => done('reject'))
          );
          det.open = true;
          if (signal) { if (signal.aborted) { done('abort'); return; } signal.addEventListener('abort', onAbort); }
        });
      },

      // Запуск: сброс прошлого итога, счётчик запусков, в док.
      running(onStop) {
        runs++;
        runsEl.textContent = runs > 1 ? `×${runs}` : '';
        badge.textContent = '';
        actions.textContent = '';
        actions.append(button('Стоп', '', onStop));
        root.dataset.state = 'running';
        det.open = false;
        result.hidden = true; result.textContent = ''; result.title = '';
        tele.hidden = false; tele.textContent = '';
        api.dock();
      },
      tele(text) { if (root.dataset.state === 'running') { tele.hidden = false; tele.textContent = text; } },
      // «Работает» / «Не работает»: у работающего скрипта (первое — задача заканчивается, скрипт играет дальше;
      // второе — скрипт останавливается, модель улучшает) и после итога (Onshape: деталь построена — проверьте).
      // Возвращает функцию, убирающую вопрос (скрипт закончился раньше ответа).
      verdict(onYes, onNo) {
        const box = el('span', 'sc-verdict');
        const off = () => box.remove();
        box.append(button('Работает', 'primary', () => { off(); onYes(); }),
          button('Не работает', '', () => { off(); onNo(); }));
        actions.append(box);
        return off;
      },
      // Цель после правки человеком: { target, better } или null, если цели нет.
      goal() {
        if (!goalInput) return null;
        const raw = String(goalInput.value).trim(), n = Number(raw);
        return { target: raw === '' || !isFinite(n) ? null : n, better: goalDir.value === 'lower' ? 'lower' : 'higher' };
      },
      // Итог: state — true/'ok', false/'fail', 'stopped'. Карточка остаётся там, где есть (в доке — в режиме «итог»).
      finish(text, state) {
        const st = state === true ? 'ok' : state === false ? 'fail' : (BADGE[state] ? state : 'fail');
        smoothDock(() => {
          actions.textContent = '';
          tele.hidden = true;                 // итог содержит ту же телеметрию
          root.dataset.state = st;
          badge.textContent = BADGE[st];
          result.hidden = false;
          result.textContent = text;
          result.title = text;
        });
        if (result.animate && !reduced()) result.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 480, easing: EASE_LUX });   // кроссфейд телеметрии в итог
      },
      note(text) { result.hidden = false; result.textContent = text; result.title = text; },
      // Дополнительная кнопка после итога (например, «Открыть Feature Studio»).
      link(label, onclick) { actions.append(button(label, '', onclick)); },
      // После завершения: запустить снова без модели и сохранить для сайта. saved — уже в библиотеке.
      // update — сохранённый скрипт изменён (починили): предложить обновить его, а не сохранять копию.
      // onRepair — запуск не удался: открыть /skript с этим скриптом черновиком.
      offer({ onRerun, onSave, saved, update, onRepair }) {
        actions.textContent = '';
        if (onRepair) actions.append(button('Починить', 'primary', onRepair));
        actions.append(button('Запустить снова', onRepair ? '' : 'primary', onRerun));
        const sb = button(update ? 'Обновить в библиотеке' : saved ? 'Сохранено' : 'Сохранить для сайта', '', onSave);
        sb.disabled = !!saved && !update;
        actions.append(sb);
      },
      // Код заменён новой версией: карточка сворачивается в одну строку в логе.
      collapse(text) {
        if (collapsed) return;
        api.toLog(false);
        collapsed = true;
        root.textContent = '';
        root.append(el('span', 'sc-replaced', text));
        cls(root, 'collapsed', true);
        root.dataset.state = 'replaced';
      }
    };
    dismiss.onclick = () => api.toLog(true);

    const button = (label, kls, onclick) => {
      const b = el('button', 'btn ' + kls, label);
      b.type = 'button'; b.onclick = onclick;
      return b;
    };
    return api;
  }

  return {
    create,
    get docked() { return docked; },
    // Новая задача: карточка из дока уползает в лог.
    undockAll() { if (docked) docked.toLog(true); },
    // «Новый запуск»: лог очищается — карточку из дока убираем без анимации.
    clearDock() {
      if (docked) { const r = docked.root; docked = null; if (r.parentNode) r.parentNode.removeChild(r); }
      const d = dockEl();
      if (d) d.textContent = '';
    }
  };
})();
