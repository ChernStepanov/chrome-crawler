'use strict';
/* skript-builtin.js — встроенная (поставляемая с расширением) база навыков сайтов.
 * Навык = подсказка-стратегия в промпт + проверенные инструменты расширения для этого сайта.
 * В отличие от сохранённых скриптов, код навыков — часть расширения (ревью, тесты), поэтому
 * ему можно то, чего нельзя коду модели (например, REST API сайта из его вкладки).
 * Каждый навык выключается на экране «Скрипты сайтов»; у навыка могут быть предпочтения.
 */

const SKRIPT_BUILTIN_OFF_KEY = 'skriptBuiltinOff';

const SKRIPT_BUILTINS = [
  {
    id: 'onshape-featurescript',
    title: 'Onshape: детали через FeatureScript',
    site: 'cad.onshape.com',
    description: 'На просьбу смоделировать деталь crawler пишет FeatureScript-фичу с параметрами и сам добавляет её в открытую Part Studio. ' +
      'Размеры потом меняются в диалоге фичи или просьбой в чате. Перед изменением документа показывается код и кнопка «Создать в Onshape».',
    matches: (u) => SkriptOnshape.HOST_RE.test(u.hostname),
    prefsKey: () => SkriptOnshape.PREFS_KEY,
    prefsDefault: () => SkriptOnshape.PREFS_DEFAULT,
    prompt: (prefs, url) => SkriptOnshape.promptFor(prefs, url),
    tools: () => [SkriptOnshape.TOOL, SkriptOnshape.DOCS_TOOL],
    handlers: { onshape_featurescript: (args, st) => SkriptOnshape.handle(args, st), featurescript_docs: (args, st) => SkriptOnshape.docs(args, st) }
  }
];

const SkriptBuiltin = (() => {
  const stor = () => chrome.storage.local;

  async function offSet() {
    const r = await stor().get({ [SKRIPT_BUILTIN_OFF_KEY]: [] });
    return new Set(r[SKRIPT_BUILTIN_OFF_KEY] || []);
  }

  async function prefs(b) {
    if (!b.prefsKey) return null;
    const key = b.prefsKey();
    const r = await stor().get({ [key]: {} });
    return { ...b.prefsDefault(), ...(r[key] || {}) };
  }

  // Навыки для адреса задачи: { ids, prompt, tools, handlers }. Выключенные не попадают.
  async function forUrl(url) {
    const empty = { ids: [], prompt: '', tools: [], handlers: {} };
    let u;
    try { u = new URL(String(url)); } catch (e) { return empty; }
    if (!/^https?:$/.test(u.protocol)) return empty;
    const off = await offSet();
    const on = SKRIPT_BUILTINS.filter((b) => !off.has(b.id) && b.matches(u));
    if (!on.length) return empty;
    const parts = [];
    for (const b of on) parts.push(await b.prompt(await prefs(b), u.href));
    return {
      ids: on.map((b) => b.id),
      prompt: '\n\nBUILT-IN SITE SKILLS (shipped with the extension, reviewed):\n' + parts.join('\n\n'),
      tools: on.flatMap((b) => b.tools()),
      handlers: Object.assign({}, ...on.map((b) => b.handlers))
    };
  }

  async function setEnabled(id, on) {
    const off = await offSet();
    if (on) off.delete(id); else off.add(id);
    await stor().set({ [SKRIPT_BUILTIN_OFF_KEY]: [...off] });
  }

  async function savePrefs(id, value) {
    const b = SKRIPT_BUILTINS.find((x) => x.id === id);
    if (!b || !b.prefsKey) return;
    await stor().set({ [b.prefsKey()]: { ...b.prefsDefault(), ...value } });
  }

  async function list() {
    const off = await offSet();
    const out = [];
    for (const b of SKRIPT_BUILTINS) out.push({ id: b.id, title: b.title, site: b.site, description: b.description, enabled: !off.has(b.id), prefs: await prefs(b) });
    return out;
  }

  return { forUrl, setEnabled, savePrefs, list, ALL: SKRIPT_BUILTINS };
})();
