// PRISM TV - multi-view dock: up to 4 muted PiP tiles alongside the main player
import { db, PROXY, streamCandidates } from './api.js';
import { esc } from './state.js';
import { stopPlayback } from './player.js';

const MAX_TILES = 4;
const dock = () => document.getElementById('mvDock');

let tiles = [];   // {id, video, hls, url}

export function tileCount() { return tiles.length; }

export function addToMultiView(id) {
  if (tiles.some(t => t.id === id)) { toast('Already in multi-view'); return; }
  if (tiles.length >= MAX_TILES) { toast(`Multi-view is full (max ${MAX_TILES})`); return; }
  const cands = streamCandidates(id);
  if (!cands.length) { toast('No stream available for this channel'); return }

  // One session per origin channel: if it's playing as the main stream,
  // stop the main player so the tile owns the connection exclusively.
  stopPlaybackFor(id);

  const candsUrl = `${PROXY}?u=${encodeURIComponent(cands[0].url)}`;
  const tile = document.createElement('div');
  tile.className = 'mv-tile';
  tile.innerHTML = `
    <video autoplay muted playsinline></video>
    <div class="mv-label">${esc(db.byId.get(id)?.name || id)}</div>
    <button class="mv-close" title="Remove" aria-label="Remove">\u00d7</button>`;
  const video = tile.querySelector('video');
  tile.querySelector('.mv-close').onclick = () => removeFromMultiView(id);
  // Tap-to-restart: recovers tiles whose origin dropped the session.
  video.addEventListener('click', () => startTile(video, candsUrl));
  dock().appendChild(tile);

  const hls = startTile(video, candsUrl);
  tiles.push({ id, video, hls, url: candsUrl });
  updateBadge();
}

function startTile(video, url) {
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    return null;
  }
  let hls = null;
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true, maxBufferLength: 15, liveSyncDuration: 15 });
    hls.loadSource(url);
    hls.attachMedia(video);
  } else {
    video.src = url;
  }
  return hls;
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
  // Native <dialog> sits in the browser top-layer: a body-level toast would
  // render underneath it while the watch dialog is open. Append there instead.
  const dlg = document.getElementById('watch');
  const host = (dlg && dlg.open) ? dlg : document.body;
  const t = document.createElement('div');
  t.className = 'toast show';
  t.style.zIndex = '99999';
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}

// Hook the main player registers: stop main playback when a tile claims its channel.
let mainStopHook = null;
export function onMainStop(fn) { mainStopHook = fn; }
function stopPlaybackFor(id) {
  if (mainStopHook) mainStopHook(id);
}
