# NVIDIA NIM / DeepSeek V4 P0 adversarial review (2026-08-23T0922ZZ)

- model: deepseek-ai/deepseek-v4-flash-0731
- tokens: prompt=3732 completion=1818
- reviewed: worker.js @ commit e576523 (deployed)

## Response

# ADVERSARIAL REVIEW: IPTV Proxy Worker

## 1. SECURITY ISSUES

### 1.1 CRITICAL: Unauthenticated KV Write Abuse (Line ~120, ~145)
**Lines 120-124, 145-149:** Any client can PUT arbitrary JSON to `/api/status` or `/api/favorites` without authentication. An attacker can:
- Overwrite the global `status` and `favorites` keys (when no X-Device-Id)
- Flood KV with unlimited device-scoped keys (dev:{uuid}:*)
- **Impact:** Data corruption, KV quota exhaustion, potential billing abuse

**Patch:** Add a shared secret check:
```javascript
const AUTH_HEADER = 'X-Auth-Token';
const VALID_TOKEN = env.AUTH_TOKEN; // from secrets
if (request.method === 'PUT' && request.headers.get(AUTH_HEADER) !== VALID_TOKEN) {
  return new Response('Unauthorized', { status: 401, headers: withCors() });
}
```

### 1.2 HIGH: Shortlist Write-Storm Bypass
**Lines 83-87:** The `probe:lastRun` guard is written BEFORE `buildShortlist()` runs, but there's a TOCTOU race:
1. Request A reads `lastRun` (stale) → writes `lastRun` → starts building
2. Request B reads `lastRun` (fresh) → returns "build in progress" ✓
3. **BUT:** If Request A fails mid-build, `lastRun` is already set, blocking rebuilds for 23h

**Patch:** Add a `probe:building` flag with TTL:
```javascript
const building = await env.STATUS.get('probe:building');
if (building) return cur || '{"channels":[]}';
await env.STATUS.put('probe:building', '1', { expirationTtl: 300 }); // 5min
```

### 1.3 MEDIUM: CORS * Allows Any Origin to Read Device Data
**Line 4:** `Access-Control-Allow-Origin: *` means any website can:
- Read `/api/favorites` and `/api/status` (if they know/guess device IDs)
- **Impact:** Privacy leak of viewing preferences

**Patch:** Restrict to known origins:
```javascript
const ALLOWED_ORIGINS = ['https://your-app.com'];
const origin = request.headers.get('Origin');
if (ALLOWED_ORIGINS.includes(origin)) {
  h.set('Access-Control-Allow-Origin', origin);
}
```

### 1.4 LOW: X-Device-Id Header Spoofing
**Lines 15-18:** UUIDv4 format is validated, but any client can generate valid UUIDs. No binding to actual device identity.

**Patch:** Add HMAC-signed device tokens:
```javascript
const hmac = await crypto.subtle.importKey('raw', env.DEVICE_SECRET, {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
const signature = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(id));
// Store/verify signature alongside device data
```

## 2. CORRECTNESS ISSUES

### 2.1 HIGH: Legacy Fallback Leaks User Data
**Lines 111-114, 136-139:** When a new device (empty `dev:{uuid}:*`) reads, it falls back to the global `favorites`/`status`. If multiple users share the legacy keys, **all users see each other's data**.

**Patch:** Remove legacy fallback entirely, or require explicit opt-in:
```javascript
// Remove lines 111-114 and 136-139
// Return empty object for new devices
```

### 2.2 MEDIUM: Deterministic Seed Collisions
**Line 55:** `daySeed = Math.floor(Date.now() / 86400000)` uses UTC day. Two different days can produce the same sample if the seed algorithm has poor distribution.

**Patch:** Use a better seed:
```javascript
const daySeed = Math.floor(Date.now() / 86400000) * 2654435761; // Knuth multiplicative hash
```

### 2.3 MEDIUM: `body.cancel()` May Not Release Connection
**Line 41:** `await resp.body?.cancel()` is called, but the response body may still hold the connection until GC. For 40 probes, this could exhaust connections.

**Patch:** Use `resp.body?.cancel()` without await, and add explicit connection close:
```javascript
resp.body?.cancel();
// Or better: use HEAD requests for probing
```

### 2.4 LOW: Octet-Stream False Positives
**Line 44:** `octet-stream` content-type accepts any binary data as "working". A dead stream returning a 404 HTML page with `application/octet-stream` would be marked alive.

**Patch:** Require status 206 OR specific video types:
```javascript
const ok = resp.status === 206 || 
  (resp.status >= 200 && resp.status < 400 && /mpegurl|video|mp2t|mp4/i.test(ct));
```

## 3. OPERATIONAL ISSUES

### 3.1 HIGH: Subrequest Accounting Underestimates
**Lines 30-31, 38-40:** The budget claims ~41 subrequests (1 streams.json + 40 probes), but:
- Each probe may follow redirects (counts as additional subrequests)
- `fetchJson` may retry internally
- **Actual worst case:** 1 + 40*3 (redirects) = 121 subrequests

**Patch:** Reduce sample size to 30, or add redirect limit:
```javascript
const resp = await fetch(stream.url, { redirect: 'manual' }); // Don't follow redirects
```

### 3.2 MEDIUM: Cron Overlap with Lazy Rebuild
**Lines 157-159:** The scheduled handler runs `buildShortlist()` unconditionally, potentially overlapping with a lazy rebuild triggered by a user request.

**Patch:** Check `probe:lastRun` in scheduled handler too:
```javascript
async scheduled(event, env, ctx) {
  const lastRun = await env.STATUS.get('probe:lastRun');
  if (!lastRun || Date.now() - JSON.parse(lastRun).ts > STALE_MS) {
    ctx.waitUntil(buildShortlist(env));
  }
}
```

### 3.3 MEDIUM: KV Eventual Consistency on lastRun Guard
**Lines 83-87:** KV writes are eventually consistent. A request to a different PoP may read stale `probe:lastRun` and trigger a duplicate build.

**Patch:** Use a Durable Object or add a longer staleness buffer:
```javascript
const STALE_MS = 23 * 60 * 60 * 1000;
const BUILD_COOLDOWN_MS = 30 * 60 * 1000; // Extra 30min buffer
if (Date.now() - lastRun < STALE_MS - BUILD_COOLDOWN_MS) {
```

## 4. VERDICT: FIX-FIRST LIST

### MUST FIX (Security/Data Integrity):
1. **Unauthenticated PUTs** - Add auth token check (Section 1.1)
2. **Legacy data leak** - Remove fallback or require explicit migration (Section 2.1)
3. **Shortlist write-storm** - Add building flag with TTL (Section 1.2)

### SHOULD FIX (Reliability):
4. **Subrequest budget** - Reduce sample to 30, disable redirects (Section 3.1)
5. **Cron overlap** - Add lastRun check in scheduled handler (Section 3.2)
6. **KV consistency** - Add cooldown buffer (Section 3.3)

### NICE TO FIX (Hardening):
7. **CORS restriction** - Limit to known origins (Section 1.3)
8. **Device ID binding** - HMAC-signed tokens (Section 1.4)
9. **Seed collision** - Better hash function (Section 2.2)
10. **body.cancel()** - Use HEAD requests for probing (Section 2.3)

**SHIP with fixes 1-6 applied.** Fixes 7-10 can be deferred but should be in the backlog.
