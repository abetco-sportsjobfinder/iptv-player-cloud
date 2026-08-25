// PRISM TV - source orchestrator: configs <-> adapters <-> db merge.
// One-directional dependency (api.js never imports sources/*), so main.js
// stays the only place that knows both sides.

import { getSource, listSources } from './adapter.js';
import { pullRemote, queuePush, newInstance } from './store.js';
import { mergeIntoDb, db } from '../api.js';
import { emit } from '../state.js';

import './m3u.js';        // side-effect registration (priority A)
import './hdhomerun.js';  // priority B
import './tve.js';        // priority C scaffold
import './ott.js';        // priority D stub

let CONFIGS = [];

// Legacy entries (pre-adapter flow) were {id,name,url} m3u-only; coerce them.
function normalizeConfig(c) {
  if (c && !c.type && typeof c.url === 'string') return { ...c, type: 'm3u', enabled: c.enabled !== false };
  return c;
}

export async function initSources() {
  CONFIGS = (await pullRemote()).map(normalizeConfig).filter(Boolean);
  return CONFIGS;
}

export function getConfigs() { return CONFIGS.slice(); }

export function makeDraft(type) {
  const ad = getSource(type);
  return newInstance(type, ad?.name || type);
}

export function upsert(cfg) {
  const i = CONFIGS.findIndex(c => c.id === cfg.id);
  if (i >= 0) CONFIGS[i] = cfg; else CONFIGS.push(cfg);
  queuePush(CONFIGS);
  return cfg;
}

export function removeConfig(id) {
  CONFIGS = CONFIGS.filter(c => c.id !== id);
  queuePush(CONFIGS);
  purgeSourceChannels(id);
}

// Drop one source's channels/streams from the live db (idempotent).
function purgeSourceChannels(sourceId) {
  const srcKey = `src_${sourceId}`;
  db.channels = db.channels.filter(c => c.source !== sourceId && !String(c.id).startsWith(srcKey + '_'));
  for (const [chId, list] of [...db.streamsByChannel]) {
    const filtered = list.filter(s => !String(s.channelId).startsWith(srcKey + '_'));
    if (filtered.length) db.streamsByChannel.set(chId, filtered);
    else db.streamsByChannel.delete(chId);
  }
}

export function setEnabled(id, enabled) {
  const c = CONFIGS.find(c => c.id === id);
  if (c) { c.enabled = !!enabled; queuePush(CONFIGS); }
}

async function collectOne(cfg) {
  const ad = getSource(cfg.type);
  if (!ad) return null;
  const r = await ad.fetchChannels(cfg);
  return { channels: r.channels || [], streams: r.streams || [] };
}

export async function testConfig(draft) {
  const ad = getSource(draft.type);
  if (!ad) return { ok: false, msg: 'Unknown source type' };
  try { return await ad.test(draft); }
  catch (e) { return { ok: false, msg: e.message }; }
}

// Fetch every enabled source and fold results into db.* . Returns counts.
// Each source's previous channels are purged first, so editing a playlist
// (removed lines) is reflected immediately — no stale ghosts until reload.
export async function refreshIntoDb(onProgress) {
  let added = 0, streamsAdded = 0;
  for (const cfg of CONFIGS.filter(c => c.enabled !== false)) {
    onProgress?.(`Loading ${cfg.name}…`);
    try {
      purgeSourceChannels(cfg.id);
      const ex = await collectOne(cfg);
      if (!ex) continue;
      mergeIntoDb(ex);
      added += ex.channels.length;
      streamsAdded += ex.streams.length;
    } catch (e) {
      console.warn('[sources]', cfg.id, e.message); // one bad line must not kill boot
    }
  }
  if (added) emit();
  return { added, streamsAdded };
}

export { listSources };
