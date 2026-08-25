// PRISM TV - poster grid with chunked rendering (IntersectionObserver sentinel).
// Renders only the scoped channel list; appends 60 cards per chunk. No fragile
// absolute-position math — the failure mode of the previous build.

import { db, PROXY, streamCandidates } from './api.js';
import { state, esc } from './state.js';
import { getStatus, lastChecked } from './tracking.js';
import { matchesCategory, flag } from './tree.js';
import { toggleFavorite } from './state.js';

const CHUNK = 60;
let io = null;
let pending = [];

// ---------- LIVE HOVER PREVIEW (module scope: renderGrid must reach it) ----------
let hp = null; // {cardId, video, hls}

function stopHoverPreview() {
  if (!hp) return;
  try { hp.hls?.destroy(); } catch {}
  try { hp.video?.pause(); hp.video?.remove(); } catch {}
  hp = null;
}

function startHoverPreview(card) {
  const id = card.dataset.id;
  if (hp && hp.cardId === id) return;
  stopHoverPreview();
  if (getStatus(id) === 'dead') return;
  const cands = streamCandidates(id);
  if (!cands.length) return;
  if (cands[0].direct) return; // LAN-direct: no CORS for hover preview; skip
  const thumb = card.querySelector('.thumb');
  if (!thumb) return;
  const v = document.createElement('video');
  v.muted = true; v.autoplay = true; v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;background:#000';
  thumb.appendChild(v);
  const hls = new Hls({ enableWorker: false, maxBufferLength: 4, liveSyncDuration: 4, fragLoadingTimeOut: 8000, fragLoadingMaxRetry: 1 });
  hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) stopHoverPreview(); });
  hls.loadSource(`${PROXY}?u=${encodeURIComponent(cands[0].url)}`);
  hls.attachMedia(v);
  v.play().catch(() => {});
  hp = { cardId: id, video: v, hls };
}

export function cardHTML(c, isSelected) {
  const st = getStatus(c.id);
  const dot = { working: 'ok', dead: 'dead', testing: 'testing' }[st] || '';
  const fav = state.favorites.has(c.id);
  const blocked = db.blocklist.has(c.id);
  const selected = isSelected ? ' selected' : '';
  const deselectBtn = isSelected ? '<button class="deselect-btn" title="Deselect">✕</button>' : '';

  // Logo chain: upstream logo -> favicon(website) -> country flag -> initial.
  // Each stage swaps via inline onerror; final failure hides the img.
  const cc = (c.country || 'xx').toLowerCase();
  const favIcon = c.favicon || '';
  const flagUrl = `https://flagcdn.com/w40/${cc}.png`;
  const primaryLogo = c.logo || favIcon || flagUrl;
  const altStage = c.logo && favIcon ? favIcon : (favIcon ? flagUrl : '');
  const logo = `<img class="thumb-img" loading="lazy" src="${esc(primaryLogo)}"
    data-alt="${esc(altStage)}" data-flag="${esc(flagUrl)}"
    onerror="if(this.dataset.alt&&this.dataset.s!=='1'){this.dataset.s='1';this.src=this.dataset.alt}else if(this.dataset.s!=='2'){this.dataset.s='2';this.src=this.dataset.flag}else{this.style.display='none'}" alt="">`;

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
  stopHoverPreview();
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

  // ---------- LIVE HOVER PREVIEW (implementations hoisted to module scope) ----------
  grid.addEventListener('mouseover', e => {
    const card = e.target.closest('.card');
    if (card) startHoverPreview(card); else stopHoverPreview();
  });
  grid.addEventListener('mouseleave', stopHoverPreview);

  grid.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
      e.preventDefault();
      onOpen.watch(e.target.dataset.id);
    }
  });
}
