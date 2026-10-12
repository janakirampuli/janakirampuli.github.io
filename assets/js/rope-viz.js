/*
  RoPE diagrams
  - [data-rope-rotate]:   one pair of numbers, turned by the position of its token
  - [data-rope-relative]: two words, the score depends only on the distance
  - [data-rope-clocks]:   many pairs, each with its own speed
  - [data-rope-score]:    the score of each pair and their average, at one distance
  - [data-rope-curve]:    score against distance, for one pair and for all pairs
  - [data-rope-between]:  score between a selected position and each other position
  Loaded on demand by interactive.js.
*/

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;

function setAttrs(node, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.setAttribute('class', v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
}

function fill(node, children) {
  for (const ch of Array.isArray(children) ? children : [children]) {
    if (ch == null) continue;
    node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
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

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// "-0.50" becomes "−0.50", and "-0.00" becomes "0.00".
function fmt(x, digits = 2) {
  const s = x.toFixed(digits);
  return (Number(s) === 0 ? (0).toFixed(digits) : s).replace('-', '−');
}

const degrees = (a) => `${Math.round(a / DEG)}°`;

/* -----------------
 * Shared UI parts
 * ----------------- */

// A circle with two axes. Angles are in radians and go counterclockwise.
function makePlane(size, margin) {
  const c = size / 2;
  const r = c - margin;
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img' }, [
    svg('circle', { class: 'ia-rope__ring', cx: c, cy: c, r }),
    svg('line', { class: 'ia-rope__axis', x1: c - r - 8, y1: c, x2: c + r + 8, y2: c }),
    svg('line', { class: 'ia-rope__axis', x1: c, y1: c - r - 8, x2: c, y2: c + r + 8 }),
  ]);
  return {
    root,
    c,
    r,
    // `len` is a part of the radius. `extra` is in pixels.
    pt: (angle, len = 1, extra = 0) => [
      c + (r * len + extra) * Math.cos(angle),
      c - (r * len + extra) * Math.sin(angle),
    ],
  };
}

function makeArrow(plane, cls) {
  const shaft = svg('line', { class: 'ia-rope__shaft', x1: plane.c, y1: plane.c });
  const head = svg('polygon', { class: 'ia-rope__head' });
  plane.root.append(svg('g', { class: `ia-rope__arrow ${cls}` }, [shaft, head]));
  return {
    set(angle, len = 1) {
      const [x, y] = plane.pt(angle, len);
      const ux = Math.cos(angle);
      const uy = -Math.sin(angle);
      const bx = x - ux * 10;
      const by = y - uy * 10;
      shaft.setAttribute('x2', bx.toFixed(1));
      shaft.setAttribute('y2', by.toFixed(1));
      head.setAttribute('points', [
        [x, y],
        [bx - uy * 5, by + ux * 5],
        [bx + uy * 5, by - ux * 5],
      ].map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
    },
  };
}

// An arc around the center of the plane, from one angle to another.
function arcPath(plane, from, to, radius) {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / (5 * DEG)));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    pts.push(`${(plane.c + radius * Math.cos(a)).toFixed(1)},${(plane.c - radius * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}`;
}

function place(label, [x, y]) {
  label.setAttribute('x', x.toFixed(1));
  label.setAttribute('y', y.toFixed(1));
}

// Call `draw(t)` with t from 0 to 1. `ease` makes the end slower.
function animate(ms, draw, { ease = false, done = null } = {}) {
  if (reduceMotion.matches && ease) {
    draw(1);
    return () => {};
  }
  let raf = null;
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    draw(ease ? 1 - (1 - t) ** 3 : t);
    if (t < 1) raf = requestAnimationFrame(step);
    else if (done) done();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

// A button that runs `start()`. `start` returns a function that stops the run,
// and it calls `finish` when the run is complete.
function makePlay(label, start) {
  const btn = el('button', { type: 'button' }, label);
  let cancel = null;
  function stop() {
    if (cancel) cancel();
    cancel = null;
    btn.textContent = label;
  }
  btn.addEventListener('click', () => {
    if (cancel) return stop();
    btn.textContent = 'Stop';
    cancel = start(stop);
  });
  return { root: el('div', { class: 'ia-player' }, btn), stop };
}

function makeField(label, attrs, onInput) {
  const input = el('input', { type: 'range', step: 1, ...attrs, 'aria-label': label });
  const value = el('span', { class: 'ia-rope__value' });
  input.addEventListener('input', () => onInput(Number(input.value)));
  const root = el('div', { class: 'ia-rope__field' }, [el('span', { class: 'ia-anim__label' }, label), input, value]);
  return { root, input, value };
}

// Rows of "label, value". `set(i, ...)` writes the value of row i.
function makeFacts(labels) {
  const values = labels.map(() => el('span', { class: 'ia-rope__fact' }));
  const root = el('div', { class: 'ia-rope__facts' }, labels.flatMap((label, i) => [
    el('span', { class: 'ia-anim__label' }, label),
    values[i],
  ]));
  return { root, set: (i, ...content) => values[i].replaceChildren(...content) };
}

const key = (cls) => el('i', { class: `ia-rope__swatch ${cls}` });

/* -----------------------------
 * One pair, one turn
 * -----------------------------
   Markup:
     <div class="ia-anim ia-rope" data-rope-rotate data-step="30"></div>

   Each word has a start arrow. The same word has the same start arrow.
*/
const START = {
  the: { angle: 20, len: 0.9 },
  cat: { angle: 75, len: 0.8 },
  sat: { angle: -30, len: 1 },
  on: { angle: 140, len: 0.7 },
  mat: { angle: 200, len: 0.85 },
};
const SENTENCE = ['the', 'cat', 'sat', 'on', 'the', 'mat'];

function buildRotate(root) {
  const stepDeg = Number(root.dataset.step) || 30;
  const step = stepDeg * DEG;

  const plane = makePlane(300, 44);
  plane.root.setAttribute('aria-label', 'A pair of numbers drawn as an arrow, before and after the turn');
  const arc = svg('path', { class: 'ia-rope__arc' });
  const arcLabel = svg('text', { class: 'ia-rope__tip is-strong' });
  plane.root.append(arc);
  const ghost = makeArrow(plane, 'is-ghost');
  const arrow = makeArrow(plane, 'is-a');
  const beforeLabel = svg('text', { class: 'ia-rope__tip' }, 'before');
  const afterLabel = svg('text', { class: 'ia-rope__tip is-strong' }, 'after');
  plane.root.append(arcLabel, beforeLabel, afterLabel);

  const facts = makeFacts(['Word', 'Turn', 'Before', 'After', 'Length']);
  const caption = el('p', { class: 'ia-anim__caption', 'aria-live': 'polite' });
  const chips = SENTENCE.map((word, i) => el('button', { type: 'button', class: 'ia-rope__word' }, [
    el('span', {}, word),
    el('small', {}, String(i)),
  ]));
  let cancel = null;

  function draw(base, turn, len) {
    arrow.set(base + turn, len);
    place(afterLabel, plane.pt(base + turn, len, 18));
    const open = turn > 12 * DEG;
    arc.setAttribute('d', open ? arcPath(plane, base, base + turn, 34) : '');
    arcLabel.textContent = open ? degrees(turn) : '';
    place(arcLabel, plane.pt(base + turn / 2, 0, 52));
    beforeLabel.style.visibility = turn > 25 * DEG ? 'visible' : 'hidden';
  }

  function select(i) {
    const word = SENTENCE[i];
    const { angle, len } = START[word];
    const base = angle * DEG;
    const turn = i * step;
    chips.forEach((chip, j) => {
      chip.classList.toggle('is-on', j === i);
      chip.setAttribute('aria-pressed', String(j === i));
    });
    ghost.set(base, len);
    place(beforeLabel, plane.pt(base, len, 18));

    const pair = (a) => `(${fmt(len * Math.cos(a))}, ${fmt(len * Math.sin(a))})`;
    facts.set(0, `${word}, position ${i}`);
    facts.set(1, `${i} × ${stepDeg}° = ${i * stepDeg}°`);
    facts.set(2, pair(base));
    facts.set(3, pair(base + turn));
    facts.set(4, `${fmt(len)} before, ${fmt(len)} after`);

    const first = SENTENCE.indexOf(word);
    caption.textContent = i === 0
      ? 'Position 0 gets no turn, so the pair does not change.'
      : first < i
        ? `The word "${word}" is also at position ${first}. The start arrow is the same, but the turn is ${i * stepDeg}° at position ${i}, so the result is different.`
        : `Position ${i} turns the arrow by ${i} × ${stepDeg}° = ${i * stepDeg}°. The two numbers change, but the length of the arrow stays the same.`;

    if (cancel) cancel();
    cancel = animate(350 + 110 * i, (t) => draw(base, turn * t, len), { ease: true });
  }

  const play = makePlay('Play', (finish) => {
    let i = 0;
    let timer = null;
    const next = () => {
      select(i);
      i += 1;
      timer = setTimeout(i < SENTENCE.length ? next : finish, 1700);
    };
    next();
    return () => clearTimeout(timer);
  });
  chips.forEach((chip, i) => chip.addEventListener('click', () => {
    play.stop();
    select(i);
  }));

  root.replaceChildren(
    play.root,
    el('div', { class: 'ia-rope__words' }, chips),
    el('div', { class: 'ia-rope__cols' }, [plane.root, facts.root]),
    caption,
  );
  select(Number(root.dataset.position) || 2);
}

/* -----------------------------
 * Two words, one distance
 * -----------------------------
   Markup:
     <div class="ia-anim ia-rope" data-rope-relative data-step="20"></div>
*/
const CELLS = 14;
const MAX_GAP = 6;

function buildRelative(root) {
  const stepDeg = Number(root.dataset.step) || 20;
  const step = stepDeg * DEG;
  const baseA = 15 * DEG;
  const baseB = 25 * DEG;
  let start = 2;
  let gap = 2;

  const plane = makePlane(300, 44);
  plane.root.setAttribute('aria-label', 'The arrows of two words and the angle between them');
  const arc = svg('path', { class: 'ia-rope__arc' });
  const arcLabel = svg('text', { class: 'ia-rope__tip is-strong' });
  plane.root.append(arc);
  const a = makeArrow(plane, 'is-a');
  const b = makeArrow(plane, 'is-b');
  const labelA = svg('text', { class: 'ia-rope__tip is-strong' }, 'cat');
  const labelB = svg('text', { class: 'ia-rope__tip is-strong' }, 'mat');
  plane.root.append(arcLabel, labelA, labelB);

  const cells = Array.from({ length: CELLS }, (_, i) => el('span', { class: 'ia-rope__cell' }, [
    el('span', {}, '·'),
    el('small', {}, String(i)),
  ]));
  const strip = el('div', { class: 'ia-rope__strip', style: `--cells: ${CELLS}` }, cells);

  const meterFill = el('i');
  const scoreText = el('span');
  const facts = makeFacts(['cat', 'mat', 'Distance', 'Angle between', 'Score']);
  facts.root.children[0].prepend(key('is-a'));
  facts.root.children[2].prepend(key('is-b'));
  const caption = el('p', { class: 'ia-anim__caption', 'aria-live': 'polite' });

  // `s` is the position of "cat". It is a fraction while the words move.
  function draw(s) {
    const pos = Math.round(s);
    const angleA = baseA + s * step;
    const angleB = baseB + (s + gap) * step;
    const between = angleB - angleA;
    const score = Math.cos(between);

    a.set(angleA);
    b.set(angleB);
    place(labelA, plane.pt(angleA, 1, 20));
    place(labelB, plane.pt(angleB, 1, 20));
    arc.setAttribute('d', arcPath(plane, angleA, angleB, 38));
    arcLabel.textContent = degrees(between);
    place(arcLabel, plane.pt((angleA + angleB) / 2, 0, 58));

    cells.forEach((cell, i) => {
      const word = i === pos ? 'cat' : i === pos + gap ? 'mat' : null;
      cell.className = `ia-rope__cell${word === 'cat' ? ' is-a' : word === 'mat' ? ' is-b' : ''}`;
      cell.firstChild.textContent = word || '·';
    });

    facts.set(0, `position ${pos}, turn ${pos * stepDeg}°`);
    facts.set(1, `position ${pos + gap}, turn ${(pos + gap) * stepDeg}°`);
    facts.set(2, gap === 1 ? '1 position' : `${gap} positions`);
    facts.set(3, degrees(between));
    scoreText.textContent = fmt(score);
    meterFill.style.left = `${score >= 0 ? 50 : 50 + score * 50}%`;
    meterFill.style.width = `${Math.abs(score) * 50}%`;
    caption.textContent = `The words are ${gap === 1 ? '1 position' : `${gap} positions`} apart, so the angle between the arrows is ${degrees(between)} and the score is ${fmt(score)}. The angle and the score stay the same when you move both words.`;
  }

  const maxStart = () => CELLS - 1 - gap;

  const startField = makeField('Position of cat', { min: 0, max: maxStart(), value: start }, (v) => {
    play.stop();
    start = v;
    sync();
  });
  const gapField = makeField('Distance to mat', { min: 1, max: MAX_GAP, value: gap }, (v) => {
    play.stop();
    gap = v;
    start = Math.min(start, maxStart());
    sync();
  });

  function sync() {
    startField.input.max = String(maxStart());
    startField.input.value = String(start);
    startField.value.textContent = `position ${start}`;
    gapField.input.value = String(gap);
    gapField.value.textContent = gap === 1 ? '1 position' : `${gap} positions`;
    draw(start);
  }

  const play = makePlay('Move both words', (finish) => animate(
    5000,
    (t) => {
      const s = t * maxStart();
      start = Math.round(s);
      startField.input.value = String(start);
      startField.value.textContent = `position ${start}`;
      draw(s);
    },
    { done: finish },
  ));

  facts.set(4, scoreText, el('span', { class: 'ia-rope__meter' }, meterFill));
  root.replaceChildren(
    play.root,
    strip,
    startField.root,
    gapField.root,
    el('div', { class: 'ia-rope__cols' }, [plane.root, facts.root]),
    caption,
  );
  sync();
}

/* -----------------------------
 * Many pairs, many speeds
 * -----------------------------
   Markup:
     <div class="ia-anim ia-rope" data-rope-clocks data-dim="8"></div>

   Pair k (from 1) turns by 10000^(-2(k-1)/d) radians for each position.
*/
const MAX_POSITION = 2000;
const SLIDER_STEPS = 1000;

// A slider from 0 to `max` that is not linear, so the small values get most of its length.
const sliderScale = (max) => ({
  toValue: (s) => Math.round((max + 1) ** (s / SLIDER_STEPS)) - 1,
  toSlider: (v) => Math.round((Math.log(v + 1) / Math.log(max + 1)) * SLIDER_STEPS),
});

function buildClocks(root) {
  const dim = Number(root.dataset.dim) || 8;
  const speeds = Array.from({ length: dim / 2 }, (_, k) => 10000 ** ((-2 * k) / dim));
  const { toValue: toPosition, toSlider } = sliderScale(MAX_POSITION);
  let position = 0;

  const dials = speeds.map((speed, k) => {
    const plane = makePlane(120, 12);
    plane.root.setAttribute('aria-label', `The hand of pair ${k + 1}`);
    const next = svg('line', { class: 'ia-rope__hand is-b', x1: plane.c, y1: plane.c });
    const hand = svg('line', { class: 'ia-rope__hand is-a', x1: plane.c, y1: plane.c });
    plane.root.append(next, hand, svg('circle', { class: 'ia-rope__hub', cx: plane.c, cy: plane.c, r: 3 }));
    const turns = el('span');
    const perStep = Number((speed / DEG).toPrecision(2));
    const node = el('div', { class: 'ia-rope__dial' }, [
      plane.root,
      el('b', {}, `Pair ${k + 1}`),
      el('span', {}, `${perStep}° per position`),
      turns,
    ]);
    const point = (line, angle) => {
      const [x, y] = plane.pt(angle);
      line.setAttribute('x2', x.toFixed(1));
      line.setAttribute('y2', y.toFixed(1));
    };
    return {
      node,
      set(p) {
        point(hand, p * speed);
        point(next, (p + 1) * speed);
        const n = (p * speed) / (2 * Math.PI);
        turns.textContent = `${fmt(n, n < 10 ? 2 : n < 100 ? 1 : 0)} turns`;
      },
    };
  });

  const field = makeField('Position', { min: 0, max: SLIDER_STEPS, value: 0 }, (s) => {
    play.stop();
    show(toPosition(s));
  });

  function show(p) {
    position = p;
    field.value.textContent = `position ${position}`;
    for (const dial of dials) dial.set(position);
  }

  const play = makePlay('Play', (finish) => animate(
    16000,
    (t) => {
      field.input.value = String(Math.round(t * SLIDER_STEPS));
      show(toPosition(t * SLIDER_STEPS));
    },
    { done: finish },
  ));

  root.replaceChildren(
    play.root,
    field.root,
    el('div', { class: 'ia-rope__legend' }, [
      el('span', {}, [key('is-a'), 'this position']),
      el('span', {}, [key('is-b'), 'the next position']),
    ]),
    el('div', { class: 'ia-rope__dials', style: `--dials: ${dials.length}` }, dials.map((d) => d.node)),
  );
  const first = Math.min(MAX_POSITION, Number(root.dataset.position) || 0);
  field.input.value = String(toSlider(first));
  show(first);
}

/* -----------------------------
 * The score, one pair at a time
 * -----------------------------
   Markup:
     <div class="ia-anim ia-rope" data-rope-score data-dim="16" data-distance="3"></div>

   One vector is at two positions. All of its pairs have a length of 1, so the
   score of pair k is cos(distance × speed of pair k). The score of the vector
   is the average of the pair scores.
*/
const MAX_SCORE_DISTANCE = 10000;

function buildScore(root) {
  const half = (Number(root.dataset.dim) || 16) / 2;
  const speeds = Array.from({ length: half }, (_, k) => 10000 ** (-k / half));
  const { toValue, toSlider } = sliderScale(MAX_SCORE_DISTANCE);

  // A bar from the zero line in the middle. `cls` gives the color.
  const makeBar = (cls) => {
    const bar = el('i', { class: cls });
    return {
      node: el('span', { class: 'ia-rope__meter' }, bar),
      set(v) {
        bar.style.left = `${v >= 0 ? 50 : 50 + v * 50}%`;
        bar.style.width = `${Math.abs(v) * 50}%`;
      },
    };
  };
  const angleText = (a) => {
    const d = (a / DEG) % 360;
    return `${fmt(d, d < 1 ? 2 : d < 10 ? 1 : 0)}°`;
  };

  const rows = speeds.map((speed, k) => {
    const angle = el('span', { class: 'ia-rope__num' });
    const bar = makeBar('is-a');
    const value = el('span', { class: 'ia-rope__num' });
    return {
      nodes: [el('span', {}, `Pair ${k + 1}`), angle, bar.node, value],
      set(distance) {
        const v = Math.cos(distance * speed);
        angle.textContent = angleText(distance * speed);
        bar.set(v);
        value.textContent = fmt(v);
        return v;
      },
    };
  });
  const totalBar = makeBar('is-b');
  const totalValue = el('span', { class: 'ia-rope__num' });
  const caption = el('p', { class: 'ia-anim__caption', 'aria-live': 'polite' });

  const field = makeField('Distance', { min: 0, max: SLIDER_STEPS, value: 0 }, (s) => {
    play.stop();
    show(toValue(s));
  });

  function show(distance) {
    field.value.textContent = distance === 1 ? '1 position' : `${distance} positions`;
    let sum = 0;
    let high = 0;
    for (const row of rows) {
      const v = row.set(distance);
      sum += v;
      if (v > 0.9) high += 1;
    }
    const score = sum / half;
    totalBar.set(score);
    totalValue.textContent = fmt(score);
    caption.textContent = distance === 0
      ? `At a distance of 0, the two copies are the same, so each pair has a score of 1 and the score of the vector is 1.`
      : `At a distance of ${distance}, ${high} of the ${half} pairs have a score above 0.9. The other pairs have turned by a larger angle, so their scores are lower, and the score of the vector is ${fmt(score)}.`;
  }

  const play = makePlay('Play', (finish) => animate(
    16000,
    (t) => {
      field.input.value = String(Math.round(t * SLIDER_STEPS));
      show(toValue(t * SLIDER_STEPS));
    },
    { done: finish },
  ));

  const head = (text) => el('span', { class: 'ia-anim__label' }, text);
  root.replaceChildren(
    play.root,
    field.root,
    el('div', { class: 'ia-rope__rows' }, [
      head('Pair'), head('Angle'), head('Score of the pair'), head(''),
      ...rows.flatMap((row) => row.nodes),
      el('b', { class: 'ia-rope__total' }, 'Average'), el('span', { class: 'ia-rope__total' }), totalBar.node, totalValue,
    ]),
    caption,
  );
  totalBar.node.classList.add('ia-rope__total');
  totalValue.classList.add('ia-rope__total');
  const first = Math.min(MAX_SCORE_DISTANCE, Number(root.dataset.distance) || 0);
  field.input.value = String(toSlider(first));
  show(first);
}

/* -----------------------------
 * Score against distance
 * -----------------------------
   Markup:
     <div class="ia-anim ia-rope" data-rope-curve data-dim="64" data-distance="6"></div>

   One vector is at two positions. All of its pairs have a length of 1, so the
   score of pair k is cos(distance × speed of pair k).
*/
const MAX_DISTANCE = 100;

function buildCurve(root) {
  const half = (Number(root.dataset.dim) || 64) / 2;
  const speed = (k) => 10000 ** (-k / half);
  const slow = Math.round(half / 4);
  const panels = [
    { title: 'Pair 1, the fastest pair', cls: 'is-a', f: (d) => Math.cos(d * speed(0)) },
    { title: `Pair ${slow + 1}, a slower pair`, cls: 'is-a', f: (d) => Math.cos(d * speed(slow)) },
    {
      title: `All ${half} pairs, average`,
      cls: 'is-b',
      f: (d) => {
        let sum = 0;
        for (let k = 0; k < half; k++) sum += Math.cos(d * speed(k));
        return sum / half;
      },
    },
  ];
  let distance = Math.min(MAX_DISTANCE, Number(root.dataset.distance) || 6);
  let geom = null;

  const chart = svg('svg', { role: 'img', 'aria-label': 'Score against distance for one fast pair, one slower pair, and all pairs' });
  const wrap = el('div', { class: 'ia-rope__chart' }, chart);
  const field = makeField('Distance', { min: 0, max: MAX_DISTANCE, value: distance }, (v) => {
    distance = v;
    mark();
  });

  function layout(width) {
    const left = 30;
    const right = 12;
    const titleH = 24;
    const plotH = 76;
    const gapH = 12;
    const height = panels.length * (titleH + plotH + gapH) + 30;
    const x = (d) => left + (d / MAX_DISTANCE) * (width - left - right);
    setAttrs(chart, { viewBox: `0 0 ${width} ${height}`, width, height });
    chart.replaceChildren();

    panels.forEach((panel, i) => {
      const top = i * (titleH + plotH + gapH) + titleH;
      const y = (v) => top + ((1 - v) / 2) * plotH;
      panel.y = y;
      panel.value = svg('text', { x: width - right, y: top - 8, 'text-anchor': 'end' });
      panel.dot = svg('circle', { class: `ia-rope__dot ${panel.cls}`, r: 4.5 });
      const pts = [];
      for (let d = 0; d <= MAX_DISTANCE; d += 0.25) pts.push(`${x(d).toFixed(1)},${y(panel.f(d)).toFixed(1)}`);
      chart.append(
        svg('text', { class: 'is-strong', x: left, y: top - 8 }, panel.title),
        panel.value,
        ...[1, 0, -1].flatMap((v) => [
          svg('line', { class: `ia-rope__grid${v === 0 ? ' is-zero' : ''}`, x1: left, x2: width - right, y1: y(v), y2: y(v) }),
          svg('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmt(v, 0)),
        ]),
        svg('path', { class: `ia-rope__line ${panel.cls}`, d: `M${pts.join('L')}` }),
      );
    });

    const bottom = height - 30;
    for (const d of [0, 25, 50, 75, 100]) {
      chart.append(svg('text', { x: x(d), y: bottom + 6, 'text-anchor': 'middle' }, String(d)));
    }
    chart.append(svg('text', { x: (left + width - right) / 2, y: bottom + 24, 'text-anchor': 'middle' }, 'Distance between the two positions'));

    // One part of the marker line for each panel, so the line does not cross the titles.
    const cross = panels.map((p) => svg('line', { class: 'ia-rope__cross', y1: p.y(1), y2: p.y(-1) }));
    chart.append(...cross, ...panels.map((p) => p.dot));
    geom = { x, left, right, width, cross };
    mark();
  }

  function mark() {
    field.input.value = String(distance);
    field.value.textContent = distance === 1 ? '1 position' : `${distance} positions`;
    if (!geom) return;
    const px = geom.x(distance).toFixed(1);
    for (const line of geom.cross) {
      line.setAttribute('x1', px);
      line.setAttribute('x2', px);
    }
    for (const panel of panels) {
      const v = panel.f(distance);
      panel.dot.setAttribute('cx', px);
      panel.dot.setAttribute('cy', panel.y(v).toFixed(1));
      panel.value.textContent = `score ${fmt(v)}`;
    }
  }

  function point(e) {
    if (!geom) return;
    const px = e.clientX - chart.getBoundingClientRect().left;
    const d = Math.round(((px - geom.left) / (geom.width - geom.left - geom.right)) * MAX_DISTANCE);
    distance = Math.max(0, Math.min(MAX_DISTANCE, d));
    mark();
  }
  chart.addEventListener('pointermove', point);
  chart.addEventListener('pointerdown', point);

  root.replaceChildren(field.root, wrap);
  let last = 0;
  new ResizeObserver(() => {
    const width = Math.max(260, Math.floor(wrap.clientWidth));
    if (width !== last) layout(width);
    last = width;
  }).observe(wrap);
}

/* -----------------------------
 * Score between two positions
 * -----------------------------
   Markup:
     <div class="ia-anim ia-rope" data-rope-between data-dim="64" data-a="20" data-b="45"></div>

   One vector is at position A and at each other position. The line shows the
   average pair score between position A and each position. The reader selects
   position B on the line.
*/
const LAST_POSITION = 100;

function buildBetween(root) {
  const half = (Number(root.dataset.dim) || 64) / 2;
  const speeds = Array.from({ length: half }, (_, k) => 10000 ** (-k / half));
  const score = (distance) => speeds.reduce((sum, s) => sum + Math.cos(distance * s), 0) / half;
  const clamp = (v) => Math.max(0, Math.min(LAST_POSITION, Math.round(v)));
  let a = clamp(Number(root.dataset.a) || 20);
  let b = clamp(Number(root.dataset.b) || 45);
  let geom = null;

  const chart = svg('svg', { role: 'img', 'aria-label': 'Score between position A and each other position' });
  const wrap = el('div', { class: 'ia-rope__chart' }, chart);
  const facts = makeFacts(['Position A', 'Position B', 'Distance', 'Score']);
  facts.root.children[0].prepend(key('is-a'));
  facts.root.children[2].prepend(key('is-b'));
  const fieldA = makeField('Position A', { min: 0, max: LAST_POSITION, value: a }, (v) => {
    a = v;
    mark();
  });
  const fieldB = makeField('Position B', { min: 0, max: LAST_POSITION, value: b }, (v) => {
    b = v;
    mark();
  });

  function layout(width) {
    const left = 30;
    const right = 12;
    const top = 26;
    const plotH = 150;
    const height = top + plotH + 44;
    const x = (p) => left + (p / LAST_POSITION) * (width - left - right);
    const y = (v) => top + (1 - v) * plotH;
    setAttrs(chart, { viewBox: `0 0 ${width} ${height}`, width, height });
    chart.replaceChildren();

    for (const v of [0, 0.5, 1]) {
      chart.append(
        svg('line', { class: `ia-rope__grid${v === 0 ? ' is-zero' : ''}`, x1: left, x2: width - right, y1: y(v), y2: y(v) }),
        svg('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(v)),
      );
    }
    for (const p of [0, 25, 50, 75, 100]) {
      chart.append(svg('text', { x: x(p), y: y(0) + 18, 'text-anchor': 'middle' }, String(p)));
    }
    chart.append(svg('text', { x: (left + width - right) / 2, y: y(0) + 36, 'text-anchor': 'middle' }, 'Position in the text'));

    const line = svg('path', { class: 'ia-rope__line is-b' });
    const marks = ['is-a', 'is-b'].map((cls, i) => ({
      stem: svg('line', { class: 'ia-rope__cross', y1: top - 4, y2: y(0) }),
      dot: svg('circle', { class: `ia-rope__dot ${cls}`, r: 5 }),
      label: svg('text', { class: 'is-strong', y: top - 10, 'text-anchor': 'middle' }, i === 0 ? 'A' : 'B'),
    }));
    chart.append(line, ...marks.flatMap((m) => [m.stem, m.label]), ...marks.map((m) => m.dot));
    geom = { x, y, left, right, width, line, marks };
    mark();
  }

  function mark() {
    const distance = Math.abs(a - b);
    const value = score(distance);
    fieldA.input.value = String(a);
    fieldB.input.value = String(b);
    fieldA.value.textContent = `position ${a}`;
    fieldB.value.textContent = `position ${b}`;
    facts.set(0, String(a));
    facts.set(1, String(b));
    facts.set(2, distance === 1 ? '1 position' : `${distance} positions`);
    facts.set(3, fmt(value));
    if (!geom) return;

    // The line is the score between position A and each position, so its top is at A.
    const pts = [];
    for (let p = 0; p <= LAST_POSITION; p += 0.25) {
      pts.push(`${geom.x(p).toFixed(1)},${geom.y(score(Math.abs(p - a))).toFixed(1)}`);
    }
    geom.line.setAttribute('d', `M${pts.join('L')}`);

    const xa = geom.x(a);
    const xb = geom.x(b);
    // Keep the two letters apart when the positions are near each other.
    const push = Math.abs(xa - xb) < 14 ? (xb >= xa ? 8 : -8) : 0;
    [[xa, 1, -push], [xb, value, push]].forEach(([px, v, shift], i) => {
      const m = geom.marks[i];
      setAttrs(m.stem, { x1: px.toFixed(1), x2: px.toFixed(1) });
      setAttrs(m.dot, { cx: px.toFixed(1), cy: geom.y(v).toFixed(1) });
      m.label.setAttribute('x', (px + shift).toFixed(1));
    });
  }

  function point(e) {
    if (!geom) return;
    const px = e.clientX - chart.getBoundingClientRect().left;
    b = clamp(((px - geom.left) / (geom.width - geom.left - geom.right)) * LAST_POSITION);
    mark();
  }
  chart.addEventListener('pointermove', point);
  chart.addEventListener('pointerdown', point);

  root.replaceChildren(fieldA.root, fieldB.root, wrap, facts.root);
  let last = 0;
  new ResizeObserver(() => {
    const width = Math.max(260, Math.floor(wrap.clientWidth));
    if (width !== last) layout(width);
    last = width;
  }).observe(wrap);
  mark();
}

for (const root of document.querySelectorAll('[data-rope-rotate]')) buildRotate(root);
for (const root of document.querySelectorAll('[data-rope-between]')) buildBetween(root);
for (const root of document.querySelectorAll('[data-rope-relative]')) buildRelative(root);
for (const root of document.querySelectorAll('[data-rope-clocks]')) buildClocks(root);
for (const root of document.querySelectorAll('[data-rope-score]')) buildScore(root);
for (const root of document.querySelectorAll('[data-rope-curve]')) buildCurve(root);
