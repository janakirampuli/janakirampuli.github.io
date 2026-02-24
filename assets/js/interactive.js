/*
  Interactive article toolkit
  - No build step
  - Works on GitHub Pages
  - Progressive enhancement: if JS fails, content still readable
*/

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

/* -----------------
 * Tabs enhancement
 * ----------------- */
function enhanceTabs(root = document) {
  const tabs = root.querySelectorAll('.ia-tabs');
  for (const container of tabs) {
    const tablist = container.querySelector('.ia-tabs__tablist');
    const buttons = Array.from(container.querySelectorAll('.ia-tabs__tab'));
    const panels = Array.from(container.querySelectorAll('.ia-tabs__panel'));

    if (!tablist || buttons.length === 0 || panels.length === 0) continue;

    function select(idx) {
      buttons.forEach((b, i) => {
        b.setAttribute('aria-selected', i === idx ? 'true' : 'false');
        b.tabIndex = i === idx ? 0 : -1;
      });
      panels.forEach((p, i) => {
        if (i === idx) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
    }

    buttons.forEach((b, idx) => {
      b.addEventListener('click', () => select(idx));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = (idx + 1) % buttons.length;
          buttons[next].focus();
          select(next);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const prev = (idx - 1 + buttons.length) % buttons.length;
          buttons[prev].focus();
          select(prev);
        }
      });
    });

    // initial
    const initial = Math.max(0, buttons.findIndex(b => b.getAttribute('aria-selected') === 'true'));
    select(initial);
  }
}

/* ----------------------
 * Code block copy button
 * ---------------------- */
function enhanceCodeCopy(root = document) {
  const pres = root.querySelectorAll('pre');
  for (const pre of pres) {
    // Skip poems and any pre that already has a copy
    if (pre.classList.contains('poem')) continue;
    if (pre.querySelector('.ia-copy')) continue;

    const code = pre.querySelector('code') || pre;
    const btn = el('button', { class: 'ia-copy', type: 'button', title: 'Copy code' }, 'Copy');
    btn.addEventListener('click', async () => {
      const text = code.innerText;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = 'Copy'), 900);
      } catch {
        btn.textContent = 'Failed';
        setTimeout(() => (btn.textContent = 'Copy'), 900);
      }
    });
    pre.appendChild(btn);
  }
}

/* ----------------
 * Image lightbox
 * ---------------- */
function enhanceLightbox(root = document) {
  const imgs = root.querySelectorAll('img.ia-zoomable');
  if (imgs.length === 0) return;

  let dialog = document.querySelector('dialog.ia-lightbox');
  if (!dialog) {
    dialog = el('dialog', { class: 'ia-lightbox' }, [
      el('button', { class: 'ia-lightbox__close', type: 'button' }, 'Close'),
      el('img', { class: 'ia-lightbox__img', alt: '' }),
    ]);
    document.body.appendChild(dialog);

    dialog.querySelector('.ia-lightbox__close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      // click outside image closes
      const rect = dialog.querySelector('.ia-lightbox__img').getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) dialog.close();
    });
  }
  const imgEl = dialog.querySelector('.ia-lightbox__img');
  for (const img of imgs) {
    img.addEventListener('click', () => {
      imgEl.src = img.src;
      imgEl.alt = img.alt || '';
      dialog.showModal();
    });
  }
}

/* ---------------------------
 * <js-runner> web component
 * ---------------------------
   A tiny JS sandbox-ish runner.
   - Runs code via Function() in an isolated scope.
   - Captures console.log.
   - This is for learning demos only.
*/
class JsRunner extends HTMLElement {
  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;

    const tpl = this.querySelector('template');
    // IMPORTANT: use textContent so HTML entities like &lt;= are decoded to <=.
    // `innerHTML` would keep entities and break JS parsing.
    const initialCode = (tpl?.content?.textContent || tpl?.textContent || '').replace(/^\n/, '').trimEnd();
    const title = this.getAttribute('title') || 'Runnable JS';

    const editor = el('textarea', { class: 'ia-code-runner__editor', spellcheck: 'false' }, initialCode);
    const output = el('div', { class: 'ia-code-runner__output' }, '');

    const run = () => {
      const logs = [];
      const fakeConsole = {
        log: (...args) => logs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')),
        warn: (...args) => logs.push('[warn] ' + args.join(' ')),
        error: (...args) => logs.push('[error] ' + args.join(' ')),
      };
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('console', editor.value);
        fn(fakeConsole);
        output.textContent = logs.join('\n') || '(no output)';
      } catch (e) {
        output.textContent = String(e);
      }
    };

    const reset = () => {
      editor.value = initialCode;
      output.textContent = '';
    };

    const container = el('div', { class: 'ia-code-runner' }, [
      el('div', { class: 'ia-code-runner__toolbar' }, [
        el('strong', {}, title),
        el('span', { style: 'flex:1' }, ''),
        el('button', { type: 'button' }, 'Run'),
        el('button', { type: 'button' }, 'Reset'),
      ]),
      editor,
      output,
    ]);

    const [runBtn, resetBtn] = container.querySelectorAll('button');
    runBtn.addEventListener('click', run);
    resetBtn.addEventListener('click', reset);

    this.innerHTML = '';
    this.appendChild(container);
  }
}

/* ---------------------------------
 * <tile-matmul-demo> web component
 * ---------------------------------
   A lightweight explorable widget:
   show naive vs tiled access intuition.
*/
class TileMatmulDemo extends HTMLElement {
  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;

    const sizeAttr = this.getAttribute('size');
    const M = Math.min(16, Math.max(2, parseInt(this.getAttribute('m') || sizeAttr || '8', 10)));
    const N = Math.min(16, Math.max(2, parseInt(this.getAttribute('n') || sizeAttr || '8', 10)));
    const K = Math.min(16, Math.max(2, parseInt(this.getAttribute('k') || sizeAttr || '8', 10)));

    // Wider canvas: earlier version could clip the C matrix on some screens.
    const canvas = el('canvas', { width: 880, height: 320, style: 'width:100%;max-width:880px;height:auto;' });
    const ctx = canvas.getContext('2d');

    const tileRange = el('input', { type: 'range', min: '1', max: String(Math.min(8, M, N, K)), value: '2' });
    const tileLabel = el('span', {}, '2');
    const modeSelect = el('select', {}, [
      el('option', { value: 'naive' }, 'naive'),
      el('option', { value: 'tiled' }, 'tiled'),
    ]);
    const stepRange = el('input', { type: 'range', min: '0', max: String(K - 1), value: '0' });
    const stepLabel = el('span', {}, '0');

    const wrapper = el('div', { class: 'ia-widget' }, [
      el('div', { class: 'ia-widget__row' }, [
        el('strong', {}, 'Tiled matmul intuition'),
        el('span', { style: 'flex:1' }, ''),
        el('label', {}, ['mode', modeSelect]),
        el('label', {}, ['tile', tileRange, tileLabel]),
        el('label', {}, ['k', stepRange, stepLabel]),
      ]),
      canvas,
      el('div', { style: 'margin-top:0.6rem;color:var(--ia-muted);font-size:0.95rem;' },
        'Move k to see which A row and B column are touched. In tiled mode, we highlight a tile that would be loaded into shared memory.')
    ]);

    this.appendChild(wrapper);

    const draw = () => {
      const tile = parseInt(tileRange.value, 10);
      const mode = modeSelect.value;
      const k = parseInt(stepRange.value, 10);
      tileLabel.textContent = String(tile);
      stepLabel.textContent = String(k);

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const isDark = document.documentElement.classList.contains('dark-mode');
      const ink = isDark ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.82)';
      const gridInk = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';

      const margin = 18;
      const gap = 86;
      const maxGrid = 170;

      const cellFor = (rows, cols) => Math.max(8, Math.floor(maxGrid / Math.max(rows, cols)));

      const cellA = cellFor(M, K);
      const cellB = cellFor(K, N);
      const cellC = cellFor(M, N);

      const wA = K * cellA;
      const hA = M * cellA;
      const wB = N * cellB;
      const hB = K * cellB;
      const wC = N * cellC;
      const hC = M * cellC;

      const top = 70;
      const ax = margin;
      const ay = top;
      const bx = ax + wA + gap;
      const by = top;
      const cx = bx + wB + gap;
      const cy = top;

      // Choose a fixed output element C(i,j)
      const i = Math.floor(M / 2);
      const j = Math.floor(N / 2);

      const drawGrid = (x0, y0, rows, cols, cell, label) => {
        const w = cols * cell;
        const h = rows * cell;
        ctx.strokeStyle = gridInk;
        ctx.lineWidth = 1;
        ctx.strokeRect(x0, y0, w, h);
        for (let c = 1; c < cols; c++) {
          ctx.beginPath();
          ctx.moveTo(x0 + c * cell, y0);
          ctx.lineTo(x0 + c * cell, y0 + h);
          ctx.stroke();
        }
        for (let r = 1; r < rows; r++) {
          ctx.beginPath();
          ctx.moveTo(x0, y0 + r * cell);
          ctx.lineTo(x0 + w, y0 + r * cell);
          ctx.stroke();
        }

        ctx.fillStyle = ink;
        ctx.font = '14px ui-sans-serif, system-ui';
        ctx.fillText(label, x0, y0 - 10);
      };

      drawGrid(ax, ay, M, K, cellA, `A (${M}×${K})`);
      drawGrid(bx, by, K, N, cellB, `B (${K}×${N})`);
      drawGrid(cx, cy, M, N, cellC, `C (${M}×${N})`);

      // Highlight C(i,j)
      ctx.fillStyle = 'rgba(0, 122, 204, 0.22)';
      ctx.fillRect(cx + j * cellC, cy + i * cellC, cellC, cellC);
      ctx.strokeStyle = 'rgba(0, 122, 204, 0.92)';
      ctx.strokeRect(cx + j * cellC, cy + i * cellC, cellC, cellC);

      // Highlight A(i,k) and B(k,j)
      ctx.fillStyle = mode === 'naive' ? 'rgba(185, 28, 28, 0.22)' : 'rgba(19, 115, 51, 0.18)';
      ctx.fillRect(ax + k * cellA, ay + i * cellA, cellA, cellA);
      ctx.fillRect(bx + j * cellB, by + k * cellB, cellB, cellB);

      // Naive mode: highlight the full A row and B column used by the dot product
      if (mode === 'naive') {
        ctx.fillStyle = 'rgba(185, 28, 28, 0.09)';
        ctx.fillRect(ax, ay + i * cellA, wA, cellA);
        ctx.fillRect(bx + j * cellB, by, cellB, hB);
      }

      // Tiled mode: highlight tiles staged for reuse
      if (mode === 'tiled') {
        const t = tile;
        const tileK = Math.floor(k / t);
        const tileI = Math.floor(i / t);
        const tileJ = Math.floor(j / t);

        // A tile covers rows [tileI*t ..] and cols [tileK*t ..]
        const aRow0 = tileI * t;
        const aCol0 = tileK * t;
        const aRows = Math.min(t, M - aRow0);
        const aCols = Math.min(t, K - aCol0);

        // B tile covers rows [tileK*t ..] and cols [tileJ*t ..]
        const bRow0 = tileK * t;
        const bCol0 = tileJ * t;
        const bRows = Math.min(t, K - bRow0);
        const bCols = Math.min(t, N - bCol0);

        ctx.fillStyle = 'rgba(19, 115, 51, 0.10)';
        ctx.fillRect(ax + aCol0 * cellA, ay + aRow0 * cellA, aCols * cellA, aRows * cellA);
        ctx.fillRect(bx + bCol0 * cellB, by + bRow0 * cellB, bCols * cellB, bRows * cellB);
        ctx.strokeStyle = 'rgba(19, 115, 51, 0.80)';
        ctx.lineWidth = 2;
        ctx.strokeRect(ax + aCol0 * cellA, ay + aRow0 * cellA, aCols * cellA, aRows * cellA);
        ctx.strokeRect(bx + bCol0 * cellB, by + bRow0 * cellB, bCols * cellB, bRows * cellB);
      }

      // Explanation text
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.68)';
      ctx.font = '13px ui-sans-serif, system-ui';
      const msg = mode === 'naive'
        ? `naive: compute C[i=${i}, j=${j}] by scanning k=0..${K - 1} (A row i, B column j)`
        : `tiled: stage A and B tiles (tile=${tile}) for reuse while accumulating C[i=${i}, j=${j}]`;
      ctx.fillText(msg, margin, 28);
    };

    tileRange.addEventListener('input', draw);
    modeSelect.addEventListener('change', draw);
    stepRange.addEventListener('input', draw);

    // Redraw when theme toggles (your site toggles class on html)
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    draw();
  }
}

/* -----------------
 * Mermaid diagrams
 * -----------------
   If any .language-mermaid code blocks exist, replace them with rendered SVG.
   Uses free CDN (no cost).
*/
async function enhanceMermaid(root = document) {
  const blocks = root.querySelectorAll('pre > code.language-mermaid');
  if (blocks.length === 0) return;

  const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
  mermaid.initialize({ startOnLoad: false, theme: document.documentElement.classList.contains('dark-mode') ? 'dark' : 'default' });

  let idx = 0;
  for (const code of blocks) {
    const pre = code.closest('pre');
    const src = code.textContent;
    const container = el('div', { class: 'ia-widget' });
    pre.replaceWith(container);
    const id = `mermaid-${idx++}`;
    try {
      const { svg } = await mermaid.render(id, src);
      container.innerHTML = svg;
    } catch (e) {
      container.textContent = `Mermaid render failed: ${String(e)}`;
    }
  }
}

customElements.define('js-runner', JsRunner);
customElements.define('tile-matmul-demo', TileMatmulDemo);

// Run enhancements
enhanceTabs();
enhanceCodeCopy();
enhanceLightbox();
enhanceMermaid();

/* -----------------------------
 * Stepper enhancement
 * -----------------------------
   Markup:
     <div class="ia-stepper" data-stepper>
       <div class="ia-stepper__controls">...</div>
       <div class="ia-stepper__panel" data-step>...</div>
       ...
     </div>
*/
function enhanceSteppers(root = document) {
  const steppers = root.querySelectorAll('[data-stepper]');
  for (const stepper of steppers) {
    const panels = Array.from(stepper.querySelectorAll('[data-step]'));
    if (panels.length === 0) continue;

    let idx = 0;
    const controls = stepper.querySelector('.ia-stepper__controls') || stepper.insertBefore(el('div', { class: 'ia-stepper__controls' }), stepper.firstChild);
    const prevBtn = el('button', { type: 'button' }, 'Prev');
    const nextBtn = el('button', { type: 'button' }, 'Next');
    const prog = el('span', { class: 'ia-stepper__progress' }, '');
    if (controls.childElementCount == 0) {
      controls.append(prevBtn, nextBtn, prog);
    } else {
      controls.appendChild(prog);
    }

    function render() {
      panels.forEach((p, i) => {
        if (i === idx) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
      prevBtn.disabled = idx === 0;
      nextBtn.disabled = idx === panels.length - 1;
      prog.textContent = `Step ${idx + 1} / ${panels.length}`;
    }

    prevBtn.addEventListener('click', () => { idx = Math.max(0, idx - 1); render(); });
    nextBtn.addEventListener('click', () => { idx = Math.min(panels.length - 1, idx + 1); render(); });

    render();
  }
}

enhanceSteppers();

/* ---------------------------------
 * Distill-ish scrollytelling
 * ---------------------------------
   Pattern: sticky figure on the left, narrative steps on the right.
   We highlight the active step and update the figure.
*/
function enhanceScrolly(root = document) {
  const scrollys = root.querySelectorAll('[data-scrolly]');
  for (const scrolly of scrollys) {
    const steps = Array.from(scrolly.querySelectorAll('.ia-scrolly__step'));
    if (steps.length === 0) continue;

    const canvas = scrolly.querySelector('canvas');
    const ctx = canvas?.getContext?.('2d');

    const isDark = () => document.documentElement.classList.contains('dark-mode');

    function drawFigure(activeIndex) {
      if (!ctx || !canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const ink = isDark() ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.82)';
      const soft = isDark() ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
      const accent = 'rgba(0,122,204,0.85)';

      // Simple “sequence -> state -> output” diagram with step-dependent emphasis.
      const margin = 18;
      const boxW = (W - margin * 2);
      const seqY = 26;
      const seqH = 56;
      const midY = 110;
      const outY = 200;

      // Sequence tokens
      const tokens = 8;
      const gap = 8;
      const tW = (boxW - gap * (tokens - 1)) / tokens;

      ctx.font = '13px ui-sans-serif, system-ui';
      ctx.fillStyle = ink;
      ctx.fillText('sequence', margin, 18);
      for (let i = 0; i < tokens; i++) {
        const x = margin + i * (tW + gap);
        ctx.fillStyle = soft;
        ctx.fillRect(x, seqY, tW, seqH);
        ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)';
        ctx.strokeRect(x, seqY, tW, seqH);

        // Make step changes visually obvious
        const isHot = (activeIndex === 0 && i === 0) || (activeIndex === 1 && i === tokens - 1);
        if (isHot) {
          ctx.fillStyle = 'rgba(0,122,204,0.18)';
          ctx.fillRect(x, seqY, tW, seqH);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 4;
          ctx.strokeRect(x + 2, seqY + 2, tW - 4, seqH - 4);
          ctx.lineWidth = 1;
        }
      }

      // Hidden state box
      ctx.fillStyle = ink;
      ctx.fillText('hidden state', margin, midY - 10);
      ctx.fillStyle = 'rgba(19,115,51,0.10)';
      ctx.fillRect(margin, midY, boxW, 60);
      ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)';
      ctx.strokeRect(margin, midY, boxW, 60);

      // Output box
      ctx.fillStyle = ink;
      ctx.fillText('output', margin, outY - 10);
      ctx.fillStyle = 'rgba(185,28,28,0.08)';
      ctx.fillRect(margin, outY, boxW, 60);
      ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)';
      ctx.strokeRect(margin, outY, boxW, 60);

      // Arrows
      const arrow = (x0, y0, x1, y1, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        // arrow head
        const a = Math.atan2(y1 - y0, x1 - x0);
        const L = 10;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - L * Math.cos(a - 0.35), y1 - L * Math.sin(a - 0.35));
        ctx.lineTo(x1 - L * Math.cos(a + 0.35), y1 - L * Math.sin(a + 0.35));
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 1;
      };

      const fromY = seqY + seqH;
      arrow(margin + boxW * 0.5, fromY, margin + boxW * 0.5, midY, activeIndex >= 1 ? accent : (isDark() ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)'));
      arrow(margin + boxW * 0.5, midY + 60, margin + boxW * 0.5, outY, activeIndex >= 2 ? accent : (isDark() ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)'));

      // Title
      ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.65)';
      ctx.font = '12px ui-sans-serif, system-ui';
      const titles = [
        'Step 1: a token can be “memorized” and carried forward',
        'Step 2: later tokens can query what was stored',
        'Step 3: output depends on the carried information',
      ];
      ctx.fillText(titles[Math.min(activeIndex, titles.length - 1)], margin, H - 12);
    }

    let current = -1;
    function setActive(i) {
      if (i === current) return;
      current = i;
      steps.forEach((s, idx) => s.classList.toggle('is-active', idx === i));
      drawFigure(i);
    }

    // Robust scroll selection (works even if IntersectionObserver thresholds are finicky)
    let ticking = false;
    function updateFromScroll() {
      // Pick the step that is closest to a preferred viewport “reading line”.
      // Using a lower line (55%) tends to feel more natural with sticky figures.
      const targetY = window.innerHeight * 0.55;

      let bestIdx = 0;
      let bestScore = Infinity;

      for (let i = 0; i < steps.length; i++) {
        const r = steps[i].getBoundingClientRect();
        // If it's completely offscreen, deprioritize.
        const visible = r.bottom > 0 && r.top < window.innerHeight;
        const stepCenter = r.top + r.height * 0.5;
        const dist = Math.abs(stepCenter - targetY);
        const penalty = visible ? 0 : window.innerHeight; // push offscreen candidates away
        const score = dist + penalty;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      setActive(bestIdx);
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateFromScroll();
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    // Redraw on theme change
    const mo = new MutationObserver(() => {
      const active = steps.findIndex(s => s.classList.contains('is-active'));
      drawFigure(Math.max(0, active));
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Initial
    setActive(0);
    updateFromScroll();
  }
}

enhanceScrolly();

/* ---------------------------------
 * Horizontal sequence scroller (x-axis)
 * ---------------------------------
   Pattern: sticky figure + a horizontally scrollable sequence of “blocks”.
   - Hover and mousewheel/trackpad vertical scrolling maps to horizontal.
   - The figure updates based on which block is closest to the rail center.

   Markup:
     <div class="ia-xscrolly" data-xscrolly>
       <div class="ia-xscrolly__figure"><canvas ...></canvas></div>
       <div class="ia-xscrolly__rail">
         <div class="ia-xscrolly__item" data-title="...">...</div>
       </div>
     </div>
*/
function enhanceXScrolly(root = document) {
  const widgets = root.querySelectorAll('[data-xscrolly]');
  for (const w of widgets) {
    const canvas = w.querySelector('canvas');
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) continue;

    // Two modes:
    //  1) "rail" mode: a horizontal scroll rail of items exists (older demo)
    //  2) "scrub" mode: no rail; user scrubs directly on the canvas sequence boxes
    const rail = w.querySelector('.ia-xscrolly__rail');
    const railItems = rail ? Array.from(w.querySelectorAll('.ia-xscrolly__item')) : [];

    const tokenCountAttr = parseInt(w.getAttribute('data-tokens') || '0', 10);
    const tokenCount = (railItems.length || tokenCountAttr || 12);

    const titles = railItems.length
      ? railItems.map((it, i) => it.getAttribute('data-title') || it.textContent.trim() || `x${i + 1}`)
      : Array.from({ length: tokenCount }, (_, i) => `x${i + 1}`);

    const isDark = () => document.documentElement.classList.contains('dark-mode');

    let current = -1;

    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

    function scrollToItem(i, behavior = 'smooth') {
      if (!rail || railItems.length === 0) return;
      const it = railItems[i];
      if (!it) return;
      const left = it.offsetLeft + it.offsetWidth * 0.5 - rail.clientWidth * 0.5;
      rail.scrollTo({ left: clamp(left, 0, rail.scrollWidth - rail.clientWidth), behavior });
    }

    function drawFigure(activeIndex) {
      if (!ctx || !canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const ink = isDark() ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.82)';
      const soft = isDark() ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
      const gridInk = isDark() ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)';
      const accent = 'rgba(0,122,204,0.85)';

      const margin = 18;
      const boxW = W - margin * 2;

      // Tokens strip
      const tokens = titles.length;
      const gap = 8;
      const tW = (boxW - gap * (tokens - 1)) / tokens;
      const seqY = 26;
      const seqH = 56;

      ctx.font = '13px ui-sans-serif, system-ui';
      ctx.fillStyle = ink;
      ctx.fillText('sequence (scroll horizontally)', margin, 18);
      for (let i = 0; i < tokens; i++) {
        const x = margin + i * (tW + gap);
        ctx.fillStyle = soft;
        ctx.fillRect(x, seqY, tW, seqH);
        ctx.strokeStyle = gridInk;
        ctx.strokeRect(x, seqY, tW, seqH);

        if (i === activeIndex) {
          ctx.fillStyle = 'rgba(0,122,204,0.18)';
          ctx.fillRect(x, seqY, tW, seqH);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 4;
          ctx.strokeRect(x + 2, seqY + 2, tW - 4, seqH - 4);
          ctx.lineWidth = 1;
        }

        // token label
        ctx.fillStyle = ink;
        ctx.font = '12px ui-sans-serif, system-ui';
        const lab = titles[i];
        const tw = ctx.measureText(lab).width;
        ctx.fillText(lab, x + (tW - tw) / 2, seqY + seqH / 2 + 4);
      }

      // State + output
      const midY = 110;
      const outY = 200;
      ctx.fillStyle = ink;
      ctx.fillText('state', margin, midY - 10);
      ctx.fillStyle = 'rgba(19,115,51,0.10)';
      ctx.fillRect(margin, midY, boxW, 60);
      ctx.strokeStyle = gridInk;
      ctx.strokeRect(margin, midY, boxW, 60);

      ctx.fillStyle = ink;
      ctx.fillText('output', margin, outY - 10);
      ctx.fillStyle = 'rgba(185,28,28,0.08)';
      ctx.fillRect(margin, outY, boxW, 60);
      ctx.strokeStyle = gridInk;
      ctx.strokeRect(margin, outY, boxW, 60);

      // Fake “output” for the demo: change a scalar as you scrub.
      const scalar = Math.sin((activeIndex / Math.max(1, tokens - 1)) * Math.PI * 2);

      // Render a small bar in state/output to make the change obvious.
      const barW = Math.max(0, Math.min(1, (scalar + 1) / 2)) * (boxW - 24);
      ctx.fillStyle = 'rgba(0,122,204,0.18)';
      ctx.fillRect(margin + 12, midY + 18, barW, 10);
      ctx.fillRect(margin + 12, outY + 18, barW, 10);

      // Caption
      const title = titles[activeIndex] || `x${activeIndex + 1}`;
      ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.65)';
      ctx.font = '12px ui-sans-serif, system-ui';
      ctx.fillText(`Active: ${title}   output: ${scalar.toFixed(2)}`, margin, H - 12);
    }

    function setActive(i, { center = true } = {}) {
      i = clamp(i, 0, titles.length - 1);
      if (i === current) return;
      current = i;
      if (railItems.length) {
        railItems.forEach((it, idx) => it.classList.toggle('is-active', idx === i));
        if (center) scrollToItem(i);
      }
      drawFigure(i);
    }

    // If a rail exists, keep backwards-compatible behavior.
    if (rail && railItems.length) {
      let ticking = false;
      function updateFromRailScroll() {
        const rect = rail.getBoundingClientRect();
        const centerX = rect.left + rect.width * 0.5;

        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < railItems.length; i++) {
          const r = railItems[i].getBoundingClientRect();
          const c = r.left + r.width * 0.5;
          const d = Math.abs(c - centerX);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        // Don’t re-center during user-driven scrolling; just update active.
        setActive(bestIdx, { center: false });
      }

      function onRailScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          updateFromRailScroll();
        });
      }

      rail.addEventListener('scroll', onRailScroll, { passive: true });
      window.addEventListener('resize', onRailScroll);

      // Wheel => horizontal scroll while hovering the rail.
      rail.addEventListener('wheel', (e) => {
        const absY = Math.abs(e.deltaY);
        const absX = Math.abs(e.deltaX);
        if (absY <= absX) return; // already horizontal

        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 16; // lines
        else if (e.deltaMode === 2) delta *= rail.clientWidth; // pages

        const max = rail.scrollWidth - rail.clientWidth;
        const before = rail.scrollLeft;
        const after = clamp(before + delta, 0, max);

        // Only hijack the wheel if we can actually scroll the rail.
        if (after !== before) {
          rail.scrollLeft = after;
          e.preventDefault();
        }
      }, { passive: false });

      // Click to focus/center
      railItems.forEach((it, idx) => {
        it.addEventListener('click', () => setActive(idx));
      });

      // Keyboard navigation
      if (!rail.hasAttribute('tabindex')) rail.setAttribute('tabindex', '0');
      rail.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); setActive(current + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setActive(current - 1); }
        else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
        else if (e.key === 'End') { e.preventDefault(); setActive(railItems.length - 1); }
      });
    }

    // Scrub directly on the canvas (this is what the kitchen sink uses).
    const toCanvasXY = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (canvas.width / r.width),
        y: (e.clientY - r.top) * (canvas.height / r.height),
      };
    };

    const hitIndex = (x) => {
      const margin = 18;
      const boxW = canvas.width - margin * 2;
      const tokens = titles.length;
      const gap = 8;
      const tW = (boxW - gap * (tokens - 1)) / tokens;
      const i = Math.round((x - margin) / (tW + gap));
      return clamp(i, 0, tokens - 1);
    };

    let dragging = false;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      const { x } = toCanvasXY(e);
      setActive(hitIndex(x), { center: false });
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const { x } = toCanvasXY(e);
      setActive(hitIndex(x), { center: false });
      e.preventDefault();
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    });
    canvas.addEventListener('pointercancel', (e) => {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    });

    // Keyboard navigation on canvas
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); setActive(current + 1, { center: false }); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setActive(current - 1, { center: false }); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0, { center: false }); }
      else if (e.key === 'End') { e.preventDefault(); setActive(titles.length - 1, { center: false }); }
    });

    // Redraw on theme change
    const mo = new MutationObserver(() => {
      drawFigure(Math.max(0, current));
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Initial
    setActive(0, { center: false });
    // Make sure the first item is visible without scrolling the page.
    scrollToItem(0, 'auto');
  }
}

enhanceXScrolly();
