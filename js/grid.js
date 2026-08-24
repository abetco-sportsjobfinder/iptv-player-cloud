// PRISM TV - poster grid with chunked rendering (IntersectionObserver sentinel).
// Renders only the scoped channel list; appends 60 cards per chunk. No fragile
// absolute-position math — the failure mode of the previous build.

import { db } from './api.js';
import { state, esc } from './state.js';
import { getStatus, lastChecked } from './tracking.js';
import { matchesCategory, flag } from './tree.js';
import { toggleFavorite } from './state.js';

const CHUNK = 60;
let io = null;
let pending = [];

export function cardHTML(c, isSelected) {
  const st = getStatus(c.id);
  const dot = { working: 'ok', dead: 'dead', testing: 'testing' }[st] || '';
  const fav = state.favorites.has(c.id);
  const blocked = db.blocklist.has(c.id);
  const selected = isSelected ? ' selected' : '';
  const deselectBtn = isSelected ? '<button class="deselect-btn" title="Deselect">✕</button>' : '';

  // Logo chain (audit): upstream logo -> iptv-org per-id logo -> flag -> initial.
  // Flag fallback handled by the onerror swap; final failure hides the img.
  const primaryLogo = c.logo || `https://iptv-org.github.io/logos/${encodeURIComponent(c.id)}.png`;
  const cc = (c.country || 'xx').toLowerCase();
  const logo = `<img class="thumb-img" loading="lazy" src="${esc(primaryLogo)}" data-flag="https://flagcdn.com/w40/${esc(cc)}.png"
    onerror="if(!this.dataset.f){this.dataset.f=1;this.src=this.dataset.flag}else{this.style.display='none'}" alt="">`;

  const ageH = Math.floor((Date.now() - lastChecked(c.id)) / 3600000);
  const ageTag = (st === 'working' && ageH >= 0) ? ` · ⏱${ageH}h` : '';
  return `
  <article class="card${selected} ${blocked ? 'is-blocked' : ''}" data-id="${esc(c.id)}" tabindex="0" role="button"
           aria-label="${esc(c.name)}">
    <div class="thumb"><span class="thumb-fallback">${esc((c.name[0] || '?').toUpperCase())}</span>${logo}
      <span class="dot ${dot}" title="${st}"></span>
      <button class="fav-btn ${fav ? 'on' : ''}" title="Favorite" aria-label="Toggle favorite">${fav ? '\u2605' : '\u2606'}</button>
      <button class="mv-add" title="Add to multi-view" aria-label="Add to multi-view">+</button>
      ${deselectBtn}
      ${blocked ? '<span class="blocked-tag">BLOCKED</span>' : ''}
      <span class="play-hint">\u25B6</span>
    </div>
    <div class="cname" title="${esc(c.name)}">${esc(c.name)}</div>
    <div class="cmeta">${flag(c.country)} ${esc(c.country || '')}${ageTag}</div>
  </article>`;
}

export function renderGrid(channels) {
  const grid = document.getElementById('grid');
  const countEl = document.getElementById('resultCount');
  grid.innerHTML = '';
  if (io) io.disconnect();

  const filtered = channels.filter(c => !c.categories.includes('xxx'));
  countEl.textContent = `${filtered.length.toLocaleString()} channels`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><h3>Nothing here</h3><p>No channels match this view.</p></div>`;
    return;
  }

  pending = filtered;
  appendChunk(grid);
  const sentinel = document.createElement('div');
  sentinel.id = 'gridSentinel';
  grid.appendChild(sentinel);
  io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) appendChunk(grid);
  }, { rootMargin: '600px' });
  io.observe(sentinel);
}

function appendChunk(grid) {
  if (!pending.length) return;
  const frag = document.createDocumentFragment();
  for (const c of pending.splice(0, CHUNK)) {
    const t = document.createElement('template');
    t.innerHTML = cardHTML(c).trim();
    frag.appendChild(t.content.firstElementChild);
  }
  grid.insertBefore(frag, document.getElementById('gridSentinel'));
  if (!pending.length) io?.disconnect();
}

// Cheap incremental repaints: patch dots/fav stars on already-mounted cards
// instead of re-rendering (keeps scroll position and loaded chunks intact).
export function updateVisibleDots() {
  for (const el of document.querySelectorAll('#grid .card[data-id]')) {
    const st = getStatus(el.dataset.id);
    const dot = el.querySelector('.dot');
    const cls = { working: 'ok', dead: 'dead', testing: 'testing' }[st] || '';
    if (dot) { dot.className = `dot ${cls}`; dot.title = st; }
  }
}

export function updateFavButtons() {
  for (const btn of document.querySelectorAll('#grid .fav-btn')) {
    const id = btn.closest('.card')?.dataset.id;
    const on = id && state.favorites.has(id);
    btn.classList.toggle('on', !!on);
    btn.textContent = on ? '\u2605' : '\u2606';
  }
}

// Event delegation: one listener for the whole grid
export function bindGrid({ onOpen }) {
  const grid = document.getElementById('grid');
  
  // NEW: Clean up existing event listeners to prevent accumulation
  const oldGrid = document.getElementById('oldGrid');
  if (oldGrid) {
    oldGrid.innerHTML = grid.innerHTML;
    oldGrid.remove();
  }
  
  grid.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.closest('.fav-btn')) { toggleFavorite(id); return; }
    if (e.target.closest('.mv-add')) { onOpen.addMulti(id); return; }
    if (e.target.closest('.mv-add')) { onOpen.addMulti(id); return; }

    onOpen.watch(id);
  });

  grid.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
      e.preventDefault();
      onOpen.watch(e.target.dataset.id);
    }
  });
}
