// PRISM TV - multi-view dock: up to 4 muted PiP tiles alongside the main player
import { db, PROXY, streamCandidates } from './api.js';
import { esc } from './state.js';

const MAX_TILES = 4;
const dock = () => document.getElementById('mvDock');

let tiles = [];   // {id, video, hls}

export function tileCount() { return tiles.length; }

export function addToMultiView(id) {
  if (tiles.some(t => t.id === id)) { toast('Already in multi-view'); return; }
  if (tiles.length >= MAX_TILES) { toast(`Multi-view is full (max ${MAX_TILES})`); return; }
  const cands = streamCandidates(id);
  if (!cands.length) { toast('No stream available for this channel'); return; }

  const tile = document.createElement('div');
  tile.className = 'mv-tile';
  tile.innerHTML = `
    <video autoplay muted playsinline></video>
    <div class="mv-label">${esc(db.byId.get(id)?.name || id)}</div>
    <button class="mv-close" title="Remove" aria-label="Remove">\u00d7</button>`;
  const video = tile.querySelector('video');
  tile.querySelector('.mv-close').onclick = () => removeFromMultiView(id);
  dock().appendChild(tile);

  let hls = null;
  const url = `${PROXY}?u=${encodeURIComponent(cands[0].url)}`;
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  } else if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true, maxBufferLength: 15, liveSyncDuration: 15 });
    hls.loadSource(url);
    hls.attachMedia(video);
  }
  tiles.push({ id, video, hls });
  updateBadge();
}

export function removeFromMultiView(id) {
  const i = tiles.findIndex(t => t.id === id);
  if (i === -1) return;
  const t = tiles[i];
  if (t.hls) t.hls.destroy();
  t.video.pause();
  t.video.removeAttribute('src');
  t.video.load();
  t.video.closest('.mv-tile')?.remove();
  tiles.splice(i, 1);
  updateBadge();
}

export function clearMultiView() {
  [...tiles].forEach(t => removeFromMultiView(t.id));
}

function updateBadge() {
  for (const id of ['mvCount', 'mvCount2']) {
    const b = document.getElementById(id);
    if (b) b.textContent = String(tiles.length);
  }
  dock()?.classList.toggle('has-tiles', tiles.length > 0);
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}
