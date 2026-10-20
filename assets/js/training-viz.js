/*
  Training diagrams
  - [data-tr-network]:    a 2-4-4-1 network learns two classes of points, with its loss after each step
  - [data-tr-activation]: fit a curve with a small network, with and without an activation function
  - [data-tr-gradient]:   the slope of the loss for one weight of the line model
  - [data-tr-optim]:      SGD, momentum and Adam on a 2D loss surface
  - [data-tr-schedule]:   warmup and cosine decay of the learning rate
  - [data-tr-batch]:      the input and the target of one training example
  Loaded on demand by interactive.js. The styles are in transformer.css and training.css.
*/

const SVG_NS = 'http://www.w3.org/2000/svg';

function setAttrs(node, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
}

function fill(node, children) {
  for (const ch of Array.isArray(children) ? children : [children]) {
    if (ch == null || ch === false) continue;
    node.appendChild(typeof ch === 'string' || typeof ch === 'number' ? document.createTextNode(String(ch)) : ch);
  }
  return node;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  return fill(node, children);
}

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  setAttrs(node, attrs);
  return fill(node, children);
}

// "-0.50" becomes "−0.50", and "-0.00" becomes "0.00".
function fmt(x, digits = 2) {
  const s = x.toFixed(digits);
  return (Number(s) === 0 ? (0).toFixed(digits) : s).replace('-', '−');
}

const pct = (p, digits = 1) => `${(p * 100).toFixed(digits)}%`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Abramowitz and Stegun 7.1.26, good to about 1e-7.
function erf(x) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

const ACT = {
  none: (z) => z,
  relu: (z) => Math.max(0, z),
  gelu: (z) => 0.5 * z * (1 + erf(z / Math.SQRT2)),
  silu: (z) => z * sigmoid(z),
};

function softmax(xs) {
  const max = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// A row of buttons where one button is selected.
function makeSeg(labels, onPick) {
  const buttons = labels.map((label, i) => el('button', { type: 'button', onclick: () => onPick(i) }, label));
  return {
    root: el('div', { class: 'ia-tf-seg', role: 'group' }, buttons),
    buttons,
    select(i) {
      buttons.forEach((b, j) => b.setAttribute('aria-pressed', i === j ? 'true' : 'false'));
    },
  };
}

// A labelled range input. With `log`, the input moves along a log scale.
function makeSlider({ label, min, max, value, step = 'any', log = false, format = (v) => fmt(v), onInput }) {
  const toPos = (v) => (log ? Math.log(v) : v);
  const fromPos = (p) => (log ? Math.exp(p) : p);
  const input = el('input', { type: 'range', min: toPos(min), max: toPos(max), step, value: toPos(value), 'aria-label': label });
  const out = el('b', { class: 'ia-tf-num ia-tr-out' });
  const s = {
    root: el('label', { class: 'ia-tr-slider' }, [el('span', { class: 'ia-anim__label' }, label), input, out]),
    get value() { return fromPos(Number(input.value)); },
    set(v) {
      input.value = toPos(v);
      out.textContent = format(v);
    },
  };
  input.addEventListener('input', () => {
    out.textContent = format(s.value);
    onInput(s.value);
  });
  out.textContent = format(value);
  return s;
}

function caption() {
  return el('p', { class: 'ia-anim__caption ia-tf-caption', 'aria-live': 'polite' });
}

// Map data coordinates to an SVG box with margins.
function frame(W, H, [x0, x1], [y0, y1], m = { l: 36, r: 12, t: 12, b: 26 }) {
  return {
    W, H, x0, x1, y0, y1, m,
    px: (x) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r),
    py: (y) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b),
  };
}

const pathOf = (f, pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f.px(x).toFixed(1)},${f.py(y).toFixed(1)}`).join('');

function axes(f, { xLabel = '', yLabel = '', xZero = true, yZero = true } = {}) {
  const g = svg('g');
  if (yZero && f.y0 <= 0 && f.y1 >= 0) g.append(svg('line', { class: 'ia-tf-zero', x1: f.px(f.x0), x2: f.px(f.x1), y1: f.py(0), y2: f.py(0) }));
  if (xZero && f.x0 <= 0 && f.x1 >= 0) g.append(svg('line', { class: 'ia-tf-zero', x1: f.px(0), x2: f.px(0), y1: f.py(f.y0), y2: f.py(f.y1) }));
  if (xLabel) g.append(svg('text', { class: 'ia-tf-guide-label', x: f.px(f.x1), y: f.H - 6, 'text-anchor': 'end' }, xLabel));
  if (yLabel) g.append(svg('text', { class: 'ia-tf-guide-label', x: f.m.l - 6, y: f.m.t + 4, 'text-anchor': 'end' }, yLabel));
  return g;
}

// Solve A x = b with Gaussian elimination and partial pivoting.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / d;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

/* -----------------------------
 * A small network
 * -----------------------------
   Two inputs, two layers of four ReLU units and one output, trained with SGD on
   batches of 10 points. The points inside the circle are one class, and the
   points around it are the other. The two classes overlap near the edge, so no
   boundary gets all the points right. The output is the logit of the inner class.
*/
const NET_SIZES = [2, 4, 4, 1];

function buildNetwork(root) {
  const LR = 0.1;
  const BATCH = 10;
  const MAX_STEPS = 1500;
  const STEPS_PER_FRAME = 3;
  const R = 3;
  const G = 36;
  const last = NET_SIZES.length - 2;
  const data = (() => {
    const r = seeded(5);
    return Array.from({ length: 120 }, (_, i) => {
      const inner = i % 2 === 0;
      const rad = inner ? 1.8 * Math.sqrt(r()) : 1.4 + 1.5 * r();
      const a = 2 * Math.PI * r();
      return [rad * Math.cos(a), rad * Math.sin(a), inner ? 1 : 0];
    });
  })();

  let layers;
  let pick;
  let steps;
  let history;
  let raf = null;
  // One step, part by part.
  const STAGES = ['Forward', 'Loss', 'Backward', 'Optimizer'];
  let stage = -1;
  let walk = null;
  let batch = null;
  let grads = null;

  function init() {
    const r = seeded(3);
    layers = NET_SIZES.slice(1).map((n, k) => ({
      W: Array.from({ length: n }, () => Array.from({ length: NET_SIZES[k] }, () => gauss(r) * Math.sqrt(2 / NET_SIZES[k]))),
      b: new Array(n).fill(0.1),
    }));
    pick = seeded(11);
    steps = 0;
    history = [avgLoss()];
  }

  // The activations of each layer, from the input to the logit.
  function forward(x) {
    const as = [x];
    let a = x;
    layers.forEach((l, k) => {
      const z = l.W.map((row, i) => row.reduce((s, w, j) => s + w * a[j], l.b[i]));
      a = k < last ? z.map((v) => Math.max(0, v)) : z;
      as.push(a);
    });
    return as;
  }
  const logit = (x0, x1) => forward([x0, x1])[last + 1][0];
  // Cross-entropy from the logit: log(1 + e^z) − y·z.
  const softplus = (z) => Math.max(z, 0) + Math.log1p(Math.exp(-Math.abs(z)));
  const avgLoss = () => data.reduce((s, [x0, x1, y]) => { const z = logit(x0, x1); return s + softplus(z) - y * z; }, 0) / data.length;
  const accuracy = () => data.filter(([x0, x1, y]) => (logit(x0, x1) > 0) === (y === 1)).length / data.length;

  const sampleBatch = () => Array.from({ length: BATCH }, () => data[Math.floor(pick() * data.length)]);
  const batchLoss = (pts) => pts.reduce((s, [x0, x1, y]) => { const z = logit(x0, x1); return s + softplus(z) - y * z; }, 0) / pts.length;

  // Forward and backward for each point of the batch, with the gradients added up.
  function gradients(pts) {
    const g = layers.map((l) => ({ W: l.W.map((row) => row.map(() => 0)), b: l.b.map(() => 0) }));
    for (const [x0, x1, y] of pts) {
      const as = forward([x0, x1]);
      let d = [(sigmoid(as[last + 1][0]) - y) / BATCH];
      for (let k = last; k >= 0; k--) {
        const a = as[k];
        d.forEach((di, i) => {
          g[k].b[i] += di;
          a.forEach((aj, j) => { g[k].W[i][j] += di * aj; });
        });
        if (k > 0) d = a.map((aj, j) => (aj > 0 ? d.reduce((s, di, i) => s + di * layers[k].W[i][j], 0) : 0));
      }
    }
    return g;
  }

  function update(g) {
    layers.forEach((l, k) => {
      l.W.forEach((row, i) => row.forEach((w, j) => { row[j] = w - LR * g[k].W[i][j]; }));
      l.b.forEach((b, i) => { l.b[i] = b - LR * g[k].b[i]; });
    });
    steps += 1;
    history.push(avgLoss());
  }

  const step = () => update(gradients(sampleBatch()));

  /* The network. Each line is a weight, and its color and width show the sign and the size. */
  const NW = 300;
  const NH = 300;
  const colX = NET_SIZES.map((_, c) => 28 + (c * (NW - 56)) / (NET_SIZES.length - 1));
  const unitY = (c, i) => (NH - 24) / 2 + (i - (NET_SIZES[c] - 1) / 2) * 62;
  const wires = NET_SIZES.slice(1).map((n, k) => Array.from({ length: n }, (_, i) => Array.from({ length: NET_SIZES[k] }, (_, j) => (
    svg('line', { class: 'ia-tr-wire', x1: colX[k], y1: unitY(k, j), x2: colX[k + 1], y2: unitY(k + 1, i) })
  ))));
  const unitName = (c, i) => (c === 0 ? `x${'₁₂'[i]}` : c === NET_SIZES.length - 1 ? 'p' : '');
  const net = svg('svg', { viewBox: `0 0 ${NW} ${NH}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'The network: two inputs, two layers of four ReLU units and one output' }, [
    svg('g', {}, wires.flat(2)),
    ...NET_SIZES.flatMap((n, c) => Array.from({ length: n }, (_, i) => svg('g', {}, [
      svg('circle', { class: 'ia-tr-unit', cx: colX[c], cy: unitY(c, i), r: 13 }),
      svg('text', { class: 'ia-tr-unit__name', x: colX[c], y: unitY(c, i) + 4, 'text-anchor': 'middle' }, unitName(c, i)),
    ]))),
    ...['input', 'ReLU', 'ReLU', 'output'].map((t, c) => svg('text', { class: 'ia-tf-guide-label', x: colX[c], y: NH - 8, 'text-anchor': 'middle' }, t)),
  ]);

  /* The plane: the output of the network as shading, the boundary and the points. */
  const F = frame(360, 360, [-R, R], [-R, R], { l: 8, r: 8, t: 8, b: 8 });
  const gx = (i) => F.px(-R + (2 * R * i) / G);
  const gy = (j) => F.py(-R + (2 * R * j) / G);
  // The shading is a small canvas, one pixel for each corner of the grid, that the
  // browser scales up smoothly.
  const canvas = document.createElement('canvas');
  canvas.width = G + 1;
  canvas.height = G + 1;
  const ctx = canvas.getContext('2d');
  const shade = svg('image', { x: gx(-0.5), y: gy(G + 0.5), width: gx(G + 0.5) - gx(-0.5), height: gy(-0.5) - gy(G + 0.5), preserveAspectRatio: 'none' });
  const rgb = (name) => {
    ctx.fillStyle = getComputedStyle(root).getPropertyValue(name).trim() || '#888';
    const hex = ctx.fillStyle;
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  };
  const edge = svg('path', { class: 'ia-tr-boundary' });
  const rings = svg('g');
  const plane = svg('svg', { viewBox: `0 0 ${F.W} ${F.H}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'Points of two classes, and the region that the network gives to each class' }, [
    svg('clipPath', { id: 'ia-tr-net-clip' }, [svg('rect', { x: gx(0), y: gy(G), width: gx(G) - gx(0), height: gy(0) - gy(G) })]),
    svg('g', { 'clip-path': 'url(#ia-tr-net-clip)' }, [shade]),
    edge,
    ...data.map(([x0, x1, y]) => svg('circle', { class: `ia-tr-dot ${y ? 'is-pos' : 'is-neg'}`, cx: F.px(x0), cy: F.py(x1), r: 3.6 })),
    rings,
  ]);

  /* The loss after each step. */
  const Q = frame(560, 130, [0, MAX_STEPS], [0, 1], { l: 30, r: 8, t: 10, b: 22 });
  const rawPath = svg('path', { class: 'ia-tr-raw' });
  const lossPath = svg('path', { class: 'ia-tf-plot__curve' });
  const qTop = svg('text', { class: 'ia-tf-guide-label', x: Q.m.l - 4, y: Q.py(1) + 4, 'text-anchor': 'end' });
  const lossPlot = svg('svg', { viewBox: `0 0 ${Q.W} ${Q.H}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'The average loss after each step' }, [
    axes(Q, { xLabel: 'step' }),
    qTop,
    svg('text', { class: 'ia-tf-guide-label', x: Q.m.l - 4, y: Q.py(0) + 4, 'text-anchor': 'end' }, '0'),
    rawPath,
    lossPath,
  ]);
  const lossOut = el('b', { class: 'ia-tf-num' });
  const accOut = el('b', { class: 'ia-tf-num' });
  const stepsOut = el('b', { class: 'ia-tf-num' });
  const stat = (label, out) => el('div', { class: 'ia-tr-net__stat' }, [el('span', { class: 'ia-anim__label' }, label), out]);

  const chips = STAGES.map((t, i) => el('span', { class: 'ia-tr-stage' }, `${i + 1}. ${t}`));
  const cap = caption();
  const stepBtn = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => stepByStage() }, 'Step');
  const playBtn = el('button', { type: 'button', class: 'ia-tf-btn is-primary', onclick: () => (raf ? stop() : play()) }, 'Train');
  const resetBtn = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => { stop(); init(); draw(); } }, 'Reset');

  root.replaceChildren(
    el('div', { class: 'ia-tf-toolbar' }, [el('div', { class: 'ia-tr-stages' }, chips), el('span', { class: 'ia-tf-spacer' }), stepBtn, playBtn, resetBtn]),
    el('div', { class: 'ia-tr-net__cols' }, [net, plane]),
    cap,
    el('div', { class: 'ia-tr-net__loss' }, [
      el('div', { class: 'ia-tr-net__stats' }, [stat('Step', stepsOut), stat('Loss', lossOut), stat('Accuracy', accOut)]),
      lossPlot,
    ]),
  );

  function play() {
    stop();
    if (steps >= MAX_STEPS) init();
    playBtn.textContent = 'Pause';
    playBtn.setAttribute('aria-pressed', 'true');
    const tick = () => {
      for (let n = 0; n < STEPS_PER_FRAME && steps < MAX_STEPS; n++) step();
      draw();
      raf = steps < MAX_STEPS ? requestAnimationFrame(tick) : (stop(), null);
    };
    raf = requestAnimationFrame(tick);
  }

  function stepByStage() {
    if (walk) return;
    stop();
    if (steps >= MAX_STEPS) init();
    batch = sampleBatch();
    const run = (s) => {
      if (s === STAGES.length) {
        walk = null;
        stop();
        draw();
        return;
      }
      stage = s;
      if (s === 2) grads = gradients(batch);
      if (s === 3) update(grads);
      draw();
      walk = setTimeout(() => run(s + 1), 1200);
    };
    run(0);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (walk) clearTimeout(walk);
    walk = null;
    stage = -1;
    batch = null;
    grads = null;
    playBtn.textContent = steps >= MAX_STEPS ? 'Train again' : 'Train';
    playBtn.setAttribute('aria-pressed', 'false');
  }

  function draw() {
    chips.forEach((c, i) => c.classList.toggle('is-on', i === stage));

    // The lines show the weights, and in the backward part, the gradients.
    const showGrads = stage === 2;
    const gMax = showGrads ? Math.max(1e-9, ...grads.flatMap((g) => g.W.flat().map(Math.abs))) : 1;
    layers.forEach((l, k) => l.W.forEach((row, i) => row.forEach((w, j) => {
      const v = showGrads ? grads[k].W[i][j] : w;
      const width = showGrads ? 0.6 + (4.4 * Math.abs(v)) / gMax : 0.6 + Math.min(Math.abs(v) * 1.5, 5);
      const wire = wires[k][i][j];
      wire.style.stroke = v >= 0 ? 'var(--tf-pos)' : 'var(--tf-neg)';
      wire.style.strokeWidth = width.toFixed(2);
      wire.classList.toggle('is-fwd', stage === 0);
      wire.classList.toggle('is-bwd', stage === 2);
    })));

    rings.replaceChildren(...(batch ? batch.map(([x0, x1]) => svg('circle', { class: 'ia-tr-ring', cx: F.px(x0), cy: F.py(x1), r: 7 })) : []));
    cap.textContent = [
      `Forward. The network computes p for a batch of ${BATCH} points, marked with rings.`,
      stage === 1 && `Loss. The average loss on the batch is ${fmt(batchLoss(batch), 3)}.`,
      'Backward. Backpropagation finds the gradient of the loss for each weight, and the lines now show the gradients.',
      `Optimizer. Each weight moves a small step against its gradient, with η = ${LR}, and the boundary moves with the weights.`,
    ][stage] ?? '';

    // The logit at each corner of the grid.
    const v = Array.from({ length: G + 1 }, (_, i) => Array.from({ length: G + 1 }, (_, j) => logit(-R + (2 * R * i) / G, -R + (2 * R * j) / G)));
    const pos = rgb('--tf-pos');
    const neg = rgb('--tf-neg');
    const img = ctx.createImageData(G + 1, G + 1);
    for (let i = 0; i <= G; i++) {
      for (let j = 0; j <= G; j++) {
        const p = sigmoid(v[i][j]);
        const o = 4 * ((G - j) * (G + 1) + i);
        img.data.set([...(p > 0.5 ? pos : neg), Math.round(255 * (0.08 + 0.32 * Math.abs(2 * p - 1)))], o);
      }
    }
    ctx.putImageData(img, 0, 0);
    shade.setAttribute('href', canvas.toDataURL());

    // The boundary, where the logit is 0, by marching squares.
    const cross = (i0, j0, i1, j1) => {
      const s = v[i0][j0] / (v[i0][j0] - v[i1][j1]);
      return `${F.px(-R + (2 * R * (i0 + s * (i1 - i0))) / G).toFixed(1)},${F.py(-R + (2 * R * (j0 + s * (j1 - j0))) / G).toFixed(1)}`;
    };
    let d = '';
    for (let i = 0; i < G; i++) {
      for (let j = 0; j < G; j++) {
        const hits = [[i, j, i + 1, j], [i + 1, j, i + 1, j + 1], [i, j + 1, i + 1, j + 1], [i, j, i, j + 1]]
          .filter(([a, b, c, e]) => (v[a][b] > 0) !== (v[c][e] > 0))
          .map((e) => cross(...e));
        for (let h = 0; h + 1 < hits.length; h += 2) d += `M${hits[h]}L${hits[h + 1]}`;
      }
    }
    edge.setAttribute('d', d);

    const top = Math.max(...history);
    qTop.textContent = fmt(top, 1);
    rawPath.setAttribute('d', pathOf(Q, history.map((l, i) => [i, l / top])));
    // The bold line is a moving average, as training plots usually show.
    let avg = history[0];
    lossPath.setAttribute('d', pathOf(Q, history.map((l, i) => { avg = 0.95 * avg + 0.05 * l; return [i, avg / top]; })));
    stepsOut.textContent = String(steps);
    lossOut.textContent = fmt(history[history.length - 1], 3);
    accOut.textContent = pct(accuracy(), 0);
  }

  init();
  draw();
}

/* -----------------------------
 * Activation functions
 * -----------------------------
   A network with one hidden layer of n units fits the points. Each unit gets the
   input, shifted to its own center and sometimes mirrored, and passes it through
   the activation. The output weights are the best fit (least squares), so the
   curve is the best that n units of that kind can do.
*/
function buildActivation(root) {
  const target = (x) => Math.sin(1.6 * x) + 0.35 * x;
  const pts = Array.from({ length: 31 }, (_, i) => {
    const x = -3 + (6 * i) / 30;
    return [x, target(x)];
  });
  const kinds = ['none', 'relu', 'gelu', 'silu'];
  const names = ['None', 'ReLU', 'GELU', 'SiLU'];
  let kind = 1;
  let units = 4;

  const unitsOf = (n) => Array.from({ length: n }, (_, k) => ({ c: -3 + (6 * (k + 0.5)) / n, dir: k % 2 ? -1 : 1 }));
  const S = 2.2;
  const feature = (u, x, act) => act(S * u.dir * (x - u.c)) / S;

  function fit(n, act) {
    const us = unitsOf(n);
    const row = (x) => [1, ...us.map((u) => feature(u, x, act))];
    const m = n + 1;
    const A = Array.from({ length: m }, () => new Array(m).fill(0));
    const b = new Array(m).fill(0);
    for (const [x, y] of pts) {
      const r = row(x);
      for (let i = 0; i < m; i++) {
        b[i] += r[i] * y;
        for (let j = 0; j < m; j++) A[i][j] += r[i] * r[j];
      }
    }
    for (let i = 1; i < m; i++) A[i][i] += 1e-6;
    const w = solve(A, b);
    const f = (x) => row(x).reduce((s, v, i) => s + v * w[i], 0);
    const mse = pts.reduce((s, [x, y]) => s + (f(x) - y) ** 2, 0) / pts.length;
    return { f, mse, us };
  }

  const F = frame(520, 250, [-3.2, 3.2], [-2.6, 2.6]);
  const curve = svg('path', { class: 'ia-tr-fit' });
  const bends = svg('g');
  const dots = svg('g', {}, pts.map(([x, y]) => svg('circle', { class: 'ia-tr-point', cx: F.px(x), cy: F.py(y), r: 3.2 })));
  const plot = svg('svg', { viewBox: `0 0 ${F.W} ${F.H}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'A network fits a curve to the points' }, [
    axes(F, { xLabel: 'x', yLabel: 'y' }), dots, curve, bends,
  ]);

  const G = frame(150, 110, [-3, 3], [-1, 3], { l: 8, r: 8, t: 8, b: 8 });
  const actCurve = svg('path', { class: 'ia-tr-act' });
  const inset = svg('svg', { viewBox: `0 0 ${G.W} ${G.H}`, class: 'ia-tr-inset', role: 'img', 'aria-label': 'The activation function' }, [axes(G), actCurve]);
  const insetName = el('span', { class: 'ia-anim__label' });

  const seg = makeSeg(names, (i) => { kind = i; draw(); });
  const slider = makeSlider({ label: 'Units', min: 1, max: 12, step: 1, value: units, format: (v) => String(Math.round(v)), onInput: (v) => { units = Math.round(v); draw(); } });
  const err = el('b', { class: 'ia-tf-num' });
  const cap = caption();

  root.replaceChildren(
    el('div', { class: 'ia-tf-toolbar' }, [el('span', { class: 'ia-anim__label' }, 'Activation'), seg.root, slider.root]),
    el('div', { class: 'ia-tr-act__wrap' }, [
      plot,
      el('div', { class: 'ia-tr-act__side' }, [
        el('div', { class: 'ia-tr-act__fn' }, [insetName, inset]),
        el('div', { class: 'ia-tr-act__err' }, [el('span', { class: 'ia-anim__label' }, 'Mean squared error'), err]),
      ]),
    ]),
    cap,
  );

  function draw() {
    seg.select(kind);
    const act = ACT[kinds[kind]];
    const { f, mse, us } = fit(units, act);
    const xs = Array.from({ length: 241 }, (_, i) => -3.2 + (6.4 * i) / 240);
    curve.setAttribute('d', pathOf(F, xs.map((x) => [x, clamp(f(x), -2.6, 2.6)])));
    bends.replaceChildren(...(kinds[kind] === 'relu'
      ? us.map((u) => svg('circle', { class: 'ia-tr-bend', cx: F.px(u.c), cy: F.py(clamp(f(u.c), -2.6, 2.6)), r: 5 }))
      : []));
    const gx = Array.from({ length: 121 }, (_, i) => -3 + (6 * i) / 120);
    actCurve.setAttribute('d', pathOf(G, gx.map((x) => [x, clamp(act(x), -1, 3)])));
    insetName.textContent = kinds[kind] === 'none' ? 'No activation' : names[kind];
    err.textContent = fmt(mse, 3);
    if (kinds[kind] === 'none') {
      cap.textContent = `With no activation, the ${units} units add up to one linear function, so the best fit is a straight line for any number of units.`;
    } else if (kinds[kind] === 'relu') {
      cap.textContent = `Each ReLU unit adds one bend, so ${units} unit${units > 1 ? 's give' : ' gives'} a line made of straight pieces. The open circles mark the bends. Add units to follow the curve more closely.`;
    } else {
      cap.textContent = `${names[kind]} has no sharp corner, so the fit is smooth. With ${units} unit${units > 1 ? 's' : ''}, the error is ${fmt(mse, 3)}.`;
    }
  }

  draw();
}

/* -----------------------------
 * Gradient for one weight
 * ----------------------------- */
function buildGradient(root) {
  const xs = [-2, -1, 0, 1, 2];
  const ys = [-2.4, -1.2, 0.6, 2.1, 3.4];
  const b = ys.reduce((a, v) => a + v, 0) / ys.length;
  const loss = (w) => xs.reduce((s, x, i) => s + (w * x + b - ys[i]) ** 2, 0) / xs.length;
  const slope = (w) => xs.reduce((s, x, i) => s + 2 * (w * x + b - ys[i]) * x, 0) / xs.length;
  const LR = 0.1;
  const W0 = -0.5;
  let w = W0;

  const F = frame(330, 220, [-1, 4], [0, 26], { l: 36, r: 12, t: 12, b: 26 });
  const lossPath = svg('path', { class: 'ia-tf-plot__curve', d: pathOf(F, Array.from({ length: 101 }, (_, i) => { const v = -1 + (5 * i) / 100; return [v, Math.min(loss(v), 26)]; })) });
  const tangent = svg('line', { class: 'ia-tr-tangent' });
  const dot = svg('circle', { class: 'ia-tf-plot__dot', r: 6 });
  const arrow = svg('path', { class: 'ia-tr-arrow' });
  const lossPlot = svg('svg', { viewBox: `0 0 ${F.W} ${F.H}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'The loss as a function of the weight w' }, [
    axes(F, { xLabel: 'w', yLabel: 'loss' }), lossPath, tangent, arrow, dot,
  ]);

  const D = frame(220, 220, [-2.6, 2.6], [-4, 4.5], { l: 14, r: 10, t: 12, b: 26 });
  const line = svg('line', { class: 'ia-tr-fit' });
  const resid = svg('g');
  const dataPlot = svg('svg', { viewBox: `0 0 ${D.W} ${D.H}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'The data and the line y = wx + b' }, [
    axes(D, { xLabel: 'x' }), resid, line,
    ...xs.map((x, i) => svg('circle', { class: 'ia-tr-point', cx: D.px(x), cy: D.py(ys[i]), r: 4 })),
  ]);

  const slider = makeSlider({ label: 'Weight w', min: -1, max: 4, step: 0.01, value: w, onInput: (v) => { w = v; draw(); } });
  const stepBtn = el('button', { type: 'button', class: 'ia-tf-btn is-primary', onclick: () => { w = clamp(w - LR * slope(w), -1, 4); draw(); } }, 'Take a step');
  const reset = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => { w = W0; draw(); } }, 'Reset');
  const formula = el('div', { class: 'ia-tf-formula' });
  const cap = caption();

  root.replaceChildren(
    el('div', { class: 'ia-tf-toolbar' }, [slider.root, stepBtn, reset]),
    el('div', { class: 'ia-tr-two' }, [
      el('div', {}, [el('div', { class: 'ia-anim__label' }, 'Loss for each value of w'), lossPlot]),
      el('div', {}, [el('div', { class: 'ia-anim__label' }, 'Data and the line'), dataPlot]),
    ]),
    formula,
    cap,
  );

  function draw() {
    slider.set(w);
    const l = loss(w);
    const g = slope(w);
    const span = 0.7;
    tangent.setAttribute('x1', F.px(w - span)); tangent.setAttribute('y1', F.py(l - g * span));
    tangent.setAttribute('x2', F.px(w + span)); tangent.setAttribute('y2', F.py(l + g * span));
    dot.setAttribute('cx', F.px(w)); dot.setAttribute('cy', F.py(Math.min(l, 26)));
    const dir = -Math.sign(g);
    const ay = F.py(Math.min(l, 26)) - 16;
    const ax0 = F.px(w);
    const ax1 = ax0 + dir * clamp(Math.abs(g) * 5, 0, 60);
    arrow.setAttribute('d', Math.abs(g) < 0.05 ? '' : `M${ax0},${ay} L${ax1},${ay} M${ax1 - dir * 6},${ay - 4} L${ax1},${ay} L${ax1 - dir * 6},${ay + 4}`);
    line.setAttribute('x1', D.px(-2.6)); line.setAttribute('y1', D.py(w * -2.6 + b));
    line.setAttribute('x2', D.px(2.6)); line.setAttribute('y2', D.py(w * 2.6 + b));
    resid.replaceChildren(...xs.map((x, i) => svg('line', { class: 'ia-tr-resid', x1: D.px(x), x2: D.px(x), y1: D.py(ys[i]), y2: D.py(w * x + b) })));
    formula.replaceChildren(
      'loss = ', el('b', { class: 'ia-tf-num' }, fmt(l)),
      ', slope ∂loss/∂w = ', el('b', { class: 'ia-tf-num' }, fmt(g)),
      `, and a step changes w by −${LR} × slope = `, el('b', { class: 'ia-tf-num' }, fmt(-LR * g)),
    );
    if (Math.abs(g) < 0.05) cap.textContent = 'The slope is almost 0, so w is at the lowest point of the loss, and the line fits the data as well as it can.';
    else if (g > 0) cap.textContent = 'The slope is positive, so a larger w gives a larger loss. The step makes w smaller, and the line becomes less steep.';
    else cap.textContent = 'The slope is negative, so a larger w gives a smaller loss. The step makes w larger, and the line becomes steeper.';
  }

  draw();
}

/* -----------------------------
 * Optimizers on a 2D loss surface
 * -----------------------------
   Two surfaces. The valley, (0.5 x² + 12 y²) / 2, is steep along y and shallow along x.
   The saddle, (0.5 x² − y²) / 2, goes up along x and down along y, and the start is
   almost on the line y = 0, where the gradient along y is almost 0.
*/
const SURFACES = {
  valley: {
    name: 'Narrow valley',
    start: [-4.2, 1.7],
    loss: ([x, y]) => 0.5 * (0.5 * x * x + 12 * y * y),
    grad: ([x, y]) => [0.5 * x, 12 * y],
    noise: [0.4, 2],
  },
  saddle: {
    name: 'Saddle point',
    start: [-4.2, 0.02],
    loss: ([x, y]) => 0.5 * (0.5 * x * x - y * y),
    grad: ([x, y]) => [0.5 * x, -y],
    noise: [0.15, 0.15],
  },
};

function buildOptim(root) {
  const STEPS = 100;
  const BETA = 0.8;
  let surf = SURFACES.valley;
  const OPTS = [
    { key: 'sgd', name: 'SGD', color: 'var(--tf-t0)' },
    { key: 'mom', name: 'Momentum', color: 'var(--tf-t1)' },
    { key: 'adam', name: 'Adam', color: 'var(--tf-t2)' },
  ];
  const on = { sgd: true, mom: true, adam: true };
  let lr = 0.05;
  let noisy = false;
  let shown = STEPS;
  let timer = null;

  function run(key) {
    const rand = seeded(7);
    let p = [...surf.start];
    let m = [0, 0];
    let v = [0, 0];
    const path = [[...p]];
    for (let t = 1; t <= STEPS; t++) {
      let g = surf.grad(p);
      if (noisy) g = [g[0] + gauss(rand) * surf.noise[0], g[1] + gauss(rand) * surf.noise[1]];
      if (key === 'sgd') {
        p = [p[0] - lr * g[0], p[1] - lr * g[1]];
      } else if (key === 'mom') {
        m = [BETA * m[0] + g[0], BETA * m[1] + g[1]];
        p = [p[0] - lr * m[0], p[1] - lr * m[1]];
      } else {
        m = m.map((mi, i) => 0.9 * mi + 0.1 * g[i]);
        v = v.map((vi, i) => 0.999 * vi + 0.001 * g[i] * g[i]);
        const mh = m.map((mi) => mi / (1 - 0.9 ** t));
        const vh = v.map((vi) => vi / (1 - 0.999 ** t));
        p = p.map((pi, i) => pi - (lr * mh[i]) / (Math.sqrt(vh[i]) + 1e-8));
      }
      const far = surf === SURFACES.saddle ? Math.abs(p[1]) > 40 : Math.abs(p[0]) > 1e6 || Math.abs(p[1]) > 1e6;
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || far) {
        path.push([clamp(p[0], -1e6, 1e6) || 0, Math.sign(p[1] || 1) * 1e6]);
        break;
      }
      path.push([...p]);
    }
    return path;
  }

  // The surface keeps the same scale in every size, so a taller view shows more of y.
  const SX = 540 / 6.5;
  const SY = 200 / 3.6;
  let F;
  let G;
  const clipId = `tr-clip-${Math.random().toString(36).slice(2, 8)}`;
  const contours = svg('g', { 'clip-path': `url(#${clipId})` });
  const paths = svg('g', { 'clip-path': `url(#${clipId})` });
  const startDot = svg('circle', { class: 'ia-tr-start', r: 4 });
  const startLabel = svg('text', { class: 'ia-tf-guide-label', 'text-anchor': 'middle' }, 'start');
  const centerLabel = svg('text', { class: 'ia-tf-guide-label', 'text-anchor': 'middle' });
  const plot = svg('svg', { class: 'ia-tf-plot ia-tr-surface', role: 'img', 'aria-label': 'Paths of three optimizers on a loss surface' });

  // The loss at each step, under the surface.
  const curves = svg('g');
  const gTop = svg('text', { class: 'ia-tf-guide-label', 'text-anchor': 'end' });
  const gBottom = svg('text', { class: 'ia-tf-guide-label', 'text-anchor': 'end' });
  const gZero = svg('line', { class: 'ia-tf-zero' });
  const chart = svg('svg', { class: 'ia-tf-plot', role: 'img', 'aria-label': 'The loss at each step for each optimizer' });
  const chartLabel = el('div', { class: 'ia-anim__label' });

  // The part of the surface in view: its center and the zoom.
  const HOME = { cx: -1.75, cy: 0.4, k: 1 };
  const view = { ...HOME };

  function layout() {
    const H = 220;
    const chartH = 120;
    const hw = (560 - 20) / (2 * SX * view.k);
    const hh = (H - 20) / (2 * SY * view.k);
    F = frame(560, H, [view.cx - hw, view.cx + hw], [view.cy - hh, view.cy + hh], { l: 10, r: 10, t: 10, b: 10 });
    plot.setAttribute('viewBox', `0 0 ${F.W} ${F.H}`);
    plot.replaceChildren(
      svg('defs', {}, svg('clipPath', { id: clipId }, svg('rect', { x: 0, y: 0, width: F.W, height: F.H }))),
      svg('rect', { class: 'ia-tr-surface__bg', x: 0, y: 0, width: F.W, height: F.H, rx: 3 }),
      contours,
      svg('circle', { class: 'ia-tr-min', cx: F.px(0), cy: F.py(0), r: 4 }),
      startDot, startLabel, centerLabel,
      svg('line', { class: 'ia-tf-guide', x1: F.px(0), x2: F.px(0), y1: F.py(0) + 8, y2: F.py(0) + 23 }),
      paths,
    );
    centerLabel.setAttribute('x', F.px(0));
    centerLabel.setAttribute('y', F.py(0) + 34);

    G = frame(560, chartH, [0, STEPS], [0, 1], { l: 40, r: 10, t: 10, b: 22 });
    chart.setAttribute('viewBox', `0 0 ${G.W} ${G.H}`);
    gTop.setAttribute('x', G.m.l - 6); gTop.setAttribute('y', G.py(1) + 4);
    gBottom.setAttribute('x', G.m.l - 6); gBottom.setAttribute('y', G.py(0) + 4);
    gZero.setAttribute('x1', G.px(0)); gZero.setAttribute('x2', G.px(STEPS));
    chart.replaceChildren(
      svg('line', { class: 'ia-tf-zero', x1: G.px(0), x2: G.px(0), y1: G.py(0), y2: G.py(1) }),
      gZero, gTop, gBottom,
      svg('text', { class: 'ia-tf-guide-label', x: G.px(STEPS), y: G.H - 4, 'text-anchor': 'end' }, 'step'),
      curves,
    );
  }
  layout();

  function drawSurface() {
    const sx = SX * view.k;
    const sy = SY * view.k;
    const nodes = [];
    if (surf === SURFACES.valley) {
      for (const L of [0.05, 0.2, 0.5, 1, 2, 3.5, 5.5, 8, 11]) {
        nodes.push(svg('ellipse', { class: 'ia-tr-contour', cx: F.px(0), cy: F.py(0), rx: (Math.sqrt((2 * L) / 0.5) * sx).toFixed(1), ry: (Math.sqrt((2 * L) / 12) * sy).toFixed(1) }));
      }
    } else {
      for (const c of [0.25, 0.8, 1.6, 2.8, 4.4]) {
        const ys = Array.from({ length: 121 }, (_, i) => F.y0 - 1 + ((F.y1 - F.y0 + 2) * i) / 120);
        for (const s of [-1, 1]) nodes.push(svg('path', { class: 'ia-tr-contour', d: pathOf(F, ys.map((y) => [s * Math.sqrt((2 * c + y * y) / 0.5), y])) }));
        const xs = Array.from({ length: 121 }, (_, i) => F.x0 - 1 + ((F.x1 - F.x0 + 2) * i) / 120);
        for (const s of [-1, 1]) nodes.push(svg('path', { class: 'ia-tr-contour is-low', d: pathOf(F, xs.map((x) => [x, s * Math.sqrt(0.5 * x * x + 2 * c)])) }));
      }
    }
    contours.replaceChildren(...nodes);
    startDot.setAttribute('cx', F.px(surf.start[0])); startDot.setAttribute('cy', F.py(surf.start[1]));
    startLabel.setAttribute('x', F.px(surf.start[0])); startLabel.setAttribute('y', F.py(surf.start[1]) - 9);
    centerLabel.textContent = surf === SURFACES.valley ? 'lowest loss' : 'saddle point';
  }

  const legend = OPTS.map((o) => {
    const val = el('span', { class: 'ia-tf-num' });
    const b = el('button', { type: 'button', class: 'ia-tr-legend', style: `--c: ${o.color}`, onclick: () => { on[o.key] = !on[o.key]; draw(); } }, [el('i'), el('span', {}, o.name), val]);
    return { o, b, val };
  });
  const slider = makeSlider({ label: 'Learning rate', min: 0.005, max: 0.3, value: lr, log: true, format: (v) => fmt(v, 3), onInput: (v) => { lr = v; stop(); shown = STEPS; draw(); } });
  const noise = el('button', { type: 'button', class: 'ia-tf-btn', 'aria-pressed': 'false', onclick: () => { noisy = !noisy; noise.setAttribute('aria-pressed', String(noisy)); draw(); } }, 'Noisy batches');
  const play = el('button', { type: 'button', class: 'ia-tf-btn is-primary', onclick: () => animate() }, 'Play');
  const keys = Object.keys(SURFACES);
  const seg = makeSeg(keys.map((k) => SURFACES[k].name), (i) => { surf = SURFACES[keys[i]]; seg.select(i); stop(); shown = STEPS; Object.assign(view, HOME); redraw(); });
  const cap = caption();
  const zoomBtn = (label, text, fn) => el('button', { type: 'button', class: 'ia-tf-btn', 'aria-label': label, title: label, onclick: fn }, text);
  const main = el('div', { class: 'ia-tr-optim__main' }, [
    plot,
    el('div', { class: 'ia-tr-zoom' }, [
      zoomBtn('Zoom in', '+', () => zoomAt(1.4)),
      zoomBtn('Zoom out', '−', () => zoomAt(1 / 1.4)),
      zoomBtn('Reset the view', '⟲', () => { Object.assign(view, HOME); redraw(); }),
    ]),
  ]);

  function redraw() {
    layout();
    drawSurface();
    draw();
  }

  // Zoom by a factor, keeping the point (x, y) in the same place. Without a point, zoom at the center.
  function zoomAt(f, x = view.cx, y = view.cy) {
    const k = clamp(view.k * f, 0.25, 8);
    const r = view.k / k;
    view.cx = x + (view.cx - x) * r;
    view.cy = y + (view.cy - y) * r;
    view.k = k;
    redraw();
  }

  // The data point under a pointer event.
  function dataAt(e) {
    const r = plot.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * F.W;
    const py = ((e.clientY - r.top) / r.height) * F.H;
    return [F.x0 + ((px - F.m.l) / (F.W - F.m.l - F.m.r)) * (F.x1 - F.x0), F.y1 - ((py - F.m.t) / (F.H - F.m.t - F.m.b)) * (F.y1 - F.y0)];
  }

  // A pinch on a trackpad comes as a wheel event with ctrlKey. The plain wheel still scrolls the page.
  plot.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const [x, y] = dataAt(e);
    zoomAt(Math.exp(-e.deltaY * 0.01), x, y);
  }, { passive: false });

  // Drag to move the view.
  let drag = null;
  plot.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
    plot.setPointerCapture(e.pointerId);
    plot.classList.add('is-dragging');
  });
  plot.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = plot.getBoundingClientRect();
    const s = F.W / r.width;
    view.cx = drag.cx - ((e.clientX - drag.x) * s) / (SX * view.k);
    view.cy = drag.cy + ((e.clientY - drag.y) * s) / (SY * view.k);
    redraw();
  });
  const endDrag = () => { drag = null; plot.classList.remove('is-dragging'); };
  plot.addEventListener('pointerup', endDrag);
  plot.addEventListener('pointercancel', endDrag);

  root.replaceChildren(
    el('div', { class: 'ia-tf-toolbar' }, [seg.root, noise, play]),
    el('div', { class: 'ia-tf-toolbar' }, [slider.root]),
    main,
    el('div', { class: 'ia-tr-legends' }, legend.map((l) => l.b)),
    chartLabel,
    chart,
    cap,
  );

  function stop() {
    if (timer) cancelAnimationFrame(timer);
    timer = null;
  }

  function animate() {
    stop();
    const t0 = performance.now();
    const tick = (now) => {
      shown = Math.min(STEPS, Math.round(((now - t0) / 2600) * STEPS));
      draw();
      if (shown < STEPS) timer = requestAnimationFrame(tick);
      else timer = null;
    };
    timer = requestAnimationFrame(tick);
  }

  function draw() {
    const valley = surf === SURFACES.valley;
    const results = {};
    const nodes = [];
    const lines = [];
    // The valley loss goes down to 0, so the chart uses a log scale. The saddle loss goes below 0.
    const gy = valley ? (l) => clamp((Math.log10(Math.max(l, 1e-9)) + 6) / 7.5, 0, 1) : (l) => clamp((l + 6) / 12, 0, 1);
    gTop.textContent = valley ? '30' : '+6';
    gBottom.textContent = valley ? '10⁻⁶' : '−6';
    gZero.setAttribute('y1', G.py(gy(valley ? 1e-9 : 0))); gZero.setAttribute('y2', G.py(gy(valley ? 1e-9 : 0)));
    chartLabel.textContent = valley ? 'Loss at each step (log scale)' : 'Loss at each step';
    for (const o of OPTS) {
      const path = run(o.key);
      const k = Math.min(shown, path.length - 1);
      const away = Math.abs(path[path.length - 1][1]) >= 1e6 && k === path.length - 1;
      results[o.key] = { away, loss: surf.loss(path[k]) };
      if (!on[o.key]) continue;
      const vis = path.slice(0, k + 1).map(([x, y]) => [clamp(x, -60, 60), clamp(y, -60, 60)]);
      nodes.push(svg('path', { class: 'ia-tr-path', style: `--c: ${o.color}`, d: pathOf(F, vis) }));
      const end = vis[vis.length - 1];
      nodes.push(svg('circle', { class: 'ia-tr-head', style: `--c: ${o.color}`, cx: F.px(end[0]), cy: F.py(end[1]), r: 4.5 }));
      const pts = path.slice(0, k + 1).map((q, t) => [t, gy(Number.isFinite(surf.loss(q)) ? surf.loss(q) : (valley ? 1e9 : -1e9))]);
      if (away) pts.push([Math.max(pts.length - 1, Math.min(shown, STEPS)), valley ? 1 : 0]);
      lines.push(svg('path', { class: 'ia-tr-path', style: `--c: ${o.color}`, d: pathOf(G, pts) }));
    }
    paths.replaceChildren(...nodes);
    curves.replaceChildren(...lines);
    legend.forEach(({ o, b, val }) => {
      b.setAttribute('aria-pressed', String(on[o.key]));
      const r = results[o.key];
      if (r.away) val.textContent = valley ? 'diverges' : 'loss < −800';
      else val.textContent = `loss ${fmt(r.loss, 3)}`;
    });
    let text;
    if (!valley) {
      text = 'The start is almost on the line through the saddle point, so the gradient along y is almost 0. SGD moves to the saddle point and stays near it until the small y grows. Momentum gets away sooner, and Adam divides by the size of the gradient, so it moves away along y at full speed from the first steps.';
    } else if (results.sgd.away) {
      text = `With a learning rate of ${fmt(lr, 3)}, SGD goes past the lowest point along the steep direction, and every step makes it worse, so it diverges.`;
    } else if (lr * 12 > 1.2) {
      text = 'SGD moves back and forth across the steep direction. Momentum averages the back and forth away, and Adam takes steps of about the same size in both directions.';
    } else if (lr * 0.5 < 0.01) {
      text = 'The learning rate is small, so SGD makes slow progress along the shallow direction. Adam divides by the size of the gradient, so its steps along the shallow direction are as large as along the steep one.';
    } else {
      text = 'SGD drops quickly along the steep direction, and then it moves slowly along the shallow one. Momentum builds up speed along the shallow direction, and Adam gives both directions steps of about the same size.';
    }
    if (noisy) text += ' With noisy batches, each gradient is only an estimate of the full gradient, so every path shakes.';
    cap.textContent = `Step ${shown} of ${STEPS}. ${text}`;
  }

  seg.select(0);
  drawSurface();
  draw();
}

/* -----------------------------
 * Learning rate schedule
 * ----------------------------- */
function buildSchedule(root) {
  let warm = 0.08;
  let floor = 0.1;
  let hover = null;

  const F = frame(560, 220, [0, 1], [0, 1.08], { l: 44, r: 14, t: 12, b: 28 });
  const area = svg('path', { class: 'ia-tr-sched__area' });
  const curve = svg('path', { class: 'ia-tf-plot__curve' });
  const warmBand = svg('rect', { class: 'ia-tr-sched__warm' });
  const warmLabel = svg('text', { class: 'ia-tf-guide-label', 'text-anchor': 'middle' }, 'warmup');
  const warmTick = svg('text', { class: 'ia-tf-guide-label', 'text-anchor': 'middle' }, 'T_w');
  const minLine = svg('line', { class: 'ia-tf-guide' });
  const minLabel = svg('text', { class: 'ia-tf-guide-label', 'text-anchor': 'end' }, 'η_min');
  const dot = svg('circle', { class: 'ia-tf-plot__dot', r: 5 });
  const hit = svg('rect', { x: F.m.l, y: F.m.t, width: F.W - F.m.l - F.m.r, height: F.H - F.m.t - F.m.b, fill: 'transparent' });
  const plot = svg('svg', { viewBox: `0 0 ${F.W} ${F.H}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'The learning rate at each step' }, [
    warmBand, axes(F, { xZero: false }), area, curve, minLine,
    svg('line', { class: 'ia-tf-guide', x1: F.px(0), x2: F.px(1), y1: F.py(1), y2: F.py(1) }),
    svg('text', { class: 'ia-tf-guide-label', x: F.m.l - 6, y: F.py(1) + 4, 'text-anchor': 'end' }, 'η_max'),
    minLabel, warmLabel, warmTick,
    svg('text', { class: 'ia-tf-guide-label', x: F.px(0), y: F.H - 8, 'text-anchor': 'middle' }, '0'),
    svg('text', { class: 'ia-tf-guide-label', x: F.px(1), y: F.H - 8, 'text-anchor': 'middle' }, 'T_c'),
    dot, hit,
  ]);

  const at = (t) => (t < warm ? t / warm : floor + 0.5 * (1 + Math.cos((Math.PI * (t - warm)) / (1 - warm))) * (1 - floor));
  const sWarm = makeSlider({ label: 'Warmup', min: 0.01, max: 0.3, value: warm, format: (v) => `${Math.round(v * 100)}% of the steps`, onInput: (v) => { warm = v; draw(); } });
  const sFloor = makeSlider({ label: 'Final rate', min: 0, max: 0.5, value: floor, format: (v) => `${Math.round(v * 100)}% of η_max`, onInput: (v) => { floor = v; draw(); } });
  const cap = caption();

  hit.addEventListener('pointermove', (e) => {
    const r = plot.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * F.W;
    hover = clamp((x - F.m.l) / (F.W - F.m.l - F.m.r), 0, 1);
    draw();
  });
  hit.addEventListener('pointerleave', () => { hover = null; draw(); });

  root.replaceChildren(el('div', { class: 'ia-tf-toolbar' }, [sWarm.root, sFloor.root]), plot, cap);

  function draw() {
    const ts = Array.from({ length: 301 }, (_, i) => i / 300);
    ts.push(warm);
    ts.sort((a, b) => a - b);
    const pts = ts.map((t) => [t, at(t)]);
    curve.setAttribute('d', pathOf(F, pts));
    area.setAttribute('d', `${pathOf(F, pts)}L${F.px(1)},${F.py(0)}L${F.px(0)},${F.py(0)}Z`);
    warmBand.setAttribute('x', F.px(0)); warmBand.setAttribute('y', F.m.t);
    warmBand.setAttribute('width', F.px(warm) - F.px(0)); warmBand.setAttribute('height', F.py(0) - F.m.t);
    warmLabel.setAttribute('x', F.px(warm / 2)); warmLabel.setAttribute('y', F.py(1) - 5);
    warmLabel.style.display = warm > 0.05 ? '' : 'none';
    warmTick.setAttribute('x', F.px(warm)); warmTick.setAttribute('y', F.H - 8);
    minLine.setAttribute('x1', F.px(0)); minLine.setAttribute('x2', F.px(1));
    minLine.setAttribute('y1', F.py(floor)); minLine.setAttribute('y2', F.py(floor));
    minLabel.setAttribute('x', F.m.l - 6); minLabel.setAttribute('y', F.py(floor) + 4);
    minLabel.style.display = floor > 0.06 && floor < 0.92 ? '' : 'none';
    const t = hover ?? 0.5;
    dot.setAttribute('cx', F.px(t)); dot.setAttribute('cy', F.py(at(t)));
    const phase = t < warm ? 'in the warmup, so the learning rate grows in a straight line' : 'in the cosine part, so the learning rate goes down';
    cap.textContent = `At ${Math.round(t * 100)}% of the training, the learning rate is ${pct(at(t), 0)} of η_max. The step is ${phase}.`;
  }

  draw();
}

/* -----------------------------
 * Input and target
 * ----------------------------- */
function buildBatch(root) {
  const piece = ['the', '␣cat', '␣saw', '␣the', '␣hat'];
  const chip = (i) => el('span', { class: 'ia-tf-tok', style: `--tok: var(--tf-t${i})` }, piece[i]);
  const cell = (child, col, cls = '') => el('div', { class: `ia-tr-batch__cell ${cls}`.trim(), style: `grid-column: ${col + 2}` }, child);
  const label = (text, sub) => el('div', { class: 'ia-tr-batch__label' }, [el('b', {}, text), el('span', {}, sub)]);

  root.replaceChildren(
    el('div', { class: 'ia-tr-batch' }, [
      label('Piece', 'T + 1 = 5 tokens'),
      ...piece.map((_, i) => cell(chip(i), i)),
      label('Input', 'the first T tokens'),
      ...piece.slice(0, 4).map((_, i) => cell(chip(i), i)),
      el('div', { class: 'ia-tr-batch__label' }),
      ...piece.slice(0, 4).map((_, i) => cell(el('span', { class: 'ia-tr-batch__arrow' }, 'predicts'), i, 'is-arrow')),
      label('Target', 'moved by one'),
      ...piece.slice(1).map((_, i) => cell(chip(i + 1), i)),
    ]),
    el('p', { class: 'ia-anim__caption ia-tf-caption' }, 'At each position, the target is the token that comes next in the text. One piece of 5 tokens gives 4 predictions, and the loss is their average.'),
  );
}

/* -----------------------------
 * Start
 * ----------------------------- */
const BUILDERS = {
  '[data-tr-network]': buildNetwork,
  '[data-tr-activation]': buildActivation,
  '[data-tr-gradient]': buildGradient,
  '[data-tr-optim]': buildOptim,
  '[data-tr-schedule]': buildSchedule,
  '[data-tr-batch]': buildBatch,
};

for (const [sel, build] of Object.entries(BUILDERS)) {
  for (const root of document.querySelectorAll(sel)) {
    try {
      build(root);
    } catch (e) {
      console.error(`Diagram ${sel} failed`, e);
    }
  }
}
