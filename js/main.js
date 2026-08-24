// PRISM TV - application orchestrator: boot, routing, sidebar tree, hero,
// search, chips, watch overlay, profile, multi-window, channel grouping, quad grid.
// Vanilla ES modules, no build step.

import { db, PROXY, CUSTOM_LOGO_URL, loadAll } from './api.js';
import {
  state, patch, onStateChange, parseHash, toggleExpanded, toggleFavorite, esc, navigate,
} from './state.js';
import { buildTree, sortedLetters, letterFor, CATEGORY_CHIPS, flag, matchesCategory, GENRE_GROUPS, primaryCategoryKeyFor } from './tree.js';
import { buildUncategorizedClusters } from './clustering.js';
import { getStatus, getStatusReason, initTracking, testStream, startBackgroundTesting, deviceId, mergeWorkingSet, lastChecked } from './tracking.js';
import { loadWorkingSet } from './api.js';
import { play, stopPlayback, primeStatus } from './player.js';
import { addToWall, mountWall, clearWall, wallState } from './wall.js';
import * as mySources from './sources.js';
import { renderGrid, bindGrid, updateVisibleDots, updateFavButtons, cardHTML } from './grid.js';
import { applyTheme, setTheme, setAccent } from './themes.js';
import { registerSW } from './pwa.js';

// ============ Constants ============
const AVATARS = ['\u{1F43A}', '\u{1F98A}', '\u{1F419}', '\u{1F42C}', '\u{1F984}', '\u{1F996}', '\u{1F43B}', '\u{1F98E}'];

const CATEGORY_LABELS = Object.fromEntries(GENRE_GROUPS);

const PROVIDER_LABELS = {};

// NEW: Multi-view/quad grid display mode
const VIEW_MODES = ['single', 'favorites', 'wall'];
// viewMode lives on the shared `state` object (see state.js).
let TREE = null;
let heroId = null;
let gridSig = "";

// NEW: Set quad/single/favorites view mode
function setViewMode(mode) {
  state.viewMode = mode;

  // Update pill states
  document.querySelectorAll('#modePills .chip').forEach(b => b.classList.remove('on'));
  const activeBtn = document.querySelector(`#modePills .chip[data-view="${mode}"]`);
  if (activeBtn) activeBtn.classList.add('on');

  state.viewMode = mode;

  // NEW: Theme selector with Default/Ocean/Purple/Forest options
  const themeMap = {
    wall: 'dark',
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
    btn.title = simpleMode ? 'Switch to Advanced Mode (providers, categories, A-Z)' : 'Switch to Simple Mode (search + grid only)';
  }
  document.body.classList.toggle('simplified', simpleMode);
  try { localStorage.setItem('prism_simple', simpleMode ? '1' : ''); } catch (e) {}
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
    const country = filterState.country || 'all';
    const matchesCountry = country === 'all' || (c.country || '').toLowerCase() === country.toLowerCase();
    const hideBlocked = filterState.hideBlocked !== false; // auto-ON unless user opts out
    const isClean = !hideBlocked || !db.blocklist.has(c.id);
    return matchesQuery && matchesCategory && matchesCountry && isClean;
  });
}

// ============ Main Boot ============
async function boot() {
  applyTheme();
  registerSW();
  try {
    await initTracking();
    await loadAll(msg => setBootMsg(msg));
    const workingSet = await loadWorkingSet();
    mergeWorkingSet(workingSet);
    // User-supplied sources (bring-your-own playlist) — merged after catalog.
    const srcList = await mySources.fetchSources();
    if (srcList.length) {
      await mySources.mergeSources(srcList);
      render(); // include My Channels in the tree
    }

    // Pull this device's favorites from KV (local-first merge).
    try {
      const fr = await fetch(`${PROXY}/api/favorites`, { headers: { 'X-Device-Id': deviceId() } });
      const fj = await fr.json();
      if (Array.isArray(fj.channels)) {
        const merged = new Set(state.favorites);
        fj.channels.forEach(id => merged.add(id));
        patch({ favorites: merged });
      }
    } catch (e) { /* offline ok */ }

    // NEW: Persist the last filter state in localStorage and restore on load instead of clearing (Bug Fix #6)
    const savedFilter = loadJSON('prism_filter_state', { query: '', category: 'all', country: 'all', hideBlocked: true, workingOnly: true });
    patch({ query: savedFilter.query, category: savedFilter.category, country: savedFilter.country || 'all', hideBlocked: savedFilter.hideBlocked !== false, workingOnly: savedFilter.workingOnly !== false });

    TREE = buildTree(db.channels);
    populateCountryFilter();
    // First-run: Genres section starts expanded.
    if (!localStorage.getItem('prism_expanded')) {
      try { localStorage.setItem('prism_expanded', JSON.stringify(['SEC:genres'])); } catch (e) {}
      state.expanded.add('SEC:genres');
    }
    patch({ route: parseHash(), ready: true });
    document.getElementById('boot')?.remove();
    startBackgroundTesting(); // NEW: Auto-start background testing at end of boot (Bug Fix #8)
    setInterval(() => { if (!document.hidden) updateVisibleDots(); }, 2500); // audit P2-D: skip work in background tabs
    setInterval(updateCountsChip, 3000);
    updateCountsChip();

    // v2: boot straight into the last channel (muted auto-resume).
    const qp = new URLSearchParams(location.search);
    if (qp.get('embed') === '1') document.body.classList.add('embed');
    const resumeIdRaw = qp.get('ch');
    const resumeId = (resumeIdRaw && db.byId.has(resumeIdRaw)) ? resumeIdRaw
      : (() => { try { return localStorage.getItem('prism_last'); } catch (e) { return null; } })();
    // Audit P1-4: embeds auto-play MUTED unless ?sound=1 is explicit.
    const wantSound = !!qp.get('sound') || !qp.get('embed');
    if (resumeId && db.byId.has(resumeId)) {
      openWatch(resumeId, { muted: !wantSound });   // ?ch= plays with sound
      if (qp.get('embed') === '1' && qp.get('genre')) patch({ category: qp.get('genre') });
    }

    // Diagnostics: surface runtime filter state on the build tag.
    const bt = document.getElementById('buildTag');
    if (bt) {
      const upd = () => { bt.textContent = `BUILD 12a6ae8 | ch:${db.channels.length} cat:${state.category} ctry:${state.country} view:${state.route.view}${state.route.special ? '/' + state.route.special : ''}`; };
      upd();
      setInterval(upd, 2000);
    }
  } catch (err) {
    console.error('[PRISM] boot failed', err);
    setBootMsg('Failed to load channel data.');
    // Keep the app usable behind the overlay; show a recovery button.
    const bb = document.getElementById('boot');
    if (bb) {
      bb.classList.add('boot-error');
      const box = bb.querySelector('.prism-loader');
      if (box && !document.getElementById('bootRetry')) {
        const btn = document.createElement('button');
        btn.id = 'bootRetry';
        btn.textContent = '↻ Retry';
        btn.style.cssText = 'background:var(--accent);color:#fff;border:none;border-radius:8px;padding:10px 22px;font-weight:700;cursor:pointer';
        btn.onclick = () => location.reload();
        box.appendChild(btn);
      }
    }
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
    case 'provider': {
      const list = db.channels.filter(c => (getProviderGroup(c) || 'Other') === route.provider);
      if (route.category && route.category !== 'all') {
        return list.filter(c => primaryCategoryKey(c) === route.category);
      }
      return list;
    }
    case 'letter': return db.channels.filter(c => c.brand && letterFor(c.brand) === route.letter);
    case 'country': return db.channels.filter(c => (c.country || '').toLowerCase() === route.country);
    case 'genre': return db.channels.filter(c => matchesCategory(c, route.genre));
    case 'brand': return (TREE?.get(route.letter)?.get(route.brandKey)) || [];
    default: return db.channels;
  }
}

// Custom-source channels (user playlists) — exempt from catalog filters.
function isMy(c) {
  return typeof c.source === 'string' && c.source.startsWith('my_');
}

function currentChannels() {
  if (state.query.trim()) return applyFilters(db.channels, { query: state.query.trim(), category: state.category, country: state.country, hideBlocked: state.hideBlocked });
  let list = channelsForRoute(state.route);
  if (state.category !== 'all') list = list.filter(c => matchesCategory(c, state.category));
  if (state.country !== 'all') list = list.filter(c => (c.country || '').toLowerCase() === state.country.toLowerCase());
  if (state.hideBlocked !== false) list = list.filter(c => !db.blocklist.has(c.id) || isMy(c));
  if (state.workingOnly) list = list.filter(c => getStatus(c.id) === 'working' || isMy(c));
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
  const hero = document.getElementById('hero');

  // VIDEO WALL mode: the grid area becomes N simultaneous players.
  if (state.viewMode === 'wall') {
    hero.style.display = 'none';
    mountWall(document.getElementById('grid'));
    return;
  }

  // HOME (v2): Netflix-style rows on the root route with no active filters.
  const isHome = state.route.view === 'root' && !state.query.trim() &&
    state.category === 'all' && state.country === 'all';
  if (isHome) {
    hero.style.display = 'none';
    document.getElementById('scopeTitle').textContent = 'Home';
    document.getElementById('resultCount').textContent =
      `${db.channels.length.toLocaleString()} streamable · ${Object.keys(workingCountMap()).length} verified working`;
    renderHomeRows(document.getElementById('grid'));
    return;
  }

  const channels = currentChannels();
  const sig = gridSignature(channels);

  hero.style.display = 'none';
  document.getElementById('scopeTitle').textContent = scopeTitle(state.route);
  const staleBar = document.getElementById('quadBar');
  if (staleBar) staleBar.remove();

  if (sig !== gridSig) {
    gridSig = sig;
    renderGrid(channels);
    updateFavButtons();
  } else {
    updateFavButtons();
  }
}

function workingCountMap() {
  // Count of channels with a fresh working status from any source.
  const out = {};
  try {
    const stored = JSON.parse(localStorage.getItem('prism_status') || '{}');
    for (const [id, e] of Object.entries(stored)) {
      if (e.status === 'working' && Date.now() - (e.time || 0) < 7 * 864e5) out[id] = e.time;
    }
  } catch (e) {}
  return out;
}

// Netflix-style horizontal rows for the home view.
let _homeCache = { len: -1, sections: null };
function renderHomeRows(grid) {
  // Audit P0-3: precompute per-genre rank-1 rows once per catalog load.
  if (_homeCache.len !== db.channels.length || !_homeCache.sections) {
    const byGenre = {};
    for (const [key] of CATEGORY_CHIPS) byGenre[key] = [];
    for (const c of db.channels) {
      for (const [key] of CATEGORY_CHIPS) {
        if (matchesCategory(c, key) && c.rank === 1) { byGenre[key].push(c); break; }
      }
    }
    _homeCache = { len: db.channels.length, byGenre };
  }

  const clean = list => state.hideBlocked !== false ? list.filter(c => !db.blocklist.has(c.id)) : list;
  const sections = [];

  const recent = state.recent.map(r => db.byId.get(r.id)).filter(Boolean);
  if (recent.length) sections.push(['▶ Continue Watching', recent]);

  const working = db.channels.filter(c => getStatus(c.id) === 'working')
    .sort((a, b) => lastChecked(b.id) - lastChecked(a.id));
  if (working.length) sections.push(['✅ Working Now', working.slice(0, 80)]);

  const mine = db.channels.filter(isMy);
  if (mine.length) sections.push(['⭐ My Channels', mine]);

  for (const [key, label] of CATEGORY_CHIPS) {
    const list = clean((_homeCache.byGenre[key] || []))
      .sort((a, b) => b.reliable - a.reliable || a.name.localeCompare(b.name))
      .slice(0, 60);
    if (list.length >= 12) sections.push([label.toUpperCase(), list]);
  }

  let html = '';
  for (const [title, list] of sections) {
    if (!list.length) continue;
    html += `<div class="home-row-title">${esc(title)}</div><div class="home-row">${list.map(c => cardHTML(c)).join('')}</div>`;
  }
  grid.innerHTML = html || '<div class="empty-state"><h3>Building your guide…</h3><p>Probe pipeline is verifying streams. Check Working Now in a few minutes.</p></div>';
}

// ============ Scope Title ============
function scopeTitle(route) {
  if (state.query.trim()) return `Search: "${state.query.trim()}"`;
  if (route.view === 'special') return { working: 'Working Now', fav: 'Favorites', recent: 'Recently Watched' }[route.special];
  if (route.view === 'provider') {
    const cat = route.category && route.category !== 'all' ? ' — ' + categoryDisplayName(route.category) : '';
    return `${decodeURIComponent(route.provider)}${cat}`;
  }
  if (route.view === 'country') {
    const code = route.country.toUpperCase();
    return `${flag(code)} ${code}`;
  }
  if (route.view === 'genre') {
    const hit = CATEGORY_CHIPS.find(([k]) => k === route.genre);
    return '🎭 ' + (hit ? hit[1] : decodeURIComponent(route.genre));
  }
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
  document.getElementById('heroMv').onclick = () => { addFromBrowse(c.id); setViewMode('wall'); };
}

// ============ Sidebar ============
// Primary grouping: Provider -> Category -> channels.
// Secondary: A-Z brand browse preserved below the provider tree.
function primaryCategoryKey(c) {
  return primaryCategoryKeyFor(c);
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

function openWatch(id, opts = {}) {
  lastWatchId = id;
  const ch = db.byId.get(id);
  if (!ch) return;
  window.__lastWatchedId = id;
  try { localStorage.setItem('prism_last', id); } catch (e) {}
  const t = document.getElementById('wTitle');
  const m = document.getElementById('wMeta');
  if (t) t.textContent = ch.name || id;
  if (m) m.textContent = [getProviderGroup(ch), ch.country].filter(Boolean).join(' \u2022 ');
  try { primeStatus(id); } catch (_e) {}
  const dlg = document.getElementById('watch');
  if (dlg) {
    // Docked non-modal player (v2 layout): fixed card, app stays usable.
    dlg.classList.add('docked');
    if (!dlg.open) dlg.show();
    if (opts.muted) {
      const v = document.getElementById('video');
      if (v) {
        v.muted = true;
        // Audit P0-1: auto-resume must have a one-gesture path to sound.
        const unmute = () => { try { v.muted = false; } catch {} };
        document.addEventListener('pointerdown', unmute, { once: true, capture: true });
      }
    }
  }
  play(id, opts);
}

function renderSidebar() {
  const nav = document.getElementById('tree');
  if (!nav) return;

  // Memoize: skip rebuild when nothing tree-relevant changed (audit P0-D).
  const treeSig = JSON.stringify([
    state.route.view, state.route.provider || '', state.route.letter || '', state.route.brandKey || '',
    [...state.expanded].join(','), db.channels.length,
  ]);
  if (window._lastTreeSig === treeSig && nav.querySelector('.tree-row')) {
    // Still re-append pills if a previous rebuild detached them.
    return;
  }
  window._lastTreeSig = treeSig;

  // Preserve mode pills across innerHTML rewrites
  const pills = document.getElementById('modePills');

  // Build provider -> channels index
  const providers = new Map();
  for (const c of db.channels) {
    const p = getProviderGroup(c) || 'Other';
    if (!providers.has(p)) providers.set(p, []);
    providers.get(p).push(c);
  }
  const sortedProviders = [...providers.entries()].sort((a, b) =>
    b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const parts = [];

  // ===== My Channels (user-supplied sources — always on top) =====
  const mine = db.channels.filter(isMy);
  if (mine.length) {
    parts.push(`<div class="tree-section-label">⭐ My Channels (${mine.length})</div><div class="tree-brands">`);
    for (const c of [...mine].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 300)) {
      parts.push(`<a class="tree-channel" data-watch="${esc(c.id)}">${esc(c.name)}</a>`);
    }
    if (mine.length > 300) parts.push(`<div class="count" style="padding:4px 12px">+${(mine.length - 300).toLocaleString()} more…</div>`);
    parts.push(`</div>`);
  }

  parts.push(`<div class="tree-section-label">Library</div>`);
  parts.push(specialRow('w', 'Working Now'));
  parts.push(specialRow('f', 'Favorites'));
  parts.push(specialRow('r', 'Recently Watched'));

  // ===== Browse by Country (top 60, collapsible) =====
  if (db.channels.length) {
    const cc = new Map();
    for (const c of db.channels) {
      const k = (c.country || '').toLowerCase();
      if (k.length === 2) cc.set(k, (cc.get(k) || 0) + 1);
    }
    const secKey = 'SEC:countries';
    const secOpen = state.expanded.has(secKey);
    const total = [...cc.values()].reduce((s, n) => s + n, 0);
    parts.push(`
      <div class="tree-row">
        <button class="tw" data-toggle="${esc(secKey)}" aria-expanded="${secOpen}">${secOpen ? '\u25BE' : '\u25B8'}</button>
        <span class="tree-link">🌍 Countries</span>
        <span class="count">${cc.size.toLocaleString()}</span>
      </div>`);
    if (secOpen) {
      parts.push(`<div class="tree-brands">`);
      for (const [code, n] of [...cc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
        const active = state.route.view === 'country' && state.route.country === code;
        parts.push(`<div class="tree-row ${active ? 'active' : ''}"><a class="tree-link" href="#/c/${esc(code)}">${flag(code)} ${esc(code.toUpperCase())}</a><span class="count">${n.toLocaleString()}</span></div>`);
      }
      parts.push(`</div>`);
    }
  }

  // ===== Browse by Genre (collapsible, open by default) =====
  {
    const secKey = 'SEC:genres';
    const secOpen = state.expanded.has(secKey) || !localStorage.getItem('prism_expanded');
    const genreCount = db.channels.length;
    parts.push(`
      <div class="tree-row">
        <button class="tw" data-toggle="${esc(secKey)}" aria-expanded="${secOpen}">${secOpen ? '\u25BE' : '\u25B8'}</button>
        <span class="tree-link">🎭 Genres</span>
        <span class="count">${genreCount.toLocaleString()}</span>
      </div>`);
    if (secOpen) {
      parts.push(`<div class="tree-brands">`);
      for (const [key, label] of CATEGORY_CHIPS.filter(([k]) => k !== 'all')) {
        const n = db.channels.filter(c => matchesCategory(c, key)).length;
        const active = state.route.view === 'genre' && state.route.genre === key;
        parts.push(`<div class="tree-row ${active ? 'active' : ''}"><a class="tree-link" href="#/g/${esc(key)}">${esc(label)}</a><span class="count">${n.toLocaleString()}</span></div>`);
      }
      parts.push(`</div>`);
    }
  }

  // ===== Providers & Platforms (collapsible section; clustered submenus) =====
  {
    const secKeyP = 'SEC:providers';
    const secPOpen = state.expanded.has(secKeyP);
    parts.push(`
      <div class="tree-row">
        <button class="tw" data-toggle="${esc(secKeyP)}" aria-expanded="${secPOpen}">${secPOpen ? '\u25BE' : '\u25B8'}</button>
        <span class="tree-link">📡 Providers &amp; Platforms</span>
        <span class="count">${sortedProviders.length.toLocaleString()}</span>
      </div>`);
    if (secPOpen) {
      parts.push(`<div id="providerGroups">`);
      const UNC = 'uncategorized';
      const realProviders = sortedProviders.filter(([p]) => p.toLowerCase() !== UNC);
      const uncEntry = sortedProviders.find(([p]) => p.toLowerCase() === UNC);
      for (const [prov, chans] of [...realProviders, ...(uncEntry ? [uncEntry] : [])]) {
        const isUnc = prov.toLowerCase() === UNC;
        const key = 'P:' + prov;
        const isOpen = state.expanded.has(key);
        parts.push(`
          <div class="tree-row">
            <button class="tw" data-toggle="${esc(key)}" aria-expanded="${isOpen}">${isOpen ? '\u25BE' : '\u25B8'}</button>
            <a class="tree-link" href="#/p/${encodeURIComponent(prov)}">${esc(isUnc ? 'Uncategorized (no provider)' : prov)}</a>
            <span class="count">${chans.length.toLocaleString()}</span>
          </div>`);
        if (!isOpen) continue;

        // Hierarchy fix: platform membership (Amagi/Wurl/...) says nothing about
        // content family, and our coarse category chips produced junk like
        // "Amagi -> General". Brand-name clusters are truthful at every level.
        let clusters;
        try { clusters = buildUncategorizedClusters(chans); } catch (e) { clusters = []; }
        parts.push(`<div class="tree-brands">`);
        for (const cl of clusters.slice(0, 40)) {
          const ckey = key + '|C:' + cl.label;
          const cOpen = state.expanded.has(ckey);
          parts.push(`
            <div class="tree-row sub">
              <button class="tw" data-toggle="${esc(ckey)}" aria-expanded="${cOpen}">${cOpen ? '\u25BE' : '\u25B8'}</button>
              <span class="tree-link">${esc(cl.label)}</span>
              <span class="count">${cl.chans.length.toLocaleString()}</span>
            </div>`);
          if (!cOpen) continue;
          const shown = cl.chans.slice(0, 100);
          parts.push(`<div class="tree-channels">`);
          parts.push(shown.map(c => `<a class="tree-channel" data-watch="${esc(c.id)}">${esc(c.name)}</a>`).join(''));
          if (cl.chans.length > shown.length) {
            parts.push(`<div class="count" style="padding:4px 12px">+${(cl.chans.length - shown.length).toLocaleString()} more…</div>`);
          }
          parts.push(`</div>`);
        }
        parts.push(`</div>`);
      }
      parts.push(`</div>`);
    }
  }

  // ===== A-Z brand browse (collapsible section) =====
  {
    const secKeyAZ = 'SEC:az';
    const secAZOpen = state.expanded.has(secKeyAZ);
    let azTotal = 0;
    if (TREE) for (const brands of TREE.values()) for (const list of brands.values()) azTotal += list.length;
    parts.push(`
      <div class="tree-row">
        <button class="tw" data-toggle="${esc(secKeyAZ)}" aria-expanded="${secAZOpen}">${secAZOpen ? '\u25BE' : '\u25B8'}</button>
        <span class="tree-link">🔤 Channels A\u2013Z</span>
        <span class="count">${azTotal.toLocaleString()}</span>
      </div>`);
    if (secAZOpen && TREE) {
      parts.push(`<div class="tree-letters">`);
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
        for (const [bk, chans] of [...brands.entries()].sort((a, b) =>
          b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
          const bActive = state.route.view === 'brand' && state.route.letter === L && state.route.brandKey === bk;
          parts.push(`
            <div class="tree-row sub ${bActive ? 'active' : ''}">
              <a href="#/L/${encodeURIComponent(L)}/${encodeURIComponent(bk)}" class="tree-link">${esc(bk)}</a>
              <span class="count">${chans.length.toLocaleString()}</span>
            </div>`);
        }
        parts.push(`</div>`);
      }
      parts.push(`</div>`);
    }
  }

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

// Persist one filter key into the saved-filter snapshot.
function persistFilter(key, value) {
  try {
    const fs = loadJSON('prism_filter_state', {});
    fs[key] = value;
    localStorage.setItem('prism_filter_state', JSON.stringify(fs));
  } catch (e) {}
}

function updateCountsChip() {
  const chip = document.getElementById('statusChip');
  if (!chip || !db.channels.length) return;
  let working = 0;
  for (const c of db.channels) { if (getStatus(c.id) === 'working') working++; }
  chip.textContent = `${working.toLocaleString()} confirmed working`;
}

// Populate the country <select> once channel data is in (top 60 by count).
function populateCountryFilter() {
  const sel = document.getElementById('countryFilter');
  if (!sel || !db.channels.length) return;
  const counts = new Map();
  for (const c of db.channels) {
    const cc = (c.country || '').toLowerCase();
    if (cc.length === 2) counts.set(cc, (counts.get(cc) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
  const cur = state.country || 'all';
  sel.innerHTML = '<option value="all">🌍 All countries</option>' +
    top.map(([cc, n]) => `<option value="${esc(cc)}">${flag(cc)} ${esc(cc.toUpperCase())} (${n.toLocaleString()})</option>`).join('');
  sel.value = top.some(([cc]) => cc === cur) ? cur : 'all';
}

function renderChips() {
  const el = document.getElementById('chips');
  if (!el) return;
  // Precompute genre counts once per data-load for hover tooltips.
  if (!window._genreCounts) {
    window._genreCounts = {};
    for (const [key] of CATEGORY_CHIPS) {
      window._genreCounts[key] = key === 'all' ? db.channels.length : db.channels.filter(c => matchesCategory(c, key)).length;
    }
  }
  el.innerHTML = CATEGORY_CHIPS.map(([key, label]) =>
    `<button class="chip${(state.category === key && !state.query.trim()) ? ' on' : ''}" data-chip="${esc(key)}" title="${((window._genreCounts[key] || 0)).toLocaleString()} channels" aria-pressed="${state.category === key && !state.query.trim()}">${esc(label)}</button>`
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
    let renderQueued = false;
    let lastFavSig = JSON.stringify([...state.favorites].sort());
    let favPushTimer = null;
    onStateChange(() => {
      // Favorites device-sync (debounced push on change)
      const favSig = JSON.stringify([...state.favorites].sort());
      if (favSig !== lastFavSig) {
        lastFavSig = favSig;
        clearTimeout(favPushTimer);
        favPushTimer = setTimeout(() => {
          fetch(`${PROXY}/api/favorites`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() },
            body: JSON.stringify({ channels: [...state.favorites] }),
          }).catch(() => {});
        }, 1500);
      }
      // Throttle: status emits fire per-channel during testing; coalesce to one render.
      if (renderQueued) return;
      renderQueued = true;
      setTimeout(() => { renderQueued = false; try { render(); } catch (err) { console.error('[PRISM] render failed', err); } }, 120);
    });
    window._onStateBound = true;
  }

  const wire = (id, fn) => {
    const el = document.getElementById(id);
    if (el && !el._bound) { el._bound = 1; el.addEventListener('click', fn); }
  };

  wire('sidebarToggle', () => {
    document.body.classList.toggle('guide-open');
    const b = document.getElementById('sidebarToggle');
    if (b) b.setAttribute('aria-expanded', document.body.classList.contains('guide-open'));
  });
  wire('simpleModeBtn', () => toggleSimpleMode());
  wire('profileBtn', () => { const d = document.getElementById('profilePop'); if (d && !d.open) d.showModal(); });
  wire('profClose', () => { const d = document.getElementById('profilePop'); if (d && d.open) d.close(); });
  wire('mvBtn', () => setViewMode('wall'));
  wire('mvClear', () => { clearWall(); renderMain(); });
  wire('wClose', () => { stopPlayback(); const d = document.getElementById('watch'); if (d && d.open) d.close(); });
  wire('wFav', () => { if (lastWatchId) toggleFavorite(lastWatchId); });
  wire('wTest', () => { if (lastWatchId) primeStatus(lastWatchId); });
  wire('wMulti', () => { if (lastWatchId) { addFromBrowse(lastWatchId); updateMvBadges(); } });

  const th = document.getElementById('profTheme');
  if (th && !th._bound) { th._bound = 1; th.addEventListener('change', () => setTheme(th.value)); }
  const ac = document.getElementById('profAccent');
  if (ac && !ac._bound) { ac._bound = 1; ac.addEventListener('change', () => setAccent(ac.value)); }

  // Country filter dropdown (static element, bound once)
  const cf = document.getElementById('countryFilter');
  if (cf && !cf._bound) {
    cf._bound = 1;
    cf.addEventListener('change', () => patch({ country: cf.value }));
  }

  // "Working only" + "Good only" toggles (persisted; both ON by default)
  const wo = document.getElementById('workingOnly');
  if (wo && !wo._bound) {
    wo._bound = 1;
    wo.checked = state.workingOnly !== false;
    wo.addEventListener('change', () => {
      state.workingOnly = wo.checked;
      persistFilter('workingOnly', wo.checked);
      renderMain();
    });
  }
  const hb = document.getElementById('hideBlocked');
  if (hb && !hb._bound) {
    hb._bound = 1;
    hb.checked = state.hideBlocked !== false;
    hb.addEventListener('change', () => {
      state.hideBlocked = hb.checked;
      persistFilter('hideBlocked', hb.checked);
      renderMain();
    });
  }

  // Favorites export / import (enterprise audit P2-H)
  const expBtn = document.getElementById('profFavExport');
  if (expBtn && !expBtn._bound) {
    expBtn._bound = 1;
    expBtn.addEventListener('click', () => {
      const data = JSON.stringify({ exported: new Date().toISOString(), device: deviceId(), favorites: [...state.favorites] }, null, 2);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prism-favorites.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  }
  const impBtn = document.getElementById('profFavImport');
  const impFile = document.getElementById('profFavFile');
  if (impBtn && impFile && !impBtn._bound) {
    impBtn._bound = 1;
    impBtn.addEventListener('click', () => impFile.click());
    impFile.addEventListener('change', async () => {
      const file = impFile.files && impFile.files[0];
      if (!file) return;
      try {
        const j = JSON.parse(await file.text());
        const incoming = Array.isArray(j) ? j : (j.favorites || []);
        const next = new Set(state.favorites);
        for (const id of incoming) if (typeof id === 'string') next.add(id);
        patch({ favorites: next });
        impBtn.textContent = '✓ Imported ' + incoming.length;
      } catch { impBtn.textContent = 'Import failed'; }
      setTimeout(() => { impBtn.textContent = '⬆ Import favorites'; }, 3000);
      impFile.value = '';
    });
  }

  // My Sources: add / list / remove user playlists
  async function refreshSrcListUI() {
    const box = document.getElementById('srcList');
    if (!box) return;
    const list = await mySources.fetchSources();
    box.innerHTML = list.length
      ? list.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:.78rem;padding:3px 0"><span>📄 ${esc(s.name)}</span><button data-delsrc="${esc(s.id)}" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:.9rem">✕</button></div>`).join('')
      : '<span style="color:var(--muted);font-size:.75rem">No sources yet — paste an M3U URL above.</span>';
    box.querySelectorAll('[data-delsrc]').forEach(btn => {
      btn.onclick = async () => {
        const list = await mySources.fetchSources();
        const entry = list.find(s => s.id === btn.dataset.delsrc);
        const next = list.filter(s => s.id !== btn.dataset.delsrc);
        await mySources.saveSources(next);
        if (entry) mySources.removeSourceChannels('my_' + entry.id);
        refreshSrcListUI();
        renderMain();
      };
    });
  }
  const srcAdd = document.getElementById('srcAdd');
  if (srcAdd && !srcAdd._bound) {
    srcAdd._bound = 1;
    srcAdd.addEventListener('click', async () => {
      const nameEl = document.getElementById('srcName');
      const urlEl = document.getElementById('srcUrl');
      const url = (urlEl?.value || '').trim();
      const nm = (nameEl?.value || '').trim() || 'My playlist';
      if (!/^https:\/\//i.test(url)) { srcAdd.textContent = '✗ https URL'; setTimeout(() => srcAdd.textContent = 'Add', 2000); return; }
      const list = await mySources.fetchSources();
      if (list.length >= 10 || list.some(s => s.url === url)) { srcAdd.textContent = '✗ dup/max'; setTimeout(() => srcAdd.textContent = 'Add', 2000); return; }
      srcAdd.textContent = 'Fetching…';
      const entry = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 10), name: nm, url };
      list.push(entry);
      if (!await mySources.saveSources(list)) { srcAdd.textContent = '✗ save failed'; return; }
      await mySources.mergeSources([entry]);
      nameEl.value = ''; urlEl.value = '';
      await refreshSrcListUI();
      render();
      srcAdd.textContent = '✓';
      setTimeout(() => srcAdd.textContent = 'Add', 1500);
    });
    refreshSrcListUI();
  }

  // Multi-view badges stay in sync after every state change
  if (!window._mvBadgeBound) {
    onStateChange(updateMvBadges);
    window._mvBadgeBound = true;
  }
}

// Wall badge sync.
function updateMvBadges() {
  const n = wallState.cells.filter(c => c.id).length;
  ['mvCount', 'mvCount2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = n;
  });
}

// Inline HTML attributes resolve against window.
Object.assign(window, {
  windowManager, handleSearchInput, setViewMode,
  navigate, toggleProviderGroup, toggleSimpleMode,
  renderMain,
});

// Start the application.
bindChrome();
// P0 fix: grid had ZERO event listeners - bindGrid was imported but never called.
function addMulti(id) {
  addFromBrowse(id);
  setViewMode('wall');
}

bindGrid({ onOpen: { watch: openWatch, addMulti } });
// Simple Mode persistence
if (localStorage.getItem('prism_simple') === '1') {
  simpleMode = true;
  document.body.classList.add('simplified');
  const sb = document.getElementById('simpleModeBtn');
  if (sb) { sb.textContent = 'Advanced'; sb.title = 'Switch to Advanced Mode (providers, categories, A-Z)'; }
}
boot();
