'use strict';
/* Тест skript-study.js: журнал находок, finish_study → стратегия, бюджет с отсрочкой, итоговая заметка.
 * Запуск: node skript-study.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console, Date });
for (const f of ['skript-policy.js', 'skript-access.js', 'skript-path.js', 'skript-study.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}
const St = vm.runInContext('SkriptStudy', ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- 0. Без сессии ----
assert.equal(St.active, false);
assert.equal(St.promptAddon(), '');
assert.equal(St.end(), null);
assert.ok(St.handle('note_finding', { kind: 'api', text: 'x', evidence: 'y' }).error);

// ---- 1. Инструменты и промпт ----
St.begin({ goal: 'создавать модели деталей', origin: 'https://cad.onshape.com', probe: { editors: ['Monaco'], menus: ['Feature Studio'] }, budgets: { steps: 3, minutes: 10, searches: 1 } });
assert.equal(St.active, true);
assert.deepEqual(plain(St.tools().map((t) => t.function.name)), ['note_finding', 'finish_study']);
let pr = St.promptAddon();
assert.match(pr, /STUDY MODE/);
assert.match(pr, /GOAL: создавать модели деталей/);
assert.match(pr, /EXPERIMENT ONLY ON THE CHOSEN PATH/);
assert.match(pr, /Feature Studio/, 'проба каналов в промпте');
assert.match(pr, /STUDY JOURNAL: empty/);
assert.match(pr, /BUDGET: шаги 0\/3/);

// ---- 2. Находки: нужна суть и доказательство, повтор не дублируется ----
assert.ok(St.handle('note_finding', { kind: 'api', text: '' , evidence: 'e' }).error, 'пустая находка');
assert.match(St.handle('note_finding', { kind: 'api', text: 'есть Feature Studio' }).text, /needs evidence/, 'без доказательства не записывается');
const f1 = St.handle('note_finding', { kind: 'editor', text: 'В Feature Studio редактор FeatureScript', evidence: 'query_dom: .monaco-editor', confidence: 'high' });
assert.match(f1.text, /#1/);
assert.equal(f1.finding.kind, 'editor');
assert.equal(St.handle('note_finding', { kind: 'editor', text: 'В Feature Studio редактор FeatureScript', evidence: 'ещё раз' }).text, 'Already recorded.');
assert.equal(St.handle('note_finding', { kind: 'нечто', text: 'неизвестный вид', evidence: 'e' }).finding.kind, 'rule', 'неизвестный вид → rule');
pr = St.promptAddon();
assert.match(pr, /1\. \[editor\] В Feature Studio редактор FeatureScript — query_dom/, 'журнал в промпте');

// ---- 3. Бюджет: поиск, исчерпание → просьба завершить → через 2 шага стоп ----
St.onCall('fetch_page');
let b = St.tick(10);
assert.match(b.warn, /STUDY BUDGET EXHAUSTED \(searches\)/, 'поиск израсходовал бюджет поисков');
b = St.tick(10);
assert.match(b.warn, /finish_study now/);
b = St.tick(10);
assert.match(b.stop, /бюджет изучения исчерпан/);

// ---- 4. finish_study → стратегия ----
assert.match(St.handle('finish_study', { level: 9, why: 'x', steps: [] }).text, /level 1–5/, 'неверный уровень — модель исправляет');
const fin = St.handle('finish_study', {
  title: 'Детали через FeatureScript', level: 1, path: 'FeatureScript', why: 'фича из кода строится за секунды',
  rejected: [{ level: 4, why: 'клики медленные' }], steps: ['Создать Feature Studio', 'Вставить фичу', 'Применить в Part Studio'],
  verify: 'деталь появилась', confidence: 'medium', unknowns: []
});
assert.equal(fin.finished, true);
assert.match(fin.summary, /путь 1 — FeatureScript/);
const r = plain(St.end());
assert.equal(St.active, false, 'после end сессии нет');
assert.equal(r.complete, true);
assert.equal(r.title, 'Стратегия: Детали через FeatureScript');
assert.match(r.text, /^Цель: создавать модели деталей\nПуть: 1 — FeatureScript/);
assert.match(r.text, /Находки:\n- \[editor\] В Feature Studio редактор FeatureScript \(query_dom: \.monaco-editor\)/);
assert.ok(r.text.length <= 3000);

// ---- 5. Без finish_study: незавершённое — только находки; без находок — пусто ----
St.begin({ goal: 'играть', origin: 'https://g.example', budgets: {} });
St.handle('note_finding', { kind: 'global', text: 'window.game хранит поле', evidence: 'eval: object' });
const part = plain(St.end());
assert.equal(part.complete, false);
assert.match(part.title, /не завершено/);
assert.match(part.text, /стратегии нет/);
assert.match(part.text, /window\.game/);
St.begin({ goal: 'x', origin: 'https://g.example' });
assert.equal(St.end().text, '', 'ничего не найдено — нечего сохранять');

console.log('skript-study.test.js: OK');
