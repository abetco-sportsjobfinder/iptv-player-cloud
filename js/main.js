// PRISM TV - application orchestrator: boot, routing, sidebar tree, hero,
// search, chips, watch overlay, profile, multi-window, channel grouping, quad grid.
// Vanilla ES modules, no build step.

import { db, PROXY, CUSTOM_LOGO_URL, loadAll } from './api.js';
import {
  state, patch, onStateChange, parseHash, toggleExpanded, toggleFavorite, esc, navigate,
} from './state.js';
import { buildTree, sortedLetters, letterFor, CATEGORY_CHIPS, flag } from './tree.js';
import { getStatus, getStatusReason, initTracking, testStream } from './tracking.js';
import { play, stopPlayback, primeStatus } from './player.js';
import { addToMultiView, clearMultiView, tileCount } from './multiview.js';
import { renderGrid, bindGrid, updateVisibleDots, updateFavButtons, cardHTML } from './grid.js';
import { applyTheme, setTheme, setAccent } from './themes.js';
import { registerSW } from './pwa.js';

// ============ Constants ============
const AVATARS = ['\u{1F43A}', '\u{1F98A}', '\u{1F419}', '\u{1F42C}', '\u{1F984}', '\u{1F996}', '\u{1F43B}', '\u{1F98E}'];

const CATEGORY_LABELS = {
  all: 'All',
  news: 'News',
  sports: 'Sports',
  kids: 'Kids',
  movies: 'Movies',
  series: 'Series',
  music: 'Music',
  entertainment: 'Entertainment',
  documentary: 'Documentary',
  culture: 'Culture',
  general: 'General',
};

const PROVIDER_LABELS = {};

// NEW: Multi-view/quad grid display mode
const VIEW_MODES = ['quad', 'single', 'favorites'];
let currentViewMode = 'quad';
let selectedChannelIds = new Set();
let TREE = null;
let heroId = null;
let gridSig = "";

// NEW: Set quad/single/favorites view mode
function setViewMode(mode) {
  // Update pill states
  document.querySelectorAll('#modePills .chip').forEach(b => b.classList.remove('on'));
  const activeBtn = document.querySelector(`#modePills .chip[data-view="${mode}"]`);
  if (activeBtn) activeBtn.classList.add('on');
  
  currentViewMode = mode;
  selectedChannelIds = new Set();
  window.selectedChannelIds = selectedChannelIds;
  
  // NEW: Theme selector with Default/Ocean/Purple/Forest options
  const themeMap = {
    quad: 'dark',
    single: 'midnight',
    favorites: 'slate'
  };
  document.documentElement.dataset.theme = themeMap[mode] || 'dark';
  
  renderMain();
}

// NEW: Simple Mode toggle with 'Advanced Mode' switching
let simpleMode = false;

function toggleSimpleMode() {
  simpleMode = !simpleMode;
  const btn = document.getElementById('simpleModeBtn');
  if (btn) {
    btn.textContent = simpleMode ? 'Advanced' : 'Simple';
    btn.title = simpleMode ? 'Switch to Simple Mode' : 'Switch to Advanced Mode';
  }
  
  // Apply simple mode styling - hide advanced features
  if (simpleMode) {
    // In simple mode, show only essential elements
    document.querySelectorAll('.tree-brands, .category-badges, .more').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll('.tree-row.sub').forEach(el => {
      el.style.display = 'none';
    });
  } else {
    // Restore advanced mode display
    document.querySelectorAll('.tree-brands, .category-badges, .more').forEach(el => {
      el.style.display = '';
    });
    document.querySelectorAll('.tree-row.sub').forEach(el => {
      el.style.display = '';
    });
  }
}

// ============ Window Management ============
const windowManager = {
  windows: [],
  activeWindow: null,

  createWindow() {
    const newWindow = {
      id: `window-${Date.now()}`,
      channels: [],
      filterState: { query: '', category: 'all' },
      expandedGroups: new Set(loadJSON(`prism_window_expanded_${Date.now}`, []))
    };
    this.windows.push(newWindow);
    if (!this.activeWindow) this.activeWindow = newWindow;
    this.renderWindows();
    return newWindow;
  },

  setActiveWindow(id) {
    this.windows.forEach(w => w.active = w.id === id);
    this.activeWindow = this.windows.find(w => w.id === id);
    this.renderWindows();
    // Sync filters when switching windows
    this.applyFiltersToWindow(this.activeWindow, this.activeWindow.filterState);
  },

  applyFiltersToWindow(window, filterState) {
    window.filterState = filterState;
    // Apply filterState to DOM inputs for this window
    const searchEl = document.getElementById(`search-${window.id}`);
    if (searchEl) searchEl.value = filterState.query || '';

    const chipsEl = document.getElementById(`chips-${window.id}`);
    if (chipsEl) {
      CATEGORY_CHIPS.forEach(([key, label]) => {
        const chip = chipsEl.querySelector(`[data-chip="${key}"]`);
        if (chip) {
          chip.classList.toggle('on', filterState.category === key && !filterState.query.trim());
        }
      });
    }
    renderVirtualListForWindow(window);
  },

  renderWindows() {
    const container = document.getElementById('windowManager');
    if (!container) {
      const newContainer = document.createElement('div');
      newContainer.id = 'windowManager';
      newContainer.style.cssText = 'position: fixed; right: 10px; top: 70px; z-index: 50; display: flex; flex-direction: column; gap: 8px;';
      newContainer.innerHTML = `
        <button class="icon-btn" onclick="windowManager.createWindow()">+ Window</button>
        <div id="windowList" style="font-size: 0.7rem; color: var(--muted);"></div>
        <button class="icon-btn" onclick="windowManager.syncAllFilters()" title="Sync filters across windows">⚙</button>
      `;
      document.body.appendChild(newContainer);
      this.windowsContainer = newContainer;
    } else {
      const windowList = container.querySelector('#windowList');
      if (windowList) {
        windowList.innerHTML = this.windows.map((w, i) => {
          const active = w.id === this.activeWindow?.id ? ' active' : '';
          return `<div class="window-item${active}" onclick="windowManager.setActiveWindow('${w.id}')">${w.id.split('-')[1]} <span>${w.channels.length}</span></div>`;
        }).join('');
      }
    }
  },

  syncAllFilters() {
    if (!this.activeWindow) return;
    this.windows.forEach(w => this.applyFiltersToWindow(w, this.activeWindow.filterState));
  }
};

// ============ Channel Grouping ============
function getProviderGroup(channel) {
  return channel.provider || 'uncategorized';
}

function getGroupKey(channelOrProvider, category) {
  const provider = typeof channelOrProvider === 'object'
    ? (channelOrProvider.provider || channelOrProvider.name || 'uncategorized')
    : channelOrProvider;
  const cat = category || '';
  return `${provider}|${cat}`;
}

function toggleGroup(key) {
  const next = new Set(state.expanded);
  next.has(key) ? next.delete(key) : next.add(key);
  patch({ expanded: next });
}

function toggleProviderGroup(provider) {
  const key = getGroupKey(provider);
  toggleGroup(key);
}

// ============ Filtering ============
function applyFilters(channels, filterState) {
  if (!filterState) return channels;

  const query = filterState.query || '';
  const category = filterState.category || 'all';

  return channels.filter(c => {
    // Defensive null check for c.name (Bug Fix: nameLowerCache in buildMaps)
    const name = c.name || '';
    const matchesQuery = query ? (name.toLowerCase().includes(query.toLowerCase())) : true;
    const matchesCategory = category === 'all' || (c.categories && c.categories.some(cat => cat.toLowerCase() === category.toLowerCase()));
    return matchesQuery && matchesCategory;
  });

  // NEW: Auto-start background testing at end of applyFilters (Bug Fix #8)
  startBackgroundTesting();
}

// ============ Background Testing ============
let testingQueue = [];
let running = false;

export function startBackgroundTesting() {
  // NEW: Extend testing to rank 2 channels (Bug Fix #7)
  testingQueue = db.channels
    .filter(c => getStatus(c.id) === 'unknown')
    .sort((a, b) => (a.rank || 2) - (b.rank || 2))
    .map(c => c.id);
  runQueue();
}

async function runQueue() {
  if (running) return;
  running = true;
  while (testingQueue.length) {
    const batch = testingQueue.splice(0, 2);
    await Promise.all(batch.map(testStream));
    await new Promise(r => setTimeout(r, 1500));
  }
  running = false;
}

// Auto-start background testing at end of applyFilters (Bug Fix #8)

// ============ Main Boot ============
async function boot() {
  applyTheme();
  registerSW();
  try {
    await initTracking();
    await loadAll(msg => setBootMsg(msg));

    // NEW: Persist the last filter state in localStorage and restore on load instead of clearing (Bug Fix #6)
    const savedFilter = loadJSON('prism_filter_state', { query: '', category: 'all' });
    patch({ query: savedFilter.query, category: savedFilter.category });

    TREE = buildTree(db.channels);
    patch({ route: parseHash(), ready: true });
    document.getElementById('boot')?.remove();
    startBackgroundTesting(); // NEW: Auto-start background testing at end of boot (Bug Fix #8)
    setInterval(updateVisibleDots, 2500);
    setInterval(updateCountsChip, 3000);
    updateCountsChip();
  } catch (err) {
    console.error('[PRISM] boot failed', err);
    setBootMsg('Failed to load channel data. Check your connection and refresh.');
  }
}

// ============ Resolution helpers ============
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
  if (state.query.trim()) return applyFilters(db.channels, { query: state.query.trim(), category: state.category });
  let list = channelsForRoute(state.route);
  if (state.category !== 'all') list = list.filter(c => matchesCategory(c, state.category));
  return list;
}

// ============ Search ============
// NEW: Search debounce increased from 150ms to 300ms (Bug Fix #4)
function searchChannels(q) {
  const needle = q.toLowerCase();
  return db.channels
    .filter(c => (c.name || '').toLowerCase().includes(needle)) // Bug Fix #3: null-safe c.name check
    .sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name))
    .slice(0, 800);
}

// NEW: Search input debounce (300ms)
const searchDebounce = 300;
let searchTimeout = null;

function handleSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const searchInput = document.getElementById('search');
    if (searchInput) {
      state.query = searchInput.value;
      gridSig = '';
      renderChips();
      renderMain();
    }
  }, searchDebounce);
}

// ============ Render Pipeline ============
function render() {
  renderSidebar();
  renderChips();
  renderMain();
}

// ============ Grid Signature ============
function gridSignature(channels) {
  return JSON.stringify([state.route, state.category, state.query, channels.length]);
}

// ============ Render Main ============
function renderMain() {
  const channels = currentChannels();
  const sig = gridSignature(channels);
  const hero = document.getElementById('hero');

  const showHero = state.route.view === 'root' && !state.query.trim();
  hero.style.display = showHero ? '' : 'none';
  if (showHero) renderHero();

  document.getElementById('scopeTitle').textContent = scopeTitle(state.route);

  // NEW: Handle quad view mode with selected channels
  if (currentViewMode === 'quad' && selectedChannelIds.size > 0) {
    renderQuadGrid([...selectedChannelIds].map(id => db.byId.get(id)).filter(Boolean));
    return;
  }

  if (sig !== gridSig) {
    gridSig = sig;
    renderGrid(channels);
    updateFavButtons();
  } else {
    updateFavButtons();
  }
}

// NEW: Render quad grid for selected channels
function renderQuadGrid(channels) {
  const grid = document.getElementById('grid');
  const countEl = document.getElementById('resultCount');

  grid.innerHTML = '';
  if (!channels.length) {
    grid.innerHTML = `<div class="empty-state"><h3>No channels selected</h3><p>Select channels using the quad view mode.</p></div>`;
    return;
  }

  countEl.textContent = `${channels.length} channels selected`;

  // Show up to 4 channels in a 2x2 grid
  const limited = channels.slice(0, 4);
  grid.innerHTML = limited.map(c => cardHTML(c)).join('');
}

// ============ Scope Title ============
function scopeTitle(route) {
  if (state.query.trim()) return `Search: "${state.query.trim}"`;
  if (route.view === 'special') return { working: 'Working Now', fav: 'Favorites', recent: 'Recently Watched' }[route.special];
  if (route.view === 'brand') return `${route.letter}`;
  if (route.view === 'letter') return `Letter ${route.letter}`;
  return 'Browse All';
}

// ============ Hero ============
function renderHero() {
  const pool = db.channels.filter(c => c.logo && c.rank === 0);
  if (!pool.length) { heroId = null; return; }
  const daySeed = Math.floor(Date.now() / 86400000);
  const c = pool[(daySeed * 7919 + 13) % pool.length];
  if (c.id === heroId) return;
  heroId = c.id;
  const el = document.getElementById('hero');
  el.innerHTML = `
    <img class="hero-bg" src="${CUSTOM_LOGO_URL || esc(c.logo)}" alt="">
    <div class="hero-content">
      <div class="hero-kicker">FEATURED TODAY</div>
      <h2>${esc(c.name)}</h2>
      <div class="hero-meta">${flag(c.country)} ${esc(c.country || '')} \u00b7 ${esc((c.categories[0] || '').toUpperCase())}</div>
      <div class="hero-actions">
        <button id="heroPlay" class="btn-accent">▶ Watch Now</button>
        <button id="heroMv" class="btn-ghost">+ Multi-view</button>
      </div>
    </div>`;
  document.getElementById('heroPlay').onclick = () => openWatch(c.id);
  document.getElementById('heroMv').onclick = () => addToMultiView(c.id);
}

// ============ Sidebar ============
// Primary grouping: Provider -> Category -> channels.
// Secondary: A-Z brand browse preserved below the provider tree.
function primaryCategoryKey(c) {
  const chips = CATEGORY_CHIPS.filter(([k]) => k !== 'all');
  for (const cat of (c.categories || [])) {
    const hit = chips.find(([k]) => k.toLowerCase() === String(cat).toLowerCase());
    if (hit) return hit[0];
  }
  return 'general';
}

function categoryDisplayName(key) {
  if (key === 'general') return 'General';
  return CATEGORY_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

function specialRow(kind, label) {
  const map = { w: 'working', f: 'fav', r: 'recent' };
  const active = state.route.view === 'special' && state.route.special === map[kind];
  return `<div class="tree-row special${active ? ' active' : ''}">
    <a href="#/${kind}" class="tree-link" style="display:block;padding:6px 10px;color:inherit;text-decoration:none">${esc(label)}</a>
  </div>`;
}

function openWatch(id) {
  lastWatchId = id;
  const ch = db.byId.get(id);
  if (!ch) return;
  const t = document.getElementById('wTitle');
  const m = document.getElementById('wMeta');
  if (t) t.textContent = ch.name || id;
  if (m) m.textContent = [getProviderGroup(ch), ch.country].filter(Boolean).join(' \u2022 ');
  try { primeStatus(id); } catch (_e) {}
  const dlg = document.getElementById('watch');
  if (dlg && !dlg.open) dlg.showModal();
  play(id);
}

function renderSidebar() {
  const nav = document.getElementById('tree');
  if (!nav) return;

  // Preserve mode pills across innerHTML rewrites
  const pills = document.getElementById('modePills');

  // Build provider -> channels index
  const providers = new Map();
  for (const c of db.channels) {
    const p = getProviderGroup(c) || 'Other';
    if (!providers.has(p)) providers.set(p, []);
    providers.get(p).push(c);
  }

  const parts = [];
  parts.push(`<div class="tree-section-label">Library</div>`);
  parts.push(specialRow('w', 'Working Now'));
  parts.push(specialRow('f', 'Favorites'));
  parts.push(specialRow('r', 'Recently Watched'));

  parts.push(`<div class="tree-section-label">Providers</div><div id="providerGroups">`);
  const sortedProviders = [...providers.entries()].sort((a, b) =>
    b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [prov, chans] of sortedProviders) {
    const key = 'P:' + prov;
    const isOpen = state.expanded.has(key);
    parts.push(`
      <div class="tree-row">
        <button class="tw" data-toggle="${esc(key)}" aria-expanded="${isOpen}">${isOpen ? '\u25BE' : '\u25B8'}</button>
        <span class="tree-link">${esc(prov)}</span>
        <span class="count">${chans.length.toLocaleString()}</span>
      </div>`);
    if (!isOpen) continue;

    // Category sub-groups inside this provider
    const cats = new Map();
    for (const c of chans) {
      const ck = primaryCategoryKey(c);
      if (!cats.has(ck)) cats.set(ck, []);
      cats.get(ck).push(c);
    }
    parts.push(`<div class="tree-brands">`);
    const sortedCats = [...cats.entries()].sort((a, b) =>
      b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [catKey, list] of sortedCats) {
      const ckey = key + '|' + catKey;
      const cOpen = state.expanded.has(ckey);
      parts.push(`
        <div class="tree-row sub">
          <button class="tw" data-toggle="${esc(ckey)}" aria-expanded="${cOpen}">${cOpen ? '\u25BE' : '\u25B8'}</button>
          <span class="tree-link">${esc(categoryDisplayName(catKey))}</span>
          <span class="count">${list.length.toLocaleString()}</span>
        </div>`);
      if (!cOpen) continue;
      const shown = list.slice(0, 60);
      parts.push(`<div class="tree-channels">`);
      parts.push(shown.map(c =>
        `<a class="tree-channel" data-watch="${esc(c.id)}">${esc(c.name)}</a>`).join(''));
      if (list.length > shown.length) {
        parts.push(`<div class="count" style="padding:4px 12px">+${(list.length - shown.length).toLocaleString()} more…</div>`);
      }
      parts.push(`</div>`);
    }
    parts.push(`</div>`);
  }
  parts.push(`</div>`);

  // ===== A-Z brand browse (secondary) =====
  parts.push(`<div class="tree-section-label">Channels A\u2013Z</div><div class="tree-letters">`);
  if (TREE) {
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
      if (!isOpen) continue;
      parts.push(`<div class="tree-brands">`);
      for (const [bk, chans] of [...brands.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const bActive = state.route.view === 'brand' && state.route.letter === L && state.route.brandKey === bk;
        parts.push(`
          <div class="tree-row sub ${bActive ? 'active' : ''}">
            <a href="#/L/${encodeURIComponent(L)}/${encodeURIComponent(bk)}" class="tree-link">${esc(bk)}</a>
            <span class="count">${chans.length.toLocaleString()}</span>
          </div>`);
      }
      parts.push(`</div>`);
    }
  }
  parts.push(`</div>`);

  nav.innerHTML = parts.join('');
  if (pills) nav.insertBefore(pills, nav.firstChild);
}

// Re-render a window's channel list into the main grid (minimal impl).
function renderVirtualListForWindow(window) {
  if (!window) return;
  window.channels = applyFilters(db.channels, window.filterState || {});
  try { renderMain(); } catch (_e) {}
}

// ---------- helpers lost in the truncated original write ----------
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function setBootMsg(msg) {
  const el = document.getElementById('bootMsg');
  if (el) el.textContent = msg;
}

function updateCountsChip() {
  const chip = document.getElementById('statusChip');
  if (!chip || !db.channels.length) return;
  let working = 0;
  for (const c of db.channels) { if (getStatus(c.id) === 'working') working++; }
  chip.textContent = `${working.toLocaleString()} confirmed working`;
}

function renderChips() {
  const el = document.getElementById('chips');
  if (!el) return;
  el.innerHTML = CATEGORY_CHIPS.map(([key, label]) =>
    `<button class="chip${(state.category === key && !state.query.trim()) ? ' on' : ''}" data-chip="${esc(key)}">${esc(label)}</button>`
  ).join('');
  el.querySelectorAll('[data-chip]').forEach(btn => {
    btn.addEventListener('click', () => { patch({ category: btn.dataset.chip }); });
  });
}

// ---------- chrome wiring (the never-written bindChrome) ----------
let lastWatchId = null;

function bindChrome() {
  // Sidebar delegation: survives innerHTML re-renders
  const tree = document.getElementById('tree');
  if (tree && !tree._bound) {
    tree.addEventListener('click', (e) => {
      const tw = e.target.closest('.tw[data-toggle]');
      if (tw) { e.preventDefault(); toggleExpanded(tw.dataset.toggle); return; }
      const w = e.target.closest('[data-watch]');
      if (w) { openWatch(w.dataset.watch); return; }
    });
    tree._bound = true;
  }

  // State changes re-render the whole UI (route changes, favorites, expansion…)
  if (!window._onStateBound) {
    onStateChange(() => { try { render(); } catch (err) { console.error('[PRISM] render failed', err); } });
    window._onStateBound = true;
  }

  const wire = (id, fn) => {
    const el = document.getElementById(id);
    if (el && !el._bound) { el._bound = 1; el.addEventListener('click', fn); }
  };

  wire('sidebarToggle', () => document.body.classList.toggle('nav-collapsed'));
  wire('simpleModeBtn', () => toggleSimpleMode());
  wire('profileBtn', () => { const d = document.getElementById('profilePop'); if (d && !d.open) d.showModal(); });
  wire('profClose', () => { const d = document.getElementById('profilePop'); if (d && d.open) d.close(); });
  wire('mvBtn', () => { const d = document.getElementById('mvDock'); if (d) d.classList.toggle('has-tiles'); });
  wire('mvClear', () => { clearMultiView(); updateMvBadges(); });
  wire('wClose', () => { const d = document.getElementById('watch'); if (d && d.open) d.close(); });
  wire('wFav', () => { if (lastWatchId) toggleFavorite(lastWatchId); });
  wire('wTest', () => { if (lastWatchId) primeStatus(lastWatchId); });
  wire('wMulti', () => { if (lastWatchId) { addToMultiView(lastWatchId); updateMvBadges(); } });

  const th = document.getElementById('profTheme');
  if (th && !th._bound) { th._bound = 1; th.addEventListener('change', () => setTheme(th.value)); }
  const ac = document.getElementById('profAccent');
  if (ac && !ac._bound) { ac._bound = 1; ac.addEventListener('change', () => setAccent(ac.value)); }

  // Multi-view badges stay in sync after every state change
  if (!window._mvBadgeBound) {
    onStateChange(() => {
      const n = (typeof tileCount === 'function') ? tileCount() : 0;
      ['mvCount', 'mvCount2'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = n;
      });
      const dock = document.getElementById('mvDock');
      if (dock) dock.classList.toggle('has-tiles', n > 0);
    });
    window._mvBadgeBound = true;
  }
}

// Inline HTML attributes resolve against window.
Object.assign(window, {
  windowManager, handleSearchInput, setViewMode,
  navigate, toggleProviderGroup, toggleSimpleMode,
});

// Start the application.
bindChrome();
boot();
