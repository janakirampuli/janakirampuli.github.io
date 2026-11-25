/*
  GPU diagrams
  - [data-gpu-machine]:   a processor that runs one place of y = a·x + y, one step at a time
  - [data-gpu-intensity]: math operations per number read, for a program and for the GPU
  - [data-gpu-threads]:   one scheduler switching between threads that wait on memory
  - [data-gpu-launch]:    a kernel launch, from the CPU to the work distributor, an SM and one thread
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
 * Kernel launch
 * ----------------------------- */

const LAUNCH_BLOCKS = 10;
// [SM, slot] of each block. Blocks 8 and 9 run in the second wave.
const LAUNCH_HOME = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [0, 0], [1, 0]];
const LAUNCH_PROGRAM = ['load  r1, a', 'load  r2, x[165]', 'load  r3, y[165]', 'mul   r4, r1, r2', 'add   r3, r4, r3', 'store y[165], r3'];

const blocksWith = (fn) => Array.from({ length: LAUNCH_BLOCKS }, (_, b) => fn(b));

// Warp states for SM 0, as [block 0, block 1] for each quarter.
const W_READY = [['ready', 'ready'], ['ready', 'ready'], ['ready', 'ready'], ['ready', 'ready']];

const LAUNCH_STEPS = [
  { view: 'chip', focus: [], cmd: 'none', copy: 'none', blocks: null,
    caption: 'The kernel runs y = a·x + y on lists of 1,280 places, as a grid of 10 blocks of 128 threads, so every place gets one thread. The chip is made up, with 4 SMs that each hold 256 threads, so each SM has room for 2 of these blocks.' },
  { view: 'chip', focus: ['cpu'], cmd: 'cpu', copy: 'none', blocks: null,
    caption: 'The CPU writes a launch command. The command names the kernel and gives the size of the grid, the size of each block and the input values, which are a, the length of the lists and the addresses of x and y.' },
  { view: 'chip', focus: ['stream'], cmd: 'stream', copy: 'stream', blocks: null,
    caption: 'The CPU puts the command in a stream, which is a queue that the GPU reads from, and it puts a second command after it that copies y back to the CPU. The CPU then goes on with its own work.' },
  { view: 'chip', focus: ['wd'], cmd: 'none', copy: 'stream', blocks: blocksWith(() => 'wait'),
    caption: 'The GPU takes the launch command from the stream and gives the grid to the work distributor. All 10 blocks wait there for space on an SM.' },
  { view: 'chip', focus: ['sms'], cmd: 'none', copy: 'stream', blocks: blocksWith((b) => (b < 8 ? 'run' : 'wait')),
    caption: 'The work distributor sends a block to every SM that has room for it. The 4 SMs take 8 blocks, and blocks 8 and 9 keep waiting.' },
  { view: 'sm', warps: W_READY, panel: 'setup',
    caption: 'Inside SM 0, the SM reserves registers for the 256 threads of blocks 0 and 1. It splits each block into 4 warps of 32 threads with consecutive numbers, and each warp goes to one quarter of the SM. The diagram shows one possible placement of the warps.' },
  { view: 'sm', warps: W_READY, panel: 'thread', rows: [], regs: ['', '', '', ''],
    caption: 'Each thread reads its block number and its thread number. Thread 37 of block 1 is in warp 1, which holds threads 32 to 63, and it works on place 1 · 128 + 37, which is place 165.' },
  { view: 'sm', warps: [['math', 'wait'], ['math', 'wait'], ['wait', 'math'], ['ready', 'read']], panel: 'thread', rows: [0, 1, 2], regs: ['a', 'on the way', 'on the way', ''],
    caption: 'The warp of thread 37 loads a and starts the reads of x and y at place 165, and then it waits for the data. In the meantime, the scheduler of its quarter runs the other warp, which is from block 0.' },
  { view: 'sm', warps: [['wait', 'math'], ['wait', 'math'], ['math', 'wait'], ['wait', 'math']], panel: 'thread', rows: [3, 4], regs: ['a', 'x[165]', 'a·x[165] + y[165]', 'a·x[165]'],
    caption: 'The data arrives, and the warp runs mul and add. Each of the 32 threads uses its own registers, so thread 37 computes a·x + y for place 165 while the other threads do the same for their places.' },
  { view: 'sm', warps: [['math', 'wait'], ['math', 'done'], ['read', 'wait'], ['math', 'wait']], panel: 'thread', rows: [5], regs: ['a', 'x[165]', 'a·x[165] + y[165]', 'a·x[165]'], done: true,
    caption: 'The warp runs store, and each thread writes its new y to memory. Every thread of the warp has reached the end of the program, so the warp is done.' },
  { view: 'chip', focus: ['sms'], cmd: 'none', copy: 'stream', blocks: blocksWith((b) => (b < 8 ? 'done' : 'run')),
    caption: 'When all the warps of a block are done, the SM frees the registers of the block. Blocks 0 to 7 have finished, and the work distributor sends blocks 8 and 9 into the free space as a second wave, while SMs 2 and 3 have nothing left to run.' },
  { view: 'chip', focus: ['stream', 'cpu'], cmd: 'none', copy: 'run', blocks: blocksWith(() => 'done'),
    caption: 'The last block finishes, so the kernel is finished. The next command in the stream, which copies y back to the CPU, can now run, and the CPU finds out that the kernel has finished when the copy arrives.' },
];

function buildLaunch(root) {
  let at = 0;
  const picture = el('div', { class: 'ia-gpu-chart ia-gpu-launch' });
  const legend = el('div', { class: 'ia-gpu-legend' });
  const back = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => go(at - 1) }, 'Back');
  const next = el('button', { type: 'button', class: 'ia-tf-btn is-primary', onclick: () => go(at + 1) }, 'Next step');
  const reset = el('button', { type: 'button', class: 'ia-tf-btn', onclick: () => go(0) }, 'Start over');
  const stepOut = el('span', { class: 'ia-anim__label ia-gpu-step' });
  const cap = caption();

  root.append(picture, legend, el('div', { class: 'ia-tf-toolbar' }, [back, next, reset, stepOut]), cap);

  const box = (x, y, w, h, on, extra = '') => svg('rect', { class: `ia-gpu-box${on ? ' is-on' : ''}${extra}`, x, y, width: w, height: h, rx: 4 });
  const title = (x, y, text) => svg('text', { class: 'ia-gpu-title', x, y }, text);
  const small = (x, y, text, cls = '') => svg('text', { class: `ia-gpu-axis${cls}`, x, y }, text);
  const arrow = (x1, y1, x2, y2) => svg('line', { class: 'ia-gpu-arrow', x1, y1, x2, y2, 'marker-end': 'url(#ia-gpu-head)' });
  const defs = () => svg('defs', {}, svg('marker', { id: 'ia-gpu-head', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' }, svg('path', { class: 'ia-gpu-arrowhead', d: 'M0,0 L8,4 L0,8 z' })));

  function card(x, y, w, lines, state) {
    return [
      svg('rect', { class: `ia-gpu-card is-${state}`, x, y, width: w, height: 34, rx: 3 }),
      ...lines.map((t, i) => small(x + 7, y + 14 + i * 12, t, i === 0 ? ' is-strong' : '')),
    ];
  }

  function block(x, y, size, b, state) {
    return [
      svg('rect', { class: `ia-gpu-blk is-${state}`, x, y, width: size, height: size, rx: 3 }),
      svg('text', { class: `ia-gpu-blk__num is-${state}`, x: x + size / 2, y: y + size / 2 + 3.5, 'text-anchor': 'middle' }, String(b)),
    ];
  }

  function chip(s) {
    const on = (k) => s.focus.includes(k);
    const parts = [defs()];

    parts.push(box(10, 20, 140, 95, on('cpu')), title(20, 38, 'CPU'));
    if (s.cmd === 'cpu') parts.push(...card(20, 56, 120, ['Launch command', '10 blocks of 128 threads'], 'on'));
    if (s.copy === 'run') parts.push(...card(20, 56, 120, ['y arrives', 'the kernel has finished'], 'on'));

    parts.push(box(10, 145, 140, 105, on('stream')), title(20, 163, 'Stream'));
    const slots = [];
    if (s.cmd === 'stream') slots.push([['Launch command', '10 blocks of 128 threads'], 'on']);
    if (s.copy !== 'none') slots.push([['Copy y to the CPU', s.copy === 'run' ? 'runs now' : 'waits for the kernel'], s.copy === 'run' ? 'on' : 'off']);
    slots.forEach(([lines, state], i) => parts.push(...card(20, 172 + i * 38, 120, lines, state)));

    parts.push(arrow(80, 115, 80, 143), arrow(150, 197, 183, 197), arrow(345, 135, 373, 135));

    parts.push(box(185, 20, 160, 230, on('wd')), title(195, 38, 'Work distributor'));
    if (s.blocks) {
      parts.push(small(195, 54, 'Grid'));
      s.blocks.forEach((st, b) => {
        const x = 231 + (b % 2) * 38;
        const y = 62 + Math.floor(b / 2) * 37;
        parts.push(...block(x, y, 30, b, st === 'run' ? 'away' : st));
      });
    }

    for (let sm = 0; sm < 4; sm++) {
      const x = 375 + (sm % 2) * 135;
      const y = 20 + Math.floor(sm / 2) * 125;
      parts.push(box(x, y, 120, 105, on('sms')), title(x + 10, y + 18, `SM ${sm}`));
      for (let slot = 0; slot < 2; slot++) {
        const bx = x + 15 + slot * 50;
        const by = y + 40;
        const b = s.blocks ? s.blocks.findIndex((st, i) => st === 'run' && LAUNCH_HOME[i][0] === sm && LAUNCH_HOME[i][1] === slot) : -1;
        if (b >= 0) parts.push(...block(bx, by, 40, b, 'run'));
        else parts.push(svg('rect', { class: 'ia-gpu-slot', x: bx, y: by, width: 40, height: 40, rx: 3 }));
      }
      parts.push(small(x + 15, y + 96, 'room for 2 blocks'));
    }
    return parts;
  }

  function sm(s) {
    const parts = [box(10, 10, 420, 250, false), title(20, 27, 'SM 0, running blocks 0 and 1')];
    for (let q = 0; q < 4; q++) {
      const y = 36 + q * 56;
      parts.push(svg('rect', { class: 'ia-gpu-quarter', x: 20, y, width: 400, height: 50, rx: 3 }), small(28, y + 12, `Quarter ${q}, one scheduler`, ' is-strong'));
      for (let b = 0; b < 2; b++) {
        const by = y + 18 + b * 15;
        const state = s.warps[q][b];
        parts.push(small(28, by + 9, `block ${b}, warp ${q}`));
        for (let lane = 0; lane < 32; lane++) {
          parts.push(svg('rect', { class: `ia-gpu-cell is-${state}`, x: 118 + lane * 9, y: by, width: 8, height: 11, rx: 1 }));
        }
      }
    }
    if (s.panel === 'thread') {
      parts.push(svg('rect', { class: 'ia-gpu-me', x: 118 + 5 * 9 - 1.5, y: 36 + 56 + 18 + 15 - 1.5, width: 11, height: 14, rx: 2 }));
    }

    parts.push(box(445, 10, 185, 250, s.panel === 'thread'));
    if (s.panel === 'setup') {
      parts.push(title(455, 27, 'Blocks 0 and 1'));
      ['128 threads in each block', '4 warps in each block', 'Registers reserved for', 'all 256 threads'].forEach((t, i) => parts.push(small(455, 48 + i * 15, t)));
      return parts;
    }

    parts.push(title(455, 27, s.done ? 'Thread 37 of block 1, done' : 'Thread 37 of block 1'));
    [['Block number', '1'], ['Thread number', '37'], ['Place', '1 · 128 + 37 = 165']].forEach(([k, v], i) => {
      parts.push(small(455, 46 + i * 14, k), small(530, 46 + i * 14, v, ' is-strong'));
    });
    parts.push(small(455, 96, 'Program'));
    LAUNCH_PROGRAM.forEach((t, i) => {
      const hot = s.rows.includes(i);
      const y = 101 + i * 14;
      if (hot) parts.push(svg('rect', { class: 'ia-gpu-hot', x: 451, y, width: 173, height: 13, rx: 2 }));
      parts.push(svg('text', { class: `ia-gpu-code${hot ? ' is-on' : ''}`, x: 457, y: y + 9.5 }, t));
    });
    parts.push(small(455, 199, 'Registers of thread 37'));
    s.regs.forEach((v, i) => {
      parts.push(svg('text', { class: 'ia-gpu-code', x: 457, y: 213 + i * 13 }, `r${i + 1}  ${v || '·'}`));
    });
    return parts;
  }

  const LEGENDS = {
    chip: [['ia-gpu-blk is-wait', 'Waits in the grid'], ['ia-gpu-blk is-run', 'Runs on an SM'], ['ia-gpu-blk is-done', 'Finished']],
    sm: [['is-math', 'Runs an instruction'], ['is-read', 'Starts a read'], ['is-wait', 'Waits for its data'], ['is-ready', 'Ready, waits for its turn'], ['is-done', 'Done']],
  };

  function go(i) {
    at = Math.max(0, Math.min(LAUNCH_STEPS.length - 1, i));
    const s = LAUNCH_STEPS[at];
    const parts = s.view === 'chip' ? chip(s) : sm(s);
    picture.replaceChildren(svg('svg', { viewBox: '0 0 640 270', role: 'img', 'aria-label': s.view === 'chip' ? 'The CPU, the stream, the work distributor and 4 SMs' : 'The warps of SM 0 and the registers of thread 37' }, parts));
    legend.replaceChildren(...LEGENDS[s.view].map(([cls, text]) => el('span', { class: 'ia-gpu-legend__item' }, [el('i', { class: `ia-gpu-swatch ${cls}` }), text])));
    stepOut.textContent = `Step ${at + 1} of ${LAUNCH_STEPS.length}`;
    back.disabled = at === 0;
    next.disabled = at === LAUNCH_STEPS.length - 1;
    cap.textContent = s.caption;
  }

  go(0);
}

/* -----------------------------
 * Start
 * ----------------------------- */
const BUILDERS = {
  '[data-gpu-machine]': buildMachine,
  '[data-gpu-intensity]': buildIntensity,
  '[data-gpu-threads]': buildThreads,
  '[data-gpu-launch]': buildLaunch,
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
