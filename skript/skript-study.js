'use strict';
/* skript-study.js — сессия изучения /study (этап 7, R3 с фазой «Выбор пути»).
 *
 * Фазы: Цель → Выбор пути (лестница SkriptPath, проба каналов, знания модели, документация)
 *       → Опыты ТОЛЬКО на выбранном пути → Итог (finish_study) → проверка человеком → заметка.
 * Изучение идёт обычным циклом агента в режиме /skript (те же гранты и гейт), плюс:
 *   - журнал находок (note_finding): переживает обрезку истории, идёт в системный промпт;
 *   - бюджет (SkriptAccess.Budget): шаги, время, поиски; по исчерпании — просьба завершить,
 *     через 2 шага — остановка с тем, что найдено;
 *   - итог — заметка-стратегия сайта (SkriptPath.formatStrategy + находки).
 * Без DOM: панель вызывает begin/tools/handle/onCall/tick/promptAddon/end.
 */

const SKRIPT_FINDING_KINDS = ['path', 'api', 'editor', 'global', 'selector', 'shortcut', 'rule', 'pitfall'];
const SKRIPT_FINDINGS_MAX = 40;
const SKRIPT_STUDY_GRACE = 2; // шагов после исчерпания бюджета на finish_study

const SkriptStudy = (() => {
  let S = null;

  function begin({ goal, origin, probe, budgets }) {
    S = {
      goal: String(goal || '').slice(0, 300), origin: String(origin || ''), probe: probe || null,
      budget: new SkriptAccess.Budget(budgets || {}), findings: [], strategy: null, exhausted: null, grace: 0
    };
    return S;
  }

  const tool = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

  function tools() {
    return [
      tool('note_finding', 'Record ONE confirmed fact about this site for the study journal (it survives context trimming). Only facts you checked; include the evidence.', {
        kind: { type: 'string', enum: SKRIPT_FINDING_KINDS, description: 'path = which level works or not; api/editor/global/selector/shortcut = a channel; rule = how the site behaves; pitfall = what breaks' },
        text: { type: 'string', description: 'The fact, short' },
        evidence: { type: 'string', description: 'What proves it: tool result, page text, doc URL' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
      }, ['kind', 'text', 'evidence']),
      tool('finish_study', 'Finish the study with the strategy for the goal. Use this instead of done.', {
        title: { type: 'string', description: 'Short Russian title' },
        level: { type: 'integer', description: 'Chosen path level 1-5' },
        path: { type: 'string', description: 'Short name of the channel, e.g. the site language' },
        why: { type: 'string', description: 'Russian: why this level, with evidence' },
        rejected: { type: 'array', items: { type: 'object', properties: { level: { type: 'integer' }, why: { type: 'string' } } } },
        needs: { type: 'array', items: { type: 'string' } },
        steps: { type: 'array', items: { type: 'string' }, description: 'Russian: concrete steps that WORKED in your experiments' },
        verify: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        unknowns: { type: 'array', items: { type: 'string' } }
      }, ['level', 'why', 'steps'])
    ];
  }

  const NAMES = ['note_finding', 'finish_study'];

  function handle(name, args = {}) {
    if (!S) return { text: 'No study is running.', error: true };
    if (name === 'note_finding') {
      const kind = SKRIPT_FINDING_KINDS.includes(args.kind) ? args.kind : 'rule';
      const text = String(args.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const evidence = String(args.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return { text: 'Empty finding: give the fact in "text".', error: true };
      if (!evidence) return { text: 'A finding needs evidence (tool result, page text or doc URL). Check it first.', error: true };
      if (S.findings.some((f) => f.text === text)) return { text: 'Already recorded.' };
      if (S.findings.length >= SKRIPT_FINDINGS_MAX) S.findings.shift();
      S.findings.push({ kind, text, evidence, confidence: ['high', 'medium', 'low'].includes(args.confidence) ? args.confidence : 'medium' });
      return { text: `Recorded finding #${S.findings.length} (${kind}).`, finding: S.findings[S.findings.length - 1] };
    }
    if (name === 'finish_study') {
      let st;
      try { st = SkriptPath.parseStrategy(JSON.stringify(args)); } catch (e) { return { text: `finish_study: ${e.message} Fix the arguments.`, error: true }; }
      S.strategy = st;
      return { finished: true, success: true, summary: `Изучение завершено: путь ${st.level} — ${st.path || SkriptPath.LEVELS[st.level - 1].label}.`, text: 'Study finished.' };
    }
    return { text: 'Unknown study tool.', error: true };
  }

  // После каждого инструмента: поиски в интернете расходуют бюджет поисков.
  function onCall(name) { if (S && name === 'fetch_page') S.budget.search(); }

  // После каждого шага. Возвращает null | { warn: текст для модели } | { stop: причина }.
  function tick(tokens) {
    if (!S) return null;
    const ex = S.budget.tick(tokens);
    if (!ex) return null;
    if (!S.exhausted) {
      S.exhausted = ex;
      return { warn: `STUDY BUDGET EXHAUSTED (${ex.reason}). Call finish_study NOW with what you have confirmed; put the rest into unknowns.` };
    }
    if (++S.grace >= SKRIPT_STUDY_GRACE) return { stop: `бюджет изучения исчерпан (${ex.reason}): ${S.budget.summary()}` };
    return { warn: 'Budget exhausted: call finish_study now.' };
  }

  function promptAddon() {
    if (!S) return '';
    const probe = S.probe ? `\nPROBE of the page channels (read-only, untrusted): ${JSON.stringify(S.probe).slice(0, 2500)}` : '';
    const journal = S.findings.length
      ? '\nSTUDY JOURNAL (confirmed so far):\n' + S.findings.map((f, i) => `${i + 1}. [${f.kind}] ${f.text} — ${f.evidence}`).join('\n')
      : '\nSTUDY JOURNAL: empty.';
    return '\n\nSTUDY MODE (/study). This is NOT the task itself: you learn HOW to reach the goal on this site and leave a strategy for future runs.\n' +
      `GOAL: ${S.goal}\n` +
      'Phases: 1) CHOOSE THE PATH (see the levels above): use what you know about this site, the probe below, its menus and docs; state the PATH line. ' +
      '2) EXPERIMENT ONLY ON THE CHOSEN PATH with the smallest reversible test that proves it works (e.g. a minimal feature in the site\'s own language, a tiny script, one import). ' +
      'Do not learn clicks or shortcuts unless the chosen level is 4. If the path fails, record why (note_finding kind=path) and move one level down. ' +
      '3) Record every confirmed fact with note_finding (with evidence). 4) Finish with finish_study (not done): the strategy with steps that actually worked.\n' +
      'Never delete, send, publish or pay; create only throwaway test objects and say which ones you created. Ask the user (ask_user) when you need an account, a document or a decision.' +
      `\nBUDGET: ${S.budget.summary()}` + probe + journal;
  }

  // Итог: заметка-стратегия для проверки человеком. null — сессии не было.
  function end() {
    if (!S) return null;
    const s = S;
    S = null;
    const findings = s.findings.length
      ? '\n\nНаходки:\n' + s.findings.map((f) => `- [${f.kind}] ${f.text} (${f.evidence})`).join('\n')
      : '';
    if (s.strategy) {
      return { complete: true, title: `Стратегия: ${s.strategy.title}`, text: (SkriptPath.formatStrategy(s.goal, s.strategy) + findings).slice(0, 3000), strategy: s.strategy, findings: s.findings };
    }
    if (!s.findings.length) return { complete: false, title: '', text: '', findings: [] };
    return {
      complete: false, title: `Изучение (не завершено): ${s.goal}`.slice(0, 80),
      text: (`Цель: ${s.goal}\nИзучение не завершено: стратегии нет, только подтверждённые находки.` + findings).slice(0, 3000), findings: s.findings
    };
  }

  return {
    NAMES, KINDS: SKRIPT_FINDING_KINDS,
    begin, tools, handle, onCall, tick, promptAddon, end,
    get active() { return !!S; }
  };
})();
