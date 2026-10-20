# Аудит chrome-crawler: карта проекта и найденные проблемы

Документ фиксирует устройство проекта и результаты ручного аудита кода (баги, уязвимости,
производительность, неточности). Проверка выполнялась по исходникам `main` (v0.7.4),
`./test.sh` на момент аудита проходит полностью.

## 1. Карта проекта

```
manifest.json                 MV3, side panel, service worker, permissions
background.js                 открытие панели по клику на иконку (1 строка)
panel/                        боковая панель (UI + агент)
  sidepanel.html              разметка, стили, порядок подключения скриптов
  sidepanel.js                главный цикл агента, инструменты, темы, палитра, обновления
  agent-loop.js               чистая логика: скриншоты, сжатие истории, ссылки в ответе
  llm-retry.js                повторы запросов к LLM (429/5xx/сеть)
  attachments.js              вложения (картинки/текст) к задаче
  model-switch.js             быстрый выбор модели в шапке
  panel-extras.js             история ввода, черновик, кнопки у сообщений
  self-update.js              скачивание ZIP с GitHub и запись в папку расширения
  updates.js                  проверка новой версии по manifest.json в main
  tour.js                     обучение при первом запуске (canvas-анимация)
page/                         код, внедряемый во вкладку
  content.js                  snapshot/click/type/fill/scroll/query_dom/fetchSame/waitIdle
  extract-items.js            товары/объявления: JSON-LD, microdata, повторяющиеся карточки
  tentacles.js                декоративные «щупальца» на странице (canvas, shadow DOM)
skript/                       режим /skript, /study и Onshape
  skript-mode.js              команды, гранты, гейт R0–R3, добавка к промпту
  skript-access.js            пресеты, классификация риска, жёсткие запреты, бюджеты
  skript-policy.js            статическая проверка кода модели (readonly/study/run)
  skript-contract.js          контракт __crawler и объявленные права
  skript-runner.js            исполнение кода в странице через CDP, лимиты, телеметрия
  skript-run.js               связка write/patch/run, карточка, «Работает/Не работает»
  skript-card.js              карточка скрипта (код, права, запуск, итог)
  skript-tools.js             определения инструментов и черновики задачи
  skript-eval.js              оценка результата по goal, журнал лучших запусков
  skript-path.js              «лестница путей» и проба каналов/состояния страницы
  skript-study.js             сессия /study: находки, бюджет, стратегия
  skript-store.js             библиотека скриптов (chrome.storage.local, SHA-256)
  skript-registry.js          подбор сохранённых скриптов под URL
  skript-library.js           UI библиотеки и предложение скриптов
  skript-builtin.js           встроенные навыки (Onshape)
  skript-onshape.js           FeatureScript через REST API Onshape
  skript-ui.js                меню «/», чип команды, полоска доступа
art/                          фон панели: WebGL-«мозг», анимации
docs/                         заметки, сайт, этот аудит
```

### Потоки данных

1. **Обычная задача.** `runTask()` в `sidepanel.js` → `page/content.js` (снимок DOM) →
   запрос к LLM (`callLLM` + `llm-retry.js`) → инструменты (`executeTool`) → снова снимок.
   Ввод, который сайт должен видеть как настоящий, идёт через CDP (`chrome.debugger`).
   Скриншоты — `captureVisibleTab`, при необходимости сжимаются в OffscreenCanvas.
2. **/skript.** Модель вызывает `write_script` → `skript-tools.js` (черновик, линт) →
   `skript-run.js` (пробный прогон, карточка, ожидание человека) → `skript-runner.js`
   (CDP `Runtime.evaluate` с обёрткой `__crawler`, мост `Runtime.addBinding`, лимиты,
   watchdog, телеметрия). Сохранение — `skript-store.js`, повторный запуск — `skript-library.js`.
3. **/study.** Обычный цикл агента с грантами /skript + `skript-study.js` (журнал находок,
   бюджет) и `skript-path.js` (выбор канала, проба состояния). Итог — черновик скила.
4. **Onshape.** Встроенный навык `skript-builtin.js` подмешивает инструменты
   `onshape_featurescript` / `featurescript_docs`; код FeatureScript исполняется в странице
   (`skriptOnshapeApply`), сеть — только проверенный код расширения.
5. **Обновления.** `updates.js` сравнивает manifest с GitHub; `self-update.js` по кнопке
   скачивает ZIP, распаковывает `DecompressionStream` и пишет файлы в выбранную папку.

### Тесты

`./test.sh` проверяет синтаксис всех `.js` и запускает `*/*.test.js` в Node (vm, фейковый DOM).
Тесты покрывают: извлечение товаров, агентскую логику, ретраи, вложения, тур, обновления,
политику /skript, гранты, контракт, оценку, библиотеку, реестр, раннер, склейку /skript,
хранилище, изучение, Onshape.

## 2. Найденные проблемы

Приоритет: **P0** — ломает сценарий/безопасность, **P1** — заметный баг/риск,
**P2** — неточность/производительность, **P3** — мелочь.

| ID | P | Где | Проблема | Статус |
|---|---|---|---|---|
| A1 | P1 | `panel/sidepanel.js` (`parseActions`) | В режиме «Команды в ответе» (локальные модели без function calling) список разрешённых имён строится только из базовых `TOOLS`. Инструменты `/skript` (`write_script`, `patch_script`, `run_script`, `screenshot_region`, `get_telemetry`, `stop_script`), `/study` и встроенные навыки (Onshape) молча отбрасываются. Сценарий `/skript` с локальной моделью фактически не работает. | исправляется |
| A2 | P1 | `panel/sidepanel.js` (фильтр `st.tools`) | В компактном режиме (авто для локальных моделей) фильтр `COMPACT_TOOLS` выкидывает инструменты `/skript` и `/study`: модель не может написать/запустить скрипт. Встроенные навыки добавляются после фильтра и выживают, скриптовые — нет. | исправляется |
| A3 | P1 (безопасность) | `skript/skript-policy.js` (`skriptStrip`) | Сканер литералов не разбирает `${…}` внутри шаблонных строк и регулярные выражения. `const x = \`${fetch("https://evil")}\`` и `const re = /["']/; fetch("/x")` проходят линт. | исправляется |
| A4 | P1 (безопасность) | `skript/skript-policy.js` (`R_NET`/`R_RUN`) | Обходы чёрного списка: `this["fetch"]`, `(function(){return this})()["fetch"]`, `Reflect.apply(fetch,…)`, `new Image().src = "https://…"`, `Object.assign(window, …)`. Остаточные DOM-векторы (`createElement("img")`, `innerHTML`, `insertAdjacentHTML`, `src=`) вынесены в A14. | исправляется |
| A5 | P1 (безопасность) | `skript/skript-mode.js` (`skriptGate`) | Грант `nav: same-origin` сравнивает только `hostname`, а не `origin`: переход с `https://shop.com` на `http://shop.com` или `https://shop.com:8443` разрешён. | исправляется |
| A6 | P1 | `panel/sidepanel.js` (`runTask`, смена вкладки) | При переключении на новую вкладку обновляется `st.tabId`, но не `st.windowId`. Скриншоты и `captureVisibleTab` продолжают смотреть в старое окно, если попап открылся в другом окне. | исправляется |
| A7 | P2 | `panel/sidepanel.js` (`executeTool`), `page/content.js` | `limit` для `query_dom`/`fetch_page` не ограничивается снизу: `Math.min(100, args.limit || 30)` при `limit=-5` даёт `-5`, а `slice(0, -5)` возвращает почти всё. | исправляется |
| A8 | P2 | `skript/skript-run.js` (`saveItem`/`execute`) | После «Сохранить для сайта» повторный запуск того же черновика теряет `savedId`: карточка снова предлагает «Сохранить для сайта», и сохранение создаёт дубль вместо обновления. | исправляется |
| A9 | P2 | `skript/skript-registry.js` (`match`) | `pathPrefix` сравнивается через `startsWith` без границы сегмента: скил для `/editor` подходит и к `/editorial`. В `sidepanel.js` (`skillPathMatches`) граница уже учитывается — поведение расходится. | исправляется |
| A10 | P2 | `skript/skript-run.js` (`execute`) | Если `run.run()` отклоняется (например, «Скрипт уже запущен»), `Promise.race` выбрасывает исключение до `clearInterval(timer)`/`removeAsk()`/`onScript(false)`: остаются живой интервал и флаг «скрипт работает». | исправляется |
| A11 | P2 | `panel/tour.js` (`drawLinks`) | `routes()` пересчитывается каждый кадр анимации: `document.querySelector`, `Range.getClientRects()` для каждой строки. На первом запуске тур может заметно нагружать панель. | исправляется |
| A12 | P2 | `page/extract-items.js` (`cards`) | Поиск карточек: `querySelectorAll('body *')` до 8000 элементов, для каждого — подъём на 9 предков и `[...parent.children]`. На больших страницах это лишняя работа в главном потоке. | исправляется |
| A13 | P2 | `page/tentacles.js` (`candidates`) | При постоянном режиме каждые ~260 мс заново сканируется большой CSS-селектор и вызывается `getBoundingClientRect()` для сотен элементов. Декоративная анимация может заметно нагружать страницу. | исправляется |
| A14 | P2 (безопасность) | `skript/skript-policy.js` | Политика — чёрный список. После A3/A4 запрещены `src=`/`innerHTML`/`insertAdjacentHTML`/`document.write`, но остаются `setAttribute("src", …)` (имя атрибута вырезается вместе со строкой) и CSS `url()`. Код исполняется в main world страницы, где может быть перехвачен. Политика — защита от случайных ошибок, а не граница безопасности. | частично |
| A15 | P2 | `panel/self-update.js` | Обновление перезаписывает файлы из ZIP, но не удаляет файлы, которых в новой версии нет. Старые файлы остаются в папке расширения. | исправляется |
| A16 | P3 | `panel/sidepanel.js` | `parseCssColor()` не используется (мёртвый код). | исправляется |
| A17 | P3 | `panel/sidepanel.js` (`loadSettings`) | `segSet('compactSeg', raw.compact)` при старом булевом значении не находит кнопку; `readSettings` спасает fallback `auto`, но состояние UI может выглядеть «ничего не выбрано». | исправляется |
| A18 | P3 | `skript/skript-store.js` (`_save`) | При обновлении записи без изменения кода обновляются только title/description/tags/enabled; `params`, `returns`, `risk`, `preconditions`, `scope` остаются старыми. | открыто |
| A19 | P3 | `panel/sidepanel.js` (`saveRating`, `addNote`) | Паттерн read-modify-write без очереди: параллельные сохранения могут затереть друг друга. Для рейтингов/заметок риск невелик. | исправляется |
| A20 | P3 | `skript/skript-runner.js` (`api.loop`) | `S.timers` пополняется идентификатором каждого тика и не чистится до `stopAll()`: за долгий запуск накапливаются десятки тысяч записей. | исправляется |

| A21 | P2 | `skript/skript-policy.js` (`R_RUN`) | Правило «самостоятельная навигация» срабатывало на любое `.top =`/`.parent =` — в том числе на `el.style.top = "10px"`; модель получала ложный отказ. | исправляется |

## 3. Что проверено и не вызвало нареканий

- `test.sh` проходит; синтаксис всех модулей корректен.
- `llm-retry.js`: повторы, `Retry-After`, отмена через `AbortSignal`.
- `updates.js`: сравнение версий, `repoOf`, кэш проверки.
- `self-update.js`: разбор ZIP (store/deflate), защита от `..`, проверка папки/манифеста.
- `extract-items.js`: цена/валюта, JSON-LD, microdata, карточки, сортировка и бюджет текста
  (тесты на реальных формах данных).
- `agent-loop.js`: снимки, сжатие истории, восстановление ссылок и списков.
- `skript-runner.js`: контракт `__crawler`, лимиты ввода, heartbeat, slow/stalled, pixels/grid.
- `skript-store.js`: валидация схемы, SHA-256, очередь транзакций, лимиты на origin.

## 4. Как проверялось

```sh
./test.sh
```

Дополнительно вручную проверялись сценарии линтера (`skript-policy.js`) на обходы:
шаблонные строки, регулярные выражения, `this[…]`, ссылки на `fetch` без вызова,
`new Image`, `createElement("img")`, `Object.assign(window, …)`.

## 5. Рекомендации по дальнейшей работе

1. Закрыть A11–A13 профилировкой: сначала измерить, потом кэшировать/семплировать.
2. Для A14 рассмотреть исполнение скриптов в изолированном мире с явным мостом к нужным
   глобальным объектам страницы, либо считать политику «защитой от случайных ошибок»,
   а не границей безопасности, и явно написать это в README.
3. Для A15 хранить список файлов прошлой версии и удалять лишние (осторожно, не трогая
   пользовательские файлы, если они появятся).
4. Добавлять тест на каждый живой баг: в проекте уже принят такой подход.
