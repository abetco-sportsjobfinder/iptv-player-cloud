// PRISM TV - data loading: iptv-org API + Free-TV M3U, blocklist, indexes
import { state } from './state.js';

const API = 'https://iptv-org.github.io/api';
export const PROXY = 'https://iptv-stream-proxy.abetscrape.workers.dev';
export const CUSTOM_LOGO_URL = ''; // ABET logo with spinning chip

// Enterprise audit P1-C: timeouts + bounded retry for all upstream data loads.
async function fetchT(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    try {
      const res = await fetch(url, { ...opts, signal: ac.signal });
      clearTimeout(t);
      if (res.ok || res.status < 500) return res;
      lastErr = new Error('HTTP ' + res.status);
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  throw lastErr || new Error('fetch failed');
}

const SOURCES = [
  { key: 'iptvorg', type: 'api' },
  { key: 'freetv', type: 'm3u', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8' },
];

export const db = {
  channels: [],
  byId: new Map(),
  streamsByChannel: new Map(),
  blocklist: new Map(),      // channelId -> reason
};

// CDN reputation (carried over from proven v1)
export const GOOD_CDNS = ['cloudfront.net', 'akamaized.net', 'akamaihd.net', 'amagi.tv', 'wurl.tv', 'tubi.video', 'pb-', 'aegis-cloudfront', 'airspace-cdn', 'fastly.net', 'pluto.tv'];
export const BAD_CDNS = ['jmp2.uk', 'messi.damitv.st'];

export async function loadAll(onProgress) {
  onProgress?.('Loading channel index…');
  const results = await Promise.all(SOURCES.map(s => s.type === 'api' ? loadIptvOrg() : loadM3U(s.url)));
  const channels = results.flatMap(r => r.channels);
  const streams = results.flatMap(r => r.streams);

  onProgress?.('Indexing streams…');
  for (const c of channels) db.byId.set(c.id, c);

  for (const s of streams) {
    if (!s.url || !/^https?:\/\//.test(s.url)) continue;
    if (!db.streamsByChannel.has(s.channelId)) db.streamsByChannel.set(s.channelId, []);
    db.streamsByChannel.get(s.channelId).push(s);
  }

  // SQUARE-ONE (measured): 30,751 of 40,715 channels have zero streams.
  // They are metadata noise — drop them from the working catalog entirely.
  const streamable = channels.filter(c => db.streamsByChannel.has(c.id));

  // rank + reliability per channel
  for (const c of streamable) {
    const list = db.streamsByChannel.get(c.id) || [];
    let rank = 2;
    if (list.some(s => !s.url.includes('youtube.com') && !s.url.includes('.mpd'))) rank = 1;
    c.rank = rank;
    c.reliable = list.some(s =>
      GOOD_CDNS.some(cdn => s.url.includes(cdn)) && !BAD_CDNS.some(bad => s.url.includes(bad)));
    if (!c.provider) c.provider = inferProvider(c.id);
  }

  db.channels = streamable;

  // Logos: channels.json ships none; Free-TV tvg-logos are kept (https-upgraded).
  // Cards without a logo render their country flag (see grid.js onerror chain).
  state.ready = true;
}

// Working set from the worker's rolling probe pipeline.
export async function loadWorkingSet() {
  try {
    const res = await fetch(`${PROXY}/shortlist`);
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j.channels) ? j.channels : [];
  } catch { return []; }
}

async function loadIptvOrg() {
  const [chRes, stRes, blRes] = await Promise.all([
    fetchT(`${API}/channels.json`), fetchT(`${API}/streams.json`), fetchT(`${API}/blocklist.json`),
  ]);
  if (!chRes.ok || !stRes.ok || !blRes.ok) throw new Error('iptv-org API unreachable');
  const [channelsData, streamsData, blocklistData] = await Promise.all([chRes.json(), stRes.json(), blRes.json()]);
  for (const b of blocklistData) db.blocklist.set(b.channel, b.reason || 'blocked');
  return {
    channels: channelsData.map(c => ({
      id: c.id, name: c.name, country: c.country || '', categories: c.categories || [],
      logo: c.logo || '', source: 'iptvorg', altNames: [], provider: '', blocked: false,
    })),
    streams: streamsData.map(s => ({ channelId: s.channel, url: s.url })),
  };
}

async function loadM3U(url) {
  const res = await fetchT(url);
  const text = await res.text();
  const channels = [], streams = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      const attrs = parseExtinf(line);
      const name = attrs.name || 'Unknown';
      current = {
        id: attrs['tvg-id'] || ('ftv_' + name.replace(/[^a-z0-9]/gi, '').toLowerCase()),
        name,
        country: (attrs['tvg-country'] || '').slice(0, 2),
        categories: attrs['group-title'] ? attrs['group-title'].split(/[;,|]/).map(t => t.trim()).filter(Boolean) : [],
        logo: (attrs['tvg-logo'] || '').replace(/^http:\/\//i, 'https://'),
        source: 'freetv', altNames: [], provider: '', blocked: false,
      };
      channels.push(current);
    } else if (line && !line.startsWith('#') && current) {
      streams.push({ channelId: current.id, url: line });
    }
  }
  return { channels, streams };
}

function parseExtinf(line) {
  const m = line.match(/#EXTINF:-?\d+(?:\s+(.*))?,(.*)/);
  if (!m) return { name: 'Unknown', attrs: {} };
  const attrs = {};
  const re = /([\w-]+)="([^"]*)"/g; let a;
  while ((a = re.exec(m[1] || ''))) attrs[a[1]] = a[2];
  attrs.name = (m[2] || '').trim();
  return attrs;
}

function inferProvider(id) {
  for (const s of db.streamsByChannel.get(id) || []) {
    try {
      const h = new URL(s.url).hostname;
      if (h.includes('pluto.tv')) return 'Pluto TV';
      if (h.includes('amagi.tv')) return h.includes('samsung') ? 'Samsung TV Plus' : 'Amagi';
      if (h.includes('wurl.tv')) return 'Wurl';
      if (h.includes('tubi.video')) return 'Tubi';
      if (h.includes('xumo')) return 'Xumo';
      if (h.includes('plex')) return 'Plex';
      if (h.includes('roku')) return 'Roku';
    } catch { /* ignore */ }
  }
  return '';
}

export function streamCandidates(id) {
  const all = (db.streamsByChannel.get(id) || []).filter(s =>
    s.url && /^https?:\/\//.test(s.url) && !s.url.includes('youtube.com') && !s.url.includes('.mpd'));
  const clean = all.filter(s => !BAD_CDNS.some(bad => s.url.includes(bad)));
  const https = clean.filter(s => s.url.startsWith('https://'));
  const pool = https.length ? https : clean;
  const good = pool.filter(s => GOOD_CDNS.some(cdn => s.url.includes(cdn)));
  return [...good, ...pool.filter(s => !good.includes(s))];
}
