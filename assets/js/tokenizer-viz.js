/*
  Tokenizer diagrams
  - [data-bpe-train]: BPE training, one merge at a time
  - [data-tokenize]:  text -> pre-tokens -> bytes -> merges -> token ids
  Loaded on demand by interactive.js. Both run a real byte-level BPE in the page.
*/

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
  for (const ch of Array.isArray(children) ? children : [children]) {
    if (ch == null) continue;
    node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
  }
  return node;
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* -----------------
 * Byte-level BPE
 * -----------------
   A token is a "byte string": one char for each byte. `<` on these strings
   gives the same order as a comparison of Python bytes.
*/
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const toBytes = (s) => String.fromCharCode(...encoder.encode(s));

function show(tok) {
  const bytes = Uint8Array.from(tok, (c) => c.charCodeAt(0));
  try {
    return decoder.decode(bytes).replace(/ /g, '␣').replace(/\n/g, '↵').replace(/\t/g, '⇥');
  } catch {
    return Array.from(bytes, (b) => '\\x' + b.toString(16).padStart(2, '0')).join('');
  }
}

const pairKey = (a, b) => `${a.length}:${a}${b}`;

function countPairs(words) {
  const pairs = new Map();
  for (const { toks, count } of words) {
    for (let i = 0; i + 1 < toks.length; i++) {
      const key = pairKey(toks[i], toks[i + 1]);
      const p = pairs.get(key);
      if (p) p.count += count;
      else pairs.set(key, { key, a: toks[i], b: toks[i + 1], count });
    }
  }
  return pairs;
}

// Highest count first. Equal counts: the pair that is last in byte order first.
function byRank(p, q) {
  if (p.count !== q.count) return q.count - p.count;
  if (p.a !== q.a) return p.a > q.a ? -1 : 1;
  return p.b > q.b ? -1 : 1;
}

function mergeToks(toks, a, b) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (i + 1 < toks.length && toks[i] === a && toks[i + 1] === b) {
      out.push(a + b);
      i++;
    } else {
      out.push(toks[i]);
    }
  }
  return out;
}

// snaps[k] and tables[k] are the words and the pair counts after k merges.
function train(words, maxMerges) {
  const snaps = [words];
  const tables = [countPairs(words)];
  const merges = [];
  while (merges.length < maxMerges) {
    const ranked = [...tables[tables.length - 1].values()].sort(byRank);
    if (ranked.length === 0) break;
    const best = ranked[0];
    merges.push({
      a: best.a,
      b: best.b,
      count: best.count,
      ties: ranked.filter((p) => p.count === best.count).length,
    });
    const next = snaps[snaps.length - 1].map((w) => ({ count: w.count, toks: mergeToks(w.toks, best.a, best.b) }));
    snaps.push(next);
    tables.push(countPairs(next));
  }
  return { snaps, tables, merges };
}

const PRETOKEN = /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

const pretokens = (text) => text.match(PRETOKEN) || [];

// Split at the special tokens. The longest special token is tried first.
function segments(text, specials) {
  if (specials.length === 0) return text ? [{ text, special: false }] : [];
  const alts = [...specials]
    .sort((x, y) => y.length - x.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text
    .split(new RegExp(`(${alts.join('|')})`))
    .filter(Boolean)
    .map((t) => ({ text: t, special: specials.includes(t) }));
}

/* -----------------
 * Shared UI parts
 * ----------------- */

// A chip for one token. Merged tokens get a hue from their merge number.
// `parts` draws the chip as two halves that close up (a merge that just happened).
function makeChip(rankOf) {
  return function chip(tok, parts = null) {
    const node = el('span', { class: 'ia-tok' });
    const rank = rankOf.get(tok);
    if (rank != null) {
      node.classList.add('ia-tok--merged');
      node.style.setProperty('--tok-hue', String((rank * 47 + 24) % 360));
    }
    if (parts) {
      node.classList.add('is-new');
      node.append(el('span', {}, show(parts[0])), el('span', { class: 'ia-tok__seam' }), el('span', {}, show(parts[1])));
    } else {
      node.textContent = show(tok);
    }
    return node;
  };
}

// Play / step / scrub over `count` frames. `onFrame(i)` draws frame i.
// `label(i, count)` gives the progress text. The default is "i / count".
function makePlayer(onFrame, delay = () => 1500, label = (i, n) => `${i + 1} / ${n}`) {
  let frame = 0;
  let count = 1;
  let timer = null;

  const playBtn = el('button', { type: 'button' }, 'Play');
  const prevBtn = el('button', { type: 'button' }, 'Prev');
  const nextBtn = el('button', { type: 'button' }, 'Next');
  const range = el('input', { type: 'range', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Step' });
  const prog = el('span', { class: 'ia-player__progress' });
  const root = el('div', { class: 'ia-player' }, [playBtn, prevBtn, nextBtn, range, prog]);

  function sync() {
    const atEnd = frame === count - 1;
    playBtn.textContent = timer ? 'Pause' : atEnd && count > 1 ? 'Replay' : 'Play';
    prevBtn.disabled = frame === 0;
    nextBtn.disabled = atEnd;
    range.max = String(count - 1);
    range.value = String(frame);
    prog.textContent = label(frame, count);
  }

  function go(i) {
    frame = Math.max(0, Math.min(count - 1, i));
    onFrame(frame);
    sync();
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
    sync();
  }

  function tick() {
    timer = setTimeout(() => {
      go(frame + 1);
      if (frame >= count - 1) stop();
      else tick();
    }, delay(frame));
  }

  playBtn.addEventListener('click', () => {
    if (timer) return stop();
    if (frame === count - 1) go(0);
    if (count > 1) tick();
    sync();
  });
  prevBtn.addEventListener('click', () => { stop(); go(frame - 1); });
  nextBtn.addEventListener('click', () => { stop(); go(frame + 1); });
  range.addEventListener('input', () => { stop(); go(Number(range.value)); });

  return {
    root,
    reset(n, at = 0) {
      count = Math.max(1, n);
      stop();
      go(at);
    },
  };
}

// Run `update` (which reorders the children of `container`), then slide each
// child from its old position to its new one.
function flip(container, update) {
  const before = new Map();
  for (const ch of container.children) before.set(ch, ch.getBoundingClientRect());
  update();
  if (reduceMotion.matches) return;
  for (const ch of container.children) {
    const from = before.get(ch);
    if (!from) {
      ch.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' });
      continue;
    }
    const to = ch.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx || dy) {
      ch.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 450, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
  }
}

/* -----------------------------
 * BPE training walk-through
 * -----------------------------
   Markup:
     <div class="ia-anim ia-bpe" data-bpe-train
          data-words=" the:5| then:2| cat:3| hat:1" data-merges="6"></div>

   Frames: 0 is the start. Then each merge has two frames: the pair is selected,
   then the pair is merged.
*/
const MAX_PAIR_ROWS = 10;
const BASE_VOCAB = 256;
const PHASES = ['1 Count the pairs', '2 Select the top pair', '3 Merge the pair'];

function hasPair(toks, a, b) {
  for (let i = 0; i + 1 < toks.length; i++) {
    if (toks[i] === a && toks[i + 1] === b) return true;
  }
  return false;
}

function buildTrainer(root) {
  const words = (root.dataset.words || '')
    .split('|')
    .map((item) => {
      const i = item.lastIndexOf(':');
      const text = i < 0 ? item : item.slice(0, i);
      const count = i < 0 ? 1 : parseInt(item.slice(i + 1), 10) || 1;
      return { toks: [...toBytes(text)], count };
    })
    .filter((w) => w.toks.length > 0);
  if (words.length === 0) return;

  const { snaps, tables, merges } = train(words, Number(root.dataset.merges) || 6);
  const chip = makeChip(new Map(merges.map((m, i) => [m.a + m.b, i])));
  const pairNode = (a, b) => el('span', { class: 'ia-pair' }, [chip(a), chip(b)]);
  const maxCount = Math.max(1, ...[...tables[0].values()].map((p) => p.count));

  const caption = el('p', { class: 'ia-anim__caption', 'aria-live': 'polite' });
  const phases = el('div', { class: 'ia-bpe__phases' }, PHASES.map((text) => el('span', {}, text)));
  const wordsBox = el('div', { class: 'ia-bpe__words' });
  const mergesLabel = el('div', { class: 'ia-anim__label' });
  const mergesBox = el('div', { class: 'ia-bpe__merges' });
  const pairsBox = el('div', { class: 'ia-bpe__pairs' });
  const more = el('div', { class: 'ia-bpe__more' });
  const rowNodes = new Map();
  let current = snaps[0];

  function mark(a, b, cls) {
    current.forEach((w, wi) => {
      const chips = wordsBox.children[wi].querySelectorAll(':scope > .ia-tok');
      for (let i = 0; i + 1 < w.toks.length; i++) {
        if (w.toks[i] === a && w.toks[i + 1] === b) {
          chips[i].classList.add(cls);
          chips[i + 1].classList.add(cls);
          i++;
        }
      }
    });
  }

  function unmark(cls) {
    for (const node of wordsBox.querySelectorAll(`.${cls}`)) node.classList.remove(cls);
  }

  function rowNode(p) {
    let row = rowNodes.get(p.key);
    if (!row) {
      row = el('div', { class: 'ia-bpe__pair' }, [
        pairNode(p.a, p.b),
        el('span', { class: 'ia-bpe__bar' }, el('i')),
        el('span', { class: 'ia-bpe__count' }),
        el('span', { class: 'ia-bpe__delta' }),
      ]);
      row.addEventListener('pointerenter', () => mark(p.a, p.b, 'is-hover'));
      row.addEventListener('pointerleave', () => unmark('is-hover'));
      rowNodes.set(p.key, row);
    }
    return row;
  }

  // The pair rows of a frame. A "selected" frame is sorted. A "merged" frame keeps
  // the order of the frame before it, so the changed counts are easy to see.
  function pairRows(k, picking) {
    if (k === 0 || picking) {
      const ranked = [...tables[picking ? k - 1 : 0].values()].sort(byRank);
      return ranked.map((p, i) => ({ ...p, delta: 0, pick: picking && i === 0 }));
    }
    const before = tables[k - 1];
    const after = tables[k];
    const kept = [...before.values()].sort(byRank).map((p) => {
      const count = after.get(p.key)?.count ?? 0;
      return { ...p, count, delta: count - p.count };
    });
    const born = [...after.values()]
      .filter((p) => !before.has(p.key))
      .sort(byRank)
      .map((p) => ({ ...p, delta: p.count, born: true }));
    return [...kept, ...born];
  }

  function render(f) {
    const k = Math.ceil(f / 2);
    const picking = f % 2 === 1;
    const done = picking ? k - 1 : k;
    const m = k > 0 ? merges[k - 1] : null;
    const merged = m && !picking ? m.a + m.b : null;

    const phase = f === 0 ? 0 : picking ? 1 : 2;
    [...phases.children].forEach((node, i) => node.classList.toggle('is-active', i === phase));

    // The words that contain the pair of this merge. The other words do not change.
    const touched = m ? snaps[k - 1].map((w) => hasPair(w.toks, m.a, m.b)) : [];

    current = snaps[done];
    wordsBox.replaceChildren(...current.map((w, wi) => el(
      'div',
      { class: `ia-bpe__word${m && !touched[wi] ? ' is-idle' : ''}` },
      [
        el('span', { class: 'ia-bpe__mult' }, `${w.count}×`),
        ...w.toks.map((t) => chip(t, t === merged ? [m.a, m.b] : null)),
      ],
    )));
    if (picking) mark(m.a, m.b, 'is-pick');

    mergesLabel.textContent = `Merges · vocabulary ${BASE_VOCAB} + ${done} = ${BASE_VOCAB + done}`;
    mergesBox.replaceChildren(...merges.slice(0, done).map((x, i) => el(
      'span',
      { class: `ia-bpe__merge${merged && i === done - 1 ? ' is-new' : ''}` },
      [`${i + 1}.`, chip(x.a), '+', chip(x.b), '→', chip(x.a + x.b)],
    )));
    if (done === 0) mergesBox.textContent = 'No merges yet.';

    const all = pairRows(k, picking);
    const rows = all.filter((p, i) => i < MAX_PAIR_ROWS || p.delta !== 0);
    flip(pairsBox, () => {
      pairsBox.replaceChildren(...rows.map((p) => {
        const row = rowNode(p);
        row.classList.toggle('is-pick', Boolean(p.pick));
        row.classList.toggle('is-gone', p.count === 0);
        row.querySelector('i').style.width = `${(p.count / maxCount) * 100}%`;
        row.querySelector('.ia-bpe__count').textContent = String(p.count);
        const delta = row.querySelector('.ia-bpe__delta');
        delta.textContent = p.delta > 0 ? `+${p.delta}` : p.delta < 0 ? `−${-p.delta}` : '';
        delta.className = `ia-bpe__delta${p.delta > 0 ? ' is-up' : p.delta < 0 ? ' is-down' : ''}`;
        return row;
      }));
    });
    more.textContent = all.length > rows.length ? `and ${all.length - rows.length} more pairs` : '';

    if (f === 0) {
      const n = words[0].count;
      caption.replaceChildren(`Each word starts as single bytes. Each pair of adjacent tokens gets a count. A pair in a word with ${n} occurrences counts ${n} times.`);
    } else if (picking) {
      caption.replaceChildren(...(m.ties > 1
        ? [`${m.ties} pairs have a count of ${m.count}. The pair that is last in byte order wins: `, pairNode(m.a, m.b), '.']
        : ['The most frequent pair is ', pairNode(m.a, m.b), `, with a count of ${m.count}.`]));
    } else {
      const inWords = touched.filter(Boolean).length;
      const changed = all.filter((p) => p.delta !== 0).length;
      const same = all.length - changed;
      caption.replaceChildren(
        pairNode(m.a, m.b), ' becomes ', chip(m.a + m.b),
        ` in ${inWords} of ${current.length} words. `,
        changed === 1 ? '1 pair count changes. ' : `${changed} pair counts change. `,
        same === 1 ? '1 pair count stays the same.' : `${same} pair counts stay the same.`,
      );
    }
  }

  const player = makePlayer(
    render,
    (f) => (f % 2 === 0 ? 1300 : 1900),
    (f) => (f === 0 ? 'Start' : `Merge ${Math.ceil(f / 2)} of ${merges.length}`),
  );
  root.replaceChildren(
    player.root,
    phases,
    caption,
    el('div', { class: 'ia-bpe__cols' }, [
      el('div', {}, [
        el('div', { class: 'ia-anim__label' }, 'Words'),
        wordsBox,
        mergesLabel,
        mergesBox,
      ]),
      el('div', {}, [
        el('div', { class: 'ia-anim__label' }, 'Pair counts'),
        pairsBox,
        more,
      ]),
    ]),
  );

  // Keep the width of the pair column and the height of the merge list constant,
  // so the bars and the page do not move during play.
  const everyPair = new Map();
  for (const table of tables) for (const p of table.values()) everyPair.set(p.key, p);
  pairsBox.replaceChildren(...[...everyPair.values()].map(rowNode));
  const pairWidth = Math.max(0, ...[...pairsBox.children].map((row) => row.firstElementChild.getBoundingClientRect().width));
  if (pairWidth) pairsBox.style.gridTemplateColumns = `${Math.ceil(pairWidth)}px minmax(2rem, 1fr) 1.5em 2.2rem`;
  render(2 * merges.length);
  mergesBox.style.minHeight = `${Math.ceil(mergesBox.getBoundingClientRect().height)}px`;

  player.reset(1 + 2 * merges.length);

  // Keep the height of the pair list constant, so the page does not move during play.
  let maxRows = 0;
  for (let f = 0; f <= 2 * merges.length; f++) {
    const all = pairRows(Math.ceil(f / 2), f % 2 === 1);
    maxRows = Math.max(maxRows, all.filter((p, i) => i < MAX_PAIR_ROWS || p.delta !== 0).length);
  }
  const rowHeight = pairsBox.firstElementChild?.getBoundingClientRect().height || 0;
  pairsBox.style.minHeight = `${maxRows * (rowHeight + 2)}px`;
  pairsBox.style.alignContent = 'start';
}

/* -----------------------------
 * Text to token ids
 * -----------------------------
   Markup:
     <div class="ia-anim ia-tkz" data-tokenize
          data-text="the cat sat" data-merges="40"
          data-specials="<|endoftext|>" data-corpus="..."></div>

   The vocabulary is trained in the page on `data-corpus`.
   Frames: 0 text, 1 split at special tokens, 2 pre-tokens, 3 bytes,
   4 one token for each byte, then one frame for each merge that the text uses.
*/
const DEFAULT_TEXT = 'the cat saw the hat 🙂<|endoftext|>';
const DEFAULT_CORPUS = [
  'the cat sat on the mat. the cat saw a hat on the mat.',
  'the hat was red and the cat was fat. then the cat sat on the hat.',
  'the dog saw the cat and the dog ran. the cat ran and then the dog sat on the mat.',
  'a red hat and a fat cat sat in the sun. then the sun was hot and the cat and the dog sat.',
  'the dog had the hat and the cat had the mat.',
].join(' ');

const STAGE_LABELS = ['Split at special tokens', 'Pre-tokens', 'UTF-8 bytes', 'Tokens and ids'];

function buildTokenize(root) {
  const specials = (root.dataset.specials ?? '<|endoftext|>').split(/\s+/).filter(Boolean);
  const wordCounts = new Map();
  for (const seg of segments(root.dataset.corpus || DEFAULT_CORPUS, specials)) {
    if (seg.special) continue;
    for (const pt of pretokens(seg.text)) wordCounts.set(pt, (wordCounts.get(pt) || 0) + 1);
  }
  const { merges } = train(
    [...wordCounts].map(([text, count]) => ({ toks: [...toBytes(text)], count })),
    Number(root.dataset.merges) || 40,
  );
  const rankOf = new Map(merges.map((m, i) => [m.a + m.b, i]));
  const chip = makeChip(rankOf);
  const idOf = (tok) => (tok.length === 1 ? tok.charCodeAt(0) : 256 + specials.length + rankOf.get(tok));

  const input = el('input', {
    type: 'text',
    value: root.dataset.text || DEFAULT_TEXT,
    maxlength: 60,
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const slider = el('input', { type: 'range', min: 0, max: merges.length, step: 1, value: merges.length });
  const sliderValue = el('span', { class: 'ia-tkz__value' });
  const caption = el('p', { class: 'ia-anim__caption', 'aria-live': 'polite' });
  const grid = el('div', { class: 'ia-tkz__grid' });
  const stats = el('div', { class: 'ia-tkz__stats' });

  let cols = [];
  let steps = [];
  let tokCells = [];
  let hasSpecial = false;
  let quiet = false;

  const stack = (chipNode, id) => el('span', { class: 'ia-tkz__tok' }, [chipNode, el('span', { class: 'ia-tkz__id' }, String(id))]);

  function renderToks(f) {
    const j = Math.max(0, Math.min(steps.length, f - 4));
    const step = !quiet && f > 4 ? steps[j - 1] : null;
    cols.forEach((col, i) => {
      if (col.special) {
        const node = el('span', { class: 'ia-tok ia-tok--special' }, col.text);
        tokCells[i].replaceChildren(stack(node, 256 + specials.indexOf(col.text)));
        return;
      }
      const toks = col.states[j];
      const fresh = step && toks !== col.states[j - 1] ? step.a + step.b : null;
      tokCells[i].replaceChildren(...toks.map((t) => stack(chip(t, t === fresh ? [step.a, step.b] : null), idOf(t))));
    });
  }

  function render(f) {
    for (const node of grid.children) node.classList.toggle('is-off', Number(node.dataset.stage) > f);
    renderToks(f);

    if (f === 0) {
      caption.replaceChildren('Start with a string of text.');
    } else if (f === 1) {
      caption.replaceChildren(hasSpecial
        ? 'First, split the text at the special tokens. A special token goes directly to its id.'
        : 'First, split the text at the special tokens. This text has none, so it stays in one piece.');
    } else if (f === 2) {
      caption.replaceChildren('A regex splits each piece into pre-tokens. A space stays with the word after it. A merge does not go across a pre-token boundary.');
    } else if (f === 3) {
      caption.replaceChildren('Each pre-token becomes UTF-8 bytes. An English letter is 1 byte and an emoji is 4 bytes.');
    } else if (f === 4) {
      caption.replaceChildren('Each byte starts as one token. The id of the token is the byte value.');
    } else {
      const s = steps[f - 5];
      caption.replaceChildren(`Merge ${s.rank + 1} joins `, el('span', { class: 'ia-pair' }, [chip(s.a), chip(s.b)]), ' into ', chip(s.a + s.b), `, with id ${idOf(s.a + s.b)}.`);
    }
  }

  function encode() {
    const k = Number(slider.value);
    const segs = segments(input.value, specials);
    cols = [];
    steps = [];
    segs.forEach((seg, si) => {
      if (seg.special) cols.push({ seg: si, text: seg.text, special: true });
      else for (const pt of pretokens(seg.text)) cols.push({ seg: si, text: pt, states: [[...toBytes(pt)]] });
    });
    hasSpecial = cols.some((c) => c.special);

    // Apply the merges in the order that training learned them.
    for (let r = 0; r < k; r++) {
      const { a, b } = merges[r];
      let hit = false;
      const next = cols.map((c) => {
        if (c.special) return null;
        const cur = c.states[c.states.length - 1];
        const out = mergeToks(cur, a, b);
        if (out.length === cur.length) return cur;
        hit = true;
        return out;
      });
      if (!hit) continue;
      cols.forEach((c, i) => { if (!c.special) c.states.push(next[i]); });
      steps.push({ rank: r, a, b });
    }

    const cell = (stage, col, span, cls, children) => el('div', {
      class: `ia-tkz__cell ${cls}`,
      'data-stage': stage,
      style: `grid-row: ${stage * 2}; grid-column: ${col + 1} / span ${span}`,
    }, children);

    const nodes = STAGE_LABELS.map((text, i) => el('div', {
      class: 'ia-anim__label ia-tkz__rowlabel',
      'data-stage': i + 1,
      style: `grid-row: ${i * 2 + 1}`,
    }, text));
    segs.forEach((seg, si) => {
      const start = cols.findIndex((c) => c.seg === si);
      const span = cols.filter((c) => c.seg === si).length;
      nodes.push(cell(1, start, span, `ia-tkz__seg${seg.special ? ' ia-tkz__seg--special' : ''}`, seg.text));
    });
    tokCells = cols.map((col, i) => {
      nodes.push(cell(2, i, 1, `ia-tkz__pre${col.special ? ' ia-tkz__pre--special' : ''}`, col.special ? col.text : show(toBytes(col.text))));
      nodes.push(cell(3, i, 1, 'ia-tkz__bytes', col.special
        ? el('span', { class: 'ia-tkz__skip' }, 'no bytes')
        : [...toBytes(col.text)].map((c) => el('span', { class: 'ia-tkz__byte' }, String(c.charCodeAt(0))))));
      const toks = cell(4, i, 1, 'ia-tkz__toks', []);
      nodes.push(toks);
      return toks;
    });
    grid.style.gridTemplateColumns = `repeat(${Math.max(1, cols.length)}, max-content)`;
    grid.replaceChildren(...nodes);

    const bytes = encoder.encode(input.value).length;
    const count = cols.reduce((n, c) => n + (c.special ? 1 : c.states[c.states.length - 1].length), 0);
    sliderValue.textContent = `${k} of ${merges.length}`;
    stats.textContent = count === 0
      ? `Vocabulary size ${256 + specials.length + k}.`
      : `Vocabulary size ${256 + specials.length + k}. ${bytes} bytes become ${count} tokens. Compression ratio ${(bytes / count).toFixed(2)}.`;

    // A change to the text or the slider shows the result, without the animation.
    quiet = true;
    player.reset(5 + steps.length, 4 + steps.length);
    quiet = false;
  }

  const player = makePlayer(render, (f) => (f < 4 ? 1600 : 750));
  input.addEventListener('input', encode);
  slider.addEventListener('input', encode);

  root.replaceChildren(
    el('div', { class: 'ia-tkz__inputs' }, [
      el('label', { class: 'ia-tkz__field' }, [el('span', { class: 'ia-anim__label' }, 'Text'), input]),
      el('label', { class: 'ia-tkz__field' }, [el('span', { class: 'ia-anim__label' }, 'Merges'), slider, sliderValue]),
    ]),
    player.root,
    caption,
    el('div', { class: 'ia-tkz__scroll' }, grid),
    stats,
  );
  encode();
}

for (const root of document.querySelectorAll('[data-bpe-train]')) buildTrainer(root);
for (const root of document.querySelectorAll('[data-tokenize]')) buildTokenize(root);
