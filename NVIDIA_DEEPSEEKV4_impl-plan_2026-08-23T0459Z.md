# NVIDIA NIM / DeepSeek V4 implementation-plan solicitation (2026-08-23T0459ZZ)

- model: deepseek-ai/deepseek-v4-flash-0731
- tokens: prompt=490 completion=1548
- Corrections from review of first solicitation were included as binding constraints.

## Prompt

```
Same IPTV project you advised before. Now produce the IMPLEMENTATION PLAN. Your prior advice was reviewed; corrections are binding:

- Device identity = client-generated UUID v4 in localStorage, sent as X-Device-Id header. NEVER hash UA+IP (mobile IP churn kills identity).
- Favorites/statuses MUST NOT expire (your expirationTtl:86400 would wipe user data daily). TTL only for ephemeral probe results.
- Stream probing uses ranged GET on the playlist (.m3u8) with 8s timeout, NOT HEAD (most origins 405/403 HEAD -> false negatives). Concurrency <= 3 from Worker.
- DASH fallback = lazily imported dash.js bundle. NO third-party embed iframes (supply-chain risk).
- Hard budget: Cloudflare Workers FREE tier. 100k req/day, KV 1000 writes/day TOTAL. Your design must state its expected daily KV-write count and stay under 1000 at 50 concurrent devices.
- Frontend = vanilla JS ES modules, no build step. worker.js currently has routes /status PUT/GET etc. (shared KV).

SCOPE TO PLAN (priority order):
P0: per-device sync keys (favorites + stream statuses isolated per X-Device-Id; backward compat during transition)
P0: nightly Cron tester -> shortlist.json (rotating sample, persistent rolling results, frontend loads shortlist first)
P1: playback fallback tree (native HLS -> hls.js -> lazy dash.js -> graceful error card)
P1: logos lazy-loading to cut 2.8MB first load
P2: NEON->PRISM convergence checklist

DELIVER, under 900 words:
1) Phase-by-phase steps with exact files touched (worker.js, wrangler.toml cron trigger, js/api.js, js/main.js, styles.css) and function signatures.
2) KV key schema table (key pattern, value shape, writer, TTL-or-none).
3) Daily KV-write budget math proving <1000 at 50 devices.
4) Rollout order + rollback per phase (deploys are instant git-push CI).
5) Test plan per phase WITHOUT local Chrome (curl-able endpoints, synthetic asserts in Actions).
Be surgical. Code sketches only where non-obvious.
```

## Response

## IMPLEMENTATION PLAN: IPTV Worker

### Phase 1: Per-Device Sync Keys (P0)

**Files:** `worker.js`, `js/api.js`

**Steps:**
1. Add `X-Device-Id` validation middleware (UUID v4 regex, 400 on invalid)
2. Prefix all KV keys with `dev:{deviceId}:`
3. Backward compat: read legacy keys (no prefix) if prefixed key missing, migrate on write
4. Update `/status` routes to use device-scoped keys

**Function signatures:**
```javascript
// worker.js
function getDeviceId(request) // returns validated UUID or null
async function kvGet(key, deviceId) // tries dev:{id}:key, falls back to legacy
async function kvPut(key, value, deviceId, ttl) // always writes prefixed
```

**KV Schema:**
| Key Pattern | Value | Writer | TTL |
|---|---|---|---|
| `dev:{id}:favs` | `{channels:[ids]}` | Frontend PUT | None |
| `dev:{id}:status:{chId}` | `{state,lastChecked}` | Frontend PUT | None |
| `legacy:favs` | `{channels:[ids]}` | Migration read | None |

### Phase 2: Nightly Cron Tester (P0)

**Files:** `worker.js`, `wrangler.toml`, `js/api.js`, `js/main.js`

**Steps:**
1. Add cron trigger: `0 3 * * *` (3 AM UTC)
2. Create `shortlist.json` builder: sample 20 channels from full list, probe each
3. Probe = ranged GET on `.m3u8` with 8s timeout, concurrency 3
4. Store results: `shortlist.json` (latest) + `probe:{chId}` (rolling 7-day history)
5. Frontend: fetch `/shortlist` first, render, then load full list

**Function signatures:**
```javascript
// worker.js
async function handleCron() // main cron entry
async function probeChannel(chId, url) // returns {ok, latency, error}
async function buildShortlist() // samples, probes, writes KV
```

**KV Schema:**
| Key Pattern | Value | Writer | TTL |
|---|---|---|---|
| `shortlist.json` | `{channels:[{id,ok,latency}]}` | Cron | 24h |
| `probe:{chId}` | `[{ts,ok,latency}]` | Cron | 7d |
| `probe:lastRun` | `{ts}` | Cron | None |

**Write Budget Math (50 devices):**
- Favorites: 50 devices × 1 write/day (avg) = 50
- Status updates: 50 × 5 channels/day = 250
- Cron: 20 probes + 1 shortlist + 1 lastRun = 22
- **Total: ~322 writes/day** (well under 1000)

### Phase 3: Playback Fallback Tree (P1)

**Files:** `js/main.js`, `js/api.js`, `worker.js`

**Steps:**
1. Native HLS check: `video.canPlayType('application/vnd.apple.mpegurl')`
2. If not native → dynamic import `hls.js` from CDN
3. If HLS fails → lazy import `dash.js` (only when needed)
4. Error card with retry + channel switch

**Code sketch:**
```javascript
// js/main.js
async function playStream(channel) {
  const video = document.getElementById('player');
  try {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = channel.hlsUrl;
    } else {
      const { default: Hls } = await import('https://cdn.jsdelivr.net/npm/hls.js@1');
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(channel.hlsUrl);
        hls.attachMedia(video);
      } else {
        await loadDashFallback(channel);
      }
    }
  } catch (e) {
    showErrorCard(channel, e);
  }
}
```

### Phase 4: Logo Lazy Loading (P1)

**Files:** `js/main.js`, `styles.css`

**Steps:**
1. Replace `<img src>` with `data-src` + IntersectionObserver
2. Add loading="lazy" + async decode
3. Add placeholder background color in CSS

**Function:**
```javascript
// js/main.js
function initLazyLogos() // sets up IntersectionObserver
```

### Phase 5: NEON→PRISM Convergence (P2)

**Files:** `styles.css`, `js/main.js`

**Steps:**
1. Audit NEON-specific CSS vars, map to PRISM equivalents
2. Update class names in JS templates
3. Remove dead NEON code paths

---

### Rollout Order & Rollback

| Phase | Deploy | Rollback |
|---|---|---|
| 1 | `git push` → CI → Workers | Revert commit, CI redeploys |
| 2 | Same | Disable cron in wrangler.toml |
| 3 | Same | Feature flag `?fallback=off` |
| 4 | Same | Remove observer init |
| 5 | Same | Keep old CSS vars as fallback |

---

### Test Plan (No Chrome)

**Phase 1:**
```bash
# curl-able
curl -X PUT /status -H "X-Device-Id: test-uuid" -d '{"state":"on"}'
curl -X GET /status -H "X-Device-Id: test-uuid" # expect same
curl -X GET /status # expect 400 (no device)
```

**Phase 2:**
```bash
# GitHub Actions synthetic
curl -X POST /__cron # simulate cron
curl /shortlist.json # assert 200, valid JSON, ≤20 channels
curl /probe:test1 # assert array, timestamps
```

**Phase 3:**
```bash
# Test API only (no browser)
curl /channel/123/playback-info # returns {hlsSupported: false, needsFallback: true}
```

**Phase 4:**
```bash
# Assert HTML structure
curl / | grep 'data-src' # logos use data-src
```

**Phase 5:**
```bash
# CSS var audit in CI
grep -r "neon-" styles.css # expect 0 matches
```

---

### Critical Constraints Met

- ✅ Device identity: UUID v4 in localStorage, `X-Device-Id` header
- ✅ No TTL on favorites/statuses (only probe results expire)
- ✅ Ranged GET probing, 8s timeout, concurrency 3
- ✅ Lazy dash.js import, no iframes
- ✅ ~322 daily KV writes at 50 devices (<1000)
- ✅ Vanilla JS ES modules, no build step

**Total implementation time: ~2 weeks part-time.**
