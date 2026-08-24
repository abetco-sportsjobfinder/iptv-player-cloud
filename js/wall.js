// PRISM TV - Video Wall: N simultaneous HLS players living in the main area.
// Architecture: cells are PERSISTENT objects bound to <video> elements.
// Renders are incremental — playing streams never reload unless their
// channel changes or the layout structurally changes.

import { db, PROXY, streamCandidates } from './api.js';
import { esc } from './state.js';

const MAX_CELLS = 16;

export const wallState = {
  cells: [],        // {id|null, video, hls}
  layout: 4,        // desired capacity
  focused: -1,      // unmuted cell index (-1 = all muted)
};

let rootEl = null;

const COLS_FOR = n => (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4);

export function mountWall(container) {
  rootEl = container;
  ensureCapacity();
  buildShell();
  syncCells();
}

export function setLayout(n) {
  wallState.layout = Math.max(1, Math.min(MAX_CELLS, n));
  ensureCapacity();
  buildShell();          // structural change: columns shift, full resync
  syncCells();
}

export function clearWall() {
  for (const c of wallState.cells) stopCell(c);
  wallState.cells = [];
  ensureCapacity();
  buildShell();
  syncCells();
}

export function addToWall(id) {
  window.__lastWatchedId = id;
  ensureCapacity();
  let idx = wallState.cells.findIndex(c => !c.id);
  if (idx === -1) idx = wallState.focused >= 0 ? wallState.focused : 0;
  assignCell(idx, id);
}

function ensureCapacity() {
  while (wallState.cells.length < wallState.layout) wallState.cells.push(newCell());
  while (wallState.cells.length > wallState.layout) {
    const c = wallState.cells.pop();
    stopCell(c);
    const el = rootEl?.querySelector(`.wall-cell[data-cell="${wallState.cells.length}"]`);
    if (el) el.remove();
  }
  wallState.focused = Math.min(wallState.focused, wallState.cells.length - 1);
}

function newCell() { return { id: null, video: null, hls: null }; }

// ---------- rendering ----------

function buildShell() {
  if (!rootEl) return;
  const cols = COLS_FOR(wallState.layout);
  rootEl.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;padding:0 0 10px;flex-wrap:wrap">
      <span style="color:var(--muted,#97a0b5);font-size:.8rem;font-weight:700">WALL</span>
      ${[1, 2, 4, 6, 9, 12].map(n =>
        `<button data-wallcols="${n}" style="background:${wallState.layout === n ? 'var(--accent,#6366f1)' : 'var(--surface2,#1a1e29)'};color:#fff;border:1px solid var(--border,#232937);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:.75rem">${n}</button>`).join('')}
      <button data-wallclear style="background:var(--surface2,#1a1e29);color:#fff;border:1px solid var(--border,#232937);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:.75rem">Clear</button>
      <span style="color:var(--muted,#97a0b5);font-size:.7rem;margin-left:auto">＋ button on any card adds here · click tile = sound · double-click = fullscreen</span>
    </div>
    <div id="wallGrid" data-cols="${cols}" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px"></div>`;
  wireHeader();
  syncCells();
}

function syncCells() {
  if (!rootEl) return;
  const grid = rootEl.querySelector('#wallGrid');
  if (!grid) return;
  grid.dataset.cols = String(COLS_FOR(wallState.cells.length));
  grid.style.gridTemplateColumns = `repeat(${COLS_FOR(wallState.cells.length)},1fr)`;

  // Reconcile children count.
  while (grid.children.length > wallState.cells.length) grid.lastElementChild.remove();
  while (grid.children.length < wallState.cells.length) {
    const div = document.createElement('div');
    div.className = 'wall-cell';
    div.style.cssText = 'position:relative;background:#000;border:1px solid var(--border,#232937);border-radius:8px;overflow:hidden;aspect-ratio:16/9';
    grid.appendChild(div);
  }

  wallState.cells.forEach((c, i) => {
    const div = grid.children[i];
    div.dataset.cell = String(i);
    div.style.outline = i === wallState.focused ? '2px solid var(--accent,#6366f1)' : '';
    const name = c.id ? (db.byId.get(c.id)?.name || c.id) : null;
    const wantVideo = !!c.id;

    if (wantVideo) {
      let v = div.querySelector('video');
      if (!v) {
        div.innerHTML = `
          <video autoplay muted playsinline style="width:100%;height:100%;object-fit:contain;display:block"></video>
          <div class="wlabel" style="position:absolute;left:6px;top:6px;font:600 .7rem Inter,sans-serif;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none">${esc(name)}</div>
          <button data-unmute="${i}" title="Sound" style="position:absolute;left:6px;bottom:6px;width:30px;height:30px;border-radius:6px;border:none;cursor:pointer;background:rgba(0,0,0,.55);color:#fff;font-size:.85rem">🔇</button>
          <button data-close="${i}" title="Remove" style="position:absolute;right:6px;top:6px;width:26px;height:26px;border-radius:6px;border:none;cursor:pointer;background:rgba(0,0,0,.55);color:#fff">×</button>`;
        v = div.querySelector('video');
        c.video = v;
        startStream(c, v);
      }
      v.muted = i !== wallState.focused;
      const lbl = div.querySelector('.wlabel');
      if (lbl && lbl.textContent !== name) lbl.textContent = name;
      const um = div.querySelector('[data-unmute]');
      if (um) { um.textContent = i === wallState.focused ? '🔊' : '🔇'; um.dataset.unmute = String(i); }
      const cl = div.querySelector('[data-close]');
      if (cl) cl.dataset.close = String(i);
      div.dataset.cell = String(i);
    } else {
      // Empty slot: tear down any player and show the add affordance.
      if (c.video || c.hls) stopCell(c);
      if (!div.querySelector('[data-pick]')) {
        div.innerHTML = `
          <button data-pick="${i}" title="Pick next added channel" style="width:100%;height:100%;background:transparent;border:none;color:var(--muted,#97a0b5);cursor:pointer;display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center">
            <span style="font-size:1.4rem">＋</span><span>Empty</span>
          </button>`;
      }
      const pk = div.querySelector('[data-pick]');
      if (pk) pk.dataset.pick = String(i);
      div.dataset.cell = String(i);
    }
  });
  wireCells();
}

function wireCells() {
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-wallcols]').forEach(b => {
    b.onclick = () => setLayout(parseInt(b.dataset.wallcols, 10));
  });
  const clr = rootEl.querySelector('[data-wallclear]');
  if (clr) clr.onclick = () => clearWall();

  rootEl.querySelectorAll('.wall-cell').forEach(div => {
    const i = parseInt(div.dataset.cell, 10);
    const pick = div.querySelector('[data-pick]');
    if (pick) pick.onclick = () => window.dispatchEvent(new CustomEvent('wall:pick', { detail: i }));
    const unm = div.querySelector('[data-unmute]');
    if (unm) unm.onclick = () => focusCell(parseInt(unm.dataset.unmute, 10));
    const cls = div.querySelector('[data-close]');
    if (cls) cls.onclick = () => { const c = wallState.cells[i]; stopCell(c); wallState.cells[i] = newCell(); syncCells(); };
    div.ondblclick = () => {
      const v = div.querySelector('video');
      if (v && !document.fullscreenElement) v.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) document.exitFullscreen?.();
    };
  });
}

function wireHeader() {}

// ---------- playback ----------

function focusCell(i) {
  if (!wallState.cells[i]?.id) return;
  wallState.focused = i;
  wallState.cells.forEach((c, idx) => { if (c.video) c.video.muted = idx !== i; });
  syncCells(); // refresh outline + icons (videos untouched)
}

export function assignCell(idx, id) {
  const c = wallState.cells[idx];
  if (!c) return;
  stopCell(c);
  c.id = id;
  syncCells();                 // creates <video> for the cell
  const v = c.video;
  if (v) startStream(c, v);
  wallState.focused = idx;
  wallState.cells.forEach((o, oi) => { if (o.video) o.video.muted = oi !== idx; });
  syncCells();
}

function startStream(cell, v) {
  const cands = streamCandidates(cell.id);
  if (!cands.length) return;
  const url = `${PROXY}?u=${encodeURIComponent(cands[0].url)}`;
  v.muted = wallState.cells.indexOf(cell) !== wallState.focused;
  v.autoplay = true;
  if (v.canPlayType('application/vnd.apple.mpegurl')) {
    v.src = url;
    v.play().catch(() => {});
  } else if (window.Hls && Hls.isSupported()) {
    cell.hls = new Hls({ enableWorker: true, maxBufferLength: 10, liveSyncDuration: 10 });
    cell.hls.loadSource(url);
    cell.hls.attachMedia(v);
    v.play().catch(() => {});
  } else {
    v.src = url;
  }
}

function stopCell(cell) {
  if (cell.hls) { try { cell.hls.destroy(); } catch {} cell.hls = null; }
  if (cell.video) {
    try { cell.video.pause(); cell.video.removeAttribute('src'); cell.video.load(); } catch {}
    cell.video = null;
  }
  cell.id = null;
}

export function stopAll() {
  for (const c of wallState.cells) stopCell(c);
}

// Browse-side hook: "+" on cards routes here.
export function addFromBrowse(id) {
  window.__lastWatchedId = id;
  addToWall(id);
}
