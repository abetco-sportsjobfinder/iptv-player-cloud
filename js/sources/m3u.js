// PRISM TV - Priority A adapter: owner-provided M3U playlists and Xtream-Codes
// provider lines. This is the legitimate path to ESPN / NFL Network / regional
// sports tiers: the channels come from a line the OWNER already pays for.
//
// Config (m3u):     { url, epgUrl? }
// Config (xtream):  { host, username, password }
// Secrets live per-device in KV (dev:{uuid}:sources) — single-user deployment;
// see SOURCES doc for the plaintext-storage caveat before sharing anything.

import { registerSource, normalizeChannel, slug, assertPlayableUrl } from './adapter.js';
import { fetchT, parseM3UText } from '../api.js';

function host(cfg) {
  return String(cfg.host || '').trim().replace(/\/+$/, '');
}

// ---- M3U playlist -------------------------------------------------------
registerSource({
  id: 'm3u',
  name: 'My Playlist (M3U link)',
  type: 'm3u',
  auth: 'm3u',
  configSchema: { url: 'playlist URL (.m3u/.m3u8)', epgUrl: 'optional guide URL (stored; guide UI not built yet)' },

  async test(cfg) {
    if (!cfg?.url) return { ok: false, msg: 'Playlist URL required' };
    try {
      const text = await (await fetchT(cfg.url, {}, 2)).text();
      const good = text.trimStart().startsWith('#EXTM3U');
      const n = (text.match(/#EXTINF/g) || []).length;
      return { ok: good, msg: good ? `Valid playlist — ${n.toLocaleString()} entries` : 'That address did not return an M3U playlist' };
    } catch (e) {
      return { ok: false, msg: `Could not load playlist: ${e.message}` };
    }
  },

  async fetchChannels(cfg) {
    const sid = cfg.id;
    const text = await (await fetchT(cfg.url)).text();
    // Parse with a throwaway source tag, then re-key into the src_ namespace
    // with per-instance dedupe so two entries named "ESPN" never collide.
    const parsed = parseM3UText(text, '__tmp__');
    const out = { channels: [], streams: [] };
    const count = new Map();
    const idMap = new Map();
    for (const c of parsed.channels) {
      const base = slug(c.name);
      const n = count.get(base) || 0;
      count.set(base, n + 1);
      const nid = n ? `${base}-${n + 1}` : base;
      idMap.set(c.id, nid);
      out.channels.push(normalizeChannel(sid, nid, {
        name: c.name,
        country: c.country,
        categories: c.categories.map(x => x.toLowerCase()),
        logo: c.logo,
      }));
    }
    for (const s of parsed.streams) {
      const nid = idMap.get(s.channelId);
      if (!nid) continue;
      if (!/^https?:\/\//i.test(s.url)) continue;
      out.streams.push({ channelId: `src_${sid}_${nid}`, url: s.url });
    }
    return out;
  },

  getPlayUrl(_cfg) {
    throw new Error('M3U playback resolves through stored streams');
  },
});

// ---- Xtream Codes provider line -----------------------------------------
registerSource({
  id: 'xtream',
  name: 'Provider login (Xtream Codes)',
  type: 'xtream',
  auth: 'xtream',
  configSchema: { host: 'http://provider-host:port', username: 'string', password: 'string' },

  apiUrl(cfg, action = '') {
    return `${host(cfg)}/player_api.php?username=${encodeURIComponent(cfg.username)}&password=${encodeURIComponent(cfg.password)}${action}`;
  },

  async test(cfg) {
    if (!host(cfg) || !cfg.username || !cfg.password) return { ok: false, msg: 'Host, username and password required' };
    try {
      const j = await (await fetchT(this.apiUrl(cfg), {}, 2)).json();
      const u = j?.user_info;
      if (!u) return { ok: false, msg: 'Not an Xtream Codes endpoint' };
      const active = String(u.status || '').toLowerCase() === 'active' || Number(u.auth) === 0;
      if (!active) return { ok: false, msg: `Line says status="${u.status || u.auth}" — check your provider` };
      const exp = u.exp_date ? new Date(Number(u.exp_date) * 1000).toLocaleDateString() : 'no expiry';
      const conns = u.max_connections ? ` · ${u.max_connections} device${u.max_connections > 1 ? 's' : ''}` : '';
      return { ok: true, msg: `Active until ${exp}${conns}` };
    } catch (e) {
      return { ok: false, msg: `Login failed: ${e.message}` };
    }
  },

  async fetchChannels(cfg) {
    const sid = cfg.id;
    const h = host(cfg);
    const cats = await (await fetchT(this.apiUrl(cfg, '&action=get_live_categories'))).json().catch(() => []);
    const catName = new Map((Array.isArray(cats) ? cats : []).map(c => [String(c.category_id), String(c.category_name || '').toLowerCase()]));
    const list = await (await fetchT(this.apiUrl(cfg, '&action=get_live_streams'))).json();

    const out = { channels: [], streams: [] };
    for (const s of (Array.isArray(list) ? list : [])) {
      const num = s.num || s.stream_id;
      if (!s.name || !num) continue;
      const nid = `${slug(s.name)}-${num}`;
      const cat = catName.get(String(s.category_id));
      out.channels.push(normalizeChannel(sid, nid, {
        name: s.name,
        categories: cat ? [cat] : [],
        logo: (s.stream_icon || '').replace(/^http:\/\//i, 'https://'),
        country: '',
      }));
      const cid = `src_${sid}_${nid}`;
      // Two transport spellings exist across panels; emit both — the player's
      // failover tries them in order. Credentials are part of the URL by
      // design of this protocol; acceptable only in this personal deployment.
      out.streams.push({ channelId: cid, url: assertPlayableUrl(`${h}/hls/${cfg.username}/${cfg.password}/${s.stream_id}.m3u8`) });
      out.streams.push({ channelId: cid, url: assertPlayableUrl(`${h}/live/${cfg.username}/${cfg.password}/${s.stream_id}.m3u8`) });
    }
    return out;
  },

  getPlayUrl(cfg, channelId) {
    const streamId = String(channelId).split('-').pop();
    return assertPlayableUrl(`${host(cfg)}/live/${cfg.username}/${cfg.password}/${streamId}.m3u8`);
  },
});
