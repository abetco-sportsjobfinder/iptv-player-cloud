// PRISM TV - COMPAT SHIM. The Settings UI (Profile → My TV sources) was built
// against this flat module; the real engine now lives in js/sources/
// (adapters, per-device store, Xtream/OTA/TVE). Everything here delegates.
// New code: import from './sources/index.js', never from here.

import { db } from './api.js';
import { emit } from './state.js';
import { initSources, getConfigs, upsert, removeConfig, refreshIntoDb, makeDraft } from './sources/index.js';

let readyPromise = null;
async function ensure() {
  if (!readyPromise) readyPromise = initSources();
  await readyPromise;
}

// Legacy shape: {id,name,url} m3u entries only (that is all the UI creates).
export async function fetchSources() {
  await ensure();
  return getConfigs()
    .filter(c => c.type === 'm3u')
    .map(({ id, name, url }) => ({ id, name, url }));
}

// Replace the m3u set while preserving other adapter configs untouched.
export async function saveSources(list) {
  await ensure();
  const keep = new Set(list.map(e => e.id));
  for (const c of getConfigs()) {
    if (c.type === 'm3u' && !keep.has(c.id)) removeConfig(c.id);
  }
  for (const e of list) {
    const existing = getConfigs().find(c => c.id === e.id && c.type === 'm3u');
    upsert({ ...(existing || makeDraft('m3u')), id: e.id, type: 'm3u', name: e.name || 'My playlist', url: e.url, enabled: true });
  }
  return true;
}

// Re-fetch + re-merge everything enabled (idempotent; purges stale first).
export async function mergeSources(_entries) {
  await ensure();
  return refreshIntoDb();
}

export function removeSourceChannels(sourceKey) {
  const srcKey = String(sourceKey).replace(/^my_/, 'src_');
  const prefixes = [String(sourceKey) + '_', srcKey + '_'];
  db.channels = db.channels.filter(c =>
    !prefixes.some(p => String(c.source).startsWith(p) || String(c.id).startsWith(p)));
  for (const [chId, list] of [...db.streamsByChannel]) {
    const filtered = list.filter(s => !prefixes.some(p => String(s.channelId).startsWith(p)));
    if (filtered.length) db.streamsByChannel.set(chId, filtered);
    else db.streamsByChannel.delete(chId);
  }
  emit();
}

export function myChannels() {
  return db.channels.filter(c => typeof c.source === 'string' &&
    (c.source.startsWith('my_') || String(c.source).startsWith('src_m3u')));
}
