'use strict';
/* skript-policy.js — статическая проверка кода режима /skript (R8, R10).
 *
 * Три профиля:
 *   readonly — для eval_readonly/sample_state: никаких побочных эффектов;
 *   study    — для eval_free: побочные эффекты разрешены, но сеть, хранилища,
 *              chrome- API и эксфильтрация данных страницы запрещены;
 *   run      — для запуска приёмов: всё из study плюс запрет eval/Function,
 *              планировщиков и самостоятельной навигации (раннер управляет циклом).
 *
 * Разбор — мини-сканер: сначала вырезаются строки, шаблоны и комментарии,
 * составные операторы нормализуются, и только потом применяются правила.
 * Это лечит ложные срабатывания старого линтера: `a == b` (присваивание?),
 * `rect.top + 1` и `el.style.top` (навигация?).
 */

// Вырезаем строковые/шаблонные литералы, регулярные выражения и комментарии, оставляя код.
// В шаблонных строках выражения ${…} — это код: их разбираем рекурсивно, иначе `fetch(...)`
// внутри ${} проходил бы мимо правил. Регулярные выражения распознаём по предыдущему токену,
// чтобы кавычка внутри /["']/ не начинала «строку».
function skriptStrip(src) {
  let out = '';
  let i = 0;
  const st = { last: '' };
  const ID = /[A-Za-z_$]/;
  const ID_PART = /[\w$]/;
  const REGEX_AFTER_WORD = new Set(['return', 'case', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await', 'throw']);
  const canStartRegex = (last) => {
    if (!last) return true;
    if (last.length > 1) return REGEX_AFTER_WORD.has(last);
    return '([{,;:!&|?+-*%^~<=>}'.includes(last);
  };
  const skipString = (q) => {
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') i++;
      if (src[i] === '\n') break; // незакрытая строка — не наш случай, но зацикливаться нельзя
      i++;
    }
    if (i < src.length) i++;
  };
  const skipRegex = () => {
    i++;
    let cls = false;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') cls = true;
      else if (c === ']') cls = false;
      else if (c === '/' && !cls) { i++; break; }
      else if (c === '\n') break;
      i++;
    }
    while (i < src.length && /[a-z]/i.test(src[i])) i++;   // флаги
  };
  const stripTemplate = () => {
    i++;
    out += '""';
    st.last = '"';
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; return; }
      if (c === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        let depth = 1;
        while (i < src.length) {
          const d = src[i];
          if (d === '}' && depth === 1) { out += '}'; i++; break; }
          if (d === '{') depth++;
          else if (d === '}') depth--;
          one();
        }
        continue;
      }
      i++;
    }
  };
  function one() {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += ' '; return; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; out += ' '; return; }
    if (c === '"' || c === "'") { skipString(c); out += '""'; st.last = '"'; return; }
    if (c === '`') { stripTemplate(); return; }
    if (c === '/' && canStartRegex(st.last)) { skipRegex(); out += '""'; st.last = '"'; return; }
    if ((c === '+' && n === '+') || (c === '-' && n === '-')) { out += c + n; st.last = c + n; i += 2; return; }
    if (ID.test(c)) {
      const s = i;
      i++;
      while (i < src.length && ID_PART.test(src[i])) i++;
      const w = src.slice(s, i);
      out += w;
      st.last = w;
      return;
    }
    out += c;
    if (!/\s/.test(c)) st.last = c;
    i++;
  }
  while (i < src.length) one();
  return out;
}

// Заменяем составные операторы на пробелы, чтобы одиночный `=` в `a = 1`
// не путался с `==`, `=>`, `+=` и т.п. Головы объявлений (var/let/const,
// включая деструктуризацию) вырезаем: инициализатор — не побочный эффект,
// а локальная переменная нужна даже в readonly-пробнике.
function skriptNormalize(code) {
  return code
 .replace(/>>>=|\*\*=|===|!==|>>=|<<=|\*\*|<=|>=|==|!=|=>/g, ' ')
 .replace(/[+\-*%&|^]=|\/=|<<=|>>=/g, '=') // составное присваивание = обычное
    .replace(/\b(?:var|let|const)\s+(?:\{[^{}]*\}|\[[^\[\]]*\]|[\w$]+)\s*=/g, 'DECL ')
    .replace(/\s+/g, ' ');
}

// Присваивание: одиночное `=` после идентификатора, скобки или литерала.
const SKRIPT_ASSIGN_RE = /[\w$\)\]'"`]\s*=(?!=)/;


// ---- Правила ----

// location в любом виде, кроме чтения безопасных полей: location.reload(), document.location.replace(…), const l = location.
const SKRIPT_LOCATION_RE = /\blocation\b(?!\s*\.\s*(?:href|pathname|search|hash|host|hostname|origin|protocol|port)\b(?!\s*=))/;

// Записи в хранилище, куки, сеть — запрещены везде, кроме инструментов агента.
const R_NET = [
  { re: /\bfetch\b/, why: 'fetch' },
  { re: /\bXMLHttpRequest\b/, why: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, why: 'WebSocket' },
  { re: /\bEventSource\b/, why: 'EventSource' },
  { re: /\bimport\s*\(/, why: 'динамический import' },
  { re: /\bsendBeacon\b/, why: 'sendBeacon' },
  { re: /\bnavigator\s*\.\s*(?:sendBeacon|credentials|serviceWorker|cookieEnabled)\b/, why: 'navigator-доступ к сетевым/учётным данным' },
  { re: /\blocalStorage\b/, why: 'localStorage' },
  { re: /\bsessionStorage\b/, why: 'sessionStorage' },
  { re: /\bindexedDB\b/, why: 'indexedDB' },
  { re: /\bcaches\b/, why: 'caches API' },
  { re: /\bcookieStore\b/, why: 'cookieStore' },
  { re: /\bdocument\s*\.\s*cookie\b/, why: 'document.cookie' },
  { re: /\b(?:chrome|browser|extension|chromeRuntime)\s*\./, why: 'chrome-/browser- API расширения' },
  // Обходы по имени: строки вырезаются заранее, поэтому window["fetch"]() иначе проходит.
  { re: /\b(?:window|globalThis|self|top|parent|frames|this)\s*\[/, why: 'доступ к глобальному объекту по ключу' },
  { re: /\breturn\s+(?:this|window|globalThis|self|top|parent|frames)\b/, why: 'возврат глобального объекта (обход запретов)' },
  { re: /\.\s*constructor\b|\[\s*""\s*\]\s*\(/, why: 'constructor/вызов по строковому ключу (обход запретов)' },
  { re: /\]\s*\(/, why: 'вызов элемента по ключу или индексу' },
  { re: /\bObject\s*\.\s*assign\s*\(\s*(?:window|globalThis|self|top|parent|document|location|history|navigator)\b/, why: 'запись в глобальный объект через Object.assign' },
  { re: /\bReflect\s*\.\s*(?:apply|construct|set|defineProperty|deleteProperty|setPrototypeOf)\b/, why: 'Reflect-обход запретов' },
  { re: /\bnew\s+(?:Image|Audio|Worker|SharedWorker|WebSocket|EventSource)\b/, why: 'загрузка ресурса/сети через конструктор' }
];

// Побочные эффекты и потенциально опасные конструкции — для readonly.
const R_SIDE = [
  { re: SKRIPT_ASSIGN_RE, why: 'оператор присваивания' },
 { re: /\b(?:eval|Function)\s*\(/, why: 'eval/Function' },
  { re: /\+\+|--/, why: 'инкремент/декремент' },
  { re: /\bdelete\b/, why: 'delete' },
  { re: /\bawait\b/, why: 'await' },
  { re: /\bnew\s+/, why: 'конструктор' },
  { re: /\bimport\b|\brequire\s*\(/, why: 'импорт модуля' },
  { re: /\b(?:setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\s*\(/, why: 'планировщик' },
  { re: /\bdocument\s*\.\s*(?:write|execCommand|createElement|writeln)\b/, why: 'запись в document' },
  { re: /\bwindow\s*\.\s*open\s*\(/, why: 'window.open' },
  { re: /(?:^|[^\w$])(?:location|top|parent|opener)\s*=(?!=)/, why: 'присваивание навигационного объекта' },
  // Навигация — только через location (и присваивание href). Раньше ловили любой .replace(/.assign(:
  // живой прогон 2048 — str.replace() и Object.assign() отклонялись как «метод навигации», модель ушла кликать.
  { re: SKRIPT_LOCATION_RE, why: 'обращение к location (можно только читать location.href/pathname/search/hash/host/origin)' },
  { re: /\.\s*href\s*=(?!=)/, why: 'присваивание href' },
  { re: /\bhistory\s*\.\s*(?:pushState|replaceState|go|back|forward)\s*\(/, why: 'history-навигация' },
  { re: /Element\s*\.\s*prototype|HTMLElement\s*\.\s*prototype|EventTarget\s*\.\s*prototype|Window\s*\.\s*prototype|Document\s*\.\s*prototype|Object\s*\.\s*defineProperty/, why: 'патч прототипов' },
  { re: /\.(?:setItem|removeItem|appendChild|removeChild|insertBefore|replaceChild|append|prepend|after|before|replaceWith|setAttribute|removeAttribute|scrollTo|scrollIntoView|focus|blur|click|submit|reset|select|setRangeText|writeText|captureEvents|releaseEvents|stopPropagation)\s*\(/, why: 'мутирующий вызов' }
];

// Для run: код приёма — это контроллер. Локальные переменные (включая ++/--
// и свойства собственных объектов) разрешены; запрещено трогать глобальные
// объекты страницы, прототипы встроенных типов, а также сеть/eval/навигацию.
const R_RUN = [
 { re: /\b(?:window|globalThis|self|top|parent|document|location|history|navigator|localStorage|sessionStorage|screen|crypto|caches)\s*(?:\.\s*[\w$]+|\[[^\][]*\])+\s*=[^=]/, why: 'присваивание свойству глобального объекта' },
 { re: /\bdelete\s+(?:window|globalThis|self|top|parent|document|location|history|navigator|localStorage|sessionStorage|screen|crypto|caches)\b/, why: 'delete глобального объекта' },
 { re: /\b[\w$]+\s*\.\s*prototype(?:\s*(?:\.\s*[\w$]+|\[[^\][]*\]))*\s*=[^=]/, why: 'патч прототипа' },
 { re: /\bdelete\s+[\w$]+\s*\.\s*prototype\b/, why: 'delete прототипа' },
 { re: /__proto__/, why: '__proto__' },
 { re: /Object\s*\.\s*(?:defineProperty|defineProperties|setPrototypeOf)\s*\(/, why: 'переопределение свойств объекта' },
  { re: /\b(?:eval|Function)\s*\(/, why: 'eval/Function' },
  { re: /\bsetTimeout\s*\(|\bsetInterval\s*\(|\brequestAnimationFrame\s*\(|\bqueueMicrotask\s*\(/, why: 'свой планировщик (раннер управляет циклом)' },
  { re: /\bwindow\s*\.\s*open\s*\(/, why: 'window.open' },
  { re: /\bdocument\s*\.\s*write\b/, why: 'document.write' },
  { re: /(?:^|[^\w$])(?:location|top|parent|opener)\s*=(?!=)/, why: 'самостоятельная навигация' },
  // Навигация — только через location (и присваивание href). Раньше ловили любой .replace(/.assign(:
  // живой прогон 2048 — str.replace() и Object.assign() отклонялись как «метод навигации», модель ушла кликать.
  { re: SKRIPT_LOCATION_RE, why: 'обращение к location (можно только читать location.href/pathname/search/hash/host/origin)' },
  { re: /\.\s*href\s*=(?!=)/, why: 'присваивание href' }
];

const SKRIPT_PROFILES = {
  // readonly: ничего, кроме чтения состояния
  readonly: [...R_NET, ...R_SIDE],
  // study: побочные эффекты ок, но сеть/хранилища/chrome под запретом
  study: [...R_NET],
  // run: study + запрет eval, планировщиков и навигации
  run: [...R_NET, ...R_RUN]
};

// where — фрагмент, на котором сработало правило: без него модель не знает, что исправить (живой прогон 2048:
// видела начало скрипта, решила, что запрещён querySelector, и переписала не то).
function skriptLintIssue(why, src, where) {
  const at = where ? ` — фрагмент: «${where}»` : `: ${String(src).trim().slice(0, 140)}`;
  return { ok: false, why, where: where || '', error: `Код отклонён (${why})${at}` };
}

// Основная точка: profile — 'readonly' | 'study' | 'run'.
function skriptLint(code, profile = 'readonly') {
  const src = Array.isArray(code) ? code.map(String).join('.') : String(code);
  if (!src.trim()) return skriptLintIssue('пустой код', src);
  if (src.length > 8000) return skriptLintIssue('слишком длинный код', src);
  const norm = skriptNormalize(skriptStrip(src));
  const rules = SKRIPT_PROFILES[profile] || SKRIPT_PROFILES.readonly;
  for (const r of rules) {
    const m = r.re.exec(norm);
    if (m) return skriptLintIssue(r.why, src, norm.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).trim());
  }
  return { ok: true, expr: src };
}

const SkriptPolicy = {
  lint: skriptLint,
  profiles: SKRIPT_PROFILES,
  strip: skriptStrip,
  normalize: skriptNormalize
};
