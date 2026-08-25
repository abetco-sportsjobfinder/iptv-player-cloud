// PRISM TV - per-device persistence for My Sources configs.
// Mirrors the favorites pattern exactly: localStorage mirror + debounced PUT
// to dev:{uuid}:sources via the worker, bounded retry, offline-tolerant.

import { PROXY } from '../api.js';
import { deviceId } from '../tracking.js';

const LS_KEY = 'prism_sources';
let putTimer = null;

export function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}

function writeLocal(configs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(configs)); } catch { /* quota */ }
}

export async function pullRemote() {
  try {
    const res = await fetch(`${PROXY}/api/sources`, { headers: { 'X-Device-Id': deviceId() } });
    if (!res.ok) return readLocal();
    const j = await res.json();
    const arr = Array.isArray(j?.sources) ? j.sources : [];
    writeLocal(arr);
    return arr;
  } catch {
    return readLocal(); // offline: keep working from the mirror
  }
}

export function queuePush(configs) {
  writeLocal(configs);
  clearTimeout(putTimer);
  putTimer = setTimeout(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${PROXY}/api/sources`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() },
          body: JSON.stringify({ sources: configs }),
        });
        if (res.ok || res.status === 400 || res.status === 413) return;
      } catch { /* network */ }
      await new Promise(r => setTimeout(r, 1000 * Math.pow(4, attempt)));
    }
  }, 1200);
}

// Fresh config instance with a unique id (namespace root for src_<id>_ channels).
export function newInstance(type, label) {
  return { id: `${type}-${Date.now().toString(36)}`, type, name: label || type, enabled: true };
}
