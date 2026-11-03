/*
  GPU diagrams
  - [data-gpu-machine]:   a processor that runs one place of y = a·x + y, one step at a time
  - [data-gpu-intensity]: math operations per number read, for a program and for the GPU
  - [data-gpu-threads]:   one scheduler switching between threads that wait on memory
  Loaded on demand by interactive.js. The styles are in transformer.css and gpu.css.
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

// 0.4 becomes "0.4", 12.3 becomes "12", 1234 becomes "1,234".
function num(x) {
  if (x < 10) return String(Math.round(x * 10) / 10);
  return Math.round(x).toLocaleString('en-US');
}

const pct = (p) => `${Math.round(p * 100)}%`;

// A row of buttons where one button is selected.
function makeSeg(labels, onPick) {
  const buttons = labels.map((label, i) => el('button', { type: 'button', onclick: () => onPick(i) }, label));
  return {
    root: el('div', { class: 'ia-tf-seg', role: 'group' }, buttons),
    select(i) {
      buttons.forEach((b, j) => b.setAttribute('aria-pressed', i === j ? 'true' : 'false'));
    },
  };
}

// A labelled range input. With `log`, the input moves along a log scale.
function makeSlider({ label, min, max, value, step = 'any', log = false, format = num, onInput }) {
  const toPos = (v) => (log ? Math.log(v) : v);
  const fromPos = (p) => (log ? Math.exp(p) : p);
  const input = el('input', { type: 'range', min: toPos(min), max: toPos(max), step, value: toPos(value), 'aria-label': label });
  const out = el('b', { class: 'ia-tf-num ia-gpu-out' });
  const s = {
    root: el('label', { class: 'ia-gpu-slider' }, [el('span', { class: 'ia-anim__label' }, label), input, out]),
    get value() { return fromPos(Number(input.value)); },
  };
  input.addEventListener('input', () => {
    out.textContent = format(s.value);
    onInput(s.value);
  });
  out.textContent = format(value);
  return s;
}

function toolbar(label, control) {
  return el('div', { class: 'ia-tf-toolbar' }, [el('span', { class: 'ia-anim__label' }, label), control]);
}

function caption() {
  return el('p', { class: 'ia-anim__caption ia-tf-caption', 'aria-live': 'polite' });
}

/* -----------------------------
 * Processor
 * ----------------------------- */

const READ_WAIT = 8;

const PROGRAM = [
  { text: 'load  r1, [100]', kind: 'load', reg: 'r1', addr: 100, desc: 'copy the number at address 100 into register r1' },
  { text: 'load  r2, [104]', kind: 'load', reg: 'r2', addr: 104, desc: 'copy the number at address 104 into register r2' },
  { text: 'load  r3, [108]', kind: 'load', reg: 'r3', addr: 108, desc: 'copy the number at address 108 into register r3' },
  { text: 'mul   r4, r1, r2', kind: 'mul', reg: 'r4', args: ['r1', 'r2'], desc: 'multiply r1 by r2 and put the result in r4' },
  { text: 'add   r3, r4, r3', kind: 'add', reg: 'r3', args: ['r4', 'r3'], desc: 'add r4 to r3 and put the result in r3' },
  { text: 'store [108], r3', kind: 'store', reg: 'r3', addr: 108, desc: 'copy r3 to address 108' },
];

const MEMORY = [
  { addr: 100, name: 'a', value: 2 },
  { addr: 104, name: 'x', value: 3 },
  { addr: 108, name: 'y', value: 4 },
];

const REGS = ['r1', 'r2', 'r3', 'r4'];

// Every step of the program, with the state after it and the kind of each tick so far.
function machineSteps() {
  const regs = Object.fromEntries(REGS.map((r) => [r, null]));
  const mem = Object.fromEntries(MEMORY.map((m) => [m.addr, m.value]));
  const ticks = [];
  const snap = (extra) => ({ regs: { ...regs }, mem: { ...mem }, ticks: [...ticks], ...extra });
  const steps = [snap({ pc: 0, phase: 'start', caption: 'The numbers a, x and y are in memory at addresses 100, 104 and 108. The program counter points to the first instruction.' })];

  PROGRAM.forEach((ins, i) => {
    ticks.push('fetch');
    steps.push(snap({ pc: i, phase: 'fetch', caption: `Tick ${ticks.length}. The processor fetches instruction ${i + 1} and decodes it. The instruction asks it to ${ins.desc}.` }));

    const start = ticks.length + 1;
    let caption;
    let math = null;
    if (ins.kind === 'load') {
      for (let t = 0; t < READ_WAIT; t++) ticks.push('wait');
      regs[ins.reg] = mem[ins.addr];
      caption = `Ticks ${start} to ${ticks.length}. The processor asks memory for the number at address ${ins.addr} and waits ${READ_WAIT} ticks for it. Then it puts ${regs[ins.reg]} in ${ins.reg}.`;
    } else if (ins.kind === 'store') {
      ticks.push('store');
      mem[ins.addr] = regs[ins.reg];
      const mathTicks = ticks.filter((t) => t === 'math').length;
      const waitTicks = ticks.filter((t) => t === 'wait').length;
      caption = `Tick ${ticks.length}. The processor sends ${regs[ins.reg]} to address ${ins.addr}, which is the new y. The program took ${ticks.length} ticks. Only ${mathTicks} of them did math, and ${waitTicks} went to waiting for memory.`;
    } else {
      ticks.push('math');
      const [p, q] = ins.args.map((r) => regs[r]);
      const result = ins.kind === 'mul' ? p * q : p + q;
      regs[ins.reg] = result;
      math = `${p} ${ins.kind === 'mul' ? '×' : '+'} ${q} = ${result}`;
      caption = `Tick ${ticks.length}. The math unit ${ins.kind === 'mul' ? 'multiplies' : 'adds'} ${p} and ${q} in one tick, and the processor puts ${result} in ${ins.reg}.`;
    }
    steps.push(snap({ pc: i, phase: 'exec', caption, math }));
  });
  return steps;
}

function buildMachine(root) {
  const steps = machineSteps();
  const total = steps[steps.length - 1].ticks.length;
  let at = 0;

  const progRows = PROGRAM.map((ins, i) => el('li', { class: 'ia-gpu-machine__row ia-tf-num' }, [el('span', { class: 'ia-gpu-machine__idx' }, String(i + 1)), ins.text]));
  const pcOut = el('b', { class: 'ia-tf-num' });
  const regRows = Object.fromEntries(REGS.map((r) => {
    const value = el('b', { class: 'ia-tf-num' });
    return [r, { value, row: el('div', { class: 'ia-gpu-machine__row' }, [el('span', { class: 'ia-tf-num' }, r), value]) }];
  }));
  const mathOut = el('b', { class: 'ia-tf-num' });
  const mathRow = el('div', { class: 'ia-gpu-machine__row ia-gpu-machine__alu' }, [el('span', {}, 'Math unit'), mathOut]);
  const memRows = Object.fromEntries(MEMORY.map((m) => {
    const value = el('b', { class: 'ia-tf-num' });
    return [m.addr, { value, row: el('div', { class: 'ia-gpu-machine__row' }, [el('span', { class: 'ia-tf-num' }, String(m.addr)), el('span', {}, m.name), value]) }];
  }));

  const col = (label, children) => el('div', { class: 'ia-gpu-machine__col' }, [el('span', { class: 'ia-anim__label' }, label), ...children]);
  const machine = el('div', { class: 'ia-gpu-machine' }, [
    col('Program', [el('ol', { class: 'ia-gpu-machine__prog' }, progRows)]),
    col('Processor', [
      el('div', { class: 'ia-gpu-machine__row' }, [el('span', {}, 'Program counter'), pcOut]),
      ...REGS.map((r) => regRows[r].row),
      mathRow,
    ]),
    col('Memory', MEMORY.map((m) => memRows[m.addr].row)),
  ]);

  const timeline = el('div', { class: 'ia-gpu-ticks' });
  const tickCount = el('b', { class: 'ia-tf-num' });
  const legend = el('div', { class: 'ia-gpu-legend' }, [
    ['is-fetch', 'Fetch and decode'],
    ['is-wait', 'Wait for memory'],
    ['is-math', 'Math'],
    ['is-store', 'Write to memory'],
  ].map(([cls, text]) => el('span', { class: 'ia-gpu-legend__item' }, [el('i', { class: `ia-gpu-swatch ${cls}` }), text])));

  const back = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => go(at - 1) }, 'Back');
  const next = el('button', { type: 'button', class: 'ia-tf-btn is-primary', onclick: () => go(at + 1) }, 'Next step');
  const reset = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => go(0) }, 'Start over');
  const cap = caption();

  root.append(
    machine,
    el('div', { class: 'ia-gpu-stats' }, [el('div', { class: 'ia-gpu-stat' }, [el('span', { class: 'ia-anim__label' }, 'Ticks so far'), tickCount])]),
    timeline,
    legend,
    el('div', { class: 'ia-tf-toolbar' }, [back, next, reset]),
    cap,
  );

  function go(i) {
    at = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[at];
    const ins = PROGRAM[s.pc];

    progRows.forEach((row, j) => row.classList.toggle('is-on', s.phase !== 'start' && j === s.pc));
    pcOut.textContent = String(s.phase === 'exec' ? s.pc + 2 : s.pc + 1);
    for (const r of REGS) {
      regRows[r].value.textContent = s.regs[r] == null ? '·' : String(s.regs[r]);
      const used = s.phase === 'exec' && (ins.reg === r || (ins.args || []).includes(r));
      regRows[r].row.classList.toggle('is-on', used);
    }
    mathOut.textContent = s.math || '';
    mathRow.classList.toggle('is-on', Boolean(s.math));
    for (const m of MEMORY) {
      memRows[m.addr].value.textContent = String(s.mem[m.addr]);
      memRows[m.addr].row.classList.toggle('is-on', s.phase === 'exec' && ins.addr === m.addr);
    }

    timeline.replaceChildren(...Array.from({ length: total }, (_, t) => el('i', { class: `ia-gpu-swatch is-${s.ticks[t] || 'empty'}` })));
    tickCount.textContent = String(s.ticks.length);
    back.disabled = at === 0;
    next.disabled = at === steps.length - 1;
    cap.textContent = s.caption;
  }

  go(0);
}

/* -----------------------------
 * Math or memory
 * ----------------------------- */

// H100 SXM. The L2 number is rounded from microbenchmarks, and the others are from the datasheet.
const MATH = [
  { name: 'FP32 cores', flops: 67e12, bytes: 4, number: 'fp32 number' },
  { name: 'Tensor cores', flops: 989e12, bytes: 2, number: 'bf16 number' },
];

const LEVELS = [
  { name: 'HBM', short: 'HBM', bandwidth: 3.35e12 },
  { name: 'L2 cache', short: 'the L2 cache', bandwidth: 7e12 },
  { name: 'Shared memory', short: 'shared memory', bandwidth: 33e12 },
];

const ALGOS = [
  { name: 'y = a·x + y' },
  { name: 'Matrix multiply' },
];

// With data-mode="simple", the diagram has one slider for the operations per number, and it
// describes a chip that needs data-need operations per number (80 by default), without H100 names.
function buildIntensity(root) {
  const simple = root.dataset.mode === 'simple';
  const need = Number(root.dataset.need || 0);
  let ops = Number(root.dataset.ops || 1);
  let algo = Number(root.dataset.algo || 0);
  let math = Number(root.dataset.math || 0);
  let level = Number(root.dataset.level || 0);
  let n = Number(root.dataset.n || 64);

  const algoSeg = makeSeg(ALGOS.map((a) => a.name), (i) => { algo = i; draw(); });
  const mathSeg = makeSeg(MATH.map((m) => m.name), (i) => { math = i; draw(); });
  const levelSeg = makeSeg(LEVELS.map((l) => l.name), (i) => { level = i; draw(); });
  const opsSlider = makeSlider({ label: 'Operations per number', min: 1, max: 1000, value: ops, log: true, format: (v) => String(Math.round(v)), onInput: (v) => { ops = Math.round(v); draw(); } });
  const size = makeSlider({ label: 'Size n', min: 1, max: 4096, value: n, log: true, format: (v) => String(Math.round(v)), onInput: (v) => { n = Math.round(v); draw(); } });

  const bar = (cls) => {
    const fillEl = el('div', { class: `ia-gpu-bar__fill ${cls}` });
    const value = el('span', { class: 'ia-tf-num ia-gpu-bar__value' });
    return { fillEl, value, track: el('div', { class: 'ia-gpu-bar__track' }, fillEl) };
  };
  const memBar = bar('is-mem');
  const mathBar = bar('is-math');

  const intensityOut = el('b', { class: 'ia-tf-num' });
  const neededOut = el('b', { class: 'ia-tf-num' });
  const busyOut = el('b', { class: 'ia-tf-num' });
  const cap = caption();

  const controls = simple
    ? [opsSlider.root]
    : [toolbar('Work', algoSeg.root), size.root, toolbar('Math on', mathSeg.root), toolbar('Numbers from', levelSeg.root)];

  root.append(
    ...controls,
    el('div', { class: 'ia-gpu-bars' }, [
      el('span', { class: 'ia-anim__label' }, 'Time to read the numbers'), memBar.track, memBar.value,
      el('span', { class: 'ia-anim__label' }, 'Time to do the math'), mathBar.track, mathBar.value,
    ]),
    el('div', { class: 'ia-gpu-stats' }, [
      el('div', { class: 'ia-gpu-stat' }, [el('span', { class: 'ia-anim__label' }, 'Math per number read'), intensityOut]),
      el('div', { class: 'ia-gpu-stat' }, [el('span', { class: 'ia-anim__label' }, simple ? 'Math the chip needs per number' : 'Math the GPU needs per number'), neededOut]),
      el('div', { class: 'ia-gpu-stat' }, [el('span', { class: 'ia-anim__label' }, 'Math units busy'), busyOut]),
    ]),
    cap,
  );

  function draw() {
    algoSeg.select(algo);
    mathSeg.select(math);
    levelSeg.select(level);
    size.root.hidden = algo !== 1;

    const m = MATH[math];
    const l = LEVELS[level];
    const needed = simple && need ? need : m.flops / (l.bandwidth / m.bytes);
    const intensity = simple ? ops : algo === 0 ? 1 : n;
    const busy = Math.min(1, intensity / needed);

    // Bars for the same amount of work: reading time is `needed`, math time is `intensity`.
    const longest = Math.max(needed, intensity);
    memBar.fillEl.style.width = pct(needed / longest);
    mathBar.fillEl.style.width = pct(intensity / longest);
    memBar.value.textContent = intensity >= needed ? '' : 'sets the speed';
    mathBar.value.textContent = intensity >= needed ? 'sets the speed' : '';

    intensityOut.textContent = num(intensity);
    neededOut.textContent = num(needed);
    busyOut.textContent = pct(busy);

    const work = simple
      ? `The program does ${num(ops)} ${ops === 1 ? 'operation' : 'operations'} on each number that it reads`
      : algo === 0
      ? 'y = a·x + y reads 2 numbers and does 2 operations on them, which is 1 operation per number'
      : `A matrix multiply of size ${n} reads each number once and uses it ${n} times, which is ${num(intensity)} operations per number`;
    const verdict = simple
      ? intensity >= needed
        ? 'The memory keeps up with the math units, so the math sets the speed.'
        : `The math units could do ${num(needed)} operations in the time it takes to read one number from memory, so they wait on reads ${pct(1 - busy)} of the time.`
      : intensity >= needed
      ? `The ${m.name.replace('Tensor', 'tensor')} can't keep up with ${l.short}, so the math sets the speed.`
      : `The ${m.name.replace('Tensor', 'tensor')} could do ${num(needed)} operations in the time it takes to read one ${m.number} from ${l.short}, so they wait on reads ${pct(1 - busy)} of the time.`;
    cap.textContent = `${work}. ${verdict}`;
  }

  draw();
}

/* -----------------------------
 * Scheduler and threads
 * ----------------------------- */

const TICKS = 64;
const WAIT = 20;

// Each thread runs `k` math instructions, then one read, then waits WAIT ticks for the data.
// The scheduler starts at most one instruction per tick. It keeps the same thread while that thread
// is ready, and otherwise picks the thread that has been ready the longest.
function simulate(warps, k) {
  const states = Array.from({ length: warps }, () => new Array(TICKS).fill('ready'));
  const step = new Array(warps).fill(0);
  const readyAt = new Array(warps).fill(0);
  const issued = new Array(TICKS).fill(-1);
  let last = -1;

  for (let t = 0; t < TICKS; t++) {
    let pick = last >= 0 && readyAt[last] <= t ? last : -1;
    for (let w = 0; pick < 0 && w < warps; w++) {
      if (readyAt[w] <= t) pick = w;
    }
    if (pick !== last) {
      for (let w = 0; w < warps; w++) {
        if (readyAt[w] <= t && readyAt[w] < readyAt[pick]) pick = w;
      }
    }
    for (let w = 0; w < warps; w++) {
      if (readyAt[w] > t) states[w][t] = 'wait';
    }
    if (pick >= 0) {
      const isRead = step[pick] === k;
      states[pick][t] = isRead ? 'read' : 'math';
      issued[t] = pick;
      if (isRead) {
        step[pick] = 0;
        readyAt[pick] = t + 1 + WAIT;
      } else {
        step[pick] += 1;
        readyAt[pick] = t + 1;
      }
      last = isRead ? -1 : pick;
    }
  }
  return { states, issued };
}

function buildThreads(root) {
  let warps = Number(root.dataset.threads || 2);
  let k = Number(root.dataset.math || 2);

  const warpSlider = makeSlider({ label: 'Threads', min: 1, max: 16, step: 1, value: warps, format: (v) => String(Math.round(v)), onInput: (v) => { warps = Math.round(v); draw(); } });
  const mathSlider = makeSlider({ label: 'Math between reads', min: 1, max: 8, step: 1, value: k, format: (v) => String(Math.round(v)), onInput: (v) => { k = Math.round(v); draw(); } });

  const legend = el('div', { class: 'ia-gpu-legend' }, [
    ['is-math', 'Runs a math instruction'],
    ['is-read', 'Starts a read'],
    ['is-wait', 'Waits for its data'],
    ['is-ready', 'Ready, waits for its turn'],
  ].map(([cls, text]) => el('span', { class: 'ia-gpu-legend__item' }, [el('i', { class: `ia-gpu-swatch ${cls}` }), text])));

  const chart = el('div', { class: 'ia-gpu-chart' });
  const busyOut = el('b', { class: 'ia-tf-num' });
  const cap = caption();

  root.append(
    warpSlider.root,
    mathSlider.root,
    legend,
    chart,
    el('div', { class: 'ia-gpu-stats' }, [
      el('div', { class: 'ia-gpu-stat' }, [el('span', { class: 'ia-anim__label' }, 'Ticks where the scheduler starts an instruction'), busyOut]),
    ]),
    cap,
  );

  function draw() {
    const { states, issued } = simulate(warps, k);
    const cell = 10;
    const gap = 1;
    const left = 62;
    const top = 16;
    const rowsH = warps * (cell + gap);
    const width = left + TICKS * (cell + gap);
    const height = top + rowsH + 8 + cell + 4;

    const parts = [];
    for (let t = 0; t < TICKS; t += 8) {
      parts.push(svg('text', { class: 'ia-gpu-axis', x: left + t * (cell + gap), y: 10 }, String(t)));
    }
    for (let w = 0; w < warps; w++) {
      const y = top + w * (cell + gap);
      parts.push(svg('text', { class: 'ia-gpu-axis', x: 0, y: y + cell - 1 }, `thread ${w + 1}`));
      for (let t = 0; t < TICKS; t++) {
        parts.push(svg('rect', { class: `ia-gpu-cell is-${states[w][t]}`, x: left + t * (cell + gap), y, width: cell, height: cell, rx: 1 }));
      }
    }
    const sy = top + rowsH + 8;
    parts.push(svg('text', { class: 'ia-gpu-axis is-strong', x: 0, y: sy + cell - 1 }, 'scheduler'));
    for (let t = 0; t < TICKS; t++) {
      const w = issued[t];
      const cls = w < 0 ? 'is-idle' : `is-${states[w][t]}`;
      parts.push(svg('rect', { class: `ia-gpu-cell ${cls}`, x: left + t * (cell + gap), y: sy, width: cell, height: cell, rx: 1 }));
    }

    chart.replaceChildren(svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Timeline of threads and the scheduler' }, parts));

    // Count from tick WAIT, after every thread has had time to start.
    const tail = issued.slice(WAIT);
    const busy = tail.filter((w) => w >= 0).length / tail.length;
    busyOut.textContent = pct(busy);

    const perWarp = (k + 1) / (k + 1 + WAIT);
    const needed = Math.ceil(1 / perWarp);
    cap.textContent = busy >= 0.99
      ? `With ${warps} threads, some thread is always ready, so the scheduler starts an instruction on every tick. Each thread waits ${WAIT} ticks after each read, and the other threads run during the wait.`
      : `Each thread starts ${k + 1} instructions and then waits ${WAIT} ticks for its data, so it is ready only ${pct(perWarp)} of the time. About ${needed} threads keep the scheduler busy on every tick, and with ${warps} ${warps === 1 ? 'thread' : 'threads'} it starts an instruction on ${pct(busy)} of the ticks.`;
  }

  draw();
}

/* -----------------------------
 * Start
 * ----------------------------- */
const BUILDERS = {
  '[data-gpu-machine]': buildMachine,
  '[data-gpu-intensity]': buildIntensity,
  '[data-gpu-threads]': buildThreads,
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
