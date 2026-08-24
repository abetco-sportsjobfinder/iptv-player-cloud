// PRISM TV - user-supplied sources: bring-your-own M3U playlists (per-device).
// Channels from custom sources are namespaced (source:'my_<id>') and surfaced
// under a dedicated "My Channels" tree section — isolated from the catalog.

import { db, PROXY } from './api.js';
import { deviceId } from './tracking.js';
import { esc } from './state.js';

export async function fetchSources() {
  try {
    const r = await fetch(`${PROXY}/api/sources`, { headers: { 'X-Device-Id': deviceId() } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.sources) ? j.sources : [];
  } catch { return []; }
}

export async function saveSources(list) {
  const r = await fetch(`${PROXY}/api/sources`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() },
    body: JSON.stringify({ sources: list }),
  });
  return r.ok;
}

// Parse an M3U text into our channel shape, namespaced to one source.
function parseM3U(text, srcId) {
  const channels = [], streams = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      const m = line.match(/#EXTINF:-?\d+(?:\s+(.*))?,(.*)/);
      const attrs = {};
      if (m) {
        const re = /([\w-]+)="([^"]*)"/g;
        let a;
        while ((a = re.exec(m[1] || ''))) attrs[a[1]] = a[2];
        attrs.name = (m[2] || '').trim();
      }
      const name = attrs.name || 'Unknown';
      current = {
        id: `my_${srcId}_${(attrs['tvg-id'] || name).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 60)}`,
        name,
        country: (attrs['tvg-country'] || '').slice(0, 2),
        categories: attrs['group-title'] ? attrs['group-title'].split(/[;,|]/).map(t => t.trim()).filter(Boolean) : ['custom'],
        logo: (attrs['tvg-logo'] || '').replace(/^http:\/\//i, 'https://'),
        favicon: '',
        source: `my_${srcId}`,
        altNames: [], provider: '', blocked: false,
      };
      channels.push(current);
    } else if (line && !line.startsWith('#') && current) {
      streams.push({ channelId: current.id, url: line });
    }
  }
  return { channels, streams };
}

// Fetch + merge every enabled source into the live db. Idempotent per source id.
export async function mergeSources(sources) {
  for (const src of sources) {
    if (!src.url || !/^https:\/\//i.test(src.url)) continue;
    try {
      const res = await fetch(src.url);
      if (!res.ok) continue;
      const text = await res.text();
      // Strip previous incarnation of this source before re-merging.
      removeSourceChannels(`my_${src.id}`);
      const { channels, streams } = parseM3U(text, src.id);
      for (const c of channels) {
        db.byId.set(c.id, c);
        db.channels.push(c);
      }
      for (const s of streams) {
        if (!s.url || !/^https?:\/\//.test(s.url)) continue;
        if (!db.streamsByChannel.has(s.channelId)) db.streamsByChannel.set(s.channelId, []);
        db.streamsByChannel.get(s.channelId).push(s);
      }
    } catch (e) { /* skip unreachable source */ }
  }
}

export function removeSourceChannels(sourceKey) {
  db.channels = db.channels.filter(c => c.source !== sourceKey);
  for (const [chId, list] of [...db.streamsByChannel]) {
    const filtered = list.filter(s => !String(s.channelId).startsWith(sourceKey + '_'));
    if (!filtered.length) db.streamsByChannel.delete(chId);
    else db.streamsByChannel.set(chId, filtered);
  }
}

export function myChannels() {
  return db.channels.filter(c => typeof c.source === 'string' && c.source.startsWith('my_'));
}
