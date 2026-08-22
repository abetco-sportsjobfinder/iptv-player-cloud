// PRISM TV - application orchestrator: boot, routing, sidebar tree, hero,
// search, chips, watch overlay, profile. Vanilla ES modules, no build step.

import { db, loadAll } from './api.js';
import {
  state, patch, onStateChange, parseHash, toggleExpanded, toggleFavorite, esc,
} from './state.js';
import { buildTree, sortedLetters, letterFor, CATEGORY_CHIPS, matchesCategory, flag } from './tree.js';
import { getStatus, getStatusReason, initTracking, startBackgroundTesting, testStream } from './tracking.js';
import { play, stopPlayback, primeStatus } from './player.js';
import { addToMultiView, clearMultiView, tileCount } from './multiview.js';
import { renderGrid, bindGrid, updateVisibleDots, updateFavButtons } from './grid.js';
import { applyTheme, setTheme, setAccent } from './themes.js';
import { registerSW } from './pwa.js';

let TREE = null;              // Map<letter, Map<brandKey, channels[]>>
let gridSig = '';             // what the grid currently shows
let sidebarSig = '';          // route+expanded snapshot; gates full tree rebuilds
let heroId = null;            // featured channel currently rendered
let mvHintTimer = null;
const AVATARS = ['\u{1F43A}', '\u{1F98A}', '\u{1F419}', '\u{1F42C}', '\u{1F984}', '\u{1F996}', '\u{1F43B}', '\u{1F98E}'];

// ---------- boot ----------
async function boot() {
  applyTheme();
  registerSW();
  try {
    await initTracking();
    await loadAll(msg => setBootMsg(msg));
    TREE = buildTree(db.channels);
    patch({ route: parseHash(), ready: true });   // subscriber performs first render
    document.getElementById('boot')?.remove();
    startBackgroundTesting();
    setInterval(updateVisibleDots, 2500);
    setInterval(updateCountsChip, 3000);
    updateCountsChip();
  } catch (err) {
    console.error('[PRISM] boot failed', err);
    setBootMsg('Failed to load channel data. Check your connection and refresh.');
  }
}

function setBootMsg(msg) {
  const el = document.getElementById('bootMsg');
  if (el) el.textContent = msg;
}

// ---------- scope resolution ----------
function channelsForRoute(route) {
  switch (route.view) {
    case 'special':
      if (route.special === 'working') return db.channels.filter(c => getStatus(c.id) === 'working');
      if (route.special === 'fav') return db.channels.filter(c => state.favorites.has(c.id));
      if (route.special === 'recent') return state.recent.map(r => db.byId.get(r.id)).filter(Boolean);
      return [];
    case 'letter': return db.channels.filter(c => c.brand && letterFor(c.brand) === route.letter);
    case 'brand': return (TREE?.get(route.letter)?.get(route.brandKey)) || [];
    default: return db.channels;
  }
}

function currentChannels() {
  if (state.query.trim()) return searchChannels(state.query.trim());
  let list = channelsForRoute(state.route);
  if (state.category !== 'all') list = list.filter(c => matchesCategory(c, state.category));
  return list;
}

function searchChannels(q) {
  const needle = q.toLowerCase();
  return db.channels
    .filter(c => c.name.toLowerCase().includes(needle))
    .sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name))
    .slice(0, 800);
}

// ---------- render pipeline ----------
// One entry point. Full sidebar rebuild only when route/expanded changes;
// everything else takes cheap paths so status-test emissions stay smooth.
function render() {
  renderSidebar();
  renderChips();
  renderMain();
}

function gridSignature(channels) {
  return JSON.stringify([state.route, state.category, state.query, channels.length]);
}

function renderMain() {
  const channels = currentChannels();
  const sig = gridSignature(channels);
  const hero = document.getElementById('hero');

  const showHero = state.route.view === 'root' && !state.query.trim();
  hero.style.display = showHero ? '' : 'none';
  if (showHero) renderHero();

  document.getElementById('scopeTitle').textContent = scopeTitle(state.route);

  if (sig !== gridSig) {
    gridSig = sig;
    renderGrid(channels);
    updateFavButtons();
  } else {
    updateFavButtons();   // favorites toggled without changing scope
  }
}

function scopeTitle(route) {
  if (state.query.trim()) return `Search: \u201C${state.query.trim()}\u201D`;
  if (route.view === 'special') return { working: 'Working Now', fav: 'Favorites', recent: 'Recently Watched' }[route.special];
  if (route.view === 'brand') return `${route.brandKey}`;
  if (route.view === 'letter') return `Letter ${route.letter}`;
  return 'Browse All';
}

// ---------- hero ----------
function renderHero() {
  const pool = db.channels.filter(c => c.logo && c.rank === 0);
  if (!pool.length) { heroId = null; return; }
  const daySeed = Math.floor(Date.now() / 86400000);
  const c = pool[(daySeed * 7919 + 13) % pool.length];
  if (c.id === heroId) return;               // same featured channel -> no rebuild/flicker
  heroId = c.id;
  const el = document.getElementById('hero');
  el.innerHTML = `
    <img class="hero-bg" src="${esc(c.logo)}" alt="">
    <div class="hero-content">
      <div class="hero-kicker">FEATURED TODAY</div>
      <h2>${esc(c.name)}</h2>
      <div class="hero-meta">${flag(c.country)} ${esc(c.country || '')} \u00b7 ${esc((c.categories[0] || '').toUpperCase())}</div>
      <div class="hero-actions">
        <button id="heroPlay" class="btn-accent">\u25B6 Watch Now</button>
        <button id="heroMv" class="btn-ghost">+ Multi-view</button>
      </div>
    </div>`;
  document.getElementById('heroPlay').onclick = () => openWatch(c.id);
  document.getElementById('heroMv').onclick = () => addToMultiView(c.id);
}

// ---------- sidebar ----------
function renderSidebar() {
  const nav = document.getElementById('tree');
  const parts = [];

  parts.push(`<div class="tree-section-label">Library</div>`);
  parts.push(specialRow('w', 'Working Now'));
  parts.push(specialRow('f', 'Favorites'));
  parts.push(specialRow('r', 'Recently Watched'));

  parts.push(`<div class="tree-section-label">Channels A\u2013Z</div><div class="tree-letters">`);
  for (const L of sortedLetters(TREE)) {
    const brands = TREE.get(L);
    let count = 0;
    for (const list of brands.values()) count += list.length;
    const key = `L:${L}`;
    const isOpen = state.expanded.has(key);
    const active = state.route.view === 'letter' && state.route.letter === L;
    parts.push(`
      <div class="tree-row ${active ? 'active' : ''}" data-letter="${L}">
        <button class="tw" data-toggle="${esc(key)}" aria-expanded="${isOpen}">${isOpen ? '\u25BE' : '\u25B8'}</button>
        <a href="#/L/${encodeURIComponent(L)}" class="tree-link">${L}</a>
        <span class="count">${count.toLocaleString()}</span>
      </div>`);
    if (isOpen) {
      parts.push(`<div class="tree-brands">`);
      for (const [bk, chans] of [...brands.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const bkey = `B:${L}|${bk}`;
        const bOpen = state.expanded.has(bkey);
        const bActive = state.route.view === 'brand' && state.route.letter === L && state.route.brandKey === bk;
        parts.push(`
          <div class="tree-row sub ${bActive ? 'active' : ''}">
            <button class="tw" data-toggle="${esc(bkey)}" aria-expanded="${bOpen}">${bOpen ? '\u25BE' : '\u25B8'}</button>
            <a href="#/L/${encodeURIComponent(L)}/${encodeURIComponent(bk)}" class="tree-link">${esc(bk)}</a>
            <span class="count">${chans.length}</span>
          </div>`);
        if (bOpen) {
          parts.push(`<div class="tree-channels">`);
          for (const c of chans.slice(0, 40)) {
            parts.push(`<a class="tree-channel" data-watch="${esc(c.id)}">${esc(c.name)}</a>`);
          }
          if (chans.length > 40) parts.push(`<a class="tree-channel more" href="#/L/${encodeURIComponent(L)}/${encodeURIComponent(bk)}">\u2026 all ${chans.length}</a>`);
          parts.push(`</div>`);
        }
      }
      parts.push(`</div>`);
    }
  }
  parts.push(`</div>`);
  nav.innerHTML = parts.join('');
}

function specialRow(hash, label) {
  const active = state.route.view === 'special' &&
    ((hash === 'w' && state.route.special === 'working') ||
     (hash === 'f' && state.route.special === 'fav') ||
     (hash === 'r' && state.route.special === 'recent'));
  return `<a class="tree-row ${active ? 'active' : ''}" href="#/${hash}" data-special="${hash}">
    <span class="tree-link">${label}</span><span class="count">\u2026</span></a>`;
}

function bindSidebar() {
  document.getElementById('tree').addEventListener('click', e => {
    const tw = e.target.closest('[data-toggle]');
    if (tw) { e.preventDefault(); toggleExpanded(tw.dataset.toggle); return; }
    const watchLink = e.target.closest('[data-watch]');
    if (watchLink) { e.preventDefault(); openWatch(watchLink.dataset.watch); }
  });
}

// ---------- chips ----------
function renderChips() {
  document.getElementById('chips').innerHTML = CATEGORY_CHIPS.map(([key, label]) =>
    `<button class="chip ${state.category === key && !state.query.trim() ? 'on' : ''}" data-chip="${key}">${label}</button>`
  ).join('');
}

// ---------- watch overlay ----------
function openWatch(id) {
  const c = db.byId.get(id);
  if (!c) return;
  document.getElementById('watch').showModal();
  document.getElementById('wTitle').textContent = c.name;
  document.getElementById('wMeta').textContent =
    `${flag(c.country)} ${c.country || ''} \u00b7 ${(c.categories.join(', ') || 'uncategorized')} \u00b7 ${c.brand}`;
  document.getElementById('wStatusReason').textContent = '';

  const favBtn = document.getElementById('wFav');
  syncWatchFav(favBtn, id);
  favBtn.onclick = () => { toggleFavorite(id); syncWatchFav(favBtn, id); };
  document.getElementById('wMulti').onclick = () => addToMultiView(id);
  document.getElementById('wTest').onclick = async () => {
    const r = document.getElementById('wStatusReason');
    r.textContent = 'Testing stream\u2026';
    await testStream(id);
    const st = getStatus(id);
    r.textContent = `Status: ${st}${getStatusReason(id) ? ` (${getStatusReason(id)})` : ''}`;
  };

  primeStatus(id);
  play(id);
  renderRelated(c);
}

function renderRelated(c) {
  const siblings = (TREE?.get(letterFor(c.brand))?.get(c.brand) || []).filter(x => x.id !== c.id).slice(0, 12);
  const row = document.getElementById('wRelated');
  row.innerHTML = siblings.length
    ? `<div class="tree-section-label">More from ${esc(c.brand)}</div>` + siblings.map(s => `
        <button class="mini-card" data-rel="${esc(s.id)}">
          <span class="dot ${dotCls(getStatus(s.id))}"></span>${esc(s.name)}
        </button>`).join('')
    : '';
  row.querySelectorAll('[data-rel]').forEach(b => b.onclick = () => openWatch(b.dataset.rel));
}

function dotCls(st) { return { working: 'ok', dead: 'dead', testing: 'testing' }[st] || ''; }

function syncWatchFav(btn, id) {
  const on = state.favorites.has(id);
  btn.classList.toggle('on', on);
  btn.textContent = on ? '\u2605 Favorited' : '\u2606 Favorite';
}

function closeWatch() {
  stopPlayback();
  document.getElementById('watch').close?.();
}

// ---------- header ----------
function updateCountsChip() {
  let w = 0, tested = 0;
  for (const c of db.channels) {
    const s = getStatus(c.id);
    if (s === 'working') w++;
    if (s !== 'unknown') tested++;
  }
  const el = document.getElementById('statusChip');
  if (el) el.textContent = `\u{1F7E2} ${w.toLocaleString()} working \u00b7 ${tested.toLocaleString()} tested`;

  // keep Library counts fresh without rebuilding the whole tree
  const wEl = document.querySelector('[data-special="w"] .count');
  const fEl = document.querySelector('[data-special="f"] .count');
  const rEl = document.querySelector('[data-special="r"] .count');
  if (wEl) wEl.textContent = w.toLocaleString();
  if (fEl) fEl.textContent = state.favorites.size.toLocaleString();
  if (rEl) rEl.textContent = state.recent.length.toLocaleString();
}

function updateMvBadge() {
  const el = document.getElementById('mvCount');
  if (el) el.textContent = String(tileCount());
}

// ---------- profile popover ----------
function bindProfile() {
  const pop = document.getElementById('profilePop');
  const nameInput = document.getElementById('profName');
  nameInput.value = state.profile.name;
  document.getElementById('profAvatars').innerHTML = AVATARS.map(a =>
    `<button class="av ${state.profile.avatar === a ? 'on' : ''}" data-av="${a}">${a}</button>`).join('');
  document.getElementById('profTheme').value = state.theme;
  document.getElementById('profAccent').value = state.accent;
  document.getElementById('profileBtn').textContent = `${state.profile.avatar}`;

  pop.addEventListener('click', e => { if (e.target === pop) pop.close(); });
  document.getElementById('profileBtn').onclick = () => pop.showModal();
  nameInput.oninput = () => patch({ profile: { ...state.profile, name: nameInput.value } });
  document.getElementById('profAvatars').addEventListener('click', e => {
    const b = e.target.closest('[data-av]');
    if (!b) return;
    document.querySelectorAll('#profAvatars .av').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    patch({ profile: { ...state.profile, avatar: b.dataset.av } });
    document.getElementById('profileBtn').textContent = b.dataset.av;
  });
  document.getElementById('profTheme').onchange = e => setTheme(e.target.value);
  document.getElementById('profAccent').onchange = e => setAccent(e.target.value);
  document.getElementById('profClose').onclick = () => pop.close();
}

// ---------- global wiring ----------
function bindChrome() {
  const search = document.getElementById('search');
  let t = null;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.query = search.value;
      gridSig = '';
      renderChips();
      renderMain();
    }, 200);
  });

  document.getElementById('chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-chip]');
    if (!chip) return;
    state.category = chip.dataset.chip;
    gridSig = '';
    renderChips();
    renderMain();
  });

  document.getElementById('mvClear').onclick = () => clearMultiView();
  document.getElementById('mvBtn').onclick = () => {
    const d = document.getElementById('mvDock');
    if (tileCount() > 0) d.classList.toggle('has-tiles');
    else { d.classList.add('has-tiles'); clearTimeout(mvHintTimer); mvHintTimer = setTimeout(() => { if (!tileCount()) d.classList.remove('has-tiles'); }, 2500); }
  };
  document.getElementById('wClose').onclick = () => closeWatch();
  document.getElementById('watch').addEventListener('close', () => stopPlayback());

  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape') closeWatch();
  });

  // NOTE: no hashchange listener here on purpose - state.js already patches
  // route on hashchange and emits once through the single subscription below.

  bindSidebar();
  bindGrid({
    onOpen: {
      watch: openWatch,
      addMulti: id => { addToMultiView(id); updateMvBadge(); },
    },
  });
  bindProfile();
}

// Single subscription: full rebuild only on navigation/expansion changes.
let lastRouteSig = null;
onStateChange(s => {
  if (!s.ready) return;
  updateMvBadge();
  const routeSig = JSON.stringify([s.route, [...s.expanded]]);
  if (routeSig !== lastRouteSig) {
    lastRouteSig = routeSig;
    gridSig = '';
    render();
  } else {
    renderMain();   // cheap path: favorites/recent/status tweaks
  }
});

bindChrome();
boot();
