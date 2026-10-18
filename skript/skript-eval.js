'use strict';
/* skript-eval.js — оценка результата скрипта /skript.
 *
 * Модель объявляет цель скрипта: goal = { metric, target, better, read }.
 *   metric — имя числа (например "score"); target — к чему стремимся; better — "higher" (по умолчанию) или "lower";
 *   read — необязательное выражение только для чтения, которым расширение САМО читает метрику со страницы
 *   (не доверяя отчёту скрипта). Без read берётся то, что скрипт отдал в __crawler.report / результате.
 * После каждого запуска журнал задачи считает оценку: значение, цель, здоровье запуска, лучший результат
 * за задачу и историю версий. Текст оценки уходит модели, короткая строка — в карточку.
 * Чистая логика без DOM и CDP; чтение со страницы делает skript-run.js.
 */

const SKRIPT_EVAL_READ_MAX = 300;
// Разница меньше этой доли от лучшего — в пределах шума (игры случайны, один запуск мало что значит).
const SKRIPT_EVAL_NOISE = 0.1;
const SKRIPT_EVAL_BAD_REASONS = { slow: 'kept the page busy', stalled: 'stopped acting', heartbeat: 'froze the page', error: 'crashed', syntax: 'did not compile', 'max-time': 'hit the time limit' };

function skriptCleanGoal(goal) {
  if (goal === undefined || goal === null) return { ok: true, goal: null };
  if (typeof goal !== 'object' || Array.isArray(goal)) return { ok: false, error: 'goal must be an object { metric, target, better, read }' };
  const metric = String(goal.metric || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(metric)) return { ok: false, error: 'goal.metric: a short name like "score"' };
  const better = goal.better === undefined ? 'higher' : String(goal.better);
  if (!['higher', 'lower'].includes(better)) return { ok: false, error: 'goal.better must be "higher" or "lower"' };
  let target = null;
  if (goal.target !== undefined && goal.target !== null) {
    target = Number(goal.target);
    if (!isFinite(target)) return { ok: false, error: 'goal.target must be a number' };
  }
  let read = null;
  if (goal.read !== undefined && goal.read !== null && String(goal.read).trim()) {
    read = String(goal.read).trim();
    if (read.length > SKRIPT_EVAL_READ_MAX) return { ok: false, error: `goal.read: at most ${SKRIPT_EVAL_READ_MAX} characters` };
    // Выражение исполняется в странице без одобрения человека — только чтение.
    const r = typeof SkriptPolicy !== 'undefined' ? SkriptPolicy.lint(read, 'readonly') : { ok: true };
    if (!r.ok) return { ok: false, error: `goal.read is not read-only: ${r.error}` };
  }
  return { ok: true, goal: { metric, target, better, read } };
}

// Значение метрики за запуск: лучшее из чтений страницы, иначе из отчёта скрипта, иначе из результата.
function skriptGoalValue(goal, summary, samples) {
  const pick = (vals) => (goal.better === 'lower' ? Math.min(...vals) : Math.max(...vals));
  const nums = (samples || []).filter((v) => typeof v === 'number' && isFinite(v));
  if (goal.read) return nums.length ? { value: pick(nums), source: 'page' } : { value: null, source: 'page' };
  const m = summary && summary.metrics && summary.metrics[goal.metric];
  if (m) return { value: goal.better === 'lower' ? m.min : m.max, source: 'script' };
  const r = summary && summary.result;
  if (r && typeof r === 'object' && typeof r[goal.metric] === 'number' && isFinite(r[goal.metric])) return { value: r[goal.metric], source: 'script' };
  return { value: null, source: null };
}

function skriptHealth(summary, extra) {
  const problems = [];
  if (summary && SKRIPT_EVAL_BAD_REASONS[summary.reason]) problems.push(SKRIPT_EVAL_BAD_REASONS[summary.reason]);
  if (summary && summary.errors && summary.errors.length) problems.push(`${summary.errors.length} error(s)`);
  if (summary && summary.dropped) problems.push(`${summary.dropped} input(s) dropped`);
  if (extra && extra.scrolled) problems.push('scrolled the page');
  return problems;
}

// Журнал одной задачи: все запуски всех черновиков, лучший результат.
function skriptCreateLedger() {
  const runs = [];
  let best = null;
  const isBetter = (goal, a, b) => (goal.better === 'lower' ? a < b : a > b);

  return {
    get runs() { return runs.slice(); },
    get best() { return best; },
    // d: черновик { id, version, goal }; summary: сводка раннера; samples: чтения goal.read; extra: { scrolled }.
    record(d, summary, samples, extra) {
      const goal = d.goal || null;
      const problems = skriptHealth(summary, extra);
      const ev = { id: d.id, version: d.version, goal, problems, value: null, source: null, reached: false, improved: false, previousBest: best, actions: summary ? summary.actions : undefined };
      if (goal) {
        Object.assign(ev, skriptGoalValue(goal, summary, samples));
        // Живой прогон 2048: read весь запуск возвращал 0 (не тот элемент), а скрипт сделал 300 ходов.
        // Значение со страницы ни разу не изменилось при многих действиях — read, скорее всего, читает не то.
        const nums = (samples || []).filter((v) => typeof v === 'number' && isFinite(v));
        if (goal.read && nums.length >= 3 && nums.every((v) => v === nums[0]) && summary && summary.actions >= 10) {
          ev.stuck = nums[0];
          const m = summary.metrics && summary.metrics[goal.metric];
          if (m && m.max !== nums[0]) ev.scriptSays = goal.better === 'lower' ? m.min : m.max;
        }
        if (ev.value !== null) {
          if (goal.target !== null) ev.reached = goal.better === 'lower' ? ev.value <= goal.target : ev.value >= goal.target;
          // Лучший сравниваем только по той же метрике: цель могли переобъявить.
          const comparable = best && best.goal.metric === goal.metric && best.goal.better === goal.better;
          if (!comparable || isBetter(goal, ev.value, best.value)) { ev.improved = !!comparable || !best; best = { id: d.id, version: d.version, value: ev.value, goal }; }
          if (comparable) {
            ev.delta = ev.value - ev.previousBest.value;
            ev.flat = ev.delta === 0 && ev.value === 0;   // 0 против 0 — не «как лучший», а «прогресса нет»
            ev.noise = !ev.flat && Math.abs(ev.delta) <= Math.abs(ev.previousBest.value) * SKRIPT_EVAL_NOISE;
          }
        }
      }
      runs.push(ev);
      return ev;
    }
  };
}

const summary_actions = (ev) => ev.actions === undefined ? 'many' : ev.actions;
const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

// Текст оценки для модели (английский, как остальные сообщения инструментов).
function skriptEvalText(ev, ledger) {
  if (!ev.goal) {
    return ' Evaluation: no goal declared, so progress cannot be measured. Next time pass goal = { metric, target, read } to write_script or patch_script ' +
      '(read = a short read-only expression that returns the number from the page, e.g. the score), so every run is scored and compared.' +
      (ev.problems.length ? ` Health: ${ev.problems.join(', ')}.` : '');
  }
  const g = ev.goal;
  const parts = [];
  if (ev.value === null) {
    parts.push(`Evaluation: ${g.metric} could not be read${g.read ? ' by your goal.read expression (it returned no number: check it)' : ' (the script did not report it: call __crawler.report({ ' + g.metric + ' }))'}.`);
  } else {
    const pct = g.target ? ` (${Math.round(ev.value / g.target * 100)}% of target ${fmtNum(g.target)})` : '';
    parts.push(`Evaluation: ${g.metric} = ${fmtNum(ev.value)}${pct}, ${ev.source === 'page' ? 'read from the page' : 'as reported by the script'}.`);
    if (ev.stuck !== undefined) {
      parts.push(`WARNING: goal.read returned the same value (${fmtNum(ev.stuck)}) for the whole run while the script acted ${summary_actions(ev)} times: ` +
        `it probably reads the wrong element, or the number is drawn on a canvas and is not in the DOM. ` +
        (ev.scriptSays !== undefined ? `Your script itself reported ${g.metric} up to ${fmtNum(ev.scriptSays)}. ` : '') +
        'Find where the number really is (query_dom, screenshot_region) and fix goal.read with patch_script; until then this score means nothing.');
    }
    if (ev.reached && ev.stuck === undefined) parts.push('TARGET REACHED: finish with done and report the result.');
    if (ev.previousBest && ev.delta !== undefined) {
      const pb = ev.previousBest;
      if (ev.flat) parts.push('No progress: still 0.');
      else if (ev.noise) parts.push(`About the same as the best so far (${fmtNum(pb.value)}, ${pb.id} v${pb.version}): within noise, one run proves nothing.`);
      else if (ev.improved) parts.push(`New best (previous best ${fmtNum(pb.value)}, ${pb.id} v${pb.version}).`);
      else parts.push(`WORSE than the best so far: ${fmtNum(pb.value)} by ${pb.id} v${pb.version}. Build on that version instead of this one.`);
    }
  }
  if (ev.problems.length) parts.push(`Health: ${ev.problems.join(', ')}.`);
  const hist = ledger.runs.filter((r) => r.goal && r.goal.metric === g.metric).slice(-8)
    .map((r) => `${r.id} v${r.version}: ${r.value === null ? '?' : fmtNum(r.value)}`);
  if (hist.length > 1) parts.push(`History: ${hist.join(' · ')}.`);
  return ' ' + parts.join(' ');
}

// Короткая строка для карточки (по-русски).
function skriptEvalLine(ev, ledger) {
  if (!ev.goal) return ev.problems.length ? `без цели · ${ev.problems.length} проблем(ы)` : 'без цели';
  const g = ev.goal;
  if (ev.value === null) return `${g.metric}: не прочитано`;
  let s = `${g.metric} ${fmtNum(ev.value)}${g.target !== null ? ` / ${fmtNum(g.target)}` : ''}`;
  if (ev.stuck !== undefined) return `${s} · не меняется — проверьте, откуда читается ${g.metric}`;
  if (ev.reached) s += ' · цель достигнута';
  const b = ledger.best;
  if (ev.previousBest && ev.delta !== undefined) s += ev.flat ? ' · без прогресса' : ev.noise ? ' · как лучший' : ev.improved ? ' · новый лучший' : ` · хуже лучшего (${fmtNum(b.value)})`;
  if (ev.source === 'script') s += ' · со слов скрипта';
  return s;
}

const SkriptEval = {
  NOISE: SKRIPT_EVAL_NOISE,
  cleanGoal: skriptCleanGoal,
  goalValue: skriptGoalValue,
  createLedger: skriptCreateLedger,
  text: skriptEvalText,
  line: skriptEvalLine
};
