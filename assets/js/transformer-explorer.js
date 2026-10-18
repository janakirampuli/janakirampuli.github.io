/*
  Transformer explorer: [data-tf-explorer]
  A 3D view of the model. Each token is a lane that runs from left to right through
  the parts of the model. The reader can turn the view, play a pass, and select a part.
  When a part is selected, the camera flies to it and the part opens to show what is inside.
  Loaded on demand by interactive.js. If WebGL is not available, it shows a flat list.
*/

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js';

const TOKENS = ['the', '␣cat', '␣saw', '␣the', '␣hat'];
const IDS = [1169, 3797, 2497, 262, 6877];
const GUESSES = ['␣dog', '␣sat', '␣the', '␣cat', '.'];
const GUESS_P = [0.18, 0.31, 0.42, 0.27, 0.55];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
  for (const ch of Array.isArray(children) ? children : [children]) {
    if (ch == null) continue;
    node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
  }
  return node;
}

function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -----------------
 * The parts of the model, from left to right
 * ----------------- */
const ABOUT = {
  ids: 'The tokenizer changes the text into numbers, so each token of the sentence has an id from the vocabulary.',
  embed: 'Each id selects one row of a large table. The row becomes the vector of the token.',
  norm: 'RMSNorm gives each vector the same norm, so the next part gets numbers in a steady range.',
  attn: 'Each token looks at the tokens before it and takes in some of their information. RoPE adds the positions here. Attention is the only part where tokens share information.',
  add: 'The output of the part before is added to the stream. The stream keeps everything that the earlier parts added.',
  ffn: 'Each token goes alone through the same small network. It works on the information that the token already has.',
  final: 'The model uses one more RMSNorm after the last layer.',
  head: 'The LM head is one more weight matrix, and it changes each vector into one score for each token of the vocabulary.',
  out: 'Softmax changes the scores into probabilities. At each position, the model gives its guess for the next token.',
};

// What the open view of a part shows.
const INSIDE = {
  embed: 'Inside: the table has one row for each token of the vocabulary. Each id pulls out its own row.',
  norm: 'Inside: the spheres show the norm of each vector. On the left the norms are different, because each embedding row is learned on its own and each earlier part added a different change to each token. After RMSNorm, all the vectors have the same norm.',
  attn: 'Inside: each token makes a query (Q), a key (K) and a value (V). The grid shows the weights, with one row for each token. The cells above the diagonal are empty, because a token can\'t look ahead.',
  add: 'Here the branch comes back down, and its result is added to the stream. The lane under the parts is the stream itself, and it goes past the parts without a change, so nothing earlier is lost.',
  ffn: 'Inside: each token widens to a column of d_ff numbers. The gate turns some of them down, and W2 brings the token back to d_model numbers.',
  head: 'Inside: one score for each token of the vocabulary. The tallest bar is the most likely next token.',
};

function makeStages(layers) {
  const stages = [];
  const spans = [];
  let x = 0;
  const push = (stage, gap) => {
    stages.push({ ...stage, x, index: stages.length });
    x += gap;
  };
  push({ kind: 'ids', title: 'Token ids', about: ABOUT.ids, shape: '5 ids', href: '#from-text-to-vectors' }, 1.25);
  push({ kind: 'embed', title: 'Embedding', about: ABOUT.embed, shape: '5 × d_model', href: '#from-text-to-vectors', h: 1.8, main: true }, 1.35);
  // In a layer, the parts sit on a branch above the stream (`branch: true`).
  // The stream itself passes under them, and the branch comes back down at "Add".
  for (let l = 0; l < layers; l++) {
    const from = x - 0.55;
    const tag = layers > 1 ? `Layer ${l + 1}` : 'Layer × N';
    push({ kind: 'norm', title: 'RMSNorm', layer: tag, about: ABOUT.norm, shape: '5 × d_model', href: '#rmsnorm', h: 1.0, branch: true }, 0.72);
    push({ kind: 'attn', title: 'Attention', layer: tag, about: ABOUT.attn, shape: '5 × d_model', href: '#attention', h: 1.8, main: true, branch: true }, 0.82);
    push({ kind: 'add', title: 'Add', layer: tag, about: ABOUT.add, shape: '5 × d_model', href: '#the-residual-stream' }, 0.75);
    push({ kind: 'norm', title: 'RMSNorm', layer: tag, about: ABOUT.norm, shape: '5 × d_model', href: '#rmsnorm', h: 1.0, branch: true }, 0.72);
    push({ kind: 'ffn', title: 'SwiGLU', layer: tag, about: ABOUT.ffn, shape: '5 × d_ff inside', href: '#the-feed-forward-layer', h: 1.6, main: true, branch: true }, 0.82);
    push({ kind: 'add', title: 'Add', layer: tag, about: ABOUT.add, shape: '5 × d_model', href: '#the-residual-stream' }, 1.15);
    spans.push({ from, to: x - 0.75, tag });
  }
  push({ kind: 'norm', title: 'Final RMSNorm', about: ABOUT.final, shape: '5 × d_model', href: '#rmsnorm', h: 1.1 }, 0.85);
  push({ kind: 'head', title: 'LM head', about: ABOUT.head, shape: '5 × vocabulary', href: '#from-vectors-to-the-next-token', h: 1.8, main: true }, 1.25);
  push({ kind: 'out', title: 'Next token', about: ABOUT.out, shape: '5 guesses', href: '#from-vectors-to-the-next-token', main: true }, 0);
  return { stages, spans, length: x };
}

/* -----------------
 * Fallback without WebGL
 * ----------------- */
function flatList(root, layers) {
  const { stages } = makeStages(layers);
  root.classList.add('is-flat');
  root.replaceChildren(el('ol', { class: 'ia-tf-flat' }, stages.map((s) => el('li', {}, [
    el('a', { href: s.href }, [el('b', {}, s.title), s.layer ? el('small', {}, s.layer) : null]),
  ]))));
}

/* -----------------
 * 3D view
 * ----------------- */
async function buildExplorer(root) {
  const layers = clamp(Number(root.dataset.layers) || 1, 1, 4);
  let THREE;
  try {
    THREE = await import(THREE_URL);
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('No WebGL');
  } catch (e) {
    console.warn('Explorer falls back to a list', e);
    flatList(root, layers);
    return;
  }

  const { stages, spans, length } = makeStages(layers);
  const N = TOKENS.length;
  const LANE_Y = 1.1; // the height of the stream
  const BRANCH_Y = 2.7; // the height of the parts on a branch
  const DEPTH = 5.3;
  const laneZ = (i) => (i - (N - 1) / 2) * 0.98;
  const X0 = -0.9;
  const X1 = length + 1.1;
  const EMBED_X = stages.find((s) => s.kind === 'embed').x;
  for (const s of stages) s.cy = s.branch ? BRANCH_Y : LANE_Y;

  /* DOM */
  const canvas = el('canvas', { class: 'ia-tf-x__canvas', 'aria-label': 'A 3D view of a transformer language model' });
  const labels = el('div', { class: 'ia-tf-x__labels', 'aria-hidden': 'true' });
  const card = el('div', { class: 'ia-tf-x__card', 'aria-live': 'polite' });
  // On a phone, the buttons show only their icons.
  const btnText = (icon, text) => [el('span', { 'aria-hidden': 'true' }, icon), el('span', { class: 'ia-tf-x__txt' }, ` ${text}`)];
  const playBtn = el('button', { type: 'button', class: 'ia-tf-x__btn is-primary', 'aria-label': 'Play a forward pass' }, btnText('▶', 'Play a forward pass'));
  const viewBtn = el('button', { type: 'button', class: 'ia-tf-x__btn ia-tf-x__overview' }, 'Overview');
  const head = el('div', { class: 'ia-tf-x__head' }, [
    el('div', { class: 'ia-tf-x__eyebrow' }, 'Interactive diagram'),
    el('div', { class: 'ia-tf-x__title' }, ['A transformer ', el('em', {}, 'language model')]),
    el('div', { class: 'ia-tf-x__stats' }, [
      el('span', {}, [el('b', {}, 'decoder-only')]),
      el('span', {}, [el('b', {}, '5'), ' tokens']),
      layers === 1
        ? el('span', {}, [el('b', {}, '1'), ' layer, repeated ', el('b', {}, 'N'), ' times'])
        : el('span', {}, [el('b', {}, String(layers)), ' layers']),
    ]),
  ]);
  const fullBtn = el('button', { type: 'button', class: 'ia-tf-x__btn', 'aria-label': 'Full screen' }, btnText('⛶', 'Full screen'));
  const tools = el('div', { class: 'ia-tf-x__tools' }, [playBtn, viewBtn, fullBtn]);
  root.tabIndex = 0;
  root.replaceChildren(canvas, labels, head, tools, card);

  /* Renderer */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 2, 0.1, 200);

  /* Colors from the page theme */
  const palette = {};
  function readPalette() {
    const cs = getComputedStyle(root);
    const get = (name, fb) => new THREE.Color((cs.getPropertyValue(name) || '').trim() || fb);
    palette.tok = [0, 1, 2, 3, 4].map((i) => get(`--tf-t${i}-hex`, '#888888'));
    palette.ink = get('--tf-ink', '#222222');
    palette.plate = get('--tf-plate', '#2a78d6');
    palette.attn = get('--tf-attn', '#8b5cf6');
    palette.ffn = get('--tf-ffn', '#1f9d6b');
    palette.grid = get('--tf-grid', '#999999');
    palette.pos = get('--tf-pos', '#e0602a');
    palette.neg = get('--tf-neg', '#2a78d6');
  }
  readPalette();

  /* Materials that follow the theme */
  const themed = [];
  function mat(Type, key, opts = {}) {
    const m = new Type({ transparent: true, depthWrite: false, ...opts });
    themed.push({ m, key });
    return m;
  }
  function applyPalette() {
    for (const { m, key } of themed) {
      const c = typeof key === 'function' ? key() : palette[key];
      if (c) m.color.copy(c);
    }
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const edgeGeo = new THREE.EdgesGeometry(boxGeo);

  /* Ground grid */
  {
    const pts = [];
    for (let x = Math.ceil(X0); x <= X1; x += 0.5) pts.push(x, 0, -DEPTH / 2 - 0.4, x, 0, DEPTH / 2 + 0.4);
    for (let z = -DEPTH / 2 - 0.4; z <= DEPTH / 2 + 0.41; z += 0.5) pts.push(X0, 0, z, X1, 0, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, mat(THREE.LineBasicMaterial, 'grid', { opacity: 0.18 })));
  }

  /* Layer outlines on the ground, and an arc that says "repeat N times" */
  for (const span of spans) {
    const shape = new THREE.Shape();
    const w = span.to - span.from;
    const d = DEPTH + 0.5;
    const r = 0.06;
    shape.moveTo(r, 0);
    shape.lineTo(w - r, 0);
    shape.quadraticCurveTo(w, 0, w, r);
    shape.lineTo(w, d - r);
    shape.quadraticCurveTo(w, d, w - r, d);
    shape.lineTo(r, d);
    shape.quadraticCurveTo(0, d, 0, d - r);
    shape.lineTo(0, r);
    shape.quadraticCurveTo(0, 0, r, 0);
    const fillMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(THREE.MeshBasicMaterial, 'plate', { opacity: 0.05, side: THREE.DoubleSide }));
    fillMesh.rotation.x = Math.PI / 2;
    fillMesh.position.set(span.from, 0.005, -d / 2);
    scene.add(fillMesh);
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(shape.getPoints(8).map((p) => new THREE.Vector3(p.x, 0, p.y))), mat(THREE.LineBasicMaterial, 'plate', { opacity: 0.45 }));
    line.position.set(span.from, 0.01, -d / 2);
    scene.add(line);
    span.anchor = new THREE.Vector3(span.from + 0.75, 0, d / 2);

    if (layers === 1) {
      // The arc goes from the end of the layer back to its start, behind the plates.
      const zBack = -DEPTH / 2 - 0.35;
      const yLow = BRANCH_Y + 1.15;
      const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(span.to, yLow, zBack),
        new THREE.Vector3(span.to, yLow + 1.0, zBack),
        new THREE.Vector3(span.from, yLow + 1.0, zBack),
        new THREE.Vector3(span.from, yLow, zBack),
      );
      const m = mat(THREE.MeshBasicMaterial, 'plate', { opacity: 0.75 });
      span.repeatMat = m;
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.025, 8, false), m));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 16), m);
      tip.position.set(span.from, yLow - 0.05, zBack);
      tip.rotation.z = Math.PI;
      scene.add(tip);
      span.repeatAt = new THREE.Vector3((span.from + span.to) / 2, yLow + 0.78, zBack);
    }
  }

  /* Lanes: one for each token. Before the embedding, a token is only an id, so its lane
     is a dashed line. After the embedding, the lane is the stream of the token. */
  const laneEnd = X1 - 0.6;
  for (let i = 0; i < N; i++) {
    const m = mat(THREE.MeshBasicMaterial, () => palette.tok[i], { opacity: 0.6 });
    const len = laneEnd - EMBED_X;
    const lane = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 10), m);
    lane.rotation.z = Math.PI / 2;
    lane.position.set(EMBED_X + len / 2, LANE_Y, laneZ(i));
    scene.add(lane);
    const dashed = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.15, LANE_Y, laneZ(i)), new THREE.Vector3(EMBED_X, LANE_Y, laneZ(i))]),
      mat(THREE.LineDashedMaterial, () => palette.tok[i], { opacity: 0.8, dashSize: 0.1, gapSize: 0.08 }),
    );
    dashed.computeLineDistances();
    scene.add(dashed);
  }

  /* Branches: in a layer, each token goes up from the stream, through RMSNorm and
     attention (or SwiGLU), and comes back down at "Add". */
  const branches = [];
  for (const s of stages) {
    if (s.kind !== 'add') continue;
    const start = stages[s.index - 2];
    const x0 = start.x - 0.3;
    const x1 = s.x;
    branches.push({ x0, x1 });
    const r = 0.22;
    for (let i = 0; i < N; i++) {
      const z = laneZ(i);
      const path = new THREE.CurvePath();
      path.add(new THREE.LineCurve3(new THREE.Vector3(x0, LANE_Y, z), new THREE.Vector3(x0, BRANCH_Y - r, z)));
      path.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, BRANCH_Y - r, z), new THREE.Vector3(x0, BRANCH_Y, z), new THREE.Vector3(x0 + r, BRANCH_Y, z)));
      path.add(new THREE.LineCurve3(new THREE.Vector3(x0 + r, BRANCH_Y, z), new THREE.Vector3(x1 - r, BRANCH_Y, z)));
      path.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(x1 - r, BRANCH_Y, z), new THREE.Vector3(x1, BRANCH_Y, z), new THREE.Vector3(x1, BRANCH_Y - r, z)));
      path.add(new THREE.LineCurve3(new THREE.Vector3(x1, BRANCH_Y - r, z), new THREE.Vector3(x1, LANE_Y, z)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, 96, 0.018, 6, false), mat(THREE.MeshBasicMaterial, () => palette.tok[i], { opacity: 0.45 }));
      scene.add(tube);
    }
  }

  // The height of a packet at x: on a branch it goes up through the parts.
  function packetY(x) {
    for (const b of branches) {
      if (x >= b.x0 - 0.01 && x <= b.x1 + 0.01) {
        const up = clamp((x - b.x0) / 0.2, 0, 1);
        const down = clamp((b.x1 - x) / 0.2, 0, 1);
        return lerp(LANE_Y, BRANCH_Y, Math.min(up, down));
      }
    }
    return LANE_Y;
  }

  /* Parts */
  const pickable = [];
  const outBars = [];

  for (const s of stages) {
    const group = new THREE.Group();
    group.position.x = s.x;
    s.group = group;
    s.faces = [];
    s.edges = [];
    s.fade = [];
    s.detailT = 0;

    const colorKey = s.kind === 'attn' ? 'attn' : s.kind === 'ffn' ? 'ffn' : s.kind === 'norm' ? 'ink' : 'plate';

    if (s.h) {
      const thick = s.kind === 'norm' ? 0.08 : 0.16;
      const face = new THREE.Mesh(boxGeo, mat(THREE.MeshBasicMaterial, colorKey, { opacity: 0.1 }));
      face.scale.set(thick, s.h, DEPTH);
      face.position.y = s.cy;
      const edge = new THREE.LineSegments(edgeGeo, mat(THREE.LineBasicMaterial, colorKey, { opacity: 0.55 }));
      edge.scale.copy(face.scale);
      edge.position.copy(face.position);
      group.add(face, edge);
      s.faces.push(face);
      s.edges.push(edge);
      face.userData.stage = s;
      pickable.push(face);
      s.top = s.cy + s.h / 2;
    }

    // A part with no plate gets an invisible box, so that it can still be selected.
    const hitBox = (h, y) => {
      const hit = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ visible: false }));
      hit.scale.set(0.45, h, DEPTH);
      hit.position.y = y;
      hit.userData.stage = s;
      group.add(hit);
      pickable.push(hit);
    };

    if (s.kind === 'ids') {
      hitBox(0.6, LANE_Y);
      s.top = LANE_Y + 0.45;
    }

    if (s.kind === 'attn') {
      // Made-up weights: mostly the token before, and some for the first token.
      s.arcs = [];
      for (let i = 1; i < N; i++) {
        for (let j = 0; j < i; j++) {
          const w = j === i - 1 ? 0.95 : j === 0 ? 0.55 : 0.18;
          const za = laneZ(i);
          const zb = laneZ(j);
          const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(0, s.cy, za),
            new THREE.Vector3(0, s.cy + 0.3 + 0.18 * (i - j), (za + zb) / 2),
            new THREE.Vector3(0, s.cy, zb),
          );
          const m = mat(THREE.MeshBasicMaterial, () => palette.tok[i], { opacity: 0.2 + 0.5 * w });
          const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.012 + 0.016 * w, 6, false), m);
          tube.userData.stage = s;
          group.add(tube);
          s.arcs.push({ m, base: 0.2 + 0.5 * w });
        }
      }
    }

    if (s.kind === 'add') {
      // The place where the branch comes back down to the stream.
      hitBox(BRANCH_Y - LANE_Y + 0.4, (LANE_Y + BRANCH_Y) / 2);
      s.top = BRANCH_Y + 0.3;
    }

    if (s.kind === 'out') {
      for (let i = 0; i < N; i++) {
        const bar = new THREE.Mesh(boxGeo, mat(THREE.MeshBasicMaterial, () => palette.tok[i], { opacity: 0.75 }));
        const h = 0.3 + GUESS_P[i] * 2.2;
        bar.scale.set(0.22, h, 0.22);
        bar.position.set(0, h / 2, laneZ(i));
        bar.userData = { stage: s, h };
        group.add(bar);
        pickable.push(bar);
        outBars.push(bar);
      }
      s.top = 2.8;
    }

    scene.add(group);
  }

  /* The open view of each part. It grows from the lane height when the part is selected. */
  const detailLabels = [];
  function addDetailLabel(s, text, local, cls = '') {
    const node = el('span', { class: `ia-tf-x__dlbl ${cls}`.trim() }, text);
    labels.append(node);
    detailLabels.push({ node, s, at: () => new THREE.Vector3(s.x + local.x, s.cy + local.y * Math.max(0.001, easeOutBack(s.detailT)), local.z) });
  }

  function buildDetail(s) {
    const g = new THREE.Group();
    g.position.set(0, s.cy, 0);
    g.visible = false;
    const parts = [];
    const add = (mesh, base) => {
      g.add(mesh);
      parts.push({ m: mesh.material, base });
      return mesh;
    };
    const box = (key, base, sx, sy, sz, x, y, z) => {
      const mesh = add(new THREE.Mesh(boxGeo, mat(THREE.MeshBasicMaterial, key, { opacity: base })), base);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const frame = (key, base, sx, sy, sz, x, y, z) => {
      const mesh = add(new THREE.LineSegments(edgeGeo, mat(THREE.LineBasicMaterial, key, { opacity: base })), base);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const heatColor = (v) => () => palette.pos.clone().lerp(palette.neg, v < 0 ? 1 : 0);
    const rand = seeded(31 + s.index);

    if (s.kind === 'attn') {
      // Q, K and V: three thin plates before the attention plate.
      ['Q', 'K', 'V'].forEach((name, k) => {
        const key = ['plate', 'attn', 'ffn'][k];
        const x = -0.6 + k * 0.17;
        box(key, 0.2, 0.035, 1.5, DEPTH * 0.9, x, 0, 0);
        frame(key, 0.8, 0.035, 1.5, DEPTH * 0.9, x, 0, 0);
        addDetailLabel(s, name, { x, y: 0.95, z: DEPTH * 0.45 }, 'is-key');
      });
      // The grid of weights, above the plate. Rows are the tokens that look, columns the tokens they look at.
      const cy = s.h / 2 + 1.25;
      const step = 0.4;
      for (let i = 0; i < N; i++) {
        const sc = [];
        for (let j = 0; j <= i; j++) sc.push(j === i - 1 ? 3 : j === 0 ? 1.6 : i === 0 ? 3 : 0.4);
        const mx = Math.max(...sc);
        const ex = sc.map((v) => Math.exp(v - mx));
        const sum = ex.reduce((a, b) => a + b, 0);
        // On the screen, a larger z is further left, so the first token gets the largest z.
        for (let j = 0; j < N; j++) {
          const y = cy + (2 - i) * step;
          const z = (2 - j) * step;
          if (j <= i) {
            const w = ex[j] / sum;
            box('attn', 0.12 + 0.88 * w, 0.03, step * 0.86, step * 0.86, 0.1, y, z);
          } else {
            frame('ink', 0.18, 0.03, step * 0.86, step * 0.86, 0.1, y, z);
          }
        }
        // A small colored mark for the token of each row and of each column.
        box(() => palette.tok[i], 0.95, 0.04, 0.12, 0.12, 0.1, cy + (2 - i) * step, 3 * step);
        box(() => palette.tok[i], 0.95, 0.04, 0.12, 0.12, 0.1, cy + 3 * step, (2 - i) * step);
      }
      addDetailLabel(s, 'weights = softmax(QKᵀ / √d)', { x: 0.1, y: cy + 3.7 * step, z: 0 }, 'is-title');
    }

    if (s.kind === 'ffn') {
      // Each token widens to a column of d_ff numbers.
      for (let i = 0; i < N; i++) {
        for (let k = 0; k < 16; k++) {
          const v = (rand() - 0.5) * 2;
          box(heatColor(v), 0.25 + 0.7 * Math.abs(v), 0.15, 0.09, 0.15, 0, (k - 7.5) * 0.12, laneZ(i));
        }
      }
      addDetailLabel(s, 'd_ff numbers for each token', { x: 0, y: 1.45, z: 0.4 }, 'is-title');
      addDetailLabel(s, 'each token alone', { x: 0, y: -1.25, z: -DEPTH * 0.3 });
    }

    if (s.kind === 'norm') {
      // Different norms on the left, the same norm on the right.
      const sizes = [0.2, 0.08, 0.15, 0.24, 0.11];
      for (let i = 0; i < N; i++) {
        add(new THREE.Mesh(new THREE.SphereGeometry(sizes[i], 20, 14), mat(THREE.MeshBasicMaterial, () => palette.tok[i], { opacity: 0.55 })), 0.55).position.set(-0.3, 0, laneZ(i));
        add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), mat(THREE.MeshBasicMaterial, () => palette.tok[i], { opacity: 0.85 })), 0.85).position.set(0.3, 0, laneZ(i));
      }
      addDetailLabel(s, 'different norms', { x: -0.3, y: 0.5, z: DEPTH * 0.45 });
      addDetailLabel(s, 'same norm', { x: 0.3, y: 0.5, z: DEPTH * 0.45 }, 'is-key');
    }

    if (s.kind === 'add') {
      // A "+" where each branch meets the stream.
      for (let i = 0; i < N; i++) {
        box('ink', 0.95, 0.03, 0.3, 0.06, 0, 0, laneZ(i));
        box('ink', 0.95, 0.03, 0.06, 0.3, 0, 0, laneZ(i));
      }
      const before = stages[s.index - 2];
      // The labels go on the far side, because the card covers the near side.
      addDetailLabel(s, 'x + change', { x: 0.3, y: 0.4, z: -DEPTH * 0.42 }, 'is-key');
      addDetailLabel(s, 'stream x: goes past unchanged', { x: (before.x - s.x) / 2, y: -0.35, z: -DEPTH * 0.48 });
      addDetailLabel(s, 'branch: calculates the change', { x: (before.x - s.x) / 2, y: BRANCH_Y - LANE_Y + 0.4, z: -DEPTH * 0.48 });
    }

    if (s.kind === 'embed') {
      // The table: many thin rows. Each token pulls its row out to its lane.
      const rows = 22;
      const pick = [3, 15, 9, 1, 19];
      for (let k = 0; k < rows; k++) {
        const y = -1.05 + k * 0.1;
        const owner = pick.indexOf(k);
        if (owner < 0) box('grid', 0.22, 0.05, 0.06, DEPTH * 0.82, -0.5, y, 0);
      }
      for (let i = 0; i < N; i++) {
        const y = -1.05 + pick[i] * 0.1;
        box(() => palette.tok[i], 0.9, 0.06, 0.07, DEPTH * 0.82, -0.5, y, 0);
        const pts = [new THREE.Vector3(-0.5, y, laneZ(i)), new THREE.Vector3(-0.25, y, laneZ(i)), new THREE.Vector3(-0.1, 0, laneZ(i))];
        add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat(THREE.LineBasicMaterial, () => palette.tok[i], { opacity: 0.9 })), 0.9);
      }
      addDetailLabel(s, 'one row for each vocabulary token', { x: -0.5, y: 1.35, z: -DEPTH * 0.2 }, 'is-title');
    }

    if (s.kind === 'head') {
      // One score for each token of the vocabulary, for the last token.
      const bars = 34;
      for (let k = 0; k < bars; k++) {
        const top = k === 21;
        const h = top ? 1.5 : 0.08 + rand() ** 2.2 * 0.75;
        box(top ? 'attn' : 'grid', top ? 0.95 : 0.55, 0.06, h, 0.06, 0.2, s.h / 2 + 0.15 + h / 2, -2.4 + (k * 4.8) / (bars - 1));
      }
      addDetailLabel(s, 'one score for each vocabulary token', { x: 0.2, y: s.h / 2 + 1.95, z: -0.6 }, 'is-title');
    }

    if (!parts.length) return null;
    s.group.add(g);
    return { g, parts };
  }

  for (const s of stages) s.detail = buildDetail(s);

  /* Packets for the play animation */
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const packets = [];
  for (let i = 0; i < N; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: palette.tok[i], transparent: true, depthWrite: false, opacity: 0 }));
    themed.push({ m: sprite.material, key: () => palette.tok[i] });
    sprite.scale.set(0.6, 0.6, 0.6);
    sprite.position.set(0, LANE_Y, laneZ(i));
    scene.add(sprite);
    packets.push(sprite);
  }

  /* HTML labels */
  const labelNodes = [];
  for (const s of stages) {
    if (s.kind === 'out') continue;
    // The embedding label goes under the front of its plate, away from the attention label.
    const low = s.kind === 'embed';
    const node = el('button', { type: 'button', class: `ia-tf-x__lbl${s.main ? ' is-main' : ''}${low ? ' is-low' : ''}`, tabindex: -1 }, s.kind === 'add' ? '+' : s.title);
    node.addEventListener('click', () => select(s));
    node.addEventListener('pointerenter', () => { hovered = s; refresh(); });
    node.addEventListener('pointerleave', () => { hovered = null; refresh(); });
    labels.append(node);
    const rank = { attn: 0, ffn: 1, head: 2, embed: 3 }[s.kind] ?? 9;
    labelNodes.push({
      node,
      s,
      low,
      rank,
      at: () => (low
        ? new THREE.Vector3(s.x, LANE_Y - s.h / 2, DEPTH / 2)
        : new THREE.Vector3(s.x, (s.top || LANE_Y + 1) + 0.12, -DEPTH / 2 + 0.6)),
    });
  }
  for (let i = 0; i < N; i++) {
    const node = el('span', { class: 'ia-tf-x__tok', style: `--tok: var(--tf-t${i})` }, [TOKENS[i], el('small', {}, String(IDS[i]))]);
    labels.append(node);
    labelNodes.push({ node, lane: true, at: () => new THREE.Vector3(-0.3, LANE_Y, laneZ(i)) });
  }
  const guessNodes = [];
  for (let i = 0; i < N; i++) {
    const shown = /^[.!?,]$/.test(GUESSES[i]) ? `“${GUESSES[i]}”` : GUESSES[i];
    const node = el('span', { class: 'ia-tf-x__guess', style: `--tok: var(--tf-t${i})` }, [el('small', {}, `after ${TOKENS[i]}`), shown]);
    labels.append(node);
    guessNodes.push(node);
    const s = stages[stages.length - 1];
    labelNodes.push({ node, guess: true, at: () => new THREE.Vector3(s.x, outBars[i].scale.y + 0.18, laneZ(i)) });
  }
  for (const span of spans) {
    const node = el('span', { class: 'ia-tf-x__layer' }, span.tag);
    labels.append(node);
    labelNodes.push({ node, layer: true, at: () => span.anchor });
    if (span.repeatAt) {
      const rep = el('span', { class: 'ia-tf-x__repeat' }, [el('b', {}, '× N'), ' repeat the layer']);
      labels.append(rep);
      labelNodes.push({ node: rep, layer: true, at: () => span.repeatAt });
    }
  }

  /* Camera */
  const homeAngles = (w) => (w < 640 ? { yaw: 1.02, pitch: 0.78 } : { yaw: 0.5, pitch: 0.56 });
  const newView = (yaw, pitch, dist, target) => ({ yaw, pitch, dist, target: target.clone() });
  const view = newView(0.5, 0.56, 20, new THREE.Vector3((X0 + X1) / 2, 1.2, 0));
  let goal = newView(view.yaw, view.pitch, view.dist, view.target);
  let home = null;
  let tween = null;
  let sway = 0;
  let firstFit = true;

  function placeCamera(v, swayAmount = 0) {
    const yaw = v.yaw + swayAmount;
    camera.position.set(
      v.target.x + Math.sin(yaw) * Math.cos(v.pitch) * v.dist,
      v.target.y + Math.sin(v.pitch) * v.dist,
      v.target.z + Math.cos(yaw) * Math.cos(v.pitch) * v.dist,
    );
    camera.lookAt(v.target);
  }

  // The corners of the model, with room for the labels and the repeat arc.
  const corners = [];
  for (const x of [X0 - 1.1, X1 + 0.2]) {
    for (const y of [0, layers === 1 ? 4.7 : 3.9]) {
      for (const z of [-DEPTH / 2 - 0.4, DEPTH / 2 + 0.3]) corners.push(new THREE.Vector3(x, y, z));
    }
  }

  // Find the distance and the center so that the model fills the free part of the view.
  function frameModel(yaw, pitch) {
    const h = canvas.clientHeight;
    const headH = head.getBoundingClientRect().height + 28;
    const top = 1 - (2 * headH * 0.7) / h;
    // On a phone the card sits under the model, so the model goes above it.
    const narrow = root.clientWidth < 640;
    const bottom = narrow ? -1 + (2 * (card.getBoundingClientRect().height + 16)) / h : -0.96;
    const side = 0.96;
    const v = newView(yaw, pitch, 20, new THREE.Vector3((X0 + X1) / 2, 1.2, 0));
    const p = new THREE.Vector3();
    for (let it = 0; it < 14; it++) {
      placeCamera(v);
      camera.updateMatrixWorld();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const c of corners) {
        p.copy(c).project(camera);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const scale = Math.max((maxX - minX) / (2 * side), (maxY - minY) / (top - bottom));
      v.dist *= 0.35 + 0.65 * scale;
      const halfH = Math.tan((camera.fov * Math.PI) / 360) * v.dist;
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      v.target.addScaledVector(right, ((maxX + minX) / 2) * halfH * camera.aspect * 0.8);
      v.target.y += ((maxY + minY) / 2 - (top + bottom) / 2) * halfH * 0.8;
    }
    return v;
  }

  // The view of one selected part: closer, more from the side, and a little to the right
  // so that the card on the left doesn't cover it.
  const FOCUS = {
    ids: { dy: 0, dist: 6.5 },
    embed: { dy: 0.3, dist: 10, dx: -0.25 },
    norm: { dy: 0.1, dist: 6.5 },
    attn: { dy: 1.3, dist: 12.5 },
    add: { dy: 0.8, dist: 9, dx: -0.35 },
    ffn: { dy: 0.2, dist: 10.5 },
    head: { dy: 1.0, dist: 10 },
    out: { dy: 0.6, dist: 8 },
  };
  function focusView(s) {
    const narrow = root.clientWidth < 640;
    const f = FOCUS[s.kind];
    const yaw = narrow ? 1.12 : 0.92;
    // Stay far enough back that the parts next to the selected part stay in view.
    const pullBack = 1.45;
    const v = newView(yaw, narrow ? 0.46 : 0.34, f.dist * pullBack * (narrow ? 1.3 : 1), new THREE.Vector3(s.x + (f.dx || 0), s.cy + f.dy, 0));
    if (narrow) {
      // The card covers the bottom of a phone screen, so the part goes higher.
      v.target.y -= v.dist * 0.07;
    } else {
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      v.target.addScaledVector(right, -v.dist * 0.1);
    }
    return v;
  }

  function flyTo(v, ms = 1200) {
    tween = { from: newView(view.yaw, view.pitch, view.dist, view.target), to: v, t0: performance.now(), ms: reduceMotion.matches ? 1 : ms };
    goal = newView(v.yaw, v.pitch, v.dist, v.target);
    wake();
  }

  function stepCamera(now, dt) {
    if (tween) {
      const t = clamp((now - tween.t0) / tween.ms, 0, 1);
      const e = easeInOut(t);
      const { from, to } = tween;
      view.yaw = lerp(from.yaw, to.yaw, e);
      view.pitch = lerp(from.pitch, to.pitch, e);
      view.target.lerpVectors(from.target, to.target, e);
      // Pull back a little in the middle of a long flight, then come in.
      const hop = from.target.distanceTo(to.target);
      view.dist = lerp(from.dist, to.dist, e) + Math.sin(Math.PI * e) * hop * 0.3;
      if (t >= 1) tween = null;
      return true;
    }
    const k = 1 - Math.exp(-dt / 110);
    view.yaw += (goal.yaw - view.yaw) * k;
    view.pitch += (goal.pitch - view.pitch) * k;
    view.dist += (goal.dist - view.dist) * k;
    view.target.lerp(goal.target, k);
    return Math.abs(goal.yaw - view.yaw) + Math.abs(goal.pitch - view.pitch) + Math.abs(goal.dist - view.dist) > 0.001;
  }

  function fit() {
    const w = root.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const a = homeAngles(w);
    home = frameModel(a.yaw, a.pitch);
    if (firstFit) {
      Object.assign(view, newView(home.yaw, home.pitch, home.dist, home.target));
      firstFit = false;
    }
    goal = selected ? focusView(selected) : newView(home.yaw, home.pitch, home.dist, home.target);
  }

  /* Pointer: drag to turn, click to select */
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY, yaw: goal.yaw, pitch: goal.pitch, moved: false };
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - dragging.x;
      const dy = e.clientY - dragging.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        dragging.moved = true;
        tween = null;
      }
      goal.yaw = dragging.yaw - dx * 0.006;
      goal.pitch = clamp(dragging.pitch + dy * 0.004, 0.06, 1.25);
      wake();
      return;
    }
    hoverAt(e);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (dragging && !dragging.moved) select(pick(e) || null);
    dragging = null;
  });
  canvas.addEventListener('pointerleave', () => {
    if (hovered) {
      hovered = null;
      refresh();
    }
  });
  viewBtn.addEventListener('click', () => select(null));

  /* Full screen. Where the browser can't make an element full screen (for example
     Safari on an iPhone), the view covers the page instead. */
  const isFull = () => document.fullscreenElement === root || root.classList.contains('is-full');
  function syncFull() {
    const on = isFull();
    root.classList.toggle('is-fullscreen', on);
    fullBtn.replaceChildren(...(on ? btnText('✕', 'Exit full screen') : btnText('⛶', 'Full screen')));
    fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    document.documentElement.classList.toggle('ia-tf-noscroll', root.classList.contains('is-full'));
    requestAnimationFrame(() => {
      fit();
      for (const item of labelNodes) item.size = null;
      wake();
    });
  }
  fullBtn.addEventListener('click', async () => {
    if (isFull()) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      root.classList.remove('is-full');
    } else if (root.requestFullscreen && document.fullscreenEnabled) {
      await root.requestFullscreen().catch(() => root.classList.add('is-full'));
    } else {
      root.classList.add('is-full');
    }
    syncFull();
    root.focus({ preventScroll: true });
  });
  document.addEventListener('fullscreenchange', syncFull);

  // In full screen the page doesn't scroll, so the wheel can zoom.
  canvas.addEventListener('wheel', (e) => {
    if (!isFull()) return;
    e.preventDefault();
    tween = null;
    goal.dist = clamp(goal.dist * Math.exp(e.deltaY * 0.0012), 3, home ? home.dist * 1.6 : 40);
    wake();
  }, { passive: false });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-full') && !selected) {
      root.classList.remove('is-full');
      syncFull();
    } else if (e.key === 'Escape') select(null);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else return;
    e.preventDefault();
  });

  /* Picking */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickable, false)[0];
    return hit ? hit.object.userData.stage : null;
  }
  let hovered = null;
  let selected = null;
  function hoverAt(e) {
    const s = pick(e);
    if (s !== hovered) {
      hovered = s;
      canvas.style.cursor = s ? 'pointer' : 'grab';
      refresh();
    }
  }

  function select(s) {
    if (s === selected) return;
    selected = s;
    hovered = null;
    flyTo(s ? focusView(s) : newView(home.yaw, home.pitch, home.dist, home.target), s ? 1200 : 1000);
    refresh();
  }

  function step(dir) {
    const i = selected ? selected.index + dir : dir > 0 ? 0 : stages.length - 1;
    select(stages[clamp(i, 0, stages.length - 1)]);
  }

  function showCard() {
    const s = selected || hovered;
    if (!s) {
      card.classList.remove('is-on');
      card.classList.add('is-hint');
      card.replaceChildren(
        el('div', { class: 'ia-tf-x__kicker' }, 'How to use'),
        el('p', {}, 'Select a part to zoom in and see what is inside. Use the arrow keys to go from part to part, and Esc to go back.'),
        el('div', { class: 'ia-tf-x__nav' }, [el('button', { type: 'button', class: 'ia-tf-x__btn', onclick: () => step(1) }, 'Start the tour →')]),
      );
      return;
    }
    card.classList.remove('is-hint');
    card.classList.add('is-on');
    const isSel = s === selected;
    // A hover shows less than a selection. The parts it leaves out are null, and
    // replaceChildren would show null as text, so they are removed first.
    card.replaceChildren(...[
      el('div', { class: 'ia-tf-x__kicker' }, `Part ${s.index + 1} of ${stages.length}${s.layer ? `, ${s.layer}` : ''}`),
      el('div', { class: 'ia-tf-x__cardtitle' }, s.title),
      el('p', { class: 'ia-tf-x__about' }, s.about),
      isSel && INSIDE[s.kind] ? el('p', { class: 'ia-tf-x__inside' }, INSIDE[s.kind]) : null,
      el('div', { class: 'ia-tf-x__chips' }, [
        el('span', {}, ['shape ', el('b', {}, s.shape)]),
        el('span', {}, s.kind === 'attn' ? 'mixes tokens' : 'one token at a time'),
      ]),
      isSel
        ? el('div', { class: 'ia-tf-x__nav' }, [
          el('button', { type: 'button', class: 'ia-tf-x__btn', disabled: s.index === 0, onclick: () => step(-1) }, '←'),
          el('button', { type: 'button', class: 'ia-tf-x__btn', onclick: () => select(null) }, 'Overview'),
          el('button', { type: 'button', class: 'ia-tf-x__btn is-primary', disabled: s.index === stages.length - 1, onclick: () => step(1) }, 'Next part →'),
          el('a', { class: 'ia-tf-x__more', href: s.href }, 'Read the section ↓'),
        ])
        : null,
    ].filter(Boolean));
  }

  function refresh() {
    const focus = selected || hovered;
    for (const s of stages) {
      const on = focus === s;
      const dim = focus && !on;
      const deep = selected && selected !== s;
      for (const f of s.faces) f.material.opacity = on ? 0.24 : deep ? 0.025 : dim ? 0.04 : s.kind === 'norm' ? 0.07 : 0.1;
      for (const ed of s.edges) ed.material.opacity = on ? 1 : deep ? 0.12 : dim ? 0.22 : 0.55;
    }
    for (const { node, s } of labelNodes) {
      if (!s) continue;
      node.classList.toggle('is-on', focus === s);
      node.classList.toggle('is-dim', Boolean(focus) && focus !== s);
    }
    // Show the guess of every position only when the last part is selected.
    const showAll = focus && focus.kind === 'out';
    guessNodes.forEach((g, i) => g.classList.toggle('is-quiet', !showAll && i !== N - 1));
    root.classList.toggle('is-zoomed', Boolean(selected));
    for (const span of spans) if (span.repeatMat) span.repeatMat.opacity = selected ? 0.12 : 0.75;
    showCard();
    wake();
  }

  /* Open and close the inside views */
  function stepDetails(dt) {
    let moving = false;
    for (const s of stages) {
      const want = selected === s ? 1 : 0;
      if (s.detailT !== want) {
        moving = true;
        const speed = dt / (want ? 650 : 300);
        s.detailT = want ? Math.min(1, s.detailT + speed) : Math.max(0, s.detailT - speed);
        if (reduceMotion.matches) s.detailT = want;
      }
      const t = s.detailT;
      if (s.detail) {
        s.detail.g.visible = t > 0.001;
        s.detail.g.scale.set(1, Math.max(0.001, easeOutBack(t)), 1);
        for (const p of s.detail.parts) p.m.opacity = p.base * Math.min(1, t * 1.4);
      }
      for (const f of s.fade) f.m.opacity = f.base * (1 - t);
      if (s.arcs && !playStart) for (const a of s.arcs) a.m.opacity = a.base + t * (1 - a.base);
    }
    for (const d of detailLabels) d.node.classList.toggle('is-on', d.s.detailT > 0.75);
    return moving;
  }

  /* Play a forward pass */
  let playStart = null;
  const PLAY_MS = 7000;
  playBtn.addEventListener('click', () => {
    select(null);
    playStart = performance.now();
    for (const b of outBars) b.scale.y = 0.001;
    for (const g of guessNodes) g.classList.add('is-hidden');
    playBtn.disabled = true;
    wake();
  });

  function stepPlay(now) {
    if (playStart == null) return false;
    const t = reduceMotion.matches ? 1 : Math.min(1, (now - playStart) / PLAY_MS);
    const xNow = X0 + 0.4 + t * (stages[stages.length - 1].x - X0 - 0.4);
    packets.forEach((p, i) => {
      p.position.x = xNow - i * 0.05;
      p.position.y = packetY(p.position.x);
      p.material.opacity = t < 0.98 ? 0.95 : 0;
    });
    for (const s of stages) {
      const near = Math.max(0, 1 - Math.abs(xNow - s.x) / 0.55);
      for (const f of s.faces) if (s !== (selected || hovered)) f.material.opacity = (s.kind === 'norm' ? 0.07 : 0.1) + near * 0.25;
      if (s.arcs) for (const a of s.arcs) a.m.opacity = a.base + near * (1 - a.base);
    }
    const outX = stages[stages.length - 1].x;
    outBars.forEach((b, i) => {
      const grow = clamp((xNow - outX + 0.6) / 0.6, 0, 1);
      b.scale.y = Math.max(0.001, b.userData.h * grow);
      b.position.y = b.scale.y / 2;
      guessNodes[i].classList.toggle('is-hidden', grow < 1);
    });
    if (t >= 1) {
      playStart = null;
      playBtn.disabled = false;
      refresh();
    }
    return true;
  }

  /* Labels follow the 3D points */
  const v3 = new THREE.Vector3();
  function project(p, w, h) {
    v3.copy(p).project(camera);
    return [(v3.x * 0.5 + 0.5) * w, (-v3.y * 0.5 + 0.5) * h, v3.z];
  }

  function placeLabels() {
    const w = root.clientWidth;
    const h = canvas.clientHeight;
    const narrow = w < 700;
    const placed = [];
    const order = [...labelNodes].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (a.s?.x ?? 0) - (b.s?.x ?? 0));
    for (const item of order) {
      const [x, y, z] = project(item.at(), w, h);
      item.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      item.node.style.visibility = z > 1 ? 'hidden' : '';
      if (item.lane || item.guess || item.layer) continue;
      // Hide a label when it covers a label that is more important.
      if (!item.size) item.size = { w: item.node.offsetWidth || 80, h: item.node.offsetHeight || 22 };
      const { w: lw, h: lh } = item.size;
      const r = { x: x - lw / 2 - 3, y: item.low ? y + 8 : y - lh - 10, w: lw + 6, h: lh };
      const covers = placed.some((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
      const hide = (item.s.main ? covers : narrow || covers) || (selected && item.s !== selected && !item.s.main);
      // The "+" label of an open Add part would cover its own labels.
      const ownAdd = item.s === selected && item.s.kind === 'add';
      item.node.classList.toggle('is-hidden', ownAdd || (hide && item.s !== (selected || hovered)));
      if (!hide) placed.push(r);
    }
    for (const d of detailLabels) {
      if (d.s.detailT <= 0.001) continue;
      const [x, y] = project(d.at(), w, h);
      d.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  /* Render loop. It runs only while the view is on the screen. */
  let visible = false;
  let running = false;
  let idleUntil = 0;
  let last = performance.now();
  function wake() {
    idleUntil = performance.now() + 1500;
    if (visible && !running) {
      running = true;
      last = performance.now();
      requestAnimationFrame(loop);
    }
  }

  function loop(now) {
    const dt = Math.min(64, now - last);
    last = now;
    const playing = stepPlay(now);
    const flying = stepCamera(now, dt);
    const opening = stepDetails(dt);
    if (!reduceMotion.matches && !dragging && !selected) sway = Math.sin(now / 4000) * 0.05;
    else sway *= 0.9;
    placeCamera(view, sway);
    renderer.render(scene, camera);
    placeLabels();
    const keep = visible && (playing || flying || opening || dragging || now < idleUntil || !reduceMotion.matches);
    if (keep) requestAnimationFrame(loop);
    else running = false;
  }

  new ResizeObserver(() => {
    fit();
    wake();
  }).observe(root);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) wake();
  }).observe(root);
  new MutationObserver(() => {
    readPalette();
    applyPalette();
    wake();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // The card goes first, because the framing on a phone depends on its height.
  showCard();
  fit();
  applyPalette();
  refresh();
  root.classList.add('is-ready');
}

for (const root of document.querySelectorAll('[data-tf-explorer]')) {
  buildExplorer(root).catch((e) => {
    console.error('Transformer explorer failed', e);
    flatList(root, 1);
  });
}
