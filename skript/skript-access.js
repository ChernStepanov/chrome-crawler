'use strict';
/* skript-access.js — слой доступа режима /skript (Редакция 2, этап A).
 *
 * Гранты решают, какие инструменты вообще попадают в список модели:
 * инструмент без гранта не показывается совсем (R2) — проще, чем запрещать
 * его в промпте. Здесь же: пресеты, классы риска R0–R3, бюджеты изучения,
 * жёсткие запреты (не тумблеры) и filterTools.
 */

// ---- Гранты по таблице R2 (пресет «Исследователь») ----
const SKRIPT_GRANT_DEFAULTS = {
  see: true,              // probe_*, query_dom, скриншот
  act: true,              // клики, ввод, клавиши, скролл, drag
  nav: 'same-origin',     // 'none' | 'same-origin' | 'any'
  web: true,              // web_search, fetch_page
  tabs: true,             // открывать и закрывать свои вкладки
  tabCopy: false,         // изучать в дубликате, не в рабочей вкладке
  evalFree: true,         // eval_free: побочные эффекты, подмена API страницы
  askHuman: 'needed',     // 'never' | 'needed' | 'often'
  writeLibrary: true,     // сохранять приёмы после ревью
  executorCanPatch: false // слабая модель может патчить приёмы
};

const SKRIPT_PRESETS = {
  cautious: {
    label: 'Осторожный',
    hint: 'Только чтение: модель смотрит на страницу и пишет приём, ничего не трогая.',
    grants: {
      see: true, act: false, nav: 'none', web: false, tabs: false,
 tabCopy: false, evalFree: false, askHuman: 'never', writeLibrary: false, executorCanPatch: false
    }
  },
  explorer: {
    label: 'Исследователь',
    hint: 'Свободное изучение: действия в пределах сайта, поиск, вопросы по необходимости.',
    grants: { ...SKRIPT_GRANT_DEFAULTS }
  },
  free: {
    label: 'Свободный',
    hint: 'Всё включено, навигация куда угодно. Действия необратимы — будьте внимательны.',
    warn: true, // красная точка в полоске доступа
    grants: {
      see: true, act: true, nav: 'any', web: true, tabs: true,
 tabCopy: false, evalFree: true, askHuman: 'needed', writeLibrary: true, executorCanPatch: false
    }
  }
};

// Бюджеты изучения (R2): шаги 60, время 10 минут, поисковых запросов 10.
const SKRIPT_BUDGET_DEFAULTS = { steps: 60, minutes: 10, searches: 10, tokens: 0 };

// Метки грантов для настроек и полоски доступа.
const SKRIPT_GRANT_META = {
  see: { label: 'Видеть', hint: 'Разведка страницы: probe_*, query_dom, скриншоты. Всегда включено.' },
  act: { label: 'Действовать', hint: 'Клики, ввод текста, нажатия клавиш, скролл, перетаскивания.' },
  nav: { label: 'Навигация', hint: 'Переходы по ссылкам и ввод адреса: нет / в пределах сайта / куда угодно.' },
  web: { label: 'Интернет', hint: 'Веб-поиск и загрузка страниц по ссылке. Данные страницы наружу не отправляет.' },
  tabs: { label: 'Новые вкладки', hint: 'Открывать и закрывать свои вкладки.' },
  tabCopy: { label: 'Копия вкладки', hint: 'Изучать сайт в дубликате вкладки, не в рабочей. Рекомендуется для редакторов.' },
  evalFree: { label: 'Свободный JS', hint: 'eval_free: выражения с побочными эффектами и подмена API страницы.' },
  askHuman: { label: 'Спрашивать человека', hint: 'Как часто модель задаёт вопросы: никогда / по необходимости / часто.' },
 writeLibrary: { label: 'Писать в библиотеку', hint: 'Сохранять приёмы после ревью человеком. Черновики write_script доступны всегда, этот грант управляет только сохранением в библиотеку.' },
  executorCanPatch: { label: 'Исполнитель правит приёмы', hint: 'Разрешить слабой модели патчить приёмы библиотеки.' }
};

// Пять тумблеров полоски доступа (R7). value — значения выключено/включено.
const SKRIPT_BAR_TOGGLES = [
  { id: 'act', label: 'Действия', icon: 'cursor', off: false, on: true },
  { id: 'nav', label: 'Навигация', icon: 'compass', off: 'none', on: 'same-origin' },
  { id: 'web', label: 'Интернет', icon: 'globe', off: false, on: true },
  { id: 'askHuman', label: 'Вопросы', icon: 'question', off: 'never', on: 'needed' },
  { id: 'tabCopy', label: 'Копия вкладки', icon: 'copy', off: false, on: true }
];


// ---- Жёсткие запреты (R2): не тумблеры, действуют всегда ----

// Чувствительные домены: банки, почта, платежи, менеджеры паролей, админки.
// Лейблы на границах домена, чтобы не задевать «mailchimp» и «paymentwall-news».
const SKRIPT_BANNED_HOST_RE = /(?:^|\.)(bank|banks|banking|sberbank|tinkoff|alfa-bank|alfabank|vtb|gazprombank|rshb|raiffeisen|psbank|banki|citibank|chase|wells|hsbc|barclays|natwest|lloyds|revolut|paypal|payoneer|paysera|liqpay|yoomoney|money|qiwi|unitpay|cloudpayments|stripe|checkout|coinbase|binance|kraken|wallet|metamask|trezor|ledger|mail|gmail|outlook|hotmail|live|protonmail|proton|tutanota|fastmail|zoho|icloud|gmx|aol|yahoo|lastpass|1password|bitwarden|dashlane|keepass|nordpass|roboform|admin|adminpanel|administrator|cpanel|plesk|bitrix|jira|confluence)(?:\.|$)/i;

// Подписи необратимых действий — расширение RISKY_RE из sidepanel.js.
const SKRIPT_R2_LABEL_RE = /(pay|purchase|buy|order|checkout|confirm|delete|remove|send|submit|publish|transfer|subscribe|unsubscribe|sign out|log out|sign in|log in|register|upload|оплат|купит|заказ|оформ|подтверд|удал|отправ|опублик|перевод|подпис|выйти|войти|регистрац|загруз)/i;

// Платёжные и секретные поля по подписи.
const SKRIPT_SECRET_LABEL_RE = /(password|пароль|card number|номер карты|cvc|cvv|security code|код карты|expiry|срок действия| expiration|pin\s*(?:code|number)|пин-?код|(?:^|\s)(?:pin|пин)\s*:?\s*$|secret|токен)/i;

const SKRIPT_RISK_ORDER = ['R0', 'R1', 'R2', 'R3'];
const skriptMaxRisk = (a, b) => (SKRIPT_RISK_ORDER.indexOf(a) >= SKRIPT_RISK_ORDER.indexOf(b) ? a : b);

// Базовый класс по инструменту, когда никаких других сигналов нет.
const SKRIPT_RISK_BASE = {
  // чтение
  query_dom: 'R0', dom_hints: 'R0', wait: 'R0', vision: 'R0', extract_items: 'R0',
  probe_globals: 'R0', probe_events: 'R0', probe_canvas: 'R0', probe_dom_state: 'R0',
  sample_state: 'R0', eval_readonly: 'R0', hook_canvas_draw: 'R0', screenshot_region: 'R0',
  fetch_page: 'R0', web_search: 'R0', get_telemetry: 'R0',
  // обратимое воздействие
  scroll: 'R1', click: 'R1', click_at: 'R1', swipe: 'R1', drag: 'R1',
  select_option: 'R1', press_keys: 'R1', type_text: 'R1', fill_form: 'R1',
  go_back: 'R1', navigate: 'R1', new_tab: 'R1', eval_free: 'R1',
  // общение с человеком и библиотекой: решение остаётся за человеком
  ask_user: 'R0', ask_human: 'R0', write_script: 'R0', patch_script: 'R0',
  draft_script: 'R0', test_script: 'R0', record_finding: 'R0', finish_skript: 'R0'
};

function skriptBannedHost(host) {
  return SKRIPT_BANNED_HOST_RE.test(String(host || ''));
}

// Жёсткий запрет на цель: домен, поле пароля, платёжное поле.
// Возвращает { banned: true, why } или null.
function skriptHardBan({ host, url, info } = {}) {
  // Проверяем и текущий хост, и цель перехода (url): иначе navigate на банк с нейтральной страницы проходит.
  const target = (() => { try { return new URL(url || '').hostname; } catch (e) { return ''; } })();
  for (const h of [host, target]) {
    if (h && skriptBannedHost(h)) return { banned: true, why: `Чувствительный домен: ${h}` };
  }
  if (info) {
    if (info.isPassword) return { banned: true, why: 'Поле пароля' };
    const label = `${info.label || ''} ${info.formAction || ''}`;
    if (SKRIPT_SECRET_LABEL_RE.test(label)) return { banned: true, why: `Платёжное или секретное поле: «${(info.label || '').trim() || info.tag}»` };
  }
  return null;
}

// Классификация риска действия (R2). action: { name, args, info?, host? }
// Класс берётся наибольший: занизить его модель не может (args.risk только повышает).
// Возвращает { cls: 'R0'|'R1'|'R2'|'R3', why: string }
function classifyRisk(action) {
  const { name, args = {}, info } = action;
  let cls = 'R0';
  const why = [];
  const bump = (c, reason) => {
    if (SKRIPT_RISK_ORDER.indexOf(c) > SKRIPT_RISK_ORDER.indexOf(cls)) { cls = c; why.push(reason); }
  };

  bump(SKRIPT_RISK_BASE[name] || 'R1', `инструмент ${name}`);

  // 1) Объявление самой модели — только повышение.
  const declared = String(args.risk || '').toUpperCase();
  if (SKRIPT_RISK_ORDER.includes(declared)) bump(declared, `модель объявила риск ${args.risk}`);
  if (args.risky === true) bump('R2', 'модель объявила risky=true');

  // 2) Жёсткие запреты → R3.
  const label = `${info?.label || ''} ${info?.formAction || ''}`;
  const ban = skriptHardBan({ host: action.host, url: args.url, info });
  if (ban) bump('R3', ban.why);
  if (name === 'eval_free' && args.expr && typeof SkriptPolicy !== 'undefined') {
    const lint = SkriptPolicy.lint(args.expr, 'study');
    if (!lint.ok) bump('R3', `политика study: ${lint.error}`);
  }
  // Код приёма и черновика проверяется по профилю run (тот же, что при запуске).
  if (['write_script', 'draft_script', 'test_script', 'patch_script'].includes(name) && args.code && typeof SkriptPolicy !== 'undefined') {
    // Причина целиком: без неё модель не знает, что исправить, и повторяет тот же код.
    const lint = SkriptPolicy.lint(args.code, 'run');
    if (!lint.ok) bump('R3', `политика run: ${lint.error}`);
  }

  // 3) Необратимые действия → R2.
  if (info?.isSubmit) bump('R2', 'кнопка отправки формы');
  if (info?.inForm && args.submit) bump('R2', 'отправка формы');
  if (label && SKRIPT_R2_LABEL_RE.test(label)) bump('R2', `подпись «${label.trim().slice(0, 40)}»`);
  if (name === 'fetch_page' && String(args.method || '').toUpperCase() !== 'GET') bump('R2', `метод ${args.method}`);

  return { cls, why: why.join('; ') };
}

// ---- Бюджеты изучения (R2) ----

class SkriptBudget {
  constructor(cfg = {}) {
    this.steps = Math.max(1, Math.min(500, Number(cfg.steps) || SKRIPT_BUDGET_DEFAULTS.steps));
    this.ms = Math.max(30_000, (Number(cfg.minutes) || SKRIPT_BUDGET_DEFAULTS.minutes) * 60_000);
    this.searches = Math.max(0, Number(cfg.searches ?? SKRIPT_BUDGET_DEFAULTS.searches));
    this.tokens = Math.max(0, Number(cfg.tokens) || SKRIPT_BUDGET_DEFAULTS.tokens);
    this.t0 = Date.now();
    this.done = 0;
    this.usedSearches = 0;
    this.usedTokens = 0;
  }

  // Шаг цикла агента прошёл. tokens — расход на этом шаге (если известен).
  // Возвращает причину исчерпания или null.
  tick(tokens = 0) {
    this.done++;
    this.usedTokens += Number(tokens) || 0;
    return this.exhausted();
  }

  search(n = 1) {
    this.usedSearches += Number(n) || 1;
    return this.exhausted();
  }

  exhausted() {
    if (this.done >= this.steps) return { reason: 'steps', limit: this.steps, used: this.done };
    if (Date.now() - this.t0 >= this.ms) return { reason: 'time', limit: this.ms, used: Date.now() - this.t0 };
    if (this.searches > 0 && this.usedSearches >= this.searches) return { reason: 'searches', limit: this.searches, used: this.usedSearches };
    if (this.tokens > 0 && this.usedTokens >= this.tokens) return { reason: 'tokens', limit: this.tokens, used: this.usedTokens };
    return null;
  }

  summary() {
    const pct = (u, l) => (l > 0 ? Math.round((u / l) * 100) : 0);
    return `шаги ${this.done}/${this.steps} (${pct(this.done, this.steps)}%), ` +
      `время ${Math.round((Date.now() - this.t0) / 1000)}с/${Math.round(this.ms / 1000)}с, ` +
      `поиски ${this.usedSearches}/${this.searches}` +
      (this.tokens > 0 ? `, токены ${this.usedTokens}/${this.tokens}` : '');
  }
}

// ---- Фильтрация инструментов по грантам (R2) ----

// Каким грантом открывается каждый инструмент: режимовые + агентские.
const SKRIPT_TOOL_GRANT = {
  see: ['probe_globals', 'probe_events', 'probe_canvas', 'probe_dom_state', 'sample_state',
    'eval_readonly', 'hook_canvas_draw', 'screenshot_region', 'query_dom', 'dom_hints',
    'vision', 'get_telemetry', 'wait', 'extract_items'],
  act: ['click', 'click_at', 'type_text', 'fill_form', 'select_option', 'press_keys', 'swipe', 'drag', 'scroll'],
  nav: ['navigate', 'go_back'],
  web: ['fetch_page', 'web_search'],
  tabs: ['new_tab'],
  evalFree: ['eval_free'],
  askHuman: ['ask_user', 'ask_human'],
};
const SKRIPT_NAME_TO_GRANT = {};
for (const [g, names] of Object.entries(SKRIPT_TOOL_GRANT)) {
  for (const n of names) SKRIPT_NAME_TO_GRANT[n] = g;
}

// Грант «Видеть» включён всегда (R2); askHuman/nav — перечисляемые значения.
function grantOn(grants, g) {
  if (g === 'see') return true;
  if (g === 'nav') return grants.nav !== 'none';
  if (g === 'askHuman') return grants.askHuman !== 'never';
  return !!grants[g];
}

function grantFor(name) {
  return SKRIPT_NAME_TO_GRANT[name] || null;
}

// Убирает из списка инструменты, чей грант выключен.
function filterTools(allTools, grants) {
  return (allTools || []).filter((t) => {
    const g = grantFor(t.function.name);
    return g ? grantOn(grants, g) : true;
  });
}

// ---- Хранение пресета и бюджетов ----

const SKRIPT_ACCESS_KEY = 'skriptAccess';

async function skriptLoadAccess() {
  const raw = await chrome.storage.local.get({ [SKRIPT_ACCESS_KEY]: {} });
  const s = raw[SKRIPT_ACCESS_KEY] || {};
  return {
    preset: SKRIPT_PRESETS[s.preset] ? s.preset : 'explorer',
    overrides: s.overrides && typeof s.overrides === 'object' ? s.overrides : null,
    budgets: { ...SKRIPT_BUDGET_DEFAULTS, ...(s.budgets && typeof s.budgets === 'object' ? s.budgets : {}) }
  };
}

async function skriptSaveAccess(patch) {
  const cur = await skriptLoadAccess();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [SKRIPT_ACCESS_KEY]: next });
  return next;
}

function skriptResolveGrants(presetId, overrides) {
  const base = (SKRIPT_PRESETS[presetId] || SKRIPT_PRESETS.explorer).grants;
  return { ...base, ...(overrides || {}) };
}

const SkriptAccess = {
  PRESETS: SKRIPT_PRESETS,
  GRANT_META: SKRIPT_GRANT_META,
  BAR_TOGGLES: SKRIPT_BAR_TOGGLES,
  BUDGET_DEFAULTS: SKRIPT_BUDGET_DEFAULTS,
  GRANT_DEFAULTS: SKRIPT_GRANT_DEFAULTS,
  Budget: SkriptBudget,
  classifyRisk,
  skriptHardBan,
  skriptBannedHost,
  filterTools,
  grantFor,
  // Public for the prompt/UI; navigation and question grants are enum-valued.
  grantOn,
  load: skriptLoadAccess,
  save: skriptSaveAccess,
  resolveGrants: skriptResolveGrants
};

