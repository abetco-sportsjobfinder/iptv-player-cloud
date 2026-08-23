# NVIDIA NIM / DeepSeek V4 — ENTERPRISE AUDIT (2026-08-23T2301ZZ)

- model: deepseek-ai/deepseek-v4-flash-0731
- tokens: prompt=33443 completion=6023
- bundle: 110985 bytes across 19 files

## Response

# PRISM TV — Enterprise-Commercial Quality Audit

## 1) EXEC SUMMARY

- **NOT commercializable today** — P0 security (open SSRF proxy), P0 legal exposure (unlicensed streaming), and P0 reliability (silent data loss) block any paid deployment.
- **Biggest risk**: The proxy at `worker.js` is an unauthenticated SSRF that any internet client can abuse to scan internal networks, exfiltrate data, or bypass egress controls — this is a liability, not a feature.
- **Second risk**: Streaming unlicensed third-party feeds (iptv-org, Free-TV) with zero DMCA/geo-blocking posture invites immediate takedown and legal action in most jurisdictions.
- **Third risk**: KV write amplification — every client error, click, render, and status flush writes to the same KV namespace with no rate limiting, guaranteeing quota exhaustion and degraded UX at any real traffic.
- **Fourth risk**: The "40k channels" claim is misleading — most are dead/blocked; the nightly probe only tests 30 channels, so the "confirmed working" badge is statistically meaningless.
- **Fifth risk**: No observability — at 3am, a KV failure, a bad playlist rewrite, or a Cloudflare Pages deploy silently breaks the app with zero alerting.

---

## 2) FINDINGS REGISTER

### P0 — BLOCKERS

**[P0][A] SSRF via `?u=` parameter — unauthenticated, unrestricted**  
**Evidence**: `worker.js` lines ~120-160: `const target = url.searchParams.get('u');` then `fetch(target, ...)` with no allowlist, no scheme restriction beyond implicit, no auth. Any client can hit `https://proxy.abetco.workers.dev/?u=http://169.254.169.254/latest/meta-data/` (cloud metadata), `http://localhost:8080/`, or internal services.  
**Commercial impact**: Immediate security incident; attacker can scan internal networks, read cloud credentials, pivot. This is a CVE-class vulnerability.  
**Remediation (M)**: Implement strict allowlist of upstream hosts (iptv-org.github.io, raw.githubusercontent.com, known CDN domains), reject non-http(s), reject private IP ranges, require a signed token for non-browser clients. Add rate limiting per IP/device.

---

### [P0][A] No rate limiting on any endpoint — KV write amplification  
**Evidence**: `worker.js` `/api/client-error`, `/api/status`, `/api/favorites` all accept PUT with no throttling. `main.js` sends a beacon on **every click** (`document.addEventListener('click', ...)` in `index.html`), every render (`renderBeacon`), and every chip click.  
**Commercial impact**: A single user with 100 clicks/minute generates 100 KV writes/minute. 1000 users = 100k writes/min = instant KV quota exhaustion (Cloudflare free tier: 100k writes/day).  
**Remediation (S)**: Remove click/render beacons entirely; batch error reports (send max 1/30s); add per-device rate limiting in worker (KV counter with TTL).

---

### [P0][B] Unlicensed streaming — no DMCA posture, no geo-blocking, no ToS  
**Evidence**: `api.js` loads from `iptv-org.github.io` and `raw.githubusercontent.com/Free-TV/IPTV` — both aggregate unlicensed streams. `player.js` proxies all streams. No geo-blocking, no content filtering beyond `xxx` category, no DMCA contact, no terms of service.  
**Commercial impact**: Immediate legal exposure; DMCA takedowns; payment processor termination; potential criminal liability in some jurisdictions.  
**Remediation (L)**: Pivot to licensed content only (Pluto TV, Tubi, Samsung TV Plus — already partially in `GOOD_CDNS`); implement geo-blocking via Cloudflare Workers geo headers; add DMCA policy page; require ToS acceptance.

---

### [P0][C] Silent catch blocks — data loss with no signal  
**Evidence**: `worker.js` `/api/status` and `/api/favorites` PUT: `try { body = JSON.parse(raw); } catch (e) { }` — malformed JSON silently accepted, then `env.STATUS.put(key, raw)` stores garbage. `tracking.js` `flushStatusToKV`: `catch { tracking.dirty = true; }` — retries forever with no backoff, no alert.  
**Commercial impact**: User favorites/status silently lost; support tickets with no root cause; no way to know data is corrupt.  
**Remediation (S)**: Validate JSON before storing; return 400 on parse failure; add exponential backoff with max retries; log failures to a separate error KV key.

---

### [P0][C] Playlist rewrite edge cases — broken streams, no fallback  
**Evidence**: `worker.js` `rewritePlaylist` — rewrites `URI="..."` attributes and bare URIs, but: (1) doesn't handle `#EXT-X-MAP:URI="..."` (fMP4 init segments) specially; (2) doesn't handle relative paths in `#EXT-X-KEY` with `IV` attributes; (3) doesn't handle `#EXT-X-MEDIA` with `URI` that's already absolute; (4) doesn't handle `#EXT-X-STREAM-INF` with `BANDWIDTH` and `RESOLUTION` — the next line is rewritten but the tag isn't.  
**Commercial impact**: Intermittent playback failures on certain streams; user frustration; support load.  
**Remediation (M)**: Add comprehensive playlist parser (or use `hls-parser` npm package); test against known problem playlists; add fallback to original body on any rewrite error (already partially done).

---

### [P0][D] 40k-item render — memory and CPU hotspots  
**Evidence**: `main.js` `renderSidebar()` builds a massive HTML string for all providers/countries/genres/letters — this runs on **every state change** (via `onStateChange` → `render()`). `renderMain()` → `currentChannels()` filters 40k channels on every keystroke (debounced 300ms). `renderGrid()` renders up to 800 channels (search) or 40k (browse) via chunked append, but `updateVisibleDots()` iterates **all mounted cards** every 2.5s.  
**Commercial impact**: UI jank on mid-range devices; battery drain; potential tab crash on mobile.  
**Remediation (M)**: Memoize sidebar HTML (rebuild only when data/expanded changes); virtualize grid (only render visible rows); throttle `updateVisibleDots` to 5s and only for visible cards.

---

### [P0][D] Worker CPU/subrequest ceilings — nightly probe will exceed  
**Evidence**: `worker.js` `buildShortlist` — fetches `streams.json` (large), samples 30, probes each with up to 8s timeout, 3 concurrent. Each probe = 1 subrequest. Plus the initial fetch = 31 subrequests. Cloudflare Workers free tier: 100k requests/day, 10ms CPU per request. The probe batch alone could hit CPU limits if streams.json is large.  
**Commercial impact**: Nightly cron fails silently; shortlist goes stale; "confirmed working" badge lies.  
**Remediation (M)**: Move probing to a separate scheduled worker with its own quota; reduce sample to 10; use `ctx.waitUntil` properly; add failure alerting.

---

### [P1][A] XSS via channel names/logos — `esc()` used inconsistently  
**Evidence**: `grid.js` `cardHTML` uses `esc()` for name/logo — good. But `main.js` `renderHero` uses `esc(c.name)` — good. However, `main.js` `renderSidebar` uses `esc()` for provider names, but `tree.js` `brandKey` and `clustering.js` `firstToken` operate on raw names — if a channel name contains `<script>`, it's stored in `c.brand` and later rendered via `esc()` — OK. **But**: `main.js` `windowManager.renderWindows` uses `w.id` in `onclick="windowManager.setActiveWindow('${w.id}')"` — `w.id` is `window-${Date.now()}` — safe. **However**: `main.js` `renderChips` uses `btn.dataset.chip` in a fetch beacon — safe. **Real risk**: `state.js` `esc()` is not applied in `main.js` `renderSidebar` for `data-toggle="${esc(key)}"` — key is from `state.expanded` which is user-controlled via localStorage.  
**Commercial impact**: Stored XSS if a malicious channel name or localStorage value is rendered unsanitized.  
**Remediation (S)**: Audit all `innerHTML` assignments; use `textContent` where possible; add a global sanitizer.

---

### [P1][A] Device UUID is the only auth — no rate limiting, no revocation  
**Evidence**: `worker.js` `getDeviceId` validates UUID format but nothing else. Any client can spoof any UUID. Favorites/status are per-device but not per-user.  
**Commercial impact**: Data isolation is weak; a malicious user can overwrite another device's favorites if they know the UUID.  
**Remediation (M)**: Add per-device rate limiting; add a device registration handshake (first-use generates a token stored in KV); add optional email/password for multi-device sync.

---

### [P1][B] No geo-blocking — legal exposure in EU/GDPR  
**Evidence**: No geo-detection anywhere. `status.html` says "no data leaves your browser except anonymous test writes" — but `main.js` sends click/render beacons with `navigator.userAgent` to a US-based worker.  
**Commercial impact**: GDPR violation (no consent for telemetry); potential fines; no way to comply with content licensing geo-restrictions.  
**Remediation (M)**: Add geo-detection via Cloudflare `CF-IPCountry` header; block EU traffic or add consent banner; remove telemetry or make it opt-in.

---

### [P1][C] No retries/timeouts on critical data loads  
**Evidence**: `api.js` `loadAll` — `Promise.all` on 3 fetches with no timeout. If `channels.json` hangs, the app never boots. `tracking.js` `pullStatusFromKV` — single fetch with no retry.  
**Commercial impact**: App appears broken on flaky networks; no graceful degradation.  
**Remediation (S)**: Add `AbortController` with 15s timeout; add retry with backoff (2 attempts); show partial data with "offline" indicator.

---

### [P1][D] Payload: 2.8MB logos.json — no compression, no CDN caching  
**Evidence**: `api.js` fetches `channels.json` (includes logos) directly from iptv-org. No gzip/brotli (Cloudflare Pages does compress, but the worker proxy doesn't). No client-side caching beyond browser cache.  
**Commercial impact**: Slow first load on mobile; high bandwidth costs at scale.  
**Remediation (M)**: Serve logos from a CDN with `Cache-Control: immutable`; split channel data from logo URLs; use IndexedDB for offline cache.

---

### [P1][E] Duplicated logic — `startBackgroundTesting` defined twice  
**Evidence**: `main.js` lines ~120-130 defines `startBackgroundTesting` and `runQueue`; `tracking.js` lines ~40-50 defines the same functions. `main.js` imports `initTracking` from `tracking.js` but calls its own `startBackgroundTesting` — the two queues run independently, doubling probe traffic.  
**Commercial impact**: Wasted bandwidth; conflicting status updates; confusing codebase.  
**Remediation (S)**: Remove the duplicate in `main.js`; import from `tracking.js`.

---

### [P1][E] Dead code — `windowManager`, `renderVirtualListForWindow`, `applyFiltersToWindow`  
**Evidence**: `main.js` `windowManager` object is defined but never used (no UI calls `createWindow`). `renderVirtualListForWindow` is called only from `applyFiltersToWindow` which is never called.  
**Commercial impact**: Code bloat; maintenance burden; confusion for new devs.  
**Remediation (S)**: Delete dead code.

---

### [P1][F] Accessibility — dialogs lack focus management, ARIA incomplete  
**Evidence**: `index.html` `<dialog id="watch">` and `<dialog id="profilePop">` — no `aria-labelledby`, no focus trap, no `aria-modal`. `grid.js` cards have `role="button"` but no `aria-pressed` for selection state. `main.js` `renderSidebar` uses `<a>` elements with `href` but no `role="treeitem"`.  
**Commercial impact**: ADA/WCAG non-compliance; excludes users; potential legal risk.  
**Remediation (M)**: Add focus trap to dialogs; add `aria-labelledby`; add `aria-expanded` to tree rows; add `aria-pressed` to selection cards.

---

### [P1][F] Color contrast — themes may fail WCAG  
**Evidence**: `styles.css` — `--muted: #97a0b5` on `--surface: #12151d` = contrast ratio ~4.5:1 (borderline). `--dead: #f87171` on `--surface` = ~3.5:1 (fails AA for small text). `--testing: #fbbf24` on `--surface` = ~4:1 (fails).  
**Commercial impact**: WCAG non-compliance; accessibility lawsuits.  
**Remediation (S)**: Adjust muted/dead/testing colors to meet 4.5:1; add a high-contrast theme.

---

### [P1][G] No observability — blind at 3am  
**Evidence**: No logging beyond `console.log` in worker (not visible in production). No error tracking (Sentry, etc.). No uptime monitoring. `status.html` is a manual check.  
**Commercial impact**: Outages go unnoticed; no SLA possible; no root-cause analysis.  
**Remediation (M)**: Add Cloudflare Workers Logs (free tier includes 100k logs/day); add a simple health check endpoint; integrate with UptimeRobot (free) or BetterStack.

---

### [P1][H] No commercial features — profiles, parental controls, billing  
**Evidence**: `state.js` has `profile` (name/avatar) but no multi-user support. No parental controls (only `xxx` category filter). No billing hooks. No admin panel.  
**Commercial impact**: Cannot charge for the product; no family plans; no content moderation.  
**Remediation (L)**: Add user accounts (email/password via Workers KV + WebCrypto); add parental PIN; add Stripe billing integration; add admin dashboard.

---

### [P1][I] Data integrity — dedup missing, stale status decay  
**Evidence**: `api.js` — channels from iptv-org and Free-TV are merged with no dedup by name/logo. `tracking.js` — status TTL is 7 days for working, 3 days for dead, but no decay — a channel marked "working" 6 days ago is still shown as working even if it died yesterday.  
**Commercial impact**: Duplicate channels confuse users; stale "working" badges mislead.  
**Remediation (M)**: Dedup by normalized name + country; add exponential decay to status (halve confidence every 24h).

---

### [P2][A] Telemetry privacy — no consent, no opt-out  
**Evidence**: `index.html` — click beacon sends `navigator.userAgent` and target element to worker on every click. `main.js` — `renderBeacon` sends render signatures. No consent banner, no opt-out.  
**Commercial impact**: GDPR/CCPA violation; user trust erosion.  
**Remediation (S)**: Remove all beacons; if telemetry needed, make it opt-in with clear disclosure.

---

### [P2][B] No DMCA contact, no terms of service, no privacy policy  
**Evidence**: No pages exist for these. `index.html` has no footer links.  
**Commercial impact**: Legal requirement in most jurisdictions; payment processors require ToS.  
**Remediation (S)**: Add static pages; link in footer.

---

### [P2][C] Partial-failure UI states — no error boundaries  
**Evidence**: `main.js` `boot()` — if `loadAll` fails, shows "Failed to load channel data" but no retry button. `grid.js` — if a chunk fails to render, no error state. `player.js` — if all streams fail, shows message but no "try again" button.  
**Commercial impact**: Users stuck on error screens; no recovery path.  
**Remediation (S)**: Add retry buttons; add error boundaries around grid/player.

---

### [P2][D] Memory growth — intervals and listeners never cleaned up  
**Evidence**: `main.js` `boot()` — `setInterval(updateVisibleDots, 2500)` and `setInterval(updateCountsChip, 3000)` never cleared. `grid.js` — `IntersectionObserver` disconnected on re-render but not on unmount. `multiview.js` — HLS instances destroyed on remove, but video elements not always removed.  
**Commercial impact**: Memory leak on long sessions; tab crash.  
**Remediation (M)**: Use `requestAnimationFrame` for dots; clear intervals on route change; add cleanup in `stopPlayback`.

---

### [P2][E] Module boundaries — `state.js` imports `esc` from itself  
**Evidence**: `state.js` exports `esc` and imports nothing, but `grid.js` imports `esc` from `state.js` — fine. However, `main.js` imports `esc` from `state.js` and also defines its own `esc` usage — inconsistent. `tree.js` exports `primaryCategoryKeyFor` but `main.js` defines its own `primaryCategoryKey` — duplicated logic.  
**Commercial impact**: Maintenance burden; bugs from divergent logic.  
**Remediation (S)**: Consolidate category helpers in `tree.js`; remove duplicates.

---

### [P2][F] Mobile ergonomics — touch targets too small  
**Evidence**: `styles.css` — `.fav-btn` and `.mv-add` are 28x28px (WCAG requires 44x44). `.tw` toggle buttons are 22x22px.  
**Commercial impact**: Poor mobile UX; accessibility failure.  
**Remediation (S)**: Increase to 44x44px; add padding.

---

### [P2][G] No structured logging — `console.log` only  
**Evidence**: `worker.js` uses `console.log` — not visible in production unless Workers Logs enabled. No request IDs, no timing, no error codes.  
**Commercial impact**: Debugging is guesswork.  
**Remediation (S)**: Add structured logging with request ID; enable Workers Logs.

---

### [P2][H] No export/import of favorites  
**Evidence**: `state.js` stores favorites in localStorage only. No export/import.  
**Commercial impact**: Users lose data on device change; no migration path.  
**Remediation (S)**: Add JSON export/import in profile dialog.

---

### [P2][I] Shortlist trustworthiness — 30 samples from 40k  
**Evidence**: `worker.js` `SAMPLE_SIZE = 30` — probes 30 random channels nightly. The "confirmed working" count in the UI shows only these 30, but users see it as a global metric.  
**Commercial impact**: Misleading marketing; user distrust when "working" channels fail.  
**Remediation (M)**: Increase sample to 100-200; add confidence intervals; label as "sampled".

---

### [P3][A] CORS allows both frontends but not localhost  
**Evidence**: `worker.js` `ALLOWED_ORIGINS` includes only production domains. Local development (`localhost:8787`) gets no CORS headers — dev workflow broken.  
**Commercial impact**: Developer friction; no local testing.  
**Remediation (S)**: Add `http://localhost:*` to allowed origins in dev environment.

---

### [P3][C] KV failure modes — no fallback to local cache  
**Evidence**: `tracking.js` `pullStatusFromKV` — if KV fails, silently ignores. `worker.js` `getShortlist` — if KV read fails, returns empty.  
**Commercial impact**: Status data lost; shortlist empty.  
**Remediation (S)**: Fall back to localStorage; add retry.

---

### [P3][D] Caching strategy — `no-store` on all proxy responses  
**Evidence**: `worker.js` sets `Cache-Control: no-store` on all responses. For a streaming proxy, this is correct (live content), but for the shortlist and status endpoints, it prevents browser caching.  
**Commercial impact**: Unnecessary bandwidth; slower load.  
**Remediation (S)**: Add `Cache-Control: max-age=60` for shortlist; `no-store` only for stream responses.

---

### [P3][F] Loading/empty/error states inventory — incomplete  
**Evidence**: `grid.js` has empty state ("Nothing here") but no loading state (grid is blank during load). `player.js` has error messages but no spinner. `main.js` boot has a loader but no progress percentage.  
**Commercial impact**: Users don't know if app is loading or broken.  
**Remediation (S)**: Add skeleton loaders; add progress bar for data load.

---

### [P3][G] No health check endpoint  
**Evidence**: `worker.js` has no `/health` or `/ping` endpoint. `status.html` does client-side checks but no server-side.  
**Commercial impact**: No automated uptime monitoring possible.  
**Remediation (S)**: Add `/health` returning `{ok: true, kv: 'up'}`.

---

### [P3][H] No admin panel  
**Evidence**: No admin routes in worker. No way to view error logs, block channels, or manage users.  
**Commercial impact**: Cannot operate the service at scale.  
**Remediation (L)**: Add admin routes with auth; add channel blocklist management.

---

### [P4][A] UUID validation — accepts only v4, but `crypto.randomUUID()` generates v4 — OK  
**Evidence**: `worker.js` `UUID_RE` — correct.  
**Remediation**: None needed.

---

### [P4][D] `gridSignature` — JSON.stringify on every render  
**Evidence**: `main.js` `gridSignature` — `JSON.stringify([state.route, state.category, state.query, channels.length])` — runs on every render. For 40k channels, this is cheap (4 elements) but still unnecessary.  
**Remediation (S)**: Use a simple string concatenation.

---

### [P4][F] `aria-live="polite"` on grid — will spam screen readers  
**Evidence**: `index.html` `<div id="grid" class="grid" aria-live="polite">` — every chunk append triggers a screen reader announcement.  
**Commercial impact**: Annoying for screen reader users.  
**Remediation (S)**: Remove `aria-live`; add it only to result count.

---

### [P4][G] Build tag `BUILD 4de8eb1+` — hardcoded, not from CI  
**Evidence**: `index.html` — `t.textContent='BUILD 4de8eb1+'` — hardcoded.  
**Remediation (S)**: Inject from CI environment variable.

---

## 3) TOP-10 QUICK WINS

1. **Remove click/render beacons** (`index.html`, `main.js`) — eliminates KV write amplification and GDPR risk.
2. **Add SSRF allowlist** in `worker.js` — block private IPs, restrict to known upstream hosts.
3. **Add rate limiting** per device/IP in worker (KV counter with TTL).
4. **Remove duplicate `startBackgroundTesting`** in `main.js` — use `tracking.js` version.
5. **Add `/health` endpoint** in worker for uptime monitoring.
6. **Fix `esc()` in `renderSidebar`** for `data-toggle` attributes.
7. **Add retry button** on boot failure in `main.js`.
8. **Increase touch targets** (`.fav-btn`, `.mv-add`, `.tw`) to 44x44px.
9. **Add `Cache-Control: max-age=60`** for shortlist endpoint.
10. **Add DMCA/ToS/Privacy pages** and link in footer.

---

## 4) RECOMMENDED 30-DAY HARDENING PLAN

### Week 1 — Security & Legal (P0)
- **Day 1-2**: SSRF allowlist + private IP blocking in `worker.js`; add rate limiting.
- **Day 3-4**: Remove all telemetry beacons; add consent banner if telemetry retained.
- **Day 5**: Add DMCA/ToS/Privacy pages; link in footer.
- **Day 6-7**: Add geo-blocking (CF-IPCountry) for EU if needed; test.

### Week 2 — Reliability & Data Integrity (P0/P1)
- **Day 8-9**: Fix silent catch blocks in worker (validate JSON, return 400); add retry/backoff in `tracking.js`.
- **Day 10-11**: Fix playlist rewrite edge cases (EXT-X-MAP, EXT-X-KEY); add fallback.
- **Day 12**: Add dedup for channels; add status decay.
- **Day 13-14**: Add error boundaries in UI; add retry buttons.

### Week 3 — Performance & Scale (P1)
- **Day 15-16**: Memoize sidebar HTML; virtualize grid.
- **Day 17-18**: Throttle `updateVisibleDots`; clear intervals on route change.
- **Day 19**: Optimize `gridSignature`; reduce payload (split logos).
- **Day 20-21**: Load test with 100 concurrent users; fix bottlenecks.

### Week 4 — UX, Observability, Commercial Readiness (P1/P2)
- **Day 22-23**: Fix accessibility (focus traps, ARIA, contrast).
- **Day 24-25**: Add structured logging; enable Workers Logs; add uptime monitoring.
- **Day 26-27**: Add favorites export/import; add parental controls (PIN).
- **Day 28-29**: Add admin panel (basic: view errors, block channels).
- **Day 30**: Final security review; deploy; document known issues.

---

**Final verdict**: With the P0 fixes (SSRF, rate limiting, legal posture), this could become a **viable free-tier product** in 30 days. For **commercial paid deployment**, you need user accounts, billing, SLA, and licensed content — that's a 3-6 month roadmap.
