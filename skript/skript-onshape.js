'use strict';
/* skript-onshape.js — встроенный навык «Onshape: детали через FeatureScript».
 *
 * Модель пишет ТОЛЬКО FeatureScript (определение фичи с параметрами). Всё остальное делает
 * этот проверенный код расширения через REST API Onshape из вкладки документа (сессия
 * пользователя, тот же origin): создаёт Feature Studio, записывает код, добавляет фичу
 * в Part Studio, потом обновляет её. Сетью пользуется только этот код, не код модели.
 *
 * Поток: onshape_featurescript(name, code?, params?) → карточка с кодом → «Создать в Onshape»
 * → skriptOnshapeApply в странице → итог (ошибки компиляции/перестроения) модели.
 * Связка name → {Feature Studio, фича} хранится по документу: позже можно менять код или
 * только значения параметров, не теряя настроенные пользователем параметры.
 *
 * Не проверено в живом Onshape: точные форматы ответов (notices, featureState) и заголовок
 * XSRF — ошибки API возвращаются модели и в лог дословно, чтобы это быстро отладить.
 */

const SKRIPT_ONSHAPE_HOST_RE = /(^|\.)onshape\.com$/i;
const SKRIPT_ONSHAPE_API = '/api/v6';
const SKRIPT_ONSHAPE_PARTS_KEY = 'onshapeParts';
const SKRIPT_ONSHAPE_PREFS_KEY = 'onshapePrefs';
const SKRIPT_ONSHAPE_UNITS = [['millimeter', 'мм'], ['centimeter', 'см'], ['meter', 'м'], ['inch', 'дюймы']];
const SKRIPT_ONSHAPE_PREFS_DEFAULT = { units: 'millimeter', notes: '' };

// ---- Чистые функции (тестируются в Node) ----

// URL документа → { did, wid, eid } или { error }.
function skriptOnshapeParseUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return { error: 'Это не страница Onshape.' }; }
  if (!SKRIPT_ONSHAPE_HOST_RE.test(u.hostname)) return { error: 'Это не страница Onshape.' };
  const m = /^\/documents\/([0-9a-f]{24})\/([wvm])\/([0-9a-f]{24})\/e\/([0-9a-f]{24})/i.exec(u.pathname);
  if (!m) return { error: 'Откройте вкладку Part Studio внутри документа Onshape.' };
  if (m[2].toLowerCase() !== 'w') return { error: 'Открыта версия или история документа: изменять можно только рабочую ветку (workspace).' };
  return { origin: u.origin, did: m[1], wid: m[3], eid: m[4] };
}

// Код модели → тело Feature Studio без заголовка (заголовок с актуальной версией std берётся
// из новой Feature Studio). { body, featureType, title } или { error }.
function skriptOnshapePrepare(code) {
  const src = String(code || '').replace(/\r\n/g, '\n');
  if (!src.trim()) return { error: 'Empty code: write the feature definition.' };
  if (src.length > 30000) return { error: 'Code is too long (max 30000 characters).' };
  const body = src
    .replace(/^\s*FeatureScript\s+\d+\s*;\s*$/gm, '')
    .replace(/^\s*import\s*\(\s*path\s*:\s*"onshape\/std\/(?:common|geometry)\.fs"[^;]*;\s*$/gm, '')
    .replace(/^\n+/, '');
  const ft = /export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*defineFeature\s*\(/.exec(body);
  if (!ft) return { error: 'No feature found: the code must contain `export const <name> = defineFeature(function(context is Context, id is Id, definition is map) ...)`.' };
  const tn = /"Feature Type Name"\s*:\s*"([^"]{1,60})"/.exec(body);
  return { body, featureType: ft[1], title: tn ? tn[1] : ft[1], params: skriptOnshapeDeclared(body) };
}

const SKRIPT_ONSHAPE_UNIT_ABBR = { millimeter: 'mm', centimeter: 'cm', meter: 'm', inch: 'in', degree: 'deg', radian: 'rad' };

// Параметры из precondition: [{ id, kind: length|angle|integer|real|boolean, def: выражение|null }].
// Значение по умолчанию берём из своей константы границ: { (millimeter) : [min, DEFAULT, max] }.
// Живой Onshape показал: фича, добавленная через API без параметров, не перестраивается (ERROR),
// поэтому при создании отправляем значение КАЖДОГО параметра.
function skriptOnshapeDeclared(body) {
  const code = String(body || '');
  const pre = /\bprecondition\s*\{([\s\S]*?)\}\s*\{/.exec(code);
  if (!pre) return [];
  const boundDefault = (name) => {
    const m = new RegExp(`\\b(?:const|var)\\s+${name}\\s*=\\s*\\{\\s*\\(\\s*(\\w+)\\s*\\)\\s*:\\s*\\[\\s*[-+\\d.eE]+\\s*,\\s*([-+\\d.eE]+)`).exec(code);
    if (!m) return null;
    if (m[1] === 'unitless') return m[2];
    return SKRIPT_ONSHAPE_UNIT_ABBR[m[1]] ? `${m[2]} ${SKRIPT_ONSHAPE_UNIT_ABBR[m[1]]}` : null;
  };
  const out = [];
  const KIND = { isLength: 'length', isAngle: 'angle', isInteger: 'integer', isReal: 'real' };
  for (const m of pre[1].matchAll(/\b(isLength|isAngle|isInteger|isReal)\s*\(\s*definition\.(\w+)\s*,\s*([A-Za-z_]\w*)/g)) {
    if (!out.some((p) => p.id === m[2])) out.push({ id: m[2], kind: KIND[m[1]], def: boundDefault(m[3]) });
  }
  for (const m of pre[1].matchAll(/\bdefinition\.(\w+)\s+is\s+boolean\b/g)) {
    if (!out.some((p) => p.id === m[1])) out.push({ id: m[1], kind: 'boolean', def: 'false' });
  }
  return out;
}

// Значения для отправки: [{ parameterId, kind, expression|value }]. units — из предпочтений
// (число без единиц у длины считается в них). { specs } или { missing: [id…] }.
function skriptOnshapeValues(declared, values, units, requireAll) {
  const abbr = SKRIPT_ONSHAPE_UNIT_ABBR[units] || 'mm';
  const specs = [];
  const missing = [];
  const known = new Map((declared || []).map((p) => [p.id, p]));
  const ids = new Set([...(requireAll ? known.keys() : []), ...Object.keys(values || {})]);
  for (const id of ids) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) continue;
    const decl = known.get(id) || { id, kind: typeof (values || {})[id] === 'boolean' ? 'boolean' : 'length' };
    let v = values && Object.prototype.hasOwnProperty.call(values, id) ? values[id] : decl.def;
    if (v === null || v === undefined || v === '') { missing.push(id); continue; }
    if (decl.kind === 'boolean') { specs.push({ parameterId: id, kind: 'boolean', value: v === true || v === 'true' }); continue; }
    let expr = String(v).trim().slice(0, 80);
    if (/^[-+]?\d+(?:\.\d+)?$/.test(expr)) {
      if (decl.kind === 'length') expr += ` ${abbr}`;
      else if (decl.kind === 'angle') expr += ' deg';
    }
    specs.push({ parameterId: id, kind: decl.kind, expression: expr });
  }
  return missing.length ? { missing, specs } : { specs };
}

// Имена стандартной библиотеки, которые модели любят переопределять (ошибка компиляции).
const SKRIPT_ONSHAPE_STD_NAMES = ['LENGTH_BOUNDS', 'NONNEGATIVE_LENGTH_BOUNDS', 'ZERO_DEFAULT_LENGTH_BOUNDS', 'BLEND_BOUNDS', 'SHELL_OFFSET_BOUNDS',
  'ANGLE_BOUNDS', 'ANGLE_360_BOUNDS', 'ANGLE_STRICT_90_BOUNDS', 'POSITIVE_COUNT_BOUNDS', 'POSITIVE_REAL_BOUNDS', 'REAL_BOUNDS', 'SCALE_BOUNDS',
  'millimeter', 'centimeter', 'meter', 'inch', 'foot', 'degree', 'radian'];
// Встроенные фичи и частые общие имена std: своя фича с таким именем рискует конфликтом
// (живой прогон: дважды не скомпилировалась «box», «rectangularBox» — скомпилировалась).
const SKRIPT_ONSHAPE_STD_FEATURES = ['box', 'cube', 'cuboid', 'cylinder', 'sphere', 'extrude', 'revolve', 'sweep', 'loft', 'fillet', 'chamfer', 'shell', 'draft',
  'hole', 'mirror', 'pattern', 'linearPattern', 'circularPattern', 'helix', 'thicken', 'boolean', 'plane', 'sketch', 'transform', 'split', 'rib', 'thread', 'part'];
const SKRIPT_ONSHAPE_UNIT_RE = /^(?:millimeter|centimeter|meter|inch|foot|mm|cm|m)$/;

// Локальная проверка известных ошибок до отправки в Onshape. Возвращает список проблем (англ., для модели).
// Значения часто используемых перечислений std (что модель путает: ADD вместо UNION).
const SKRIPT_ONSHAPE_ENUMS = {
  BooleanOperationType: ['UNION', 'SUBTRACTION', 'INTERSECTION', 'SUBTRACT_COMPLEMENT'],
  EntityType: ['VERTEX', 'EDGE', 'FACE', 'BODY']
};
function skriptOnshapeLint(body) {
  const issues = [];
  const code = String(body || '').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of code.matchAll(/\b(?:const|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
    if (SKRIPT_ONSHAPE_STD_NAMES.includes(m[1])) issues.push(`"${m[1]}" is already defined in the Onshape standard library: give your constant another name (e.g. MY_${m[1].toUpperCase()}).`);
  }
  const ft = /export\s+const\s+([A-Za-z_]\w*)\s*=\s*defineFeature/.exec(code);
  if (ft && SKRIPT_ONSHAPE_STD_FEATURES.includes(ft[1])) {
    issues.push(`Feature name "${ft[1]}" may clash with a standard Onshape name: use a distinctive one (e.g. crawler${ft[1][0].toUpperCase()}${ft[1].slice(1)}).`);
  }
  if (/\bmakeQuery\s*\(/.test(code)) issues.push('makeQuery(...) is not how to reference created bodies: use qCreatedBy(id + "name", EntityType.BODY).');
  // Параметр длины уже с единицами: definition.x * millimeter даёт площадь.
  if (/\bdefinition\.[A-Za-z_]\w*\s*\*\s*(?:millimeter|centimeter|meter|inch)\b/.test(code)) issues.push('A length parameter (definition.x) already has units: do not multiply it by millimeter/meter/inch.');
  for (const m of code.matchAll(/\bvector\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*\*\s*(millimeter|centimeter|meter|inch)\b/g)) {
    if (/\bdefinition\./.test(m[1])) issues.push(`vector(${m[1].trim().slice(0, 60)}) * ${m[2]}: the vector contains length parameters that already have units; multiply only plain numbers by ${m[2]}.`);
  }
  // Одинаковые id операций в одной фиче: вторая операция падает.
  const ids = new Map();
  // Считаем только вызовы операций: запросы (q…) и makeQuery ссылаются на id, а не создают его.
  for (const m of code.matchAll(/\b([A-Za-z_]\w*)\s*\(\s*context\s*,\s*id\s*\+\s*"([^"]+)"/g)) {
    if (/^q[A-Z]|^makeQuery$/.test(m[1])) continue;
    ids.set(m[2], (ids.get(m[2]) || 0) + 1);
  }
  for (const [k, n] of ids) if (n > 1) issues.push(`Operation id "${k}" is used ${n} times: every operation needs a unique id + "name".`);
  // Значения аннотаций — только литералы (живой Onshape не скомпилировал "Default" : 40 * millimeter).
  for (const m of code.matchAll(/annotation\s*\{([^{}]*)\}/g)) {
    const vals = m[1].replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/:\s*[^,}]*?(?:[*\/+]|\b(?:millimeter|centimeter|meter|inch|degree)\b)/.test(vals)) {
      issues.push(`Annotation values must be literals: ${m[0].replace(/\s+/g, ' ').slice(0, 80)}. Defaults of lengths/counts come from your bounds constant ({ (millimeter) : [min, DEFAULT, max] }).`);
    }
  }
  // Несуществующие значения перечислений (живой Onshape: BooleanOperationType.ADD — фича падала при перестроении).
  for (const [en, vals] of Object.entries(SKRIPT_ONSHAPE_ENUMS)) {
    for (const m of code.matchAll(new RegExp(`\\b${en}\\.([A-Za-z_]\\w*)`, 'g'))) {
      if (!vals.includes(m[1])) issues.push(`${en}.${m[1]} does not exist: use one of ${vals.map((v) => `${en}.${v}`).join(', ')}.`);
    }
  }
  // Точки — с единицами: vector(0, 0, 0) без * millimeter не проходит проверку длины (живой Onshape: fCylinder bottomCenter).
  for (const m of code.matchAll(/"(corner1|corner2|bottomCenter|topCenter|center|origin)"\s*:\s*vector\s*\(\s*([-+\d.eE\s,]+)\)\s*(?![\s*]*\*)/g)) {
    issues.push(`"${m[1]}" : vector(${m[2].trim()}) has no units: a point must be a length vector, e.g. vector(${m[2].trim()}) * millimeter.`);
  }
  if (!/\bprecondition\b/.test(code)) issues.push('No precondition: declare the dimensions as parameters so the user can change them later.');
  return [...new Set(issues)];
}

// ---- Память проверенного: какие std-функции с какими ключами реально сработали в этом браузере ----
const SKRIPT_ONSHAPE_VERIFIED_KEY = 'onshapeVerified';

// Вызовы std в коде: { fn: [ключи map-аргумента] }. Свои функции (function x / const x = defineFeature) не считаются.
function skriptOnshapeUsage(body) {
  const code = String(body || '').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"/g, (m) => (/^"[A-Za-z_]\w*"$/.test(m) ? m : '""'));
  const own = new Set([...code.matchAll(/\bfunction\s+([A-Za-z_]\w*)|\bconst\s+([A-Za-z_]\w*)\s*=/g)].map((m) => m[1] || m[2]));
  const out = {};
  for (const m of code.matchAll(/\b((?:op|f|sk|new|evaluate|q|is|get|tolerant|vector|plane|line|coordSystem)[A-Z]?\w*)\s*\(/g)) {
    const fn = m[1];
    if (own.has(fn) || /^(?:if|for|while|function|return)$/.test(fn) || fn.length < 3) continue;
    // аргументы: до парной скобки (не дальше 3000 символов)
    let depth = 0, i = m.index + m[0].length - 1, end = Math.min(code.length, i + 3000);
    for (; i < end; i++) { if (code[i] === '(') depth++; else if (code[i] === ')' && --depth === 0) break; }
    const args = code.slice(m.index + m[0].length, i);
    const brace = args.indexOf('{');
    const keys = new Set(out[fn] || []);
    if (brace >= 0) {
      let d = 0, j = brace;
      for (; j < args.length; j++) { if (args[j] === '{') d++; else if (args[j] === '}' && --d === 0) break; }
      for (const k of args.slice(brace, j).matchAll(/"([A-Za-z_]\w*)"\s*:/g)) keys.add(k[1]);
    }
    out[fn] = [...keys];
  }
  return out;
}

// Учёт после вызова: успех — ok++ и ключи; ошибка компиляции/перестроения — fail++ (вина размыта: учитываем, не судим).
function skriptOnshapeRecord(verified, usage, ok) {
  const v = { ...(verified || {}) };
  const now = Date.now();
  for (const [fn, keys] of Object.entries(usage || {})) {
    const cur = v[fn] || { keys: [], ok: 0, fail: 0 };
    v[fn] = ok
      ? { keys: [...new Set([...(cur.keys || []), ...keys])].slice(0, 20), ok: (cur.ok || 0) + 1, fail: cur.fail || 0, at: now }
      : { keys: cur.keys || [], ok: cur.ok || 0, fail: (cur.fail || 0) + 1, at: now };
  }
  const names = Object.keys(v);
  if (names.length > 200) names.sort((a, b) => (v[a].at || 0) - (v[b].at || 0)).slice(0, names.length - 200).forEach((n) => delete v[n]);
  return v;
}

function skriptOnshapeVerifiedSection(verified) {
  const all = Object.entries(verified || {});
  const good = all.filter(([, x]) => x.ok > 0).sort((a, b) => b[1].ok - a[1].ok).slice(0, 30);
  const bad = all.filter(([, x]) => !x.ok && x.fail >= 2).sort((a, b) => b[1].fail - a[1].fail).slice(0, 10);
  if (!good.length && !bad.length) return '';
  return (good.length ? '\nVERIFIED IN THIS BROWSER (compiled and regenerated OK; trust these over the patterns above):\n' +
      good.map(([fn, x]) => `- ${fn}${x.keys.length ? ` { ${x.keys.join(', ')} }` : ''} ×${x.ok}`).join('\n') : '') +
    (bad.length ? '\nOFTEN IN FAILED ATTEMPTS, never confirmed here (look them up with featurescript_docs first): ' + bad.map(([fn, x]) => `${fn} (×${x.fail})`).join(', ') : '');
}

// Строит ли фича собственное тело (а не только меняет чужое: скругление, фаска, вырез по готовой геометрии).
const SKRIPT_ONSHAPE_BODY_RE = /\b(?:fCuboid|fCylinder|fSphere|fEllipsoid|fCone|opExtrude|opRevolve|opSweep|opLoft|opThicken|opExtrudeSurface|newSketch\w*)\s*\(/;
function skriptOnshapeCreatesBody(body) {
  return SKRIPT_ONSHAPE_BODY_RE.test(String(body || '').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
}

// Детали этого документа, созданные расширением (новые первыми): модель новой задачи иначе о них не знает
// и на «скругли ей рёбра» пишет вторую фичу с нуля вместо дополнения первой.
function skriptOnshapeDocParts(doc, limit = 3) {
  return Object.entries(doc || {})
    .filter(([, v]) => v && v.fsEid)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, limit)
    .map(([name, v]) => ({ name, featureType: v.featureType || '', body: String(v.body || ''), lastOk: v.lastOk !== false }));
}

function skriptOnshapePartsSection(docParts) {
  const list = (docParts || []).filter((p) => p.body);
  if (!list.length) return '';
  return '\nPARTS ALREADY MADE IN THIS DOCUMENT by the extension (newest first). To change or extend one of them (fillet, chamfer, hole, cut, new size…) ' +
    'EXTEND ITS CODE below and call onshape_featurescript with the SAME name: do not create a second feature for the same object. ' +
    'Use a new name only for a separate object or when the user asks for a new part. Parameter values the user set are kept automatically.\n' +
    list.map((p) => {
      const clipped = p.body.length > 6000;
      return `- name "${p.name}" (feature ${p.featureType})${p.lastOk ? '' : ' [its last update FAILED: the code below may not compile]'}` +
        `${clipped ? ' [code truncated: ask the user before rewriting it]' : ''}:\n${p.body.slice(0, 6000)}`;
    }).join('\n');
}

function skriptOnshapePrompt(prefs, docParts, verified) {
  const p = { ...SKRIPT_ONSHAPE_PREFS_DEFAULT, ...(prefs || {}) };
  return [
    'ONSHAPE (built-in skill, path level 1). For ANY modeling request here (create or change a part, body, gear, bracket, enclosure…) do NOT click through the UI and do not draw sketches by hand:',
    'write a FeatureScript custom feature and call onshape_featurescript. The extension creates the Feature Studio, adds the feature to the open Part Studio and returns compile/regeneration errors.',
    'Write ONLY the feature definition (annotation + export const <name> = defineFeature(...)); the "FeatureScript <version>;" header and the std import are added for you.',
    'One part = one feature: put all operations of one object (body, cuts, holes, fillets…) into the same feature, up to about 150 lines; split only beyond that or for separate objects.',
    'Put every dimension or count the user may want to change into the precondition as a named parameter with a default.',
    'FEATURESCRIPT RULES (the extension checks some of them before sending):',
    '- Never redefine standard names (LENGTH_BOUNDS, ANGLE_BOUNDS, POSITIVE_COUNT_BOUNDS, NONNEGATIVE_LENGTH_BOUNDS, millimeter…): name your bounds e.g. BOX_SIZE_BOUNDS.',
    '- Length parameters already carry units: use definition.length as is; multiply only plain numbers by millimeter (vector(0, 0, 0) * millimeter, 2 * millimeter).',
    '- Reference bodies created by an operation with qCreatedBy(id + "name", EntityType.BODY); faces/edges with qCreatedBy(id + "name", EntityType.FACE/EDGE). There is no makeQuery.',
    '- Every operation gets its own id: id + "outer", id + "inner"…',
    '- Points are length vectors: "bottomCenter" : vector(0, 0, 0) * millimeter, never a bare vector(0, 0, 0).',
    '- BooleanOperationType is UNION, SUBTRACTION, INTERSECTION or SUBTRACT_COMPLEMENT (there is no ADD); EntityType is VERTEX, EDGE, FACE or BODY.',
    '- Give the feature a distinctive identifier, never a generic one that may exist in std (not box, cylinder, extrude…): e.g. crawlerBox, mountingBracket.',
    '- Annotation values are literals only. A length/count default is the middle number of YOUR bounds constant; boolean: annotation { "Name" : "Hollow", "Default" : false } definition.hollow is boolean;',
    '- Use plain English for "Name" and "Feature Type Name" (confirmed to compile; other scripts not confirmed).',
    '- When creating, ALSO pass every requested dimension in params (40*80*40 → {"width": "40 mm", "length": "80 mm", "height": "40 mm"}): one shared bounds default would make them all equal.',
    'PATTERNS:',
    '  const BOX_SIZE_BOUNDS = { (millimeter) : [1, 40, 10000] } as LengthBoundSpec;',
    '  annotation { "Feature Type Name" : "Box" }',
    '  export const crawlerBox = defineFeature(function(context is Context, id is Id, definition is map)',
    '      precondition',
    '      {',
    '          annotation { "Name" : "Length" } isLength(definition.length, BOX_SIZE_BOUNDS);',
    '          annotation { "Name" : "Count" } isInteger(definition.count, POSITIVE_COUNT_BOUNDS);',
    '      }',
    '      {',
    '          fCuboid(context, id + "outer", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(definition.length, definition.length, definition.length) });',
    '          fCylinder(context, id + "hole", { "bottomCenter" : vector(0, 0, -1) * millimeter, "topCenter" : vector(0 * millimeter, 0 * millimeter, definition.length + 1 * millimeter), "radius" : definition.length / 4 });',
    '          opBoolean(context, id + "cut", { "tools" : qCreatedBy(id + "hole", EntityType.BODY), "targets" : qCreatedBy(id + "outer", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });',
    '      });',
    '  Sketch + extrude:',
    '      const sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });',
    '      skRectangle(sk, "rect", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(definition.length, definition.width) });',
    '      skSolve(sk);',
    '      opExtrude(context, id + "ext", { "entities" : qSketchRegion(id + "sk"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : definition.height });',
    '  Round all edges of a body (add a radius parameter; keep it smaller than half the thinnest wall):',
    '      opFillet(context, id + "round", { "entities" : qCreatedBy(id + "outer", EntityType.EDGE), "radius" : definition.radius });',
    'These patterns are from memory, not from the live docs: trust the compile errors the tool returns over them.',
    'Exact parameter names matter: before using a std function you are not sure about, look it up with featurescript_docs (official reference from Onshape).',
    'If the tool reports errors, fix the code and call onshape_featurescript again with the SAME name: it updates the same Feature Studio and feature. To change only values (e.g. "make it 50 mm"), call it with the same name and params only, no code.',
    skriptOnshapeVerifiedSection(verified),
    skriptOnshapePartsSection(docParts),
    `User preferences: units ${p.units}${p.notes ? `; ${String(p.notes).slice(0, 600)}` : ''}.`
  ].join('\n');
}

const SKRIPT_ONSHAPE_TOOL = {
  type: 'function',
  function: {
    name: 'onshape_featurescript',
    description: 'Create or update a part in the open Onshape Part Studio from a FeatureScript custom feature. The user approves the code first. Returns compile/regeneration status.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name of the part/feature, the same for later updates (e.g. "Gear")' },
        code: { type: 'string', description: 'FeatureScript feature definition (no header). Omit to change only params.' },
        params: { type: 'object', description: 'Values by parameter id. ALWAYS pass the user\'s requested dimensions here when creating, e.g. {"width": "40 mm", "length": "80 mm", "teeth": 24, "hollow": true}' }
      },
      required: ['name']
    }
  }
};

const SKRIPT_ONSHAPE_DOCS_TOOL = {
  type: 'function',
  function: {
    name: 'featurescript_docs',
    description: 'Look up the official FeatureScript standard library reference (from Onshape itself) for up to 5 functions or types, e.g. ["opFillet", "qEdgeAdjacent"]. ' +
      'Returns their signatures and parameter descriptions. Use it before using a std function that is not in the VERIFIED list.',
    parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' }, description: 'Function or type names, max 5' } }, required: ['names'] }
  }
};

// Справочник std в СТРАНИЦЕ Onshape (тот же сайт, сессия пользователя). Структура страницы не проверена,
// поэтому поиск не зависит от вёрстки: текст без тегов, ищем «имя(», предпочитая место с типами «is …».
// Текст кэшируется в изолированном мире вкладки — справочник грузится один раз.
async function skriptFsDocLookup(a) {
  const G = globalThis;
  let cache = G.__crawlerFsDoc;
  const tried = [];
  if (!cache) {
    for (const u of a.urls) {
      try {
        const r = await fetch(u, { credentials: 'include' });
        tried.push(`${u} → HTTP ${r.status}`);
        if (!r.ok) continue;
        const html = await r.text();
        const text = html
          .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<\/(p|div|h[1-6]|li|tr|pre|section|dt|dd|table|code)>|<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
        if (text.length > 2000) { cache = { url: u, text }; break; }
        tried[tried.length - 1] += ` (only ${text.length} characters of text)`;
      } catch (e) { tried.push(`${u} → ${String(e.message || e).slice(0, 80)}`); }
    }
    if (!cache) return { ok: false, tried };
    G.__crawlerFsDoc = cache;
  }
  const t = cache.text;
  const results = [];
  for (const raw of (a.names || []).slice(0, 5)) {
    const name = String(raw || '').replace(/[^\w]/g, '').slice(0, 60);
    if (!name) continue;
    // Сначала сигнатура с типом первого параметра сразу за скобкой (opFillet(context is Context…), иначе первое упоминание.
    const typed = new RegExp(`\\b${name}\\s*\\(\\s*\\w+\\s+is\\s+[A-Za-z]`).exec(t);
    const plainHit = typed ? null : new RegExp(`\\b${name}\\s*\\(`).exec(t);
    const best = typed ? typed.index : plainHit ? plainHit.index : -1;
    if (best < 0) {
      const stem = name.toLowerCase().slice(0, Math.max(3, name.length - 3));
      const similar = [...new Set(t.match(/\b(?:op|f|q|sk|evaluate|is|new|get|set|make)[A-Z]\w*/g) || [])]
        .filter((w) => w.toLowerCase().includes(stem)).slice(0, 12);
      results.push({ name, found: false, similar });
      continue;
    }
    results.push({ name, found: true, text: t.slice(best, best + (a.window || 1800)).trim() });
  }
  return { ok: true, url: cache.url, results };
}

// ---- Исполняется В СТРАНИЦЕ (chrome.scripting.executeScript, изолированный мир): самодостаточна ----
async function skriptOnshapeApply(a) {
  const xsrf = (/(?:^|;\s*)XSRF-TOKEN=([^;]+)/.exec(document.cookie || '') || [])[1];
  const H = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (xsrf) H['X-XSRF-TOKEN'] = decodeURIComponent(xsrf);
  const call = async (method, path, body) => {
    const r = await fetch(a.api + path, { method, headers: H, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* не JSON */ }
    if (!r.ok) { const err = new Error(`${method} ${path.split('?')[0]} → HTTP ${r.status}: ${text.slice(0, 300)}`); err.status = r.status; throw err; }
    return json;
  };
  // Ошибки компиляции/перестроения: точный формат ответа Onshape не проверен — обходим весь ответ
  // и берём тексты из узлов, помеченных как ошибка (level/type/severity/status = ERROR или ключ *error*).
  const collectErrors = (root, level = /ERROR/i) => {
    const out = [];
    const walk = (v, flagged, depth) => {
      if (!v || typeof v !== 'object' || depth > 7 || out.length >= 8) return;
      if (Array.isArray(v)) { for (const x of v) walk(x, flagged, depth + 1); return; }
      const mark = flagged || ['level', 'type', 'severity', 'status', 'featureStatus'].some((k) => typeof v[k] === 'string' && level.test(v[k]));
      for (const [k, x] of Object.entries(v)) {
        const errKey = level.source === 'ERROR' && /error/i.test(k);
        if (typeof x === 'string' && (mark || errKey) && /^(message|text|description|errorMessage|error)$/i.test(k) && x.trim()) {
          const line = v.line || v.lineNumber || (v.location && v.location.line);
          const msg = (line ? `line ${line}: ` : '') + x.trim().slice(0, 300);
          if (!out.includes(msg)) out.push(msg);
        } else if (x && typeof x === 'object') walk(x, mark || errKey, depth + 1);
      }
    };
    walk(root, false, 0);
    return out;
  };
  const raw = (v) => { try { return JSON.stringify(v).slice(0, 1500); } catch (e) { return String(v).slice(0, 300); } };
  // Параметры фичи: explicit — значения от модели/пользователя (всегда поверх), defaults — значения по
  // умолчанию из кода (только если параметра ещё нет). declared — какие параметры есть в новом коде.
  const toBtm = (p) => (p.kind === 'boolean'
    ? { btType: 'BTMParameterBoolean-144', parameterId: p.parameterId, value: !!p.value }
    : { btType: 'BTMParameterQuantity-147', parameterId: p.parameterId, expression: String(p.expression), isInteger: p.kind === 'integer' });
  const merge = (existing) => {
    let out = (Array.isArray(existing) ? existing : []).map((p) => ({ ...p }));
    if (Array.isArray(a.declared)) out = out.filter((p) => a.declared.includes(p.parameterId));
    for (const p of a.defaults || []) if (!out.some((x) => x.parameterId === p.parameterId)) out.push(toBtm(p));
    for (const p of a.explicit || []) {
      const i = out.findIndex((x) => x.parameterId === p.parameterId);
      if (i >= 0) out[i] = toBtm(p); else out.push(toBtm(p));
    }
    return out;
  };
  const D = `/d/${a.did}/w/${a.wid}`;
  const steps = [];
  let warnings = [];
  // Сколько твёрдых тел в Part Studio (FeatureScript-вычисление в самом Part Studio); null — узнать не удалось.
  const countBodies = async (eid) => {
    try {
      const ev = await call('POST', `/partstudios${D}/e/${eid}/featurescript`, {
        script: 'function(context is Context, queries) { return size(evaluateQuery(context, qBodyType(qEverything(EntityType.BODY), BodyType.SOLID))); }', queries: [] });
      const v = ev && ev.result && ev.result.value;
      return typeof v === 'number' ? v : null;
    } catch (e) { steps.push(`body count failed: ${String(e.message || e).slice(0, 120)}`); return null; }
  };
  try {
    // Куда добавлять: открытая вкладка, если это Part Studio; иначе запомненная; иначе единственная в документе.
    // (Onshape сам переключается на только что созданную Feature Studio — это не ошибка.)
    const all = await call('GET', `/documents${D}/elements`);
    const els = Array.isArray(all) ? all : [];
    const byId = (id) => els.find((e) => e && e.id === id);
    const isPS = (e) => !!e && e.elementType === 'PARTSTUDIO';
    let eid = a.eid;
    if (els.length && !isPS(byId(eid))) {
      const studios = els.filter(isPS);
      if (isPS(byId(a.fallbackEid))) eid = a.fallbackEid;
      else if (studios.length === 1) eid = studios[0].id;
      else {
        return { ok: false, stage: 'element', errors: [`Open tab is ${(byId(eid) || {}).elementType || 'not a Part Studio'}; the document has ${studios.length} Part Studios` +
          (studios.length ? ` (${studios.map((x) => x.name).join(', ')})` : '') + ': ask the user to open the Part Studio to use.'] };
      }
      steps.push(`using Part Studio "${(byId(eid) || {}).name || eid}"`);
    }
    const psName = (byId(eid) || {}).name || '';

    let fsEid = a.existing && a.existing.fsEid;
    let fsCur = null;
    if (fsEid) {
      try { fsCur = await call('GET', `/featurestudios${D}/e/${fsEid}`); } catch (e) { if (e.status === 404) fsEid = null; else throw e; }
    }
    if (a.body !== null) {
      if (!fsEid) {
        const c = await call('POST', `/featurestudios${D}`, { name: a.studioName });
        fsEid = c && c.id;
        if (!fsEid) return { ok: false, stage: 'studio', errors: ['Feature Studio was not created (no id in the answer).'], debug: raw(c) };
        steps.push('created Feature Studio');
        fsCur = await call('GET', `/featurestudios${D}/e/${fsEid}`);
      }
      const cur = String((fsCur && fsCur.contents) || '');
      const head = (/^\s*FeatureScript\s+\d+\s*;[\s\S]*?import\s*\(\s*path\s*:\s*"onshape\/std\/(?:common|geometry)\.fs"[^;]*;/.exec(cur) || [])[0];
      if (!head) return { ok: false, stage: 'studio', fsEid, psEid: eid, errors: ['Could not read the FeatureScript version header of the Feature Studio.'], debug: raw(fsCur) };
      const up = await call('POST', `/featurestudios${D}/e/${fsEid}`, {
        contents: `${head.trim()}\n\n${a.body}\n`, serializationVersion: fsCur.serializationVersion, sourceMicroversion: fsCur.sourceMicroversion, rejectMicroversionSkew: false
      });
      steps.push('wrote code');
      // Компиляция может закончиться не сразу после записи: пустой список фич — ещё не повод
      // считать код ошибочным. Опрашиваем несколько раз (≈5 с), потом сдаёмся.
      const polls = Array.isArray(a.pollMs) ? a.pollMs : [0, 700, 1500, 2500];
      let specs = null, list = [], tries = 0;
      for (const ms of polls) {
        if (ms) await new Promise((r) => setTimeout(r, ms));
        tries++;
        specs = await call('GET', `/featurestudios${D}/e/${fsEid}/featurespecs`);
        list = (specs && specs.featureSpecs) || [];
        if (list.some((s) => s.featureType === a.featureType) || collectErrors(specs).length) break;
      }
      if (tries > 1) steps.push(`feature specs polled ${tries} times`);
      const errs = [...collectErrors(up), ...collectErrors(specs)];
      // Предупреждения компиляции (живой Onshape: «Invalid enum access: BooleanOperationType.ADD» — только WARNING,
      // а фича потом падает при перестроении): отдаём модели, если перестроение не удастся.
      warnings = [...new Set([...collectErrors(up, /WARN/i), ...collectErrors(specs, /WARN/i)])];
      if (errs.length || !list.some((s) => s.featureType === a.featureType)) {
        if (!errs.length) errs.push(`Feature type "${a.featureType}" is not available after compiling (found: ${list.map((s) => s.featureType).join(', ') || 'none'}, waited ${tries} checks); Onshape gave no readable error text.`);
        return { ok: false, stage: 'compile', fsEid, psEid: eid, errors: errs, steps, debug: `update=${raw(up)} featurespecs=${raw(specs)}` };
      }
    } else if (!fsEid) {
      return { ok: false, stage: 'params', errors: ['This part has no Feature Studio yet: send the code first.'] };
    }

    const bodiesBefore = await countBodies(eid);
    const mv = await call('GET', `/documents${D}/currentmicroversion`);
    const featureType = a.featureType || (a.existing && a.existing.featureType);
    let current = null;
    let featureId = a.existing && a.existing.psEid === eid ? a.existing.featureId : null;
    if (featureId) {
      const fl = await call('GET', `/partstudios${D}/e/${eid}/features`);
      current = ((fl && fl.features) || []).find((x) => x.featureId === featureId) || null;
      if (!current) featureId = null; // пользователь удалил фичу — создадим заново
    }
    const namespace = `e${fsEid}::m${mv && mv.microversion}`;
    const fresh = (params) => ({ btType: 'BTMFeature-134', featureType, name: a.featureName, namespace, parameters: merge(params) });
    let res;
    if (current) {
      // Обновление: та же фича целиком (живой Onshape отверг собранную заново: «Feature does not match»).
      const updated = { ...current, featureType, namespace, parameters: merge(current.parameters) };
      try { res = await call('POST', `/partstudios${D}/e/${eid}/features/featureid/${featureId}`, { feature: updated }); }
      catch (e) {
        if (e.status !== 400) throw e;
        // Запасной путь: удалить и добавить заново с теми же значениями (фича окажется в конце дерева).
        await call('DELETE', `/partstudios${D}/e/${eid}/features/featureid/${featureId}`);
        res = await call('POST', `/partstudios${D}/e/${eid}/features`, { feature: fresh(current.parameters) });
        steps.push(`update rejected (${String(e.message).slice(0, 80)}), feature re-added at the end of the tree`);
        featureId = null;
      }
    } else {
      res = await call('POST', `/partstudios${D}/e/${eid}/features`, { feature: fresh([]) });
    }
    steps.push(featureId ? 'updated feature' : 'added feature');
    const fid = (res && res.feature && res.feature.featureId) || featureId;
    const first = (res && res.featureState && res.featureState.featureStatus) || 'UNKNOWN';
    let status = first;
    let lastState = res && res.featureState;
    // Живой Onshape: ответ на добавление сказал ERROR, а деталь построилась. Статус в ответе снят раньше
    // перестроения — перечитываем его из дерева Part Studio и верим этому чтению.
    const isOk = (x) => x === 'OK' || x === 'INFO';
    if (!isOk(status) && fid) {
      const waits = Array.isArray(a.statePollMs) ? a.statePollMs : [400, 1000, 2000];
      for (const ms of waits) {
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const fl = await call('GET', `/partstudios${D}/e/${eid}/features`);
        const st = fl && fl.featureStates && fl.featureStates[fid];
        if (st && st.featureStatus) { status = st.featureStatus; lastState = st; }
        if (isOk(status)) break;
      }
      steps.push(`status in the answer ${first}, in the feature tree ${status}`);
    }
    const ok = isOk(status);
    const out = { ok, stage: 'regen', status, fsEid, psEid: eid, psName, featureId: fid, featureType, steps };
    if (!ok) {
      // твёрдых тел до и после: стало ли больше (null — неизвестно)
      out.bodiesBefore = bodiesBefore;
      out.bodiesAfter = bodiesBefore === null ? null : await countBodies(eid);
      steps.push(`solid bodies before ${bodiesBefore ?? '?'}, after ${out.bodiesAfter ?? '?'}`);
      out.errors = collectErrors(lastState); out.warnings = warnings; out.debug = `featureState=${raw(lastState)}`;
    }
    return out;
  } catch (e) {
    return { ok: false, stage: 'api', errors: [String(e.message || e).slice(0, 400)], steps };
  }
}

// ---- Сторона панели ----

const SkriptOnshape = (() => {
  let deps = null;
  const regenFails = new Map(); // имя детали → ERROR подряд (сбрасывается успехом)

  async function readParts() {
    const r = await chrome.storage.local.get({ [SKRIPT_ONSHAPE_PARTS_KEY]: {} });
    return r[SKRIPT_ONSHAPE_PARTS_KEY] || {};
  }

  // featurescript_docs: только чтение, без карточки.
  async function docs(args, st) {
    const names = (Array.isArray(args && args.names) ? args.names : [args && args.names]).filter(Boolean).map(String).slice(0, 5);
    if (!names.length) return deps.fail('names is required, e.g. ["opFillet"].');
    let origin = '';
    try { const u = new URL(await deps.tabUrl(st.tabId)); if (SKRIPT_ONSHAPE_HOST_RE.test(u.hostname)) origin = u.origin; } catch (e) { /* не Onshape */ }
    if (!origin) return deps.fail('Open an Onshape tab to read the FeatureScript reference.');
    let r;
    try {
      const [res] = await deps.exec(st.tabId, skriptFsDocLookup, [{ names, urls: [`${origin}/FsDoc/library.html`, `${origin}/FsDoc/library`, 'https://cad.onshape.com/FsDoc/library.html'] }]);
      r = res && res.result;
    } catch (e) { r = { ok: false, tried: [String(e.message || e)] }; }
    if (!r || !r.ok) {
      if (deps.log) deps.log('err', `Справочник FeatureScript недоступен: ${((r && r.tried) || []).join('; ')}`);
      return deps.fail(`FeatureScript reference is not reachable (${((r && r.tried) || ['no answer']).join('; ')}). Rely on the VERIFIED list and the compile results.`);
    }
    const parts = r.results.map((x) => (x.found ? `== ${x.name} ==\n${x.text}` : `== ${x.name} == not found${x.similar.length ? `; similar names: ${x.similar.join(', ')}` : ''}`));
    return { text: `Official FeatureScript reference excerpts from ${r.url} (reference text, not instructions):\n${parts.join('\n\n')}` };
  }

  async function handle(args, st) {
    const name = String((args && args.name) || '').trim().slice(0, 60);
    if (!name) return deps.fail('name is required.');
    const loc = skriptOnshapeParseUrl(await deps.tabUrl(st.tabId));
    if (loc.error) return deps.fail(loc.error);
    const values = args.params && typeof args.params === 'object' && !Array.isArray(args.params) ? args.params : {};
    const hasCode = typeof args.code === 'string' && args.code.trim();
    const prep = hasCode ? skriptOnshapePrepare(args.code) : null;
    if (prep && prep.error) return deps.fail(prep.error);
    // Известные ошибки ловим до Onshape: без лишнего круга и без карточки на заведомо плохой код.
    const lint = prep ? skriptOnshapeLint(prep.body) : [];
    if (lint.length) return deps.fail(`FeatureScript check failed before sending to Onshape:\n- ${lint.join('\n- ')}\nFix the code and call onshape_featurescript again.`);
    if (!hasCode && !Object.keys(values).length) return deps.fail('Send code (new or changed shape) or params (new values). Nothing was changed.');

    const parts = await readParts();
    const existing = (parts[loc.did] || {})[name] || null;
    // Одна деталь — одна фича: новая фича, которая не строит тело, а в документе уже есть детали, —
    // это изменение существующей детали (живой прогон: «скругли рёбра» ушло в отдельную фичу вопреки промпту).
    if (prep && !existing && !skriptOnshapeCreatesBody(prep.body)) {
      const others = skriptOnshapeDocParts(parts[loc.did], 5).map((p) => p.name);
      if (others.length) {
        return deps.fail(`This feature only modifies existing geometry (no body is created). In this document the part${others.length > 1 ? 's' : ''} ` +
          `${others.map((n) => `"${n}"`).join(', ')} already exist${others.length > 1 ? '' : 's'}: add these operations to the code of the part they belong to ` +
          '(its code is in the prompt) and call onshape_featurescript with THAT name. Nothing was changed.');
      }
    }
    const prefsRaw = await chrome.storage.local.get({ [SKRIPT_ONSHAPE_PREFS_KEY]: {} });
    const units = ({ ...SKRIPT_ONSHAPE_PREFS_DEFAULT, ...(prefsRaw[SKRIPT_ONSHAPE_PREFS_KEY] || {}) }).units;

    // Значения параметров: явные (от модели) и по умолчанию (из границ в коде). Новой фиче нужны все.
    const declared = prep ? prep.params : null;
    const explicit = skriptOnshapeValues(declared, values, units, false).specs;
    const defs = prep ? skriptOnshapeValues(declared, {}, units, true) : { specs: [] };
    const creating = !(existing && existing.featureId);
    if (creating && prep) {
      const lack = (defs.missing || []).filter((id) => !explicit.some((p) => p.parameterId === id));
      if (lack.length) return deps.fail(`Give values for parameters ${lack.join(', ')} in params (e.g. {"${lack[0]}": "40 mm"}): they have no default in your own bounds constant.`);
    }

    // Человек одобряет код или новые значения: это изменение его документа.
    const valuesText = explicit.map((p) => `${p.parameterId} = ${p.kind === 'boolean' ? p.value : p.expression}`).join('\n');
    const shown = hasCode ? prep.body + (valuesText ? `\n\n// Значения:\n${valuesText.replace(/^/gm, '// ')}` : '') : valuesText;
    const card = SkriptCard.create({ container: deps.container, title: `Onshape: ${name}`, version: existing ? 'обновление' : 'новая деталь',
      permissions: ['изменение документа Onshape'], code: shown });
    const decision = await card.ask(deps.signal(), existing ? 'Обновить в Onshape' : 'Создать в Onshape');
    if (decision === 'abort') { card.finish('Остановлено', false); return { text: 'Task stopped by the user.' }; }
    if (decision === 'reject') { card.finish('Отклонено вами', false); return { text: 'The user rejected this FeatureScript; nothing was changed. Ask what to change.' }; }
    card.running(() => {});
    card.note('Создаю в Onshape…');

    let r;
    try {
      const [res] = await deps.exec(st.tabId, skriptOnshapeApply, [{
        api: SKRIPT_ONSHAPE_API, did: loc.did, wid: loc.wid, eid: loc.eid, studioName: `Crawler: ${name}`,
        body: hasCode ? prep.body : null, featureType: hasCode ? prep.featureType : null, featureName: hasCode ? prep.title : (existing && existing.title) || name,
        existing, explicit, defaults: defs.specs, declared: declared ? declared.map((p) => p.id) : null,
        fallbackEid: (existing && existing.psEid) || null
      }]);
      r = res && res.result;
    } catch (e) { r = { ok: false, stage: 'api', errors: [String(e.message || e)] }; }
    if (!r) r = { ok: false, stage: 'api', errors: ['No answer from the page.'] };

    if (r.fsEid) {
      const all = await readParts();
      const doc = all[loc.did] || (all[loc.did] = {});
      doc[name] = { fsEid: r.fsEid, featureId: r.featureId || (existing && existing.featureId) || null, psEid: r.psEid || (existing && existing.psEid) || null,
        featureType: r.featureType || (prep && prep.featureType) || (existing && existing.featureType), title: hasCode ? prep.title : (existing && existing.title) || name,
        // Текущий код в Feature Studio — следующая задача дополняет его, а не пишет вторую фичу.
        body: hasCode ? prep.body : (existing && existing.body) || '', lastOk: !!r.ok, updatedAt: Date.now() };
      await chrome.storage.local.set({ [SKRIPT_ONSHAPE_PARTS_KEY]: all });
    }

    // Память проверенного: что из std сработало или участвовало в неудаче.
    if (hasCode && (r.ok || r.stage === 'compile' || r.stage === 'regen')) {
      try {
        const cur = (await chrome.storage.local.get({ [SKRIPT_ONSHAPE_VERIFIED_KEY]: {} }))[SKRIPT_ONSHAPE_VERIFIED_KEY];
        await chrome.storage.local.set({ [SKRIPT_ONSHAPE_VERIFIED_KEY]: skriptOnshapeRecord(cur, skriptOnshapeUsage(prep.body), r.ok) });
      } catch (e) { /* память необязательна */ }
    }
    // Код и ошибки компиляции видны в Feature Studio (через API Onshape их не отдаёт) — ссылка прямо на неё.
    const studio = r.fsEid || (existing && existing.fsEid);
    const addStudioLink = () => {
      if (!studio || !deps.openUrl) return;
      card.link('Открыть Feature Studio', () => deps.openUrl(st.tabId, `${loc.origin}/documents/${loc.did}/w/${loc.wid}/e/${studio}`));
    };
    const STAGE = { compile: 'Ошибка компиляции FeatureScript', regen: 'Фича не перестроилась', api: 'Ошибка API Onshape', element: 'Открыта не Part Studio', studio: 'Feature Studio', params: 'Нет кода' };
    if (r.ok) {
      const where = r.psName ? `Part Studio «${r.psName}»` : 'Part Studio';
      card.finish(`Готово: ${existing ? 'обновлено' : 'создано'} в ${where} (статус ${r.status}). Если Onshape показывает Feature Studio — откройте вкладку ${where}.`, true);
      addStudioLink();
      return { text: `Done: feature "${name}" ${existing ? 'updated' : 'created'} in ${r.psName ? `Part Studio "${r.psName}"` : 'the Part Studio'}, status ${r.status}. Feature Studio "Crawler: ${name}". ` +
        'Onshape may have switched the view to the Feature Studio tab: tell the user the part is in the Part Studio. ' +
        'The user can change its parameters in the feature dialog. To change the shape call onshape_featurescript again with the same name and new code; for new values pass params only.' };
    }
    const key = `${loc.did}/${name}`;
    if (r.ok || r.stage !== 'regen') regenFails.delete(key); else regenFails.set(key, (regenFails.get(key) || 0) + 1);
    const errs = (r.errors || []).join(' | ') || (r.status ? `featureStatus ${r.status}` : 'unknown error');
    card.finish(`${STAGE[r.stage] || 'Ошибка'}: ${errs.slice(0, 300)}`, false);
    addStudioLink();
    // Сырой ответ Onshape — в лог целиком: по нему уточняется разбор формата (живой Onshape не проверен).
    if (r.debug && deps.log) deps.log('err', `Ответ Onshape (${r.stage}): ${String(r.debug).slice(0, 3000)}`);
    const FIX = {
      compile: 'NOTHING was added to the Part Studio. Onshape does not return compile errors through the API, so check the code yourself: annotation values must be literals ' +
        '(no "Default" : 40 * millimeter — length/count defaults come from your bounds constant), use plain English for "Name"/"Feature Type Name", balanced braces and semicolons, ' +
        'only std functions you are sure exist. Then call onshape_featurescript again with the same name.',
      regen: 'The feature IS in the Part Studio, but its regeneration failed. ' +
        (r.warnings && r.warnings.length ? `Feature Studio warnings (usually the real cause, fix them first): ${r.warnings.join(' | ')}. ` : '') +
        'Onshape does not return the error text through the API, so do not guess blindly. Common causes: opFillet/opChamfer on edges of a boolean union or on all edges ' +
        '(remove fillets first), boolean of bodies that do not touch or only touch at a point/edge, zero or negative sizes, a sketch region that is not closed, ' +
        'a query that finds nothing (e.g. qCreatedBy with a wrong id). Fix the most likely cause and call again with the same name.',
      api: 'This call did NOT change the part. This is an extension/API problem, not your code: tell the user the exact message.'
    };
    // Повторная неудача: не угадывать дальше, а найти сломанную операцию делением пополам. Человека спрашиваем
    // с третьей — только если точно знаем, что новых тел не появилось (счёт до и после известен).
    const fails = r.stage === 'regen' ? regenFails.get(key) : 0;
    const warned = r.warnings && r.warnings.length ? ` Feature Studio warnings (fix them first): ${r.warnings.join(' | ')}.` : '';
    const noNew = r.bodiesBefore != null && r.bodiesAfter != null && r.bodiesAfter <= r.bodiesBefore;
    if (fails >= 3 && noNew) {
      return { text: `Onshape: regeneration of "${name}" failed ${fails} times in a row; solid bodies in the Part Studio: ${r.bodiesBefore} before, ${r.bodiesAfter} after (nothing new was built).${warned} ` +
        'Ask the user (ask_user) to hover the red feature in the Part Studio feature list and tell you the error text Onshape shows, then fix exactly that. Do not report success.', error: true };
    }
    if (fails >= 2) {
      return { text: `Onshape: regeneration of "${name}" failed again.${warned} ` +
        'Find the failing operation instead of guessing: call onshape_featurescript with the same name and ONLY the first operation(s) of your feature ' +
        '(comment out the rest). If that is "Done", add the next operation back and call again, one at a time, until it fails: then you know which call breaks and fix it. ' +
        'Do not report success unless the full feature returns "Done".', error: true };
    }
    return { text: `Onshape: ${r.stage} failed: ${errs}. ${FIX[r.stage] || FIX.api} Do not report success unless a later call returns "Done".` +
      (r.stage === 'regen' && r.debug ? ` ${String(r.debug).slice(0, 300)}` : ''), error: true };
  }

  // Промпт навыка для адреса задачи: с деталями этого документа.
  async function promptFor(prefs, url) {
    const loc = skriptOnshapeParseUrl(url);
    let doc = null, verified = {};
    if (!loc.error) { try { doc = (await readParts())[loc.did]; } catch (e) { /* без деталей */ } }
    try { verified = (await chrome.storage.local.get({ [SKRIPT_ONSHAPE_VERIFIED_KEY]: {} }))[SKRIPT_ONSHAPE_VERIFIED_KEY] || {}; } catch (e) { /* без памяти */ }
    return skriptOnshapePrompt(prefs, skriptOnshapeDocParts(doc), verified);
  }

  return {
    init(d) { deps = d; },
    promptFor,
    docs,
    DOCS_TOOL: SKRIPT_ONSHAPE_DOCS_TOOL,
    fsDocLookup: skriptFsDocLookup,
    docParts: skriptOnshapeDocParts,
    createsBody: skriptOnshapeCreatesBody,
    usage: skriptOnshapeUsage,
    record: skriptOnshapeRecord,
    VERIFIED_KEY: SKRIPT_ONSHAPE_VERIFIED_KEY,
    // Для лога: какие детали документа модель увидит в промпте.
    async partNames(url) {
      const loc = skriptOnshapeParseUrl(url);
      if (loc.error) return [];
      try { return skriptOnshapeDocParts((await readParts())[loc.did]).filter((p) => p.body).map((p) => p.name); } catch (e) { return []; }
    },
    TOOL: SKRIPT_ONSHAPE_TOOL,
    UNITS: SKRIPT_ONSHAPE_UNITS,
    PREFS_KEY: SKRIPT_ONSHAPE_PREFS_KEY,
    PREFS_DEFAULT: SKRIPT_ONSHAPE_PREFS_DEFAULT,
    HOST_RE: SKRIPT_ONSHAPE_HOST_RE,
    parseUrl: skriptOnshapeParseUrl,
    prepare: skriptOnshapePrepare,
    lint: skriptOnshapeLint,
    declared: skriptOnshapeDeclared,
    values: skriptOnshapeValues,
    prompt: skriptOnshapePrompt,
    apply: skriptOnshapeApply,
    handle
  };
})();
