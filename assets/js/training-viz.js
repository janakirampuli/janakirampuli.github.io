/*
  Training diagrams
  - [data-tr-network]:    a small network, one training step at a time: forward, loss, backward, update
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
 * A small network, one training step at a time
 * -----------------------------
   One input, five ReLU units and one output, trained with SGD on one example
   at a time. Each step has four stages: forward, loss, backward and update.
*/
const NET_TARGET = (x) => Math.sin(1.6 * x) + 0.35 * x;

function buildNetwork(root) {
  const N = 5;
  const LR = 0.02;
  const data = Array.from({ length: 21 }, (_, i) => {
    const x = -3 + (6 * i) / 20;
    return [x, NET_TARGET(x)];
  });
  const STAGES = ['Forward', 'Loss', 'Backward', 'Update'];

  let p;
  let pick;
  let ex;
  let f;
  let g;
  let stage;
  let steps;
  let history;
  let focus = null;
  let lossBefore = 0;
  let timer = null;

  function init() {
    const r = seeded(3);
    p = { w1: [], b1: [], w2: [], b2: 0 };
    for (let j = 0; j < N; j++) {
      const c = -2.4 + (4.8 * j) / (N - 1);
      p.w1[j] = (j % 2 ? -1 : 1) * (0.9 + 0.4 * r());
      p.b1[j] = -p.w1[j] * c;
      p.w2[j] = 0.15 * gauss(r);
    }
    pick = seeded(11);
    steps = 0;
    history = [avgLoss()];
    next();
    stage = 0;
  }

  const forward = (x) => {
    const z = p.w1.map((w, j) => w * x + p.b1[j]);
    const a = z.map((v) => Math.max(0, v));
    return { x, z, a, y: a.reduce((s, v, j) => s + v * p.w2[j], p.b2) };
  };
  const avgLoss = () => data.reduce((s, [x, y]) => s + (forward(x).y - y) ** 2, 0) / data.length;

  function backward() {
    const dy = 2 * (f.y - ex[1]);
    const dz = f.z.map((z, j) => dy * p.w2[j] * (z > 0 ? 1 : 0));
    return {
      dy,
      dz,
      da: p.w2.map((w) => dy * w),
      w2: f.a.map((a) => dy * a),
      b2: dy,
      w1: dz.map((d) => d * f.x),
      b1: dz,
    };
  }

  function update() {
    for (let j = 0; j < N; j++) {
      p.w2[j] -= LR * g.w2[j];
      p.w1[j] -= LR * g.w1[j];
      p.b1[j] -= LR * g.b1[j];
    }
    p.b2 -= LR * g.b2;
  }

  // Take the next example.
  function next() {
    ex = data[Math.floor(pick() * data.length)];
    f = forward(ex[0]);
    g = null;
  }

  function advance() {
    if (stage === 0) stage = 1;
    else if (stage === 1) { g = backward(); stage = 2; }
    else if (stage === 2) {
      lossBefore = (f.y - ex[1]) ** 2;
      update();
      steps += 1;
      history.push(avgLoss());
      stage = 3;
    } else {
      next();
      stage = 0;
    }
    draw();
  }

  function train(n) {
    stopPlay();
    for (let i = 0; i < n; i++) {
      next();
      g = backward();
      update();
      steps += 1;
      history.push(avgLoss());
    }
    next();
    stage = 0;
    draw();
  }

  /* The network. */
  const W = 560;
  const H = 392;
  const X_IN = 56;
  const X_HID = 250;
  const X_OUT = 420;
  const X_LOSS = 515;
  const R = 21;
  const hy = (j) => 40 + (j * (H - 80)) / (N - 1);
  const MID = H / 2;

  const edgesIn = [];
  const edgesOut = [];
  const edgeLayer = svg('g');
  for (let j = 0; j < N; j++) {
    const a = svg('path', { class: 'ia-tr-edge', d: `M${X_IN + R},${MID} L${X_HID - R},${hy(j)}` });
    const b = svg('path', { class: 'ia-tr-edge', d: `M${X_HID + R},${hy(j)} L${X_OUT - R},${MID}` });
    edgesIn.push(a);
    edgesOut.push(b);
    edgeLayer.append(a, b);
  }
  const lossEdge = svg('path', { class: 'ia-tr-edge ia-tr-edge--loss', d: `M${X_OUT + R},${MID} L${X_LOSS - R},${MID}` });
  edgeLayer.append(lossEdge);

  function node(cx, cy, label, cls = '') {
    const circle = svg('circle', { class: `ia-tr-node ${cls}`.trim(), cx, cy, r: R });
    const value = svg('text', { class: 'ia-tr-node__val', x: cx, y: cy + 4, 'text-anchor': 'middle' });
    const name = svg('text', { class: 'ia-tr-node__name', x: cx, y: cy - R - 6, 'text-anchor': 'middle' }, label);
    const grad = svg('text', { class: 'ia-tr-node__grad', x: cx, y: cy + R + 13, 'text-anchor': 'middle' });
    const group = svg('g', { class: 'ia-tr-nodeg' }, [circle, value, name, grad]);
    return { group, circle, value, name, grad };
  }
  const nIn = node(X_IN, MID, 'x', 'is-input');
  const nHid = Array.from({ length: N }, (_, j) => node(X_HID, hy(j), `h${j + 1}`));
  const nOut = node(X_OUT, MID, 'ŷ', 'is-output');
  const nLoss = node(X_LOSS, MID, 'loss', 'is-loss');
  nHid.forEach((n, j) => {
    n.group.addEventListener('pointerenter', () => { focus = j; draw(); });
    n.group.addEventListener('pointerleave', () => { focus = null; draw(); });
  });

  const net = svg('svg', { viewBox: `0 0 ${W} ${H + 8}`, class: 'ia-tf-plot ia-tr-net', role: 'img', 'aria-label': 'A network with one input, five hidden units and one output' }, [
    edgeLayer,
    nIn.group, ...nHid.map((n) => n.group), nOut.group, nLoss.group,
    svg('text', { class: 'ia-tf-guide-label', x: X_HID, y: H + 6, 'text-anchor': 'middle' }, 'ReLU units'),
  ]);

  /* The fit and the loss. */
  const P = frame(300, 190, [-3.2, 3.2], [-2.6, 2.6], { l: 14, r: 8, t: 10, b: 20 });
  const fitCurve = svg('path', { class: 'ia-tr-fit' });
  const exDot = svg('circle', { class: 'ia-tr-ex', r: 6 });
  const predDot = svg('circle', { class: 'ia-tr-pred', r: 4.5 });
  const errLine = svg('line', { class: 'ia-tr-resid' });
  const fitPlot = svg('svg', { viewBox: `0 0 ${P.W} ${P.H}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'The training points and the curve that the network computes' }, [
    axes(P, { xLabel: 'x' }),
    ...data.map(([x, y]) => svg('circle', { class: 'ia-tr-point', cx: P.px(x), cy: P.py(y), r: 3 })),
    fitCurve, errLine, exDot, predDot,
  ]);
  const Q = frame(300, 90, [0, 1], [0, 1], { l: 30, r: 8, t: 8, b: 16 });
  const lossPath = svg('path', { class: 'ia-tf-plot__curve' });
  const qTop = svg('text', { class: 'ia-tf-guide-label', x: Q.m.l - 4, y: Q.py(1) + 4, 'text-anchor': 'end' });
  const lossPlot = svg('svg', { viewBox: `0 0 ${Q.W} ${Q.H}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'The average loss after each step' }, [
    svg('line', { class: 'ia-tf-zero', x1: Q.px(0), x2: Q.px(1), y1: Q.py(0), y2: Q.py(0) }),
    svg('line', { class: 'ia-tf-zero', x1: Q.px(0), x2: Q.px(0), y1: Q.py(0), y2: Q.py(1) }),
    qTop,
    svg('text', { class: 'ia-tf-guide-label', x: Q.m.l - 4, y: Q.py(0) + 4, 'text-anchor': 'end' }, '0'),
    lossPath,
  ]);
  const stepsOut = el('div', { class: 'ia-anim__label' });

  /* Controls. */
  const chips = el('div', { class: 'ia-tr-stages' }, STAGES.map((s, i) => el('span', { class: 'ia-tr-stage' }, `${i + 1}. ${s}`)));
  const nextBtn = el('button', { type: 'button', class: 'ia-tf-btn is-primary', onclick: () => { stopPlay(); advance(); } }, 'Next stage');
  const playBtn = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => (timer ? stopPlay() : startPlay()) }, 'Play');
  const trainBtn = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => train(100) }, 'Train 100 steps');
  const resetBtn = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => { stopPlay(); init(); draw(); } }, 'Reset');
  const formula = el('div', { class: 'ia-tf-formula ia-tr-net__formula' });
  const cap = caption();

  root.replaceChildren(
    el('div', { class: 'ia-tf-toolbar' }, [chips, el('span', { class: 'ia-tf-spacer' }), nextBtn, playBtn, trainBtn, resetBtn]),
    el('div', { class: 'ia-tr-net__cols' }, [
      el('div', {}, [net]),
      el('div', { class: 'ia-tr-net__side' }, [
        el('div', { class: 'ia-anim__label' }, 'The curve of the network'),
        fitPlot,
        stepsOut,
        lossPlot,
      ]),
    ]),
    cap,
    formula,
  );

  function startPlay() {
    playBtn.textContent = 'Pause';
    playBtn.setAttribute('aria-pressed', 'true');
    advance();
    timer = setInterval(advance, 1300);
  }

  function stopPlay() {
    if (timer) clearInterval(timer);
    timer = null;
    playBtn.textContent = 'Play';
    playBtn.setAttribute('aria-pressed', 'false');
  }

  const signColor = (v) => (v >= 0 ? 'var(--tf-pos)' : 'var(--tf-neg)');

  function paintEdge(edge, value, scale, dir, off) {
    edge.style.stroke = signColor(value);
    edge.style.strokeWidth = (0.8 + Math.min(Math.abs(value) * scale, 5)).toFixed(2);
    edge.classList.toggle('is-off', off);
    edge.classList.toggle('is-fwd', dir === 1 && !off);
    edge.classList.toggle('is-bwd', dir === -1 && !off);
  }

  function draw() {
    chips.querySelectorAll('.ia-tr-stage').forEach((c, i) => c.classList.toggle('is-on', i === stage));
    nextBtn.textContent = stage === 3 ? 'Next example' : `Next: ${STAGES[stage + 1]}`;

    // Edges show the weights in the forward stages, and the gradients in the backward stage.
    for (let j = 0; j < N; j++) {
      const off = f.z[j] <= 0;
      if (stage === 2) {
        paintEdge(edgesIn[j], g.w1[j], 2.5, -1, off);
        paintEdge(edgesOut[j], g.w2[j], 2.5, -1, false);
      } else {
        paintEdge(edgesIn[j], p.w1[j], 1.6, stage === 0 ? 1 : 0, false);
        paintEdge(edgesOut[j], p.w2[j], 3, stage === 0 ? 1 : 0, off && stage === 0);
      }
    }
    lossEdge.classList.toggle('is-fwd', stage === 1);
    lossEdge.classList.toggle('is-bwd', stage === 2);

    // Nodes. After the update, they show a new forward pass with the new weights.
    const shown = stage === 3 ? forward(ex[0]) : f;
    nIn.value.textContent = fmt(f.x);
    nIn.grad.textContent = '';
    nHid.forEach((n, j) => {
      const off = shown.z[j] <= 0;
      n.value.textContent = fmt(shown.a[j]);
      n.circle.classList.toggle('is-off', off);
      n.group.classList.toggle('is-focus', focus === j);
      n.grad.textContent = stage === 2 ? `∂ ${fmt(g.dz[j])}` : (off ? 'off' : '');
    });
    nOut.value.textContent = fmt(shown.y);
    nOut.grad.textContent = stage === 2 ? `∂ ${fmt(g.dy)}` : `y = ${fmt(ex[1])}`;
    const l = (f.y - ex[1]) ** 2;
    nLoss.value.textContent = stage >= 1 ? fmt((shown.y - ex[1]) ** 2) : '';
    nLoss.circle.classList.toggle('is-on', stage >= 1);

    // The fit, the example and the loss history.
    const xs = Array.from({ length: 161 }, (_, i) => -3.2 + (6.4 * i) / 160);
    fitCurve.setAttribute('d', pathOf(P, xs.map((x) => [x, clamp(forward(x).y, -2.6, 2.6)])));
    const now = forward(ex[0]).y;
    exDot.setAttribute('cx', P.px(ex[0])); exDot.setAttribute('cy', P.py(ex[1]));
    predDot.setAttribute('cx', P.px(ex[0])); predDot.setAttribute('cy', P.py(clamp(now, -2.6, 2.6)));
    errLine.setAttribute('x1', P.px(ex[0])); errLine.setAttribute('x2', P.px(ex[0]));
    errLine.setAttribute('y1', P.py(ex[1])); errLine.setAttribute('y2', P.py(clamp(now, -2.6, 2.6)));
    const top = Math.max(...history);
    qTop.textContent = fmt(top, 1);
    const n = Math.max(history.length - 1, 1);
    lossPath.setAttribute('d', pathOf(Q, history.map((v, i) => [i / n, v / top])));
    stepsOut.textContent = `Average loss, after ${steps} step${steps === 1 ? '' : 's'}`;

    // The caption and the numbers of one unit.
    const j = focus ?? f.a.reduce((best, a, k) => (Math.abs(a * p.w2[k]) > Math.abs(f.a[best] * p.w2[best]) ? k : best), 0);
    const u = `h${j + 1}`;
    if (stage === 0) {
      cap.textContent = `Forward. The example is x = ${fmt(f.x)}, and its target is y = ${fmt(ex[1])}. Each unit computes w·x + b and a ReLU, and the output adds the units with its own weights, so ŷ = ${fmt(f.y)}. The edges show the weights, with orange for positive and blue for negative.`;
      formula.textContent = `${u}: z = ${fmt(p.w1[j])} × ${fmt(f.x)} + ${fmt(p.b1[j])} = ${fmt(f.z[j])}, and ReLU(z) = ${fmt(f.a[j])}${f.z[j] <= 0 ? ', so the unit is off for this input' : ''}.`;
    } else if (stage === 1) {
      cap.textContent = `Loss. The loss compares the output with the target: (ŷ − y)² = (${fmt(f.y)} − ${fmt(ex[1])})² = ${fmt(l, 3)}.`;
      formula.textContent = 'In the plot, the line from the ring (the target) to the dot (the output) is the error for this example.';
    } else if (stage === 2) {
      const offs = f.z.filter((z) => z <= 0).length;
      cap.textContent = `Backward. The slope of the loss for ŷ is 2(ŷ − y) = ${fmt(g.dy)}. Backpropagation sends it back along each edge, and multiplies it by the weight of the edge and by the slope of the ReLU. The edges now show the gradients.${offs ? ` ${offs} unit${offs > 1 ? 's are' : ' is'} off, so the ReLU slope is 0, and no gradient goes through ${offs > 1 ? 'them' : 'it'}.` : ''}`;
      formula.textContent = `${u}: ∂loss/∂${u} = ${fmt(g.dy)} × ${fmt(p.w2[j])} × ${f.z[j] > 0 ? 1 : 0} = ${fmt(g.dz[j])}, and the gradient of its input weight is ${fmt(g.dz[j])} × x = ${fmt(g.w1[j])}.`;
    } else {
      cap.textContent = `Update. Each weight moves a small step against its gradient, w ← w − η·g, with η = ${LR}. The new forward pass gives ŷ = ${fmt(now)}, so the loss on this example ${(now - ex[1]) ** 2 < lossBefore ? 'falls' : 'changes'} from ${fmt(lossBefore, 3)} to ${fmt((now - ex[1]) ** 2, 3)}, and the curve moves a little toward the point.`;
      formula.textContent = `${u}: the input weight moves by −${LR} × ${fmt(g.w1[j])} = ${fmt(-LR * g.w1[j], 3)}, and the output weight by −${LR} × ${fmt(g.w2[j])} = ${fmt(-LR * g.w2[j], 3)}.`;
    }
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
