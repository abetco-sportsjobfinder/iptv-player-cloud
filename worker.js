// Ensure every response — success, error, preflight, or missing-param —
// carries CORS headers, or the browser blocks it before reading the body.
function withCors(headers) {
  const h = new Headers(headers || {});
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Range, Origin, Referer, User-Agent, X-Device-Id');
  return h;
}

// ---------- P0-A: per-device identity ----------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function getDeviceId(request) {
  const id = request.headers.get('X-Device-Id') || '';
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

// ---------- P0-B: nightly shortlist builder ----------
const STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const SAMPLE_SIZE = 40;
const STALE_MS = 23 * 60 * 60 * 1000;

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('fetch ' + url + ' -> ' + r.status);
  return r.json();
}

// Date-seeded deterministic sample so coverage rotates predictably day to day.
function seededSample(streams, n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const arr = streams.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

async function probeChannel(stream) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const resp = await fetch(stream.url, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-2048', 'User-Agent': 'prism-probe/1.0' },
      signal: ac.signal,
      redirect: 'follow',
    });
    try { await resp.body?.cancel(); } catch {}
    clearTimeout(timer);
    const ct = resp.headers.get('content-type') || '';
    const ok = resp.status >= 200 && resp.status < 400 &&
      (/mpegurl|video|mp2t|mp4|octet-stream/i.test(ct) || resp.status === 206 || !ct);
    return { id: stream.channel, url: stream.url, ok, latency: Date.now() - t0 };
  } catch (e) {
    clearTimeout(timer);
    return { id: stream.channel, url: stream.url, ok: false, latency: Date.now() - t0, error: e.message };
  }
}

async function runProbeBatch(streams) {
  const out = [];
  for (let i = 0; i < streams.length; i += 3) {
    const batch = streams.slice(i, i + 3).map(probeChannel);
    out.push(...await Promise.all(batch));
  }
  return out;
}

async function buildShortlist(env) {
  const all = await fetchJson(STREAMS_URL);
  const usable = all.filter(s => s.url && /^https?:\/\//.test(s.url) &&
    !/youtube\.com|youtu\.be|\.mpd(\?|$)/i.test(s.url));
  const daySeed = Math.floor(Date.now() / 86400000);
  const sample = seededSample(usable, SAMPLE_SIZE, daySeed);
  const results = await runProbeBatch(sample);
  const working = results.filter(r => r.ok)
    .map(r => ({ id: r.id, latency: r.latency }))
    .sort((a, b) => a.latency - b.latency);
  const payload = JSON.stringify({ ts: new Date().toISOString(), sampled: sample.length, channels: working });
  await env.STATUS.put('shortlist:v1', payload);
  await env.STATUS.put('probe:lastRun', JSON.stringify({ ts: Date.now(), count: sample.length }));
  return payload;
}

async function getShortlist(env) {
  let cur = null;
  try { cur = await env.STATUS.get('shortlist:v1'); } catch (e) {}
  if (cur) {
    try {
      const parsed = JSON.parse(cur);
      if (Date.now() - Date.parse(parsed.ts) < STALE_MS) return cur;
    } catch (e) {}
  }
  let lastRun = 0;
  try { lastRun = (JSON.parse(await env.STATUS.get('probe:lastRun')) || {}).ts || 0; } catch (e) {}
  // Guard against write storms: rebuild at most once per stale window globally.
  if (Date.now() - lastRun < STALE_MS) {
    return cur || JSON.stringify({ ts: null, channels: [], note: 'build in progress' });
  }
  await env.STATUS.put('probe:lastRun', JSON.stringify({ ts: Date.now(), count: 0 }));
  try {
    return await buildShortlist(env);
  } catch (e) {
    return cur || JSON.stringify({ ts: null, channels: [], error: e.message });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    console.log('[proxy] method=%s path=%s', request.method, url.pathname);

    // 0) Stream status log. With X-Device-Id: device-scoped key (legacy fallback on read).
    if (url.pathname === '/api/status') {
      const dev = getDeviceId(request);
      const key = dev ? `dev:${dev}:status` : 'status';
      if (request.method === 'GET') {
        let val = {};
        try { val = await env.STATUS.get(key, 'json') || {}; } catch (e) {}
        if (dev && val && !Object.keys(val).length) {
          try { val = await env.STATUS.get('status', 'json') || {}; } catch (e) {}
        }
        return new Response(JSON.stringify(val), {
          status: 200,
          headers: withCors({ 'Content-Type': 'application/json' }),
        });
      }
      if (request.method === 'PUT') {
        let body = {};
        try { body = await request.json(); } catch (e) { }
        await env.STATUS.put(key, JSON.stringify(body));
        return new Response('ok', { status: 200, headers: withCors() });
      }
      return new Response('method not allowed', { status: 405, headers: withCors() });
    }

    // 2) Favorites cache. Device-scoped when X-Device-Id present; legacy shared otherwise.
    if (url.pathname === '/api/favorites') {
      const dev = getDeviceId(request);
      const key = dev ? `dev:${dev}:favorites` : 'favorites';
      if (request.method === 'GET') {
        let val = {};
        try { val = await env.STATUS.get(key, 'json') || {}; } catch (e) {}
        if (dev && val && !Object.keys(val).length) {
          try { val = await env.STATUS.get('favorites', 'json') || {}; } catch (e) {}
        }
        return new Response(JSON.stringify(val), {
          status: 200,
          headers: withCors({ 'Content-Type': 'application/json' }),
        });
      }
      if (request.method === 'PUT') {
        let body = {};
        try { body = await request.json(); } catch (e) { }
        await env.STATUS.put(key, JSON.stringify(body));
        return new Response('ok', { status: 200, headers: withCors() });
      }
      return new Response('method not allowed', { status: 405, headers: withCors() });
    }

    // 2b) Nightly-probed "confirmed working" shortlist (P0-B). Rebuilds lazily when stale.
    if (url.pathname === '/shortlist' && request.method === 'GET') {
      const payload = await getShortlist(env);
      return new Response(payload, {
        status: 200,
        headers: withCors({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }),
      });
    }

    // 3) Phone‑as‑remote WebSocket endpoint.
    if (url.pathname === '/remote' && request.method === 'GET' && request.headers.get('upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      request.acceptWebSocket(pair[0]);
      pair[1].addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[remote]', data);
        } catch {}
      });
      pair[1].addEventListener('close', () => console.log('[remote] closed'));
      return new Response(null, { status: 101 });
    }

    // 1) Preflight must be answered BEFORE any upstream fetch.
    if (request.method === 'OPTIONS') {
      console.log('[proxy] OPTIONS preflight -> 204');
      return new Response(null, { status: 204, headers: withCors() });
    }

    const target = url.searchParams.get('u');
    if (!target) {
      console.log('[proxy] missing u param -> 400');
      return new Response('Missing u parameter', {
        status: 400,
        headers: withCors({ 'Content-Type': 'text/plain' }),
      });
    }
    console.log('[proxy] target=%s', target);

    const referer = url.searchParams.get('r') || '';
    const ua = url.searchParams.get('ua') ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
    const origin = url.origin; // this worker's own origin

    const upstreamHeaders = {
      'Referer': referer,
      'User-Agent': ua,
    };
    const range = request.headers.get('Range');
    if (range) upstreamHeaders['Range'] = range;

    try {
      const resp = await fetch(target, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
      });
      console.log('[proxy] upstream status=%s type=%s', resp.status, resp.headers.get('content-type'));

      const headers = new Headers(resp.headers);
      headers.set('Cache-Control', 'no-store');

      const isPlaylist = /\.m3u8(\?.*)?$/i.test(target) ||
        /\.m3u(\?.*)?$/i.test(target) ||
        (resp.headers.get('content-type') || '').includes('mpegurl');

      if (isPlaylist) {
        // Read the body once; reuse `text` for both rewrite and fallback.
        const text = await resp.text();
        let body = text;
        try {
          if (text.trimStart().startsWith('#EXTM3U')) {
            body = rewritePlaylist(text, target, origin, ua, referer);
          }
        } catch (rewriteErr) {
          // Never crash on a malformed playlist — serve the original with CORS.
          console.log('[proxy] rewrite failed, serving original: %s', rewriteErr.message);
          body = text;
        }
        headers.set('Content-Type', 'application/vnd.apple.mpegurl');
        return new Response(body, { status: resp.status, headers: withCors(headers) });
      }

      return new Response(resp.body, { status: resp.status, headers: withCors(headers) });
    } catch (e) {
      // Upstream fetch failed (blocked port, network, timeout). The 502 MUST
      // still carry ACAO, or the browser throws a CORS error and hides the body.
      console.log('[proxy] upstream fetch error: %s', e.message);
      return new Response('Proxy error: ' + e.message, {
        status: 502,
        headers: withCors({ 'Content-Type': 'text/plain' }),
      });
    }
  },

  // P0-B: nightly 03:00 UTC probe run (wrangler.toml [triggers]).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildShortlist(env).catch(e => console.log('[cron] shortlist build failed:', e.message)));
  }
};

// Build a self-referential proxied URL for a segment / nested playlist.
function selfProxy(origin, targetAbs, ua, referer) {
  const u = new URL(origin + '/');
  u.searchParams.set('u', targetAbs);
  if (ua) u.searchParams.set('ua', ua);
  if (referer) u.searchParams.set('r', referer);
  return u.toString();
}

function makeAbsolute(u, base) {
  try {
    return new URL(u, base).href;
  } catch {
    return u;
  }
}

function rewritePlaylist(text, baseUrl, origin, ua, referer) {
  const lines = text.split(/\r?\n/);
  return lines.map(line => {
    const trimmed = line.trim();
    if (trimmed === '') return line;
    // Tag attributes like URI="..." (EXT-X-MEDIA, EXT-X-KEY, EXT-X-I-FRAME-STREAM-INF, ...)
    if (trimmed.startsWith('#') && trimmed.includes('URI=')) {
      return line.replace(/URI="([^"]*)"/g, (m, inner) => {
        const abs = makeAbsolute(inner, baseUrl);
        return `URI="${selfProxy(origin, abs, ua, referer)}"`;
      });
    }
    // Bare URI line: a segment (.ts) or a nested playlist (.m3u8).
    if (!trimmed.startsWith('#')) {
      const abs = makeAbsolute(trimmed, baseUrl);
      return selfProxy(origin, abs, ua, referer);
    }
    return line;
  }).join('\n');
}
