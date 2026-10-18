/*
  Transformer diagrams
  - [data-tf-embed]:     token ids select rows of the embedding table
  - [data-tf-rmsnorm]:   RMSNorm keeps the shape of a vector and gives it a fixed norm
  - [data-tf-attention]: scores, causal mask, softmax and the weighted sum, for one head
  - [data-tf-swiglu]:    the SiLU curve and the gated feed-forward layer for one token
  - [data-tf-output]:    scores for the next token and their probabilities
  - [data-tf-shapes]:    the shape of each tensor for a model size that the reader sets
  Loaded on demand by interactive.js. All the numbers are made up, from fixed seeds.
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

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
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

const randVec = (rand, n, scale = 1) => Array.from({ length: n }, () => gauss(rand) * scale);
const randMat = (rand, rows, cols, scale = 1) => Array.from({ length: rows }, () => randVec(rand, cols, scale));
const matVec = (m, v) => m.map((row) => row.reduce((s, w, i) => s + w * v[i], 0));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const silu = (x) => x * sigmoid(x);

function softmax(xs) {
  const finite = xs.filter(Number.isFinite);
  const max = Math.max(...finite);
  const exps = xs.map((x) => (Number.isFinite(x) ? Math.exp(x - max) : 0));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// The sentence from part 1, split into tokens. The ids are from an example vocabulary.
const TOKENS = [
  { text: 'the', id: 1169 },
  { text: '␣cat', id: 3797 },
  { text: '␣saw', id: 2497 },
  { text: '␣the', id: 262 },
  { text: '␣hat', id: 6877 },
];

function tokChip(i, extra = '') {
  return el('span', { class: `ia-tf-tok ${extra}`.trim(), style: `--tok: var(--tf-t${i % 5})` }, TOKENS[i].text);
}

// Background color for one number: orange for positive, blue for negative.
function heat(v, max) {
  const pct = Math.round(clamp(Math.abs(v) / max, 0, 1) * 88);
  return `color-mix(in srgb, var(${v >= 0 ? '--tf-pos' : '--tf-neg'}) ${pct}%, var(--tf-cell))`;
}

// A row of colored cells, one cell for each number of a vector.
function makeStrip(n, { max = 2, cls = '' } = {}) {
  const cells = Array.from({ length: n }, () => el('i'));
  const root = el('span', { class: `ia-tf-strip ${cls}`.trim() }, cells);
  return {
    root,
    cells,
    set(values) {
      values.forEach((v, i) => {
        cells[i].style.background = heat(v, max);
        cells[i].title = fmt(v);
      });
    },
    clear() {
      for (const c of cells) {
        c.style.background = '';
        c.title = '';
      }
    },
  };
}

// A row of buttons where one button is selected.
function makeSeg(labels, onPick, { cls = '' } = {}) {
  const buttons = labels.map((label, i) => el('button', { type: 'button', onclick: () => onPick(i) }, label));
  const root = el('div', { class: `ia-tf-seg ${cls}`.trim(), role: 'group' }, buttons);
  return {
    root,
    buttons,
    select(i) {
      buttons.forEach((b, j) => b.setAttribute('aria-pressed', i === j ? 'true' : 'false'));
    },
  };
}

function caption() {
  return el('p', { class: 'ia-anim__caption ia-tf-caption', 'aria-live': 'polite' });
}

/* -----------------------------
 * Embedding lookup
 * -----------------------------
   A still picture: the tokens and their ids on the left, the table in the middle,
   and the vectors on the right. Lines join each token to its row, and each row to
   the vector of the token.
*/
const EMBED_DIM = 8;

function buildEmbed(root) {
  const rand = seeded(11);
  const shown = [0, 1, 261, 262, 263, 1168, 1169, 1170, 2497, 3797, 3798, 6877, 9999];
  const rows = new Map(shown.map((id) => [id, randVec(rand, EMBED_DIM, 0.9)]));
  const owner = new Map(TOKENS.map((t, i) => [t.id, i]));

  const toks = TOKENS.map((t, i) => el('div', { class: 'ia-tf-emb__tok' }, [
    tokChip(i),
    el('span', { class: 'ia-tf-embed__id' }, `id ${t.id}`),
  ]));

  const tableRows = new Map();
  const table = el('div', { class: 'ia-tf-embed__table' });
  shown.forEach((id, k) => {
    if (k > 0 && id - shown[k - 1] > 1) table.append(el('div', { class: 'ia-tf-embed__gap' }, '⋮'));
    const strip = makeStrip(EMBED_DIM);
    strip.set(rows.get(id));
    const i = owner.get(id);
    const row = el('div', { class: `ia-tf-embed__row${i != null ? ' is-hit' : ''}`, style: i != null ? `--tok: var(--tf-t${i})` : null }, [
      el('span', { class: 'ia-tf-embed__rowid' }, String(id)),
      strip.root,
    ]);
    tableRows.set(id, row);
    table.append(row);
  });
  table.append(el('div', { class: 'ia-tf-embed__gap' }, '10,000 rows in all'));

  const outs = TOKENS.map((t, i) => {
    const strip = makeStrip(EMBED_DIM);
    strip.set(rows.get(t.id));
    return el('div', { class: 'ia-tf-emb__out' }, [strip.root, tokChip(i)]);
  });

  const links = svg('svg', { class: 'ia-tf-emb__links', 'aria-hidden': 'true' });
  const grid = el('div', { class: 'ia-tf-emb' }, [
    el('div', { class: 'ia-anim__label' }, 'Token and id'),
    el('div', { class: 'ia-anim__label' }, `Embedding table: ${EMBED_DIM} numbers in each row`),
    el('div', { class: 'ia-anim__label' }, 'One vector for each token'),
    el('div', { class: 'ia-tf-emb__toks' }, toks),
    table,
    el('div', { class: 'ia-tf-emb__outs' }, outs),
    links,
  ]);
  root.replaceChildren(grid);

  // Draw the lines after the layout is known, and again when the size changes.
  function drawLinks() {
    const box = grid.getBoundingClientRect();
    links.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const curve = (a, b) => {
      const mx = (a[0] + b[0]) / 2;
      return `M${a[0]},${a[1]} C${mx},${a[1]} ${mx},${b[1]} ${b[0]},${b[1]}`;
    };
    const right = (r) => [r.right - box.left + 4, r.top + r.height / 2 - box.top];
    const left = (r) => [r.left - box.left - 4, r.top + r.height / 2 - box.top];
    links.replaceChildren(...TOKENS.flatMap((t, i) => {
      const tok = toks[i].getBoundingClientRect();
      const row = tableRows.get(t.id).getBoundingClientRect();
      const out = outs[i].getBoundingClientRect();
      const style = `--tok: var(--tf-t${i})`;
      return [
        svg('path', { class: 'ia-tf-emb__link', style, d: curve(right(tok), left(row)) }),
        svg('path', { class: 'ia-tf-emb__link', style, d: curve(right(row), left(out)) }),
      ];
    }));
  }

  new ResizeObserver(drawLinks).observe(grid);
  if (document.fonts?.ready) document.fonts.ready.then(drawLinks);
}

/* -----------------------------
 * RMSNorm
 * ----------------------------- */
function buildRmsnorm(root) {
  const base = [0.9, -0.4, 1.6, 0.2, -1.1, 0.6, -0.2, 1.3];
  let scale = 1;
  const W = 300;
  const H = 190;
  const PAD = 14;
  const LIMIT = 3.2;
  const n = base.length;
  const slot = (W - 2 * PAD) / n;
  const yOf = (v) => H / 2 - (clamp(v, -LIMIT, LIMIT) / LIMIT) * (H / 2 - PAD);
  const vOf = (y) => ((H / 2 - y) / (H / 2 - PAD)) * LIMIT;

  function chart(title, cls) {
    const bars = Array.from({ length: n }, (_, i) => svg('rect', { class: 'ia-tf-bar', x: PAD + i * slot + slot * 0.18, width: slot * 0.64 }));
    const guideTop = svg('line', { class: 'ia-tf-guide', x1: PAD, x2: W - PAD });
    const guideBottom = svg('line', { class: 'ia-tf-guide', x1: PAD, x2: W - PAD });
    const guideLabel = svg('text', { class: 'ia-tf-guide-label', x: PAD, 'text-anchor': 'start' });
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: `ia-tf-chart ${cls}`, role: 'img', 'aria-label': title }, [
      svg('line', { class: 'ia-tf-zero', x1: PAD, x2: W - PAD, y1: H / 2, y2: H / 2 }),
      guideTop, guideBottom, guideLabel, ...bars,
    ]);
    return {
      root,
      set(values, guide, label) {
        values.forEach((v, i) => {
          const y = yOf(v);
          bars[i].setAttribute('y', Math.min(y, H / 2).toFixed(1));
          bars[i].setAttribute('height', Math.max(1, Math.abs(y - H / 2)).toFixed(1));
          bars[i].classList.toggle('is-neg', v < 0);
        });
        for (const [line, v] of [[guideTop, guide], [guideBottom, -guide]]) {
          line.setAttribute('y1', yOf(v).toFixed(1));
          line.setAttribute('y2', yOf(v).toFixed(1));
        }
        guideLabel.setAttribute('y', Math.max(11, yOf(guide) - 5).toFixed(1));
        guideLabel.textContent = label;
      },
    };
  }

  const input = chart('Input vector', 'is-input');
  const output = chart('Output vector', 'is-output');
  const rmsOut = el('b', { class: 'ia-tf-num' });
  const formula = el('div', { class: 'ia-tf-formula' });
  const slider = el('input', { type: 'range', min: -2, max: 2, step: 0.01, value: 0, 'aria-label': 'Scale of the input' });
  const sliderOut = el('b', { class: 'ia-tf-num' });

  root.replaceChildren(
    el('div', { class: 'ia-tf-toolbar' }, [
      el('span', { class: 'ia-anim__label' }, 'Multiply the input by'),
      slider,
      sliderOut,
    ]),
    el('div', { class: 'ia-tf-rms__cols' }, [
      el('div', {}, [el('div', { class: 'ia-anim__label' }, 'Input: drag a bar'), input.root]),
      el('div', { class: 'ia-tf-rms__mid' }, [el('span', { class: 'ia-tf-arrow' }, '÷ RMS →'), el('span', { class: 'ia-anim__label' }, 'RMS'), rmsOut]),
      el('div', {}, [el('div', { class: 'ia-anim__label' }, 'Output'), output.root]),
    ]),
    formula,
  );

  function draw() {
    const x = base.map((v) => v * scale);
    const rms = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / n);
    const y = x.map((v) => v / rms);
    input.set(x, rms, `±RMS = ±${fmt(rms)}`);
    output.set(y, 1, '±1');
    rmsOut.textContent = fmt(rms);
    sliderOut.textContent = `× ${fmt(scale)}`;
    formula.replaceChildren(
      el('span', {}, 'RMS = √( ('),
      ...x.flatMap((v, i) => [i ? ' + ' : '', el('span', { class: 'ia-tf-num' }, v < 0 ? `(${fmt(v, 1)})²` : `${fmt(v, 1)}²`)]),
      el('span', {}, ` ) / ${n} ) = `),
      el('b', { class: 'ia-tf-num' }, fmt(rms)),
    );
  }

  let dragging = false;
  function setFromPointer(e) {
    const r = input.root.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    const i = clamp(Math.floor((px - PAD) / slot), 0, n - 1);
    base[i] = clamp(vOf(py), -LIMIT, LIMIT) / scale;
    draw();
  }
  input.root.addEventListener('pointerdown', (e) => {
    dragging = true;
    input.root.setPointerCapture(e.pointerId);
    setFromPointer(e);
  });
  input.root.addEventListener('pointermove', (e) => { if (dragging) setFromPointer(e); });
  input.root.addEventListener('pointerup', () => { dragging = false; });
  slider.addEventListener('input', () => {
    scale = 2 ** Number(slider.value);
    draw();
  });
  draw();
}

/* -----------------------------
 * Attention
 * ----------------------------- */
const VALUE_DIM = 8;

// Made-up scores for four heads. Each head has a simple pattern on top of a little noise.
function headScores() {
  const rand = seeded(5);
  const n = TOKENS.length;
  const noise = () => Array.from({ length: n }, () => Array.from({ length: n }, () => gauss(rand) * 0.45));
  const heads = [
    { name: 'Head 1', about: 'The head looks mostly at the token just before.', s: noise() },
    { name: 'Head 2', about: 'The head looks mostly at the first token.', s: noise() },
    { name: 'Head 3', about: 'The head links tokens that are alike, e.g., ␣the with the, and ␣hat with ␣cat.', s: noise() },
    { name: 'Head 4', about: 'The head spreads its attention over all the tokens it can see.', s: noise() },
  ];
  for (let i = 0; i < n; i++) {
    if (i > 0) heads[0].s[i][i - 1] += 3;
    else heads[0].s[i][i] += 3;
    heads[1].s[i][0] += 2.6;
    heads[2].s[i][i] += 1.4;
    for (let j = 0; j < n; j++) heads[3].s[i][j] *= 0.35;
  }
  heads[2].s[3][0] += 3.2;
  heads[2].s[4][1] += 2.8;
  return heads;
}

function buildAttention(root) {
  const n = TOKENS.length;
  const heads = headScores();
  const values = randMat(seeded(17), n, VALUE_DIM, 0.9);
  const STEPS = ['1 Scores', '2 Mask', '3 Softmax', '4 Mix'];
  let head = 0;
  let step = 0;
  let query = n - 1;

  const cap = caption();
  const about = el('p', { class: 'ia-tf-about' });
  const headSeg = makeSeg(heads.map((h) => h.name), (i) => { head = i; draw(); });
  const stepSeg = makeSeg(STEPS, (i) => { step = i; draw(); }, { cls: 'is-steps' });
  const prev = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => { step = Math.max(0, step - 1); draw(); } }, 'Prev');
  const next = el('button', { type: 'button', class: 'ia-tf-btn is-primary', onclick: () => { step = Math.min(STEPS.length - 1, step + 1); draw(); } }, 'Next');

  // The sentence with arcs from the selected token.
  const AW = 560;
  const AH = 150;
  const ax = (j) => 50 + (j * (AW - 100)) / (n - 1);
  const baseY = AH - 34;
  const arcs = svg('g');
  const words = TOKENS.map((t, j) => {
    const g = svg('g', { class: 'ia-tf-word', transform: `translate(${ax(j)}, ${baseY})`, style: `--tok: var(--tf-t${j})`, onclick: () => { query = j; draw(); } }, [
      svg('rect', { x: -32, y: -14, width: 64, height: 28, rx: 2 }),
      svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, t.text),
      svg('text', { class: 'ia-tf-word__pos', y: 26, 'text-anchor': 'middle' }, `position ${j}`),
    ]);
    return g;
  });
  const arcSvg = svg('svg', { viewBox: `0 0 ${AW} ${AH}`, class: 'ia-tf-arcs', role: 'img', 'aria-label': 'Attention from the selected token' }, [arcs, ...words]);

  // The matrix of scores or weights.
  const cells = [];
  const grid = el('div', { class: 'ia-tf-matrix', style: `--n: ${n}` });
  grid.append(el('span', { class: 'ia-tf-matrix__corner' }, 'from ↓  to →'));
  TOKENS.forEach((t, j) => grid.append(el('span', { class: 'ia-tf-matrix__col' }, tokChip(j))));
  grid.append(el('span', { class: 'ia-tf-matrix__sumh' }, 'sum'));
  const sums = [];
  for (let i = 0; i < n; i++) {
    grid.append(el('button', { type: 'button', class: 'ia-tf-matrix__row', onclick: () => { query = i; draw(); } }, tokChip(i)));
    cells[i] = [];
    for (let j = 0; j < n; j++) {
      const c = el('span', { class: 'ia-tf-matrix__cell', onclick: () => { query = i; draw(); } });
      c.addEventListener('pointerenter', () => explainCell(i, j));
      c.addEventListener('pointerleave', () => describe());
      cells[i][j] = c;
      grid.append(c);
    }
    sums[i] = el('span', { class: 'ia-tf-matrix__sum ia-tf-num' });
    grid.append(sums[i]);
  }

  const mix = el('div', { class: 'ia-tf-mix' });

  root.replaceChildren(
    el('div', { class: 'ia-tf-toolbar' }, [headSeg.root]),
    about,
    el('div', { class: 'ia-tf-toolbar' }, [stepSeg.root, el('span', { class: 'ia-tf-spacer' }), prev, next]),
    cap,
    arcSvg,
    el('div', { class: 'ia-tf-attn__cols' }, [
      el('div', {}, [el('div', { class: 'ia-anim__label' }, 'One row for each token. Select a row.'), grid]),
      el('div', {}, [el('div', { class: 'ia-anim__label' }, 'Mix the value vectors'), mix]),
    ]),
  );

  const masked = (i, j) => step >= 1 && j > i;
  const weightsFor = (i) => softmax(heads[head].s[i].map((v, j) => (j > i ? -Infinity : v)));

  function explainCell(i, j) {
    if (masked(i, j)) {
      cap.replaceChildren(tokChip(i), ' cannot look at ', tokChip(j), ', because ', tokChip(j), ' comes later in the text.');
    } else if (step >= 2) {
      cap.replaceChildren(tokChip(i), ' gives ', tokChip(j), ` a weight of ${fmt(weightsFor(i)[j])}.`);
    } else {
      cap.replaceChildren('The score of ', tokChip(i), ' for ', tokChip(j), ` is ${fmt(heads[head].s[i][j], 1)}.`);
    }
  }

  function describe() {
    const lines = [
      ['Each token gives a score to each token. A high score means a good match. The scores are made up.'],
      ['A token cannot look at the tokens after it, so the mask removes those scores.'],
      ['Softmax changes the scores of each row into weights. The weights of a row are 0 or more, and they add up to 1.'],
      ['The output for ', tokChip(query), ' is the value vectors of the tokens, multiplied by their weights and added together.'],
    ];
    cap.replaceChildren(...lines[step]);
  }

  function drawArcs() {
    const w = weightsFor(query);
    arcs.replaceChildren();
    for (let j = 0; j < n; j++) {
      if (j === query) continue;
      const future = j > query;
      if (future && step >= 1) continue;
      const x1 = ax(query);
      const x2 = ax(j);
      const lift = 26 + Math.abs(x2 - x1) * 0.28;
      const d = `M${x1},${baseY - 15} C${x1},${baseY - 15 - lift} ${x2},${baseY - 15 - lift} ${x2},${baseY - 15}`;
      const strength = step >= 2 ? w[j] : sigmoid(heads[head].s[query][j] - 1);
      arcs.append(svg('path', {
        class: `ia-tf-arc${future ? ' is-future' : ''}${step < 2 ? ' is-score' : ''}`,
        d,
        style: `stroke-width: ${(1 + strength * 9).toFixed(2)}; opacity: ${(0.25 + strength * 0.75).toFixed(2)}`,
      }));
    }
    if (step >= 2) {
      const self = w[query];
      arcs.append(svg('circle', { class: 'ia-tf-arc-self', cx: ax(query), cy: baseY - 24, r: (3 + self * 12).toFixed(1), style: `opacity: ${(0.3 + self * 0.7).toFixed(2)}` }));
    }
    words.forEach((g, j) => {
      g.classList.toggle('is-query', j === query);
      g.classList.toggle('is-hidden', step >= 1 && j > query);
    });
  }

  function drawMatrix() {
    for (let i = 0; i < n; i++) {
      const w = weightsFor(i);
      for (let j = 0; j < n; j++) {
        const c = cells[i][j];
        const s = heads[head].s[i][j];
        c.classList.toggle('is-masked', masked(i, j));
        c.classList.toggle('is-query', i === query);
        if (masked(i, j)) {
          c.textContent = '−∞';
          c.style.background = '';
        } else if (step >= 2) {
          c.textContent = fmt(w[j]);
          c.style.background = `color-mix(in srgb, var(--tf-weight) ${Math.round(w[j] * 90)}%, var(--tf-cell))`;
        } else {
          c.textContent = fmt(s, 1);
          c.style.background = heat(s, 4);
        }
      }
      sums[i].textContent = step >= 2 ? '1.00' : '';
    }
  }

  function drawMix() {
    if (step < 3) {
      mix.replaceChildren(el('p', { class: 'ia-tf-hint' }, 'Go to step 4 to see how the weights mix the value vectors.'));
      return;
    }
    const w = weightsFor(query);
    const out = Array(VALUE_DIM).fill(0);
    const lines = [];
    for (let j = 0; j <= query; j++) {
      values[j].forEach((v, k) => { out[k] += w[j] * v; });
      const scaled = makeStrip(VALUE_DIM, { max: 1.6 });
      scaled.set(values[j].map((v) => v * w[j]));
      lines.push(el('div', { class: 'ia-tf-mix__row', style: `--w: ${w[j].toFixed(3)}` }, [
        tokChip(j),
        el('span', { class: 'ia-tf-num ia-tf-mix__w' }, `${fmt(w[j])} ×`),
        scaled.root,
      ]));
    }
    const total = makeStrip(VALUE_DIM, { max: 1.6, cls: 'is-total' });
    total.set(out);
    mix.replaceChildren(...lines, el('div', { class: 'ia-tf-mix__row is-total' }, [
      el('span', { class: 'ia-tf-mix__eq' }, 'output for'),
      tokChip(query),
      total.root,
    ]));
  }

  function draw() {
    headSeg.select(head);
    stepSeg.select(step);
    prev.disabled = step === 0;
    next.disabled = step === STEPS.length - 1;
    about.textContent = heads[head].about;
    describe();
    drawArcs();
    drawMatrix();
    drawMix();
  }

  draw();
}

/* -----------------------------
 * SwiGLU
 * ----------------------------- */
const FF_IN = 6;
const FF_MID = 16;

function buildSwiglu(root) {
  const rand = seeded(23);
  const W1 = randMat(rand, FF_MID, FF_IN, 0.55);
  const W3 = randMat(rand, FF_MID, FF_IN, 0.55);
  const W2 = randMat(rand, FF_IN, FF_MID, 0.35);
  const inputs = randMat(seeded(29), TOKENS.length, FF_IN, 1);
  let token = 1;
  let focus = null;

  // The SiLU curve.
  const PW = 320;
  const PH = 200;
  const X0 = -6;
  const X1 = 6;
  const Y0 = -1;
  const Y1 = 6;
  const px = (x) => 30 + ((x - X0) / (X1 - X0)) * (PW - 44);
  const py = (y) => PH - 24 - ((y - Y0) / (Y1 - Y0)) * (PH - 36);
  const pts = [];
  for (let x = X0; x <= X1 + 1e-9; x += 0.1) pts.push(`${px(x).toFixed(1)},${py(silu(x)).toFixed(1)}`);
  const dot = svg('circle', { class: 'ia-tf-plot__dot', r: 6 });
  const dotLabel = svg('text', { class: 'ia-tf-plot__label' });
  const plot = svg('svg', { viewBox: `0 0 ${PW} ${PH}`, class: 'ia-tf-plot', role: 'img', 'aria-label': 'The SiLU curve' }, [
    svg('line', { class: 'ia-tf-zero', x1: px(X0), x2: px(X1), y1: py(0), y2: py(0) }),
    svg('line', { class: 'ia-tf-zero', x1: px(0), x2: px(0), y1: py(Y0), y2: py(Y1) }),
    svg('line', { class: 'ia-tf-guide', x1: px(0), y1: py(0), x2: px(Y1), y2: py(Y1) }),
    svg('text', { class: 'ia-tf-guide-label', x: px(4.4), y: py(5.2) }, 'y = x'),
    svg('polyline', { class: 'ia-tf-plot__curve', points: pts.join(' ') }),
    svg('text', { class: 'ia-tf-guide-label', x: px(X1), y: py(0) + 16, 'text-anchor': 'end' }, 'x'),
    dot, dotLabel,
  ]);
  const plotOut = el('div', { class: 'ia-tf-formula' });

  function setDot(x) {
    const xx = clamp(x, X0, X1);
    dot.setAttribute('cx', px(xx).toFixed(1));
    dot.setAttribute('cy', py(silu(xx)).toFixed(1));
    dotLabel.setAttribute('x', (px(xx) + (xx > 3 ? -10 : 10)).toFixed(1));
    dotLabel.setAttribute('y', (py(silu(xx)) - 10).toFixed(1));
    dotLabel.setAttribute('text-anchor', xx > 3 ? 'end' : 'start');
    dotLabel.textContent = `(${fmt(xx, 1)}, ${fmt(silu(xx))})`;
    plotOut.replaceChildren(
      'SiLU(', el('span', { class: 'ia-tf-num' }, fmt(xx)), ') = ',
      el('span', { class: 'ia-tf-num' }, fmt(xx)), ' × sigmoid(', el('span', { class: 'ia-tf-num' }, fmt(xx)), ') = ',
      el('span', { class: 'ia-tf-num' }, fmt(xx)), ' × ', el('span', { class: 'ia-tf-num' }, fmt(sigmoid(xx))), ' = ',
      el('b', { class: 'ia-tf-num' }, fmt(silu(xx))),
    );
  }

  // The gated layer for one token.
  const picks = makeSeg(TOKENS.map((t) => t.text), (i) => { token = i; draw(); });
  picks.buttons.forEach((b, i) => b.style.setProperty('--tok', `var(--tf-t${i})`));
  const stage = (label, size, note) => {
    const strip = makeStrip(size, { max: 2.2, cls: size === FF_MID ? 'is-wide' : '' });
    const row = el('div', { class: 'ia-tf-ff__row' }, [
      el('div', { class: 'ia-tf-ff__label' }, [el('b', {}, label), el('span', {}, note)]),
      strip.root,
    ]);
    return { strip, row };
  };
  const sIn = stage('Input', FF_IN, `${FF_IN} numbers`);
  const sGate = stage('Gate', FF_MID, `W1 × input, ${FF_MID} numbers`);
  const sAct = stage('SiLU of the gate', FF_MID, 'near 0 where the gate is negative');
  const sUp = stage('Up', FF_MID, `W3 × input, ${FF_MID} numbers`);
  const sProd = stage('Gate × up', FF_MID, 'one number at a time');
  const sOut = stage('Output', FF_IN, `W2 × (gate × up), ${FF_IN} numbers`);
  const wide = [sGate, sAct, sUp, sProd];
  const readout = el('p', { class: 'ia-tf-caption ia-anim__caption', 'aria-live': 'polite' });
  wide.forEach((s) => s.strip.cells.forEach((c, k) => {
    c.addEventListener('pointerenter', () => { focus = k; paintFocus(); });
  }));

  let current = null;
  function paintFocus() {
    wide.forEach((s) => s.strip.cells.forEach((c, k) => c.classList.toggle('is-focus', k === focus)));
    if (focus == null || !current) {
      readout.textContent = 'Point at a column of the four wide rows to see its calculation.';
      return;
    }
    const g = current.gate[focus];
    const u = current.up[focus];
    readout.replaceChildren(
      `Column ${focus + 1}: SiLU(${fmt(g)}) = ${fmt(silu(g))}, and ${fmt(silu(g))} × ${fmt(u)} = `,
      el('b', {}, fmt(silu(g) * u)),
      g < -1 ? '. The gate is negative, so this column adds almost nothing.' : '.',
    );
    setDot(g);
  }

  root.replaceChildren(
    el('div', { class: 'ia-tf-ff__cols' }, [
      el('div', {}, [el('div', { class: 'ia-anim__label' }, 'The SiLU curve'), plot, plotOut]),
      el('div', {}, [
        el('div', { class: 'ia-tf-toolbar' }, [el('span', { class: 'ia-anim__label' }, 'Token'), picks.root]),
        sIn.row, sGate.row, sAct.row, sUp.row, sProd.row, sOut.row,
        readout,
      ]),
    ]),
  );

  function draw() {
    picks.select(token);
    const x = inputs[token];
    const gate = matVec(W1, x);
    const up = matVec(W3, x);
    const act = gate.map(silu);
    const prod = act.map((a, k) => a * up[k]);
    const out = matVec(W2, prod);
    current = { gate, up };
    sIn.strip.set(x);
    sGate.strip.set(gate);
    sAct.strip.set(act);
    sUp.strip.set(up);
    sProd.strip.set(prod);
    sOut.strip.set(out);
    paintFocus();
  }

  setDot(1.5);
  draw();
}

/* -----------------------------
 * Next token
 * ----------------------------- */
function buildOutput(root) {
  const cands = [
    { text: '.', logit: 3.1 },
    { text: '␣and', logit: 2.2 },
    { text: '␣on', logit: 1.6 },
    { text: '␣was', logit: 1.2 },
    { text: '␣in', logit: 0.9 },
    { text: '!', logit: 0.6 },
    { text: '␣with', logit: 0.2 },
    { text: '␣is', logit: -0.4 },
  ];
  const LIM = 5;
  const cap = caption();
  const sentence = el('div', { class: 'ia-tf-next' });

  const rows = cands.map((c, i) => {
    const logitBar = el('i');
    const logitTrack = el('span', { class: 'ia-tf-logit' }, [el('span', { class: 'ia-tf-logit__zero' }), logitBar]);
    const logitNum = el('span', { class: 'ia-tf-num' });
    const probBar = el('i');
    const probNum = el('span', { class: 'ia-tf-num' });
    const row = el('div', { class: 'ia-tf-out__row' }, [
      el('span', { class: 'ia-tf-out__tok' }, c.text),
      logitTrack, logitNum,
      el('span', { class: 'ia-tf-prob' }, probBar), probNum,
    ]);
    return { c, logitBar, logitNum, probBar, probNum, row, i };
  });

  const total = el('b', { class: 'ia-tf-num' });
  root.replaceChildren(
    sentence,
    cap,
    el('div', { class: 'ia-tf-out__head' }, [
      el('span', { class: 'ia-anim__label' }, 'Token'),
      el('span', { class: 'ia-anim__label' }, 'Score (logit)'),
      el('span'),
      el('span', { class: 'ia-anim__label' }, 'Probability'),
      el('span'),
    ]),
    ...rows.map((r) => r.row),
    el('div', { class: 'ia-tf-out__total' }, ['Sum of the probabilities: ', total]),
  );

  function draw() {
    const p = softmax(rows.map((r) => r.c.logit));
    let best = 0;
    rows.forEach((r, i) => {
      const v = r.c.logit;
      const half = Math.abs(v) / LIM / 2;
      r.logitBar.style.left = `${(v >= 0 ? 50 : 50 - half * 100).toFixed(1)}%`;
      r.logitBar.style.width = `${(half * 100).toFixed(1)}%`;
      r.logitBar.classList.toggle('is-neg', v < 0);
      r.logitNum.textContent = fmt(v, 1);
      r.probBar.style.width = `${(p[i] * 100).toFixed(1)}%`;
      r.probNum.textContent = `${(p[i] * 100).toFixed(1)}%`;
      if (p[i] > p[best]) best = i;
    });
    rows.forEach((r, i) => r.row.classList.toggle('is-best', i === best));
    total.textContent = fmt(p.reduce((a, b) => a + b, 0));
    sentence.replaceChildren(
      ...TOKENS.map((_, i) => tokChip(i)),
      el('span', { class: 'ia-tf-tok is-next' }, rows[best].c.text),
    );
    cap.replaceChildren(
      'The most likely next token is ',
      el('span', { class: 'ia-tf-tok is-next' }, rows[best].c.text),
      `, with a probability of ${(p[best] * 100).toFixed(1)}%.`,
    );
  }

  draw();
}

/* -----------------------------
 * Shapes
 * ----------------------------- */
function buildShapes(root) {
  const PRESET = { B: 8, T: 256, d: 512, h: 16, ff: 1344, V: 10000, L: 4 };
  const cfg = { ...PRESET };
  const fields = [
    { key: 'B', label: 'Batch', steps: [1, 2, 4, 8, 16, 32, 64] },
    { key: 'T', label: 'Tokens', steps: [16, 64, 128, 256, 512, 1024, 2048] },
    { key: 'd', label: 'd_model', steps: [64, 128, 256, 384, 512, 768, 1024, 1600] },
    { key: 'h', label: 'Heads', steps: [1, 2, 4, 6, 8, 12, 16, 25] },
    { key: 'ff', label: 'd_ff', steps: [256, 512, 1024, 1344, 2048, 3072, 4096, 6400] },
    { key: 'V', label: 'Vocabulary', steps: [256, 1000, 10000, 32000, 50257] },
    { key: 'L', label: 'Layers', steps: [1, 2, 4, 6, 12, 24, 48] },
  ];

  const inputs = el('div', { class: 'ia-tf-shapes__in' });
  const outs = new Map();
  for (const f of fields) {
    const out = el('b', { class: 'ia-tf-num' });
    const move = (dir) => {
      const k = f.steps.indexOf(cfg[f.key]);
      cfg[f.key] = f.steps[clamp((k < 0 ? 0 : k) + dir, 0, f.steps.length - 1)];
      draw(f.key);
    };
    inputs.append(el('div', { class: 'ia-tf-stepper' }, [
      el('span', { class: 'ia-anim__label' }, f.label),
      el('span', { class: 'ia-tf-stepper__box' }, [
        el('button', { type: 'button', 'aria-label': `Less ${f.label}`, onclick: () => move(-1) }, '−'),
        out,
        el('button', { type: 'button', 'aria-label': `More ${f.label}`, onclick: () => move(1) }, '+'),
      ]),
    ]));
    outs.set(f.key, out);
  }
  const preset = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => { Object.assign(cfg, PRESET); draw(); } }, 'Reset to the assignment model');

  const list = el('div', { class: 'ia-tf-shapes__list' });
  const checks = el('div', { class: 'ia-tf-checks' });
  root.replaceChildren(el('div', { class: 'ia-tf-toolbar' }, [inputs, preset]), list, checks);

  const rowsDef = (c) => {
    const dk = c.d / c.h;
    return [
      { name: 'Token ids', shape: ['B', 'T'], n: c.B * c.T, note: 'the input' },
      { name: 'Embeddings', shape: ['B', 'T', 'd_model'], n: c.B * c.T * c.d, note: 'one vector for each token' },
      { name: 'Q, K or V of the heads', shape: ['B', 'heads', 'T', 'd_model / heads'], n: c.B * c.h * c.T * dk, note: `each head works with ${Number.isInteger(dk) ? dk : fmt(dk, 1)} numbers` },
      { name: 'Attention scores', shape: ['B', 'heads', 'T', 'T'], n: c.B * c.h * c.T * c.T, note: 'one score for each pair of tokens' },
      { name: 'Attention output', shape: ['B', 'T', 'd_model'], n: c.B * c.T * c.d, note: 'added to the stream' },
      { name: 'Feed-forward middle', shape: ['B', 'T', 'd_ff'], n: c.B * c.T * c.ff, note: 'the wide part of SwiGLU' },
      { name: 'Logits', shape: ['B', 'T', 'vocabulary'], n: c.B * c.T * c.V, note: 'one score for each token of the vocabulary' },
    ];
  };

  let last = null;
  function draw(changed) {
    for (const f of fields) outs.get(f.key).textContent = fmtInt(cfg[f.key]);
    const rows = rowsDef(cfg);
    const maxLog = Math.log10(Math.max(...rows.map((r) => r.n)));
    const values = { B: cfg.B, T: cfg.T, d_model: cfg.d, heads: cfg.h, d_ff: cfg.ff, vocabulary: cfg.V, 'd_model / heads': cfg.d / cfg.h };
    list.replaceChildren(...rows.map((r, k) => {
      const flash = last && last[k] !== r.n && changed;
      return el('div', { class: `ia-tf-shapes__row${flash ? ' is-flash' : ''}` }, [
        el('span', { class: 'ia-tf-shapes__name' }, [el('b', {}, r.name), el('small', {}, r.note)]),
        el('span', { class: 'ia-tf-shapes__shape' }, r.shape.map((s) => el('span', { class: 'ia-tf-dim', title: s }, Number.isInteger(values[s]) ? fmtInt(values[s]) : fmt(values[s], 1)))),
        el('span', { class: 'ia-tf-shapes__bar' }, el('i', { style: `width: ${Math.max(2, (Math.log10(Math.max(1, r.n)) / maxLog) * 100).toFixed(1)}%` })),
        el('span', { class: 'ia-tf-num ia-tf-shapes__n' }, fmtInt(r.n)),
      ]);
    }));
    last = rows.map((r) => r.n);

    const dk = cfg.d / cfg.h;
    const okHeads = Number.isInteger(dk);
    const okPairs = okHeads && dk % 2 === 0;
    checks.replaceChildren(
      el('span', { class: `ia-tf-check ${okHeads ? 'is-ok' : 'is-bad'}` }, okHeads ? `d_model / heads = ${dk}` : 'd_model must divide into the heads evenly'),
      el('span', { class: `ia-tf-check ${okPairs ? 'is-ok' : 'is-bad'}` }, okPairs ? 'each head has an even size, so RoPE can make pairs' : 'RoPE needs an even size for each head'),
      el('span', { class: 'ia-tf-check' }, `d_ff / d_model = ${fmt(cfg.ff / cfg.d)}`),
      el('span', { class: 'ia-tf-check' }, `${cfg.L} layers, each with the same shapes`),
    );
  }

  draw();
}

/* -----------------------------
 * Start
 * ----------------------------- */
const BUILDERS = {
  '[data-tf-embed]': buildEmbed,
  '[data-tf-rmsnorm]': buildRmsnorm,
  '[data-tf-attention]': buildAttention,
  '[data-tf-swiglu]': buildSwiglu,
  '[data-tf-output]': buildOutput,
  '[data-tf-shapes]': buildShapes,
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
