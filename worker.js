// Ensure every response — success, error, preflight, or missing-param —
// carries CORS headers, or the browser blocks it before reading the body.
function withCors(headers, request) {
  const h = new Headers(headers || {});
  // Restrict credentialed reads/writes to our own frontends; non-browser
  // clients (curl, workers) don't need CORS headers at all.
  const ALLOWED_ORIGINS = [
    'https://iptv-player-pro.pages.dev',
    'https://iptv-player-20g.pages.dev',
  ];
  const origin = request && request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
  }
  h.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Range, Origin, Referer, User-Agent, X-Device-Id');
  return h;
}

// ---------- P0-A: per-device identity ----------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function getDeviceId(request) {
  const id = request.headers.get('X-Device-Id') || '';
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

// ---------- Rate limiting: CF Rate Limiting binding (global) w/ in-isolate fallback ----------
const RL = new Map(); // key -> {count, reset}
function memLimit(key, maxPerMinute) {
  const now = Date.now();
  const e = RL.get(key);
  if (!e || now > e.reset) { RL.set(key, { count: 1, reset: now + 60000 }); return true; }
  e.count++;
  if (RL.size > 5000) RL.clear();
  return e.count <= maxPerMinute;
}
async function rateLimit(env, key, maxPerMinute) {
  if (env.RATE_LIMITER) {
    try { const r = await env.RATE_LIMITER.limit({ key }); return r.success; }
    catch (e) { /* fall through to memory */ }
  }
  return memLimit(key, maxPerMinute);
}

// ---------- Working-set pipeline: rotating probe every cron tick ----------
// Every 5 minutes: probe 40 untested/oldest streams + re-check 10 working ones.
// Maintains a PERSISTENT global working set (survives restarts, merges results).
// Full catalog (~16.8k streams) re-verified about once per day.
const STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const PROBE_BATCH = 40;
const RECHECK_COUNT = 10;
const STALE_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('fetch ' + url + ' -> ' + r.status);
  return r.json();
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
      redirect: 'manual',
    });
    resp.body?.cancel();
    clearTimeout(timer);
    const ct = resp.headers.get('content-type') || '';
    const ok = (resp.status === 206 ||
      (resp.status >= 200 && resp.status < 300 && /mpegurl|video|mp2t|mp4/i.test(ct)));
    return { id: stream.channel, url: stream.url, ok, latency: Date.now() - t0 };
  } catch (e) {
    clearTimeout(timer);
    return { id: stream.channel, url: stream.url, ok: false, latency: Date.now() - t0 };
  }
}

async function runProbeBatch(streams) {
  const out = [];
  for (let i = 0; i < streams.length; i += 3) {
    out.push(...await Promise.all(streams.slice(i, i + 3).map(probeChannel)));
  }
  return out;
}

// Persistent rolling pipeline. KV layout:
//   probe:cursor   number  - rotation index into usable stream list
//   working:v1     {ts, map:{id:{latency,checked}}}
//   shortlist:v1   frontend payload derived from working:v1
async function runPipeline(env) {
  const all = await fetchJson(STREAMS_URL);
  const usable = all.filter(s => s.url && /^https?:\/\//.test(s.url) &&
    !/youtube\.com|youtu\.be|\.mpd(\?|$)/i.test(s.url));

  let cursor = 0;
  try { cursor = JSON.parse(await env.STATUS.get('probe:cursor')) || 0; } catch (e) {}
  let workingMap = {};
  try { workingMap = (JSON.parse(await env.STATUS.get('working:v1')) || {}).map || {}; } catch (e) {}

  // Batch A: next rotating slice of the catalog (cursor wraps).
  const start = ((cursor % usable.length) + usable.length) % usable.length;
  const batchA = usable.slice(start, start + PROBE_BATCH);
  if (start + PROBE_BATCH >= usable.length) batchA.push(...usable.slice(0, (start + PROBE_BATCH) - usable.length));
  const nextCursor = (start + PROBE_BATCH) % usable.length;

  // Batch B: freshness re-checks on a slice of the current working set.
  const workIds = Object.keys(workingMap);
  const recheckIds = [];
  if (workIds.length) {
    const now = Date.now();
    const staleFirst = workIds.sort((a, b) => (workingMap[a].checked || 0) - (workingMap[b].checked || 0));
    for (const id of staleFirst.slice(0, RECHECK_COUNT)) {
      const s = usable.find(u => u.channel === id);
      if (s) recheckIds.push(s);
      if (recheckIds.length >= RECHECK_COUNT) break;
    }
  }

  const byId = new Map(usable.map(u => [u.channel, u]));
  const probed = [
    ...await runProbeBatch(batchA),
    ...await runProbeBatch(recheckIds.map(id => ({ channel: id, url: byId.get(id)?.url })).filter(s => s && s.url)),
  ];

  const checkedNow = Date.now();
  let confirmed = 0, lost = 0;
  for (const r of probed) {
    if (r.ok) { workingMap[r.id] = { latency: r.latency, checked: checkedNow }; confirmed++; }
    else if (workingMap[r.id]) { delete workingMap[r.id]; lost++; }
  }

  const ts = new Date().toISOString();
  await env.STATUS.put('working:v1', JSON.stringify({ ts, map: workingMap }));
  await env.STATUS.put('probe:cursor', JSON.stringify(nextCursor));
  await env.STATUS.put('probe:lastRun', JSON.stringify({ ts: checkedNow, count: probed.length }));

  const channels = Object.entries(workingMap)
    .map(([id, v]) => ({ id, latency: v.latency, checked: v.checked }))
    .sort((a, b) => b.checked - a.checked);
  const payload = JSON.stringify({
    ts, sampled: probed.length, confirmed, lost,
    total_working: channels.length, cursor: nextCursor, channels,
  });
  await env.STATUS.put('shortlist:v1', payload);
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
  const building = await env.STATUS.get('probe:building');
  if (building) return cur || JSON.stringify({ ts: null, channels: [], note: 'build in progress' });
  await env.STATUS.put('probe:building', '1', { expirationTtl: 240 });
  try {
    const built = await runPipeline(env);
    await env.STATUS.delete('probe:building');
    return built;
  } catch (e) {
    await env.STATUS.delete('probe:building');
    return cur || JSON.stringify({ ts: null, channels: [], error: e.message });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    console.log('[proxy] method=%s path=%s', request.method, url.pathname);

    // CORS preflight MUST be answered before any route matching — otherwise
    // OPTIONS falls into a route's method-not-allowed (405, no ACAO) and the
    // browser aborts the real request. This bug silently killed every
    // favorites/status/telemetry write from the browser.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withCors(null, request) });
    }

    // Health check for uptime monitors (enterprise audit P3-G).
    if (url.pathname === '/health' && request.method === 'GET') {
      let kv = 'up';
      try { await env.STATUS.get('probe:lastRun'); } catch (e) { kv = 'down'; }
      return new Response(JSON.stringify({ ok: kv === 'up', kv, ts: Date.now() }), {
        status: 200,
        headers: withCors({ 'Content-Type': 'application/json' }, request),
      });
    }

    // 0) Stream status log. With X-Device-Id: device-scoped key (legacy fallback on read).
    if (url.pathname === '/api/status') {
      const dev = getDeviceId(request);
      const key = dev ? `dev:${dev}:status` : 'status';
      if (request.method === 'GET') {
        let val = {};
        try { val = await env.STATUS.get(key, 'json') || {}; } catch (e) {}
        // Statuses are SHARED quality signals: named devices fall back to the
        // global legacy map until their own probes populate. Not private data.
        if ((!val || !Object.keys(val).length) && dev) {
          try { val = await env.STATUS.get('status', 'json') || {}; } catch (e) {}
        }
        return new Response(JSON.stringify(val), {
          status: 200,
          headers: withCors({ 'Content-Type': 'application/json' }, request),
        });
      }
      if (request.method === 'PUT') {
        const rlKey = (getDeviceId(request) || request.headers.get('cf-connecting-ip') || 'anon') + ':put';
        if (!(await rateLimit(env, rlKey, 30))) {
          return new Response('rate limited', { status: 429, headers: withCors({ 'Content-Type': 'text/plain', 'Retry-After': '30' }, request) });
        }
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) {
          return new Response('payload too large', { status: 413, headers: withCors({ 'Content-Type': 'text/plain' }, request) });
        }
        try { JSON.parse(raw); } catch (e) {
          return new Response('invalid JSON', { status: 400, headers: withCors({ 'Content-Type': 'text/plain' }, request) });
        }
        await env.STATUS.put(key, raw);
        return new Response('ok', { status: 200, headers: withCors(null, request) });
      }
      return new Response('method not allowed', { status: 405, headers: withCors(null, request) });
    }

    // 2) Favorites cache. Device-scoped when X-Device-Id present; legacy shared otherwise.
    if (url.pathname === '/api/favorites') {
      const dev = getDeviceId(request);
      const key = dev ? `dev:${dev}:favorites` : 'favorites';
      if (request.method === 'GET') {
        let val = {};
        try { val = await env.STATUS.get(key, 'json') || {}; } catch (e) {}
        // Favorites: strict privacy — a fresh device starts EMPTY, never sees
        // another visitor's legacy favorites.
        return new Response(JSON.stringify(val), {
          status: 200,
          headers: withCors({ 'Content-Type': 'application/json' }, request),
        });
      }
      if (request.method === 'PUT') {
        const rlKey = (getDeviceId(request) || request.headers.get('cf-connecting-ip') || 'anon') + ':fav';
        if (!(await rateLimit(env, rlKey, 30))) {
          return new Response('rate limited', { status: 429, headers: withCors({ 'Content-Type': 'text/plain', 'Retry-After': '30' }, request) });
        }
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) {
          return new Response('payload too large', { status: 413, headers: withCors({ 'Content-Type': 'text/plain' }, request) });
        }
        try { JSON.parse(raw); } catch (e) {
          return new Response('invalid JSON', { status: 400, headers: withCors({ 'Content-Type': 'text/plain' }, request) });
        }
        await env.STATUS.put(key, raw);
        return new Response('ok', { status: 200, headers: withCors(null, request) });
      }
      return new Response('method not allowed', { status: 405, headers: withCors(null, request) });
    }

    // 2b) Nightly-probed "confirmed working" shortlist (P0-B). Rebuilds lazily when stale.
    if (url.pathname === '/shortlist' && request.method === 'GET') {
      const payload = await getShortlist(env);
      return new Response(payload, {
        status: 200,
        headers: withCors({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }, request),
      });
    }

    // 2c) Client-side error telemetry (remote diagnosis; no local Chrome).
    if (url.pathname === '/api/client-error') {
      if (request.method === 'PUT') {
        let p = {};
        try { p = await request.json(); } catch (e) { }
        if (p && typeof p.msg === 'string') {
          let list = [];
          try { list = await env.STATUS.get('clienterr:latest', 'json') || []; } catch (e) {}
          list.unshift({ msg: String(p.msg).slice(0, 300), line: p.line, src: String(p.src || '').slice(-80), ua: p.ua, t: p.t });
          await env.STATUS.put('clienterr:latest', JSON.stringify(list.slice(0, 25)));
        }
        return new Response('ok', { status: 200, headers: withCors(null, request) });
      }
      if (request.method === 'GET') {
        let list = [];
        try { list = await env.STATUS.get('clienterr:latest', 'json') || []; } catch (e) {}
        return new Response(JSON.stringify(list), {
          status: 200,
          headers: withCors({ 'Content-Type': 'application/json' }, request),
        });
      }
      return new Response('method not allowed', { status: 405, headers: withCors(null, request) });
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

    // (Preflight is handled at the top of fetch() — see note there.)

    const target = url.searchParams.get('u');
    if (!target) {
      console.log('[proxy] missing u param -> 400');
      return new Response('Missing u parameter', {
        status: 400,
        headers: withCors({ 'Content-Type': 'text/plain' }, request),
      });
    }

    // SSRF guard (enterprise audit P0-A): block non-http(s) schemes and
    // private/link-local/metadata targets. Public IPTV hosts remain reachable.
    try {
      const tu = new URL(target);
      if (!/^https?:$/.test(tu.protocol)) throw new Error('scheme');
      const h = tu.hostname;
      const privateHost =
        /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(h) ||
        /^\[?(::1|fc|fd)/i.test(h) ||
        /\.(internal|local)$/i.test(h);
      if (privateHost) {
        return new Response('Blocked target', { status: 403, headers: withCors({ 'Content-Type': 'text/plain' }, request) });
      }
    } catch (e) {
      return new Response('Invalid u parameter', { status: 400, headers: withCors({ 'Content-Type': 'text/plain' }, request) });
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
        return new Response(body, { status: resp.status, headers: withCors(headers, request) });
      }

      return new Response(resp.body, { status: resp.status, headers: withCors(headers, request) });
    } catch (e) {
      // Upstream fetch failed (blocked port, network, timeout). The 502 MUST
      // still carry ACAO, or the browser throws a CORS error and hides the body.
      console.log('[proxy] upstream fetch error: %s', e.message);
      return new Response('Proxy error: ' + e.message, {
        status: 502,
        headers: withCors({ 'Content-Type': 'text/plain' }, request),
      });
    }
  },

  // Cron tick (*/5): advance the rolling probe pipeline.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPipeline(env).catch(e => console.log('[cron] pipeline failed:', e.message)));
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
