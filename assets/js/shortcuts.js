/*
  Keyboard shortcuts
  - Option+T (Alt+T) switches between the light and dark theme.
  - Cmd+K (Ctrl+K) opens a command palette to jump to sections of the
    current page, the site pages, blog posts and notes.
  The page list comes from the JSON in _includes/palette-data.html.
*/

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const THEME_KEYS = isMac ? '⌥T' : 'Alt+T';
const PALETTE_KEYS = isMac ? '⌘K' : 'Ctrl+K';

function isTyping(target) {
  return target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

function toggleTheme() {
  document.getElementById('theme-toggle')?.click();
}

function readData() {
  try {
    return JSON.parse(document.getElementById('palette-data')?.textContent || '{}');
  } catch {
    return {};
  }
}

// Section headings of the current page, the same ones the section rail uses.
function pageSections() {
  const article = document.getElementById('main_content');
  if (!article) return [];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return Array.from(article.querySelectorAll('h2[id], [data-rail][id]'))
    .filter((h) => h.id !== 'contents' && !h.closest('.ia-toc'))
    .map((h) => ({
      title: h.textContent.trim(),
      run: () => {
        h.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
        history.replaceState(null, '', '#' + h.id);
      },
    }));
}

function links(list) {
  return (list || []).filter((item) => item.title).map((item) => ({
    title: item.title,
    run: () => window.location.assign(item.url),
  }));
}

// Built each time the palette opens, so sections drawn later by a page are included.
function groups() {
  const data = readData();
  const dark = document.documentElement.classList.contains('dark-mode');
  return [
    { name: 'On this page', items: pageSections() },
    { name: 'Pages', items: links(data.pages) },
    { name: 'Blog', items: links(data.blog) },
    { name: 'Notes', items: links(data.notes) },
    {
      name: 'Actions',
      items: [{ title: dark ? 'Switch to light theme' : 'Switch to dark theme', hint: THEME_KEYS, run: toggleTheme }],
    },
  ].filter((g) => g.items.length > 0);
}

/* -----------------
 * Command palette
 * ----------------- */
let dialog = null;
let input = null;
let list = null;
let allGroups = [];
let shown = [];
let active = 0;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildDialog() {
  dialog = make('dialog', 'palette');
  dialog.id = 'palette';
  dialog.setAttribute('aria-label', 'Command palette');

  input = make('input', 'palette__input');
  Object.assign(input, { type: 'text', placeholder: 'Search pages, posts, notes and sections', autocomplete: 'off', spellcheck: false });
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'palette-list');
  input.setAttribute('aria-autocomplete', 'list');

  list = make('ul', 'palette__list');
  list.id = 'palette-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Results');

  const footer = make('div', 'palette__footer', `↑↓ to move · ↵ to open · esc to close · ${PALETTE_KEYS} to toggle`);
  dialog.append(input, list, footer);
  document.body.appendChild(dialog);

  input.addEventListener('input', render);
  input.addEventListener('keydown', onInputKey);

  list.addEventListener('pointermove', (e) => {
    const option = e.target.closest('[role="option"]');
    if (option) setActive(Number(option.dataset.index), false);
  });
  list.addEventListener('click', (e) => {
    const option = e.target.closest('[role="option"]');
    if (option) choose(Number(option.dataset.index));
  });

  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

function matches(item, group, words) {
  const text = (item.title + ' ' + group.name).toLowerCase();
  return words.every((w) => text.includes(w));
}

function render() {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  list.replaceChildren();
  shown = [];

  for (const group of allGroups) {
    const items = group.items.filter((item) => matches(item, group, words));
    if (items.length === 0) continue;
    const header = make('li', 'palette__group', group.name);
    header.setAttribute('role', 'presentation');
    list.appendChild(header);
    for (const item of items) {
      const option = make('li', 'palette__option');
      option.id = 'palette-option-' + shown.length;
      option.dataset.index = String(shown.length);
      option.setAttribute('role', 'option');
      option.appendChild(make('span', 'palette__title', item.title));
      if (item.hint) option.appendChild(make('kbd', 'palette__hint', item.hint));
      list.appendChild(option);
      shown.push(item);
    }
  }

  if (shown.length === 0) {
    const empty = make('li', 'palette__empty', 'No results');
    empty.setAttribute('role', 'presentation');
    list.appendChild(empty);
  }
  setActive(0, true);
}

function setActive(index, scroll) {
  if (shown.length === 0) {
    input.removeAttribute('aria-activedescendant');
    return;
  }
  active = (index + shown.length) % shown.length;
  for (const option of list.querySelectorAll('[role="option"]')) {
    option.setAttribute('aria-selected', option.dataset.index === String(active) ? 'true' : 'false');
  }
  const current = document.getElementById('palette-option-' + active);
  input.setAttribute('aria-activedescendant', current.id);
  if (scroll) current.scrollIntoView({ block: 'nearest' });
}

function onInputKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActive(active + 1, true);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActive(active - 1, true);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (shown.length) choose(active);
  }
}

function choose(index) {
  const item = shown[index];
  dialog.close();
  item?.run();
}

function openPalette() {
  if (!dialog) buildDialog();
  allGroups = groups();
  input.value = '';
  render();
  dialog.showModal();
  input.focus();
}

function togglePalette() {
  if (dialog?.open) dialog.close();
  else openPalette();
}

/* -----------------
 * Key handling
 * ----------------- */
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.repeat) return;

  // Uses e.code, because Option+T on a Mac types "†" and changes e.key.
  if (e.code === 'KeyT' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    if (isTyping(e.target)) return;
    e.preventDefault();
    toggleTheme();
    return;
  }

  if (e.code === 'KeyK' && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    togglePalette();
  }
});

const themeButton = document.getElementById('theme-toggle');
if (themeButton) {
  themeButton.title = `Toggle theme (${THEME_KEYS})`;
  themeButton.setAttribute('aria-keyshortcuts', 'Alt+T');
}
