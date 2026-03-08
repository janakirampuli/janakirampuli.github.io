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

// Run enhancements
enhanceTabs();
enhanceCodeCopy();
enhanceLightbox();
enhanceMermaid();

/* -----------------------------
 * TODO checklist enhancement
 * -----------------------------
   Kramdown task lists are rendered as:
     <li class="task-list-item"><input type="checkbox" ...>text</li>
   We wrap the text in a span so completed items can be struck through
   without affecting the checkbox itself.
*/
function enhanceTodoLists(root = document) {
  const items = root.querySelectorAll('.ia-todo__body li.task-list-item');
  for (const li of items) {
    const checkbox = li.querySelector('input[type="checkbox"]');
    if (!checkbox) continue;

    let text = li.querySelector('.ia-task-text');
    if (!text) {
      text = el('span', { class: 'ia-task-text' });
      const nodes = Array.from(li.childNodes);
      for (const node of nodes) {
        if (node === checkbox) continue;
        text.appendChild(node);
      }
      li.appendChild(text);
    }

    const done = checkbox.checked || checkbox.hasAttribute('checked');
    li.classList.toggle('is-done', done);
  }
}

enhanceTodoLists();

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
