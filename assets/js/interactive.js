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

/* -----------------
 * Mermaid diagrams
 * -----------------
   If any .language-mermaid code blocks exist, replace them with rendered SVG.
   Uses free CDN (no cost).
*/
let mermaidModulePromise = null;
let mermaidThemeObserver = null;
let mermaidRenderCount = 0;

function getMermaidTheme() {
  return document.documentElement.classList.contains('dark-mode') ? 'dark' : 'default';
}

async function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')
      .then((mod) => mod.default);
  }
  return mermaidModulePromise;
}

async function renderMermaidWidgets(root = document) {
  const widgets = root.querySelectorAll('.ia-widget--mermaid[data-mermaid-source]');
  if (widgets.length === 0) return;

  const mermaid = await loadMermaid();
  mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });

  for (const widget of widgets) {
    const src = widget.dataset.mermaidSource || '';
    const id = `mermaid-${mermaidRenderCount++}`;
    try {
      const { svg } = await mermaid.render(id, src);
      widget.innerHTML = svg;
    } catch (e) {
      widget.textContent = `Mermaid render failed: ${String(e)}`;
    }
  }
}

function ensureMermaidThemeSync() {
  if (mermaidThemeObserver) return;

  mermaidThemeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        renderMermaidWidgets().catch((e) => {
          console.error('Mermaid re-render failed', e);
        });
        break;
      }
    }
  });

  mermaidThemeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

async function enhanceMermaid(root = document) {
  const blocks = root.querySelectorAll('pre > code.language-mermaid');
  for (const code of blocks) {
    const pre = code.closest('pre');
    if (!pre) continue;
    const src = code.textContent || '';
    const container = el('div', { class: 'ia-widget ia-widget--mermaid', 'data-mermaid-source': src });
    pre.replaceWith(container);
  }

  if (root.querySelector('.ia-widget--mermaid[data-mermaid-source]')) {
    ensureMermaidThemeSync();
    await renderMermaidWidgets(root);
  }
}

// Run enhancements
enhanceTabs();
enhanceCodeCopy();
enhanceLightbox();
enhanceMermaid().catch((e) => {
  console.error('Mermaid enhancement failed', e);
});

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
 * Auto TOC (table of contents)
 * ---------------------------------
   Populates any <div class="ia-toc" data-auto> with a nested list built from
   h2/h3 under #main_content. Requires kramdown heading IDs (on by default).

   Usage:
     <div class="ia-toc" data-auto></div>
*/
function enhanceTOC(root = document) {
  const tocs = root.querySelectorAll('.ia-toc[data-auto]');
  if (tocs.length === 0) return;

  const article = document.getElementById('main_content') || document.body;
  const headings = Array.from(article.querySelectorAll('h2[id], h3[id]'));
  if (headings.length === 0) return;

  for (const toc of tocs) {
    const list = el('ul');
    let currentSub = null;
    for (const h of headings) {
      if (h.closest('.ia-toc')) continue;
      const a = el('a', { href: '#' + h.id }, h.textContent.trim());
      const li = el('li', {}, [a]);
      if (h.tagName === 'H2') {
        list.appendChild(li);
        currentSub = null;
      } else {
        if (!currentSub) {
          currentSub = el('ul');
          (list.lastElementChild || list).appendChild(currentSub);
        }
        currentSub.appendChild(li);
      }
    }
    toc.innerHTML = '';
    toc.appendChild(list);
  }
}

enhanceTOC();

/* -----------------
 * Back to top button
 * ----------------- */
function enhanceBackToTop() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;

  const showAfter = 300;

  function syncVisibility() {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    btn.classList.toggle('is-visible', y > showAfter);
  }

  btn.addEventListener('click', () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  });

  window.addEventListener('scroll', syncVisibility, { passive: true });
  window.addEventListener('resize', syncVisibility);
  syncVisibility();
}

enhanceBackToTop();
