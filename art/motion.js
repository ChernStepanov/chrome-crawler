// Motion-Luxe: премиальные микроанимации Chrome crawler.
// Полностью отделён от sidepanel.js — наблюдает за DOM, ничего не меняя в логике.
// При prefers-reduced-motion модуль не запускается: CSS сам показывает всё статично.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce()) return;
  const born = performance.now();                    // чтобы отличить восстановление палитры при открытии от реального детекта

  /* ---- 1. Каскадное появление сообщений (stagger) ---- */
  let burstAt = 0, step = 0;
  const enter = (el) => {
    const now = performance.now();
    step = (now - burstAt < 340) ? Math.min(step + 1, 6) : 0;
    burstAt = now;
    el.style.setProperty('--d', (step * 55) + 'ms');
    el.classList.add('enter');
    el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
  };
  for (const box of [$('#log'), $('#chatLog')]) {
    if (!box) continue;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        enter(n);
        if (n.classList?.contains('done')) succeed(n);
      }
    }).observe(box, { childList: true });
  }

  /* ---- 2. Успех: рисуемая галочка + всплеск акцентных частиц ---- */
  const OK = '<svg class="ok-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.6l5 5L19.5 7" pathLength="1"/></svg>';
  function succeed(msg) {
    msg.insertAdjacentHTML('afterbegin', OK);
    const dot = $('#statusTile'), host = $('.status');
    if (!dot || !host) return;
    const hr = host.getBoundingClientRect(), dr = dot.getBoundingClientRect();
    burst(host, dr.left + dr.width / 2 - hr.left, dr.top + dr.height / 2 - hr.top);
  }
  function burst(host, x, y) {
    const wrap = document.createElement('div');
    wrap.className = 'lux-burst';
    wrap.style.left = (x - 5) + 'px';
    wrap.style.top = (y - 5) + 'px';
    wrap.append(document.createElement('b'));                    // ореол
    for (let i = 0; i < 12; i++) {                               // частицы
      const a = (Math.PI * 2 * i) / 12 + (Math.random() - .5) * .5;
      const r = 15 + Math.random() * 15;
      const s = document.createElement('i');
      s.style.setProperty('--tx', (Math.cos(a) * r).toFixed(1) + 'px');
      s.style.setProperty('--ty', (Math.sin(a) * r).toFixed(1) + 'px');
      s.style.setProperty('--s', (2.5 + Math.random() * 2.5).toFixed(1) + 'px');
      s.style.setProperty('--dur', (640 + Math.random() * 320 | 0) + 'ms');
      s.style.animationDelay = (Math.random() * 90 | 0) + 'ms';
      wrap.append(s);
    }
    host.append(wrap);
    setTimeout(() => wrap.remove(), 1400);                       // страховка от зависания
  }

  /* ---- 3. Мягкая смена заголовка статуса — кроссфейд ---- */
  for (const id of ['heroTitle', 'heroSub']) {
    const el = document.getElementById(id);
    if (!el) continue;
    new MutationObserver(() => {
      el.classList.remove('swap');
      void el.offsetWidth;                                        // перезапуск анимации
      el.classList.add('swap');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  /* ---- 4. Детектор палитры сайта: акцентная волна в момент срабатывания ----
     sidepanel.js кладёт подобранный цвет в инлайн --acc на <html>. Ловим это
     событие и подтверждаем подбор мягкой волной из точки статуса + кольцом на ней.
     Палитра восстанавливается из хранилища при открытии — в первые 1.6 с волну не играем. */
  const root = document.documentElement;
  let lastAcc = root.style.getPropertyValue('--acc');
  function palWave() {
    const dot = $('#statusTile');
    if (dot) {                                        // кольцо акцентного цвета на точке статуса
      dot.classList.remove('pal-ring'); void dot.offsetWidth; dot.classList.add('pal-ring');
      setTimeout(() => dot.classList.remove('pal-ring'), 900);
    }
    const el = document.createElement('div');
    el.className = 'pal-wave';
    let x = 44, y = 44;
    if (dot) { const r = dot.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    el.style.setProperty('--x', x + 'px');
    el.style.setProperty('--y', y + 'px');
    document.body.append(el);                         // плавное акцентное затопление панели
    setTimeout(() => el.remove(), 1000);              // страховка от зависания
  }
  new MutationObserver(() => {
    const acc = root.style.getPropertyValue('--acc');
    if (acc === lastAcc) return;                      // цвет не менялся
    lastAcc = acc;
    if (!acc || root.dataset.accent !== 'auto') return;   // только авто-подбор под сайт
    if (performance.now() - born < 1600) return;          // открытие панели — не срабатывание детектора
    palWave();
  }).observe(root, { attributes: true, attributeFilter: ['style', 'data-accent'] });
})();
