// Точечный арт для фона чата. Сетка 245x140, 2 бита на ячейку (0 — пусто, 1–3 — плотность).
// Данные, форма и анимация находятся в одном файле; ART_DATA — упакованные уровни точек.
(() => {
const GW = 245, GH = 140;
const ART_DATA = "AAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAEAAAAAEAAAEAGRRBQEBEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAQAQJABUQAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAQAAAAAAAAAABEAAAAAAFBQAAAAAAAABEFVRBAQAQAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAEAAQAkFAEABAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAQAAAAAAAAAAAFAABAQIAABERUFABAEREAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAIAElgJAAQAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAEAAAAAAAQAQACEAAQBQQABAAAAACalGVRUQAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAQAQAAAAAAAAAAAEEBBoWgBAAQAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAQABIAAAAFAAAAAAAAAAAAAAAAUAARAWBpRwAVQUAAQgAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAQAAAAAAABKqtABQAABABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFQAAAAAAAAAAQEAAAUAAAAEAAAAAAQBQUAQABAUVjo9hQAVQEAQQEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAEAAAAAAAAAEAApVaBVBUAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAABAAAAABABEAAAAEBAAAQAAABEBUAEBAABQQOqvh0UVFAABAAAAAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAEAAAAAAAABBAISpmkIJVAEAAAAAAAEAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAFAAAEAQAAQEQAAAAAEEUAACJpZ9WFRRAEREBEAEBAAAQAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAEABAEBAkKl6ikEAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVQAAAAAEBAAAAAFAAAEAAAEAAABVAFFQSAlICq/k1FUVVUEAABAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAEEAAEABRQQEAQmf8GVQBUAAAAIAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABAAAAACAQAAAAAFAAAABABAgAAAABVAABgoJT6rwQUUAAAAAQAAAAAAABVAAAAAAAAAEAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAACAAQAEAAFEAQAEQQIqZ/bsWCAEAAAABAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQBABAQEQAAAQUBVARAQBAAQQAEAAQUUVACooOp/VkQUFEABAAAAAAABAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQAQAAAFAAAEIQCAAAAAAAAAQAERJm+f0UVAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAABEBARBRUBREBEQABERBQBVARRCSU/v4ZUlQAQBERABAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABFAAAAAAVAEVEAEQABERIAAABURQCv6vVgQAAEABAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAJRARAQAEAQBABEQEBAUARVBBEVWjtv0UERFABFAAAABAQABAAAABAAAAABAAAAAAAAAAAAAAAAAAAQAAAEAAAQAAEFAAAAAABARBAEABgJBFlvr9VVAREUQEAQAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAEABARAAABQkBQAARABEFCACVaFVfn7akpEQFUAAQEAAQABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAABQAAAAEBQEFUABEEZaZJQWn6/qpUZQAUAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAREQAAEFBQAEQAAERlAUVRVSVIUln5uu7lUZEQQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAQAQAAAAAgIQBBGUQGVEQVFBhAWZmadX/b1aZBUBBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQRAEAQAAABQBVUUlVVVWlCUUWVpVqp/6upSUVQQQEAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAQQEUCIBBUIVGBVRViVGpYmZlq/+rphYFVQUUAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBEUBAAFJAVFWlkVVVVmYZalnf+v1qmWVAQAAQQEAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAABAQVBgQJQkUVVmkJSiqZraHru//+vqlUBiAAUQEABAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAQAAEBEBQRJVVgVEpVVlVVZWqqqrqqv+/qppaAFAFUBAAFBAAAAAAAAAAAAAEAAAAAAAAAAAAAQAAABAAAAABUBAAAUVRWWVaaVlVlZq5alVW5////6taWgEGEQBEAEBAAAAAAAAEAAAAEAAAAAAAAAAAAAQAAAAAAABAAAAFRAAQBVlZ7qqWliWqppmW9uvv///+ZlRaFAAAABAAEBAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAEFBFAEBQ6qrqbqpaZa5apq2qv////1pkVVEAAARAAFFAAAQAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAEQEEVAaKq6quppqqqqnq/v////9aphYAFQVQAABEAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFGlAq7/ru6q/qeb/v////+/u1oVAABQUEBABAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABAAAAAAAAAABAUKVV66vqq7q66v//////v6u6GgEAABUABAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAAAABAAAEQBUnpj/r6/+v/7///////+/qyoYFFBVAAAAREQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQRUWV+f7+v//+////////v/qiFgUFAQAABAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAABAFAAIKjp/v////////////+rZxIAEAEUAABAAAAEAAAAAAAAAAAAAAAQAAEAAAAAAAAAAAAAAAAAAAABAABQVZWkrv7//////////////6VGVUBQAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAARUAFFxaqq//////////////9vngYQFQVVAQBAQAAEQAAEAAAAAAAAAAAAAQAAAEAAAAAAAAAAAAAAAAAAAEBRgFRKrv//////////////v2YlQABQAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAABAAVVBElKn+///////////////voAFFQFVAAACAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgECoqv7/////////////vxoAEAAAAAAAAAgAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAREAEUAEAkmmj6+/////////////8vJEIBBVAQAEAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFBICU2fv/////////////v2JAEVAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAEQAAUEAYlOn///////////////+vAgVVBRBAAEQAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQWYBW//7/////////////T6QAUBVAaQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAARAAAAAAAAAAAFAAgACohb7//////////////78RFQVVla8JAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQASIX6+//7////////////VwAQQJD/WgBAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAEBAAAQBQBBCE4P6v/v///////////28FUUBB/+9AAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAABAAAAAABVAABEVND/+/////////////6/ZgBFRf/vCwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAEAAABVAAQQDEu+rv///////////v/6sWkAX9/y4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABUQQRAQKqqqfv///////////5fkhIG/f/vAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAQAAAAAAEAFAAQAElIKpnqr++////////////29GFfX/7y4AAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBSGiNqur///////////9bRmTQ//+aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAEAAAAAQKDJv5v7////////////rwJQ1f//rwoEAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAUAAFQBBAOWm+u/7//////////78mVkX//68qAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAESIAJgqmpv+////////////aqFR/f//qgCACAAAAAAAAAEAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAABVAAgEC26+I+uf/////v7////6+rAPT/764qAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAVQAEUBqKmbWL7/////v7//////qhXg//++qgAAAAAABAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVAAAlNWejqvk//+///vvpvr//++6Vf///q5CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAQFAUWv3qpv3//6uv/qpq4f/6X6b9//+vKkQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARJAez+O6n6///r7a7ua7r/l++D/v///64EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAQECh+q9++///e7u+uqtm/m/ar9n///+uSkAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAECFBeq/v/n//69beq6aqvq/paVe/v///loABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEVEAUX5v/////+vqblRqlXqvxJY5ev///+vCwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUvkUBqL//v/+/u+mStWm67v6SEVrl////7loAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAABQUP+/SeT6+7///5Zq2VZbqVruGxVVVf7///+rRkAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAED//29F+vu/v///V2Raq1Wu/ksRAZTq////q2kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7f//a/n/////62ujW2lZpuqfUQBgpP7///+qAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALT5/7/+/////7+rrWq5qVr9K1UQAUD1////vx5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAFUUf//////////r5579aqq9W5RQRUAQP////+qBQUAAAAAAAAQAAAAAQAAAAAAAAAAAAAAAAAAAAAAAEAAAAn9//////////+/um6mma9vVAREEAD8////vyoUAAAAAAAAQAAAAAQAAAAAAAAAAAAAAAAQAAAAABAAAAAApOa/6///////q6q6pa6uv0FBEAQA4P////+6GgAAAAAAAAABAAAQAAAAAAAAAAAAAAAAQAAAAABAAAAAABCV/qr+//////+/+aqrvv8GVUFQAAD+/////msAAAAAAAAABAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAVPoW4f/////+76v1qv7+BkQRQQAA8P+///vuGgAAAAAQAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAURDlW0H5//////7+n9bv+xYAQEUAAID//////78AAABAQAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABVG4AUP7//////ruuvv9WAAAEQAEA/P+//6+6BQAAAAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFGlAhXp//////+uq+7/BgEBAARAAeD///+/+nYAAAAAQABAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAQQApQ6P3//////u+7/xsEAAAAABQAqf/////qAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAABRAAQGlRFD6//////////8bAAAAAAAUEOD6//+/rz4BAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQkQIFkf7/////////SlAAAAAAUAAA///77/p7CQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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AAAAiJqpKqmm6uYeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAARBRmaapVpVmZ1EAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFVVUpVapiVaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBRUVkRVZVWUQUAAAQBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABARERVRWRVVAUAQAZUBBABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAERVRYRVVAYAWEAFQBAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAEREVRRURAUAWUBABQEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFRAEAEBABRBACUFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEAEAABQAAFVSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAEAVFQBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAFAQAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAIEAJAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAFBAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAABAEQAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAFIQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCGEAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABFAQAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
const DURATION = 1200;
const EXTRA = 84;          // строк нашего арта над картинкой
const TH = GH + EXTRA;
const FIELD_W = 300, FIELD_H = 360;
const FIELD_X = 27, FIELD_Y = 68;

let cells = null;
let drawn = 0, startAt = 0, raf = 0, canvas = null, ctx = null, geo = null;
let mask = null, artColor = '';                  // маска цвета не знает — красим её в акцент на лету
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const noise = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };

function decode() {
  const bin = atob(ART_DATA), map = new Map();
  const put = (x, y, l) => {
    if (x < 0 || x >= GW || y < 0 || y >= TH) return;
    const k = y * GW + x;
    if ((map.get(k) || 0) < l) map.set(k, l);
  };
  // исходная картинка — смещена вниз на EXTRA строк
  for (let i = 0; i < GW * GH; i++) {
    const l = (bin.charCodeAt(i >> 2) >> ((i & 3) * 2)) & 3;
    if (l) put(i % GW, ((i / GW) | 0) + EXTRA, l);
  }
  // дорисовка сверху: блик — луч, продолжающий верхний «шип» картинки, лучики, ореол и звёздочка на конце
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const hz = (x, y) => { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); };   // детерминированный «шум»
  const FL = { x0: 137, k: 0.62, len: 58, overlap: 32 }; // луч заходит в редкий шип картинки и там затухает
  const flareT = new Map();                       // ячейка блика → доля пути 0..1 (чтобы блик «выстреливал» от картинки к кончику)
  const fput = (x, y, l, p) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= GW || y < 0 || y >= TH) return;
    put(x, y, l);
    if (y < EXTRA) flareT.set(y * GW + x, p);
  };
  const beamX = (t) => FL.x0 + FL.k * t;
  const cosA = 1 / Math.hypot(1, FL.k);
  const halfW = (u) => 0.6 + 3.2 * Math.pow(1 - u, 1.25);
  const sm = (v) => { v = Math.min(1, Math.max(0, v)); return v * v * (3 - 2 * v); };

  // главный луч заходит в картинку: её редкий шип переходит в ядро без пустой полосы
  for (let y = 0; y < EXTRA + FL.overlap; y++) {
    const t = EXTRA - 1 - y;
    if (t > FL.len) continue;
    const u = Math.max(0, t / FL.len), xc = beamX(t);
    const fade = t < 0 ? sm((FL.overlap + t) / 16) : 1;
    const hw = halfW(u) * (0.5 + 0.5 * fade);
    const b = (0.65 + 0.35 * sm(t / 16)) * (0.5 + 0.5 * Math.pow(1 - u, 0.6)) * fade;
    for (let x = Math.floor(xc - hw * 5); x <= Math.ceil(xc + hw * 5); x++) {
      const d = ((x - xc) * cosA) / hw;
      const f = (Math.exp(-d * d * 1.2) + Math.exp(-((d / 3) ** 2)) * 0.3) * b;
      if (f > bayer[(y & 3) * 4 + (x & 3)] / 16 * 0.7 + 0.06) fput(x, y, f > 0.6 ? 3 : f > 0.3 ? 2 : 1, u);
    }
    // Центр проходит через стык и постепенно растворяется в плотной части исходной картинки.
    if (fade > 0.3) fput(xc, y, t < 8 || t < 0 ? 2 : 3, u);
  }
  // кольцо-«призрак» вокруг точки на луче
  const ring = (cxr, cyr, r, lv, p, keep) => {
    for (let a = 0; a < 360; a += 3) {
      const rx = cxr + Math.cos(a * Math.PI / 180) * r, ry = cyr + Math.sin(a * Math.PI / 180) * r;
      if (bayer[(Math.round(ry) & 3) * 4 + (Math.round(rx) & 3)] < keep) fput(rx, ry, lv, p);
    }
  };
  ring(beamX(38), EXTRA - 1 - 38, 5, 2, 0.58, 10);
  ring(beamX(22), EXTRA - 1 - 22, 3, 1, 0.33, 9);

  // кончик: ореол, звёздочка и длинный горизонтальный блик, как у объектива
  const tx = Math.round(beamX(FL.len)), ty = EXTRA - 1 - FL.len;
  ring(tx, ty, 8, 1, 1, 9);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) fput(tx + dx, ty + dy, 3, 1);
  for (let k = 2; k <= 13; k++) {
    const lv = k <= 4 ? 3 : k <= 8 ? 2 : 1;
    fput(tx, ty - k, lv, 1); fput(tx, ty + k, lv, 1);
    if (k <= 4) for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) fput(tx + sx * k, ty + sy * k, k <= 2 ? 3 : 2, 1);
  }
  for (let k = 2; k <= 34; k++) {                      // горизонтальная полоса затухает пунктиром
    const f = 1 - k / 34, lv = f > 0.65 ? 3 : f > 0.3 ? 2 : 1;
    if (f < 0.6 && k % 2) continue;
    fput(tx - k, ty, lv, 1); fput(tx + k, ty, lv, 1);
  }
  // пыль и зеркальное продолжение редких точек у стыка (без зеркального «ромба» вокруг шипа)
  for (let y = 0; y < EXTRA; y++) {
    const t = EXTRA - 1 - y, xc = beamX(Math.min(t, FL.len));
    const seam = Math.max(0, (y - (EXTRA - 24)) / 23), blend = seam * seam * (3 - 2 * seam);
    for (let x = 0; x < GW; x++) {
      const far = Math.abs(x - xc) > 12 + (t < FL.len ? halfW(t / FL.len) * 2 : 0);
      if (far && Math.random() < blend) {
        const i = (EXTRA - 1 - y) * GW + x;
        if (((bin.charCodeAt(i >> 2) >> ((i & 3) * 2)) & 3) === 1) { put(x, y, 1); continue; }
      }
      if (far && Math.random() < 0.012) put(x, y, Math.random() < 0.3 ? 2 : 1);
    }
  }
  for (const [sx, sy, arm] of [[46, 14, 2], [206, 30, 1], [86, 54, 2], [228, 66, 1]]) {
    put(sx, sy, 3);
    for (let k = 1; k <= arm; k++) for (const [dx, dy] of [[k, 0], [-k, 0], [0, k], [0, -k]]) put(sx + dx, sy + dy, k === 1 ? 3 : 2);
  }
  // Разреженный нижний левый угол картинки продолжаем тем же точечным звёздным полем.
  for (let y = EXTRA + 48; y < TH; y++) for (let x = 0; x < 90; x++) {
    const fade = sm((y - EXTRA - 48) / 24) * sm((90 - x) / 24);
    if (!map.has(y * GW + x) && noise(x, y) < 0.025 * fade) {
      const bright = noise(x + 37, y + 41);
      put(x, y, bright > 0.97 ? 3 : bright > 0.7 ? 2 : 1);
    }
  }
  const out = [];
  for (const [k, l] of map) out.push({ x: k % GW, y: (k / GW) | 0, l, t: 0 });
  // Вспышка в точке стыка: картинка раскрывается радиально, луч уходит к звезде.
  for (const c of out) {
    const p = flareT.get(c.y * GW + c.x);
    c.t = p === undefined
      ? Math.min(0.57, Math.hypot((c.x - 137) * 0.8, (c.y - EXTRA) * 0.75) / 260) + hz(c.x, c.y) * 0.07
      : 0.08 + p * 0.49 + hz(c.x, c.y) * 0.04;
  }
  // Единое поле: точки исходной картинки и звёзды фона живут в одной сетке.
  // Заполняем пустоты по всему полю, в том числе внутри границ исходника:
  // иначе на стыке двух областей остаётся заметная прямоугольная граница.
  for (const c of out) { c.x += FIELD_X; c.y += FIELD_Y; }
  const occupied = new Set(out.map(c => c.y * FIELD_W + c.x));
  const maxRadius = Math.max(...[
    [0, 0], [FIELD_W, 0], [0, FIELD_H], [FIELD_W, FIELD_H]
  ].map(([x, y]) => Math.hypot((x - FIELD_X - 137) * 0.8, (y - FIELD_Y - EXTRA) * 0.75)));
  for (let y = 0; y < FIELD_H; y++) for (let x = 0; x < FIELD_W; x++) {
    if (occupied.has(y * FIELD_W + x)) continue;
    const gx = x - FIELD_X, gy = y - FIELD_Y;
    if (noise(gx, gy) >= 0.025) continue;
    const bright = noise(gx + 37, gy + 41);
    const radius = Math.hypot((gx - 137) * 0.8, (gy - EXTRA) * 0.75);
    out.push({ x, y, l: bright > 0.97 ? 3 : bright > 0.7 ? 2 : 1,
      t: Math.min(0.96, radius / maxRadius * 0.9 + noise(gx + 11, gy + 23) * 0.035), cross: bright > 0.995 });
  }
  out.sort((p, q) => p.t - q.t);
  return out;
}

function layout() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const width = Math.max(1, Math.round(r.width * dpr)), height = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width === width && canvas.height === height && geo) return;
  canvas.width = width;
  canvas.height = height;
  // Масштабируем одно готовое изображение целиком; избыток по краям обрезается контейнером.
  const scale = Math.max(width / FIELD_W, height / FIELD_H) * 1.2 / 0.9;   // на 10% меньше клеток на экране — точки крупнее
  geo = { scale, dot: scale, ox: (width - FIELD_W * scale) / 2, oy: (height - FIELD_H * scale) / 2 };
  const p = reduce() || !raf ? 1 : Math.min(1, (performance.now() - startAt) / DURATION);
  drawn = 0;
  while (drawn < cells.length && cells[drawn].t <= p) drawn++;
}

const color = () => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#fff';

function drawRange(from, to, target = ctx, geometry = geo, accent = color()) {
  const s = geometry.dot, size = [0, 0.34, 0.5, 0.66];
  target.fillStyle = accent;
  for (let i = from; i < to; i++) {
    const c = cells[i], d = s * size[c.l];
    target.globalAlpha = c.l === 1 ? 0.85 : c.l === 2 ? 0.95 : 1;
    target.fillRect(geometry.ox + c.x * s + (s - d) / 2, geometry.oy + c.y * s + (s - d) / 2, d, d);
    if (c.cross) {
      const x = geometry.ox + (c.x + 0.5) * s, y = geometry.oy + (c.y + 0.5) * s;
      target.globalAlpha = 0.45;
      target.fillRect(x - s * 1.5, y - d * 0.15, s * 3, d * 0.3);
      target.fillRect(x - d * 0.15, y - s * 1.5, d * 0.3, s * 3);
    }
  }
  target.globalAlpha = 1;
}

// Композиция один раз рисуется белым по прозрачному в высоком разрешении —
// плотность точек уже хранится в альфе, поэтому смену цвета даёт один fillRect.
function buildMask() {
  mask ||= document.createElement('canvas');
  const resolution = 4;
  mask.width = FIELD_W * resolution;
  mask.height = FIELD_H * resolution;
  drawRange(0, cells.length, mask.getContext('2d'), { dot: resolution, ox: 0, oy: 0 }, '#fff');
}

function drawImage(accent) {
  accent ||= color();
  if (!mask) buildMask();
  ctx.drawImage(mask, geo.ox, geo.oy, FIELD_W * geo.scale, FIELD_H * geo.scale);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';      // красим только точки, не трогая прозрачный фон
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  artColor = accent;
}

// Палитра перетекает за 420 мс (CSS transition на --acc): пока идёт переход,
// canvas перерисовывается каждым кадром, следуя за вычисляемым цветом.
let flowRaf = 0;
function flow() {
  if (!canvas || !cells) return;
  cancelAnimationFrame(flowRaf);
  const t0 = performance.now();
  const step = () => {
    if (!raf && color() !== artColor) drawFrame(1);   // drawFrame сам чистит canvas; во время волны арт не трогаем
    if (performance.now() - t0 < 1000) flowRaf = requestAnimationFrame(step);   // 420 мс переход + запас
  };
  flowRaf = requestAnimationFrame(step);
}

// Точки резко вспыхивают чуть крупнее обычного и быстро оседают на место.
function drawEmerging(progress, from) {
  const s = geo.dot, size = [0, 0.34, 0.5, 0.66];
  const accent = color();
  for (let i = from; i < drawn; i++) {
    const c = cells[i], phase = Math.min(1, Math.max(0, (progress - c.t) / 0.12));
    const pop = Math.sin(Math.PI * phase), x = geo.ox + (c.x + 0.5) * s, y = geo.oy + (c.y + 0.5) * s;
    const d = s * size[c.l] * (1 + pop * 0.95);
    ctx.fillStyle = accent;
    ctx.globalAlpha = pop * (c.l === 1 ? 0.23 : 0.35);
    ctx.fillRect(x - d, y - d, d * 2, d * 2);
    ctx.globalAlpha = (c.l === 1 ? 0.85 : c.l === 2 ? 0.95 : 1) * Math.min(1, phase * 8);
    ctx.fillRect(x - d / 2, y - d / 2, d, d);
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = pop * (c.l === 1 ? 0.28 : 0.65);
    ctx.fillRect(x - d * 0.23, y - d * 0.23, d * 0.46, d * 0.46);
  }
  ctx.globalAlpha = 1;
}

function drawFrame(progress) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (progress >= 1 || reduce()) { drawImage(); return; }
  let settled = drawn;
  while (settled > 0 && cells[settled - 1].t > progress - 0.12) settled--;
  drawRange(0, settled);
  drawEmerging(progress, settled);
}

function redraw() {
  if (!canvas || !cells) return;
  layout();
  const p = Math.min(1, (performance.now() - startAt) / DURATION);
  drawFrame(raf ? p : 1);
}

function tick(now) {
  const p = Math.min(1, (now - startAt) / DURATION);
  let n = drawn;
  while (n < cells.length && cells[n].t <= p) n++;
  drawn = n;
  drawFrame(p);
  if (p < 1) raf = requestAnimationFrame(tick);
  else raf = 0;
}

function play() {
  if (!canvas) return;
  cancelAnimationFrame(raf);
  drawn = 0;
  layout();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (reduce()) { drawn = cells.length; drawFrame(1); return; }
  startAt = performance.now();
  raf = requestAnimationFrame(tick);
}

function init(el) {
  canvas = el; ctx = canvas.getContext('2d');
  cells = decode();
  new ResizeObserver(() => redraw()).observe(canvas);
  play();
}

window.CrawlerArt = { init, play, redraw, flow };
})();
