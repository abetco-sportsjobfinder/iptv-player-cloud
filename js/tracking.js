// PRISM TV - stream status tracking: localStorage TTL cache + background tester + KV sync
import { db, PROXY } from './api.js';
import { emit } from './state.js';

const WORKING_TTL = 7 * 24 * 60 * 60 * 1000;
const DEAD_TTL = 3 * 24 * 60 * 60 * 1000;

export const tracking = {
  status: new Map(),          // id -> {status, time, reason}
  dirty: false,
  testing: new Set(),
};

export function loadStatusCache() {
  try {
    tracking.status = new Map(Object.entries(JSON.parse(localStorage.getItem('prism_status') || '{}')));
  } catch { tracking.status = new Map(); }
}

function saveStatusCache() {
  try { localStorage.setItem('prism_status', JSON.stringify(Object.fromEntries(tracking.status))); } catch { /* quota */ }
}

export function getStatus(id) {
  const e = tracking.status.get(id);
  if (!e) return 'unknown';
  if (e.status === 'testing') return 'unknown';
  const age = Date.now() - (e.time || 0);
  if (e.status === 'dead') return age < DEAD_TTL ? 'dead' : 'unknown';
  return age < WORKING_TTL ? e.status : 'unknown';
}

export function getStatusReason(id) {
  return tracking.status.get(id)?.reason || '';
}

let saveTimer = null;
let flushTimer = null;

export function setStatus(id, status, reason) {
  const prev = tracking.status.get(id);
  tracking.status.set(id, { status, time: Date.now(), reason: reason || prev?.reason || '' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStatusCache, 1000);
  tracking.dirty = true;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushStatusToKV, 60000);
  emit();   // cards re-paint their dot
}

async function pullStatusFromKV() {
  try {
    const res = await fetch(`${PROXY}/api/status`, { headers: { 'X-Device-Id': deviceId() } });
    if (!res.ok) return;
    const data = await res.json();
    for (const [id, entry] of Object.entries(data)) {
      const local = tracking.status.get(id);
      if (!local || (entry.time || 0) > (local.time || 0)) {
        tracking.status.set(id, { status: entry.status, time: entry.time || Date.now(), reason: entry.reason || '' });
      }
    }
    emit();
  } catch { /* offline ok */ }
}

async function flushStatusToKV() {
  if (!tracking.dirty) return;
  tracking.dirty = false;
  // Enterprise audit P1-C: bounded backoff retry instead of silent single-shot.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${PROXY}/api/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() },
        body: JSON.stringify(Object.fromEntries(tracking.status)),
      });
      if (res.ok) return;
      if (res.status === 400 || res.status === 413) return; // unrecoverable: drop batch
    } catch { /* network */ }
    await new Promise(r => setTimeout(r, 1000 * Math.pow(4, attempt)));
  }
  tracking.dirty = true; // give up this round; next setStatus re-arms flush
}

// ---------- background tester ----------
let queue = [];
let running = false;

export function startBackgroundTesting() {
  queue = db.channels
    .filter(c => c.rank < 2 && getStatus(c.id) === 'unknown')
    .map(c => c.id);
  runQueue();
}

async function runQueue() {
  if (running) return;
  running = true;
  while (queue.length) {
    const batch = queue.splice(0, 2);
    await Promise.all(batch.map(testStream));
    await new Promise(r => setTimeout(r, 1500));
  }
  running = false;
}

export async function testStream(id) {
  if (tracking.testing.has(id)) return;
  tracking.testing.add(id);
  try {
    const streams = db.streamsByChannel.get(id) || [];
    if (!streams.length) { setStatus(id, 'dead', 'no_streams'); return; }
    for (const s of streams.slice(0, 3)) {
      // LAN-direct streams (HDHomeRun): the worker cannot reach them and the
      // browser cannot probe cross-origin either. Assume alive; playback is
      // the only real test, and failover still applies.
      if (s.direct) { setStatus(id, 'working', 'antenna_direct'); return; }
      if (!/^https?:\/\//.test(s.url) || s.url.includes('youtube.com') || s.url.includes('.mpd')) continue;
      const proxied = `${PROXY}?u=${encodeURIComponent(s.url)}`;
      const isPlaylist = /\.m3u8?(\?.*)?$/i.test(s.url);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15000);
          let ok = false, reason = '';
          if (isPlaylist) {
            const res = await fetch(proxied, { signal: ctrl.signal });
            if (res.ok) {
              const text = await res.text();
              ok = text.trimStart().startsWith('#EXTM3U');
              reason = ok ? 'm3u8_ok' : 'not_m3u8';
            } else reason = `http_${res.status}`;
          } else {
            let res = await fetch(proxied, { method: 'HEAD', signal: ctrl.signal });
            if (res.status === 405 || res.status === 403) {
              res = await fetch(proxied, { headers: { Range: 'bytes=0-1023' }, signal: ctrl.signal });
              reason = res.ok || res.status === 206 ? 'range_ok' : `http_${res.status}`;
            } else {
              reason = res.ok || res.status === 206 ? 'head_ok' : `http_${res.status}`;
            }
            ok = res.ok || res.status === 206;
          }
          clearTimeout(t);
          if (ok) { setStatus(id, 'working', reason); return; }
          setStatus(id, 'dead', reason);
        } catch { setStatus(id, 'dead', 'timeout'); }
      }
    }
  } finally {
    tracking.testing.delete(id);
  }
}

export async function initTracking() {
  loadStatusCache();
  await pullStatusFromKV();
}

// Merge probe-pipeline results (id/latency/checked) into status map.
// Never overrides newer local entries; single emit at end.
export function mergeWorkingSet(entries) {
  let changed = false;
  for (const e of entries) {
    if (!e.id || !e.checked) continue;
    const local = tracking.status.get(e.id);
    if (!local || (local.time || 0) < e.checked) {
      tracking.status.set(e.id, { status: 'working', time: e.checked, reason: 'probe_ok' });
      changed = true;
    }
  }
  if (changed) { saveStatusCache(); emit(); }
}

export function lastChecked(id) {
  return tracking.status.get(id)?.time || 0;
}

// Device identity (enterprise audit P1-A): stable UUID minted on first run.
export function deviceId() {
  let d = localStorage.getItem('prismDeviceId');
  if (!d) {
    d = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    try { localStorage.setItem('prismDeviceId', d); } catch { /* private mode */ }
  }
  return d;
}
