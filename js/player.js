// PRISM TV - main player: HLS with failover, proven config carried from v1
import { db, PROXY, streamCandidates } from './api.js';
import { getStatus, setStatus, testStream } from './tracking.js';
import { pushRecent } from './state.js';
import { addToMultiView, removeFromMultiView, onMainStop } from './multiview.js';

// Session exclusivity: when a multi-view tile claims this channel,
// release the main player's connection to the same origin stream.
onMainStop(id => {
  if (currentId === id) stopPlayback();
});

let hls = null;
let loadTimer = null;
let loadResolved = false;
let attempts = 0;
let currentId = null;

function proxied(url) { return `${PROXY}?u=${encodeURIComponent(url)}`; }

export function stopPlayback() {
  clearTimeout(loadTimer);
  loadResolved = false;
  const v = document.getElementById('video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  if (hls) { hls.destroy(); hls = null; }
}

export async function play(id, opts = {}) {
  const v = document.getElementById('video');
  if (!v) return;
  currentId = id;
  attempts = 0;
  try { localStorage.setItem('prism_last', id); } catch (e) {}
  v.muted = !!opts.muted;   // auto-resume boots muted (browser autoplay policy)
  pushRecent(id);
  // Free any multi-view tile holding this channel: one session per stream.
  removeFromMultiView(id);

  const reason = db.blocklist.get(id);
  if (reason) { ui(`Blocked: ${db.byId.get(id)?.name || id} — ${reason}`); stopPlayback(); return; }

  tryPlay();
  return;

  function tryPlay() {
    stopPlayback();
    const candidates = streamCandidates(id);
    if (!candidates.length) { ui(`${db.byId.get(id)?.name || id} — no stream available`); return; }
    if (attempts >= Math.min(candidates.length, 4)) {
      setStatus(id, 'dead', 'playback_failed');
      ui(`${db.byId.get(id)?.name || id} — all streams failed`);
      return;
    }
    const stream = candidates[attempts];
    loadResolved = false;
    attempts++;
    v.onerror = () => retry('Network/CORS error');
    v.onplaying = () => {
      loadResolved = true;
      attempts = 0;
      setStatus(id, 'working', 'playing');
      ui('');
    };
    const url = proxied(stream.url);
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url;
      v.play().catch(() => {});
    } else if (window.Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        maxBufferLength: 30, maxMaxBufferLength: 60,
        liveSyncDuration: 30, liveMaxLatencyDuration: 60,
        maxBufferSize: 60 * 1000 * 1000, maxBufferHole: 0.5,
        fragLoadingTimeOut: 20000, fragLoadingMaxRetry: 6,
        startFragPrefetch: true, capLevelToPlayerSize: true,
      });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) retry(`HLS: ${data.details}`); });
      hls.loadSource(url);
      hls.attachMedia(v);
      v.play().catch(() => {});
    } else {
      v.src = url;
    }
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => { if (!loadResolved) retry('Load timeout'); }, 20000);
  }

  function retry(msg) {
    if (!loadResolved) {
      ui(`${msg} — trying stream ${attempts + 1}…`);
      tryPlay();
    }
  }

  function ui(text) {
    const el = document.getElementById('playerMsg');
    if (el) el.textContent = text;
  }
}

// Called when opening watch view: reflect cached status, test if unknown
export function primeStatus(id) {
  if (getStatus(id) === 'unknown') {
    setStatus(id, 'testing');
    testStream(id);
  }
}
