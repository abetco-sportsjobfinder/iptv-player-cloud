# COORDINATION — IPTV dual-platform status (2026-08-22 ~16:00)

## Session map
| ID | Role | Status |
|---|---|---|
| `ses_fd96bc97…` | original build session, resumed → active PRISM/feature dev in D:\iptv-player | 🟢 ACTIVE |
| `ses_fd7f96d0…` | NEON repair agent + deploys + this coordination | 🟢 ACTIVE |
| `ses_fd8142405…` | PRISM initial rebuild author | ⛔ halted |

## Live platforms
| Platform | URL | Deploys from |
|---|---|---|
| NEON STREAM (production) | https://iptv-player-20g.pages.dev | E:\iptv-player-oxfix (branch fix/oxalpha-render-fixes → PR #1) |
| PRISM TV (preview) | https://iptv-player-pro.pages.dev | git push to abet-hq/iptv-player main → CI (project `iptv-player-pro`). NO local wrangler uploads — cloud-only deploys. |
| Proxy worker | https://iptv-stream-proxy.abetscrape.workers.dev | D:\iptv-player\worker.js (fixed: CORS/PUT/preflight) |

## Just shipped (both platforms)
Animated loading screens:
- PRISM: spinning accent diamond + shimmer progress bar + bouncing dots; fades/scales out on boot completion.
- NEON: neon spinner ring + pulsing "INITIALIZING STREAM MATRIX…" with staggered dots while channels load.
Both respect prefers-reduced-motion.

## Touch rules
- ses_fd96bc97 owns D:\iptv-player js/* logic. Alpha (fd7f96d0) touches only index.html boot block / styles.css appends there when needed.
- Alpha owns E:\iptv-player-oxfix and all Cloudflare deploys. Don't deploy over each other within 10-min windows.
- Known harness quirk: Chrome 151 headless screenshot/dump-dom currently broken on this machine — verify UI changes by fetching the LIVE cloud URLs and grepping served content. Do not spin up local servers; this project is cloud-only.

## STAGING PROTOCOL (critical)
- index.html & styles.css carry UNSTAGED loader edits on top of ses_fd96bc97's staged work.
- Commit with plain `git commit` (NOT `-a`, NOT `git add -A`/`add .`) — that commits exactly the staged set and leaves loader edits intact.
- 2026-08-22: with human approval, Alpha committed the staged set as a checkpoint, then committed loader fixes separately. Tree is clean going forward — normal commits are safe again.

## Requested change (ses_fd96bc97, when convenient)
One line in the boot success path of js/main.js, before removing #boot:
`document.dispatchEvent(new CustomEvent('prism:boot-complete'));`
Alpha will switch the loader shim to listen for that event and drop its fallbacks once confirmed live.

## Fix round 2 (2026-08-22, Alpha)
1. Hardened boot shim: idempotency guard + reduced-motion-aware timeout + MutationObserver fallback.
2. styles.css: fade-out transition disabled under prefers-reduced-motion; `.boot-mark` restored to design-system accent color.
3. CI fixed: pages.yml now targets project `iptv-player-pro` (was `iptv-browser` — pushes never updated the live site, which is why local uploads crept in). Deploys are now push-driven only.

## Deploy pipeline (2026-08-23 UPDATE — private-migration in progress)
- PUBLIC FORK DEMOTED: old fork main force-reset to 7a75928 (coordination docs + PRISM history removed from public view). Its ONLY remaining role: hosts the head branch of NEON PR #1 — do not delete until PR #1 resolves.
- SOURCE REPO (final): abetco-sportsjobfinder/iptv-player-cloud — made PUBLIC by owner decision 2026-08-23 for unlimited free Actions. Old fork main stays reset (PR#1 vehicle only). Local remote: `deploy`.
- Billing blocker resolved by the public flip; deploys verified green from this repo.
- TOKEN LIFECYCLE: CLOUDFLARE_API_TOKEN secret = wrangler OAuth access token, expires ~60 min after each refresh. On 401 deploy failures: refresh via POST dash.cloudflare.com/oauth2/token (grant_type=refresh_token, client_id 54d11594-84e4-41aa-b438-e81b8fa78ee7), update %APPDATA%\xdg.config\.wrangler\config\default.toml AND re-seed the repo secret. NOTE: npm is broken on this machine (ECOMPROMISED) so `npx wrangler` cannot auto-refresh — use the manual flow. Permanent fix: mint a real CF API token (Pages:Edit) and replace the secret once.
- Deploy options once unblocked: keep Actions (~30s/run, trivial drain) OR connect Cloudflare Pages Git integration in dash (zero GH minutes, 500 CF builds/mo). Both CF projects are currently source=none/direct-upload.
- Verified live-deploy path while blocked: last good cloud deploys = runs 32606656282/32606793190 from the fork era. Site content is current; only future pushes wait on the billing fix.
- misterplusev CANNOT push abet-hq (403); abet-hq entry in .git-credentials is dead. Use abetco-sportsjobfinder for PRISM pushes.
- WARNING for NEON PR #1 merge: abet-hq main's pages.yml now targets iptv-player-pro (PRISM). Merging PR #1 will conflict on .github/workflows/pages.yml — resolve by splitting into two workflows (one per Pages project) or separating repos. Do not let one platform's merge silently repoint or disable the other's deploy.

## Open items
0. Pipeline collision warning above (PR #1 merge vs PRISM workflow) — resolve at merge time.
1. Merge decision: production NEON vs PRISM rewrite (human call).
2. Rotate exposed tokens: misterplusev PAT, OpenRouter key, possibly one HF token.
3. `.git-credentials` restored 6/7 — verify pulls still work per identity.

## Product status & gaps (2026-08-23, evidence-based)
WORKING (verified this session):
- Two live HTTPS PWAs: PRISM https://iptv-player-pro.pages.dev, NEON https://iptv-player-20g.pages.dev; push-driven CI deploys both.
- Data path alive: iptv-org API (streams.json 3.5MB, 200 OK) + Free-TV M3U (549KB, 200 OK); client indexes ~40k channels at boot.
- Proxy worker iptv-stream-proxy responds (~200ms); KV STATUS namespace wired for favorites/status sync.
- UI: brand-grouped tree, quad/single/favorites views, themes, multi-view dock, animated loaders (both platforms), reduced-motion support.

UNVERIFIED:
- End-to-end video PLAYBACK on real devices (headless Chrome broken on build machine all session; no pixel-proof). Needs one human play test per platform or repaired Chrome.

MISSING for "watch TV from anywhere, any device":
1. Playback QA matrix: desktop Chrome/Firefox/Safari, iOS Safari, Android Chrome — HLS ok via hls.js, but MPD/DASH and YouTube-embed channels have no verified fallback story.
2. Stream reliability ops: background tester exists but statuses go stale; no scheduled re-test/curation of a "confirmed working now" shortlist; most of 40k channels are dead weight.
3. Accounts/identity: none — favorites/status sync shares ONE anonymous KV namespace across ALL visitors (privacy + collision risk). Need per-device or per-user keys before public sharing of URL.
4. Guide/EPG, catch-up, Chromecast/Airplay: absent.
5. Product split unresolved: production URL serves NEON (older UX), preview serves PRISM rewrite — one must win.
6. Monitoring/alerting: zero (site up? streams dead? nobody knows without looking).
7. Mobile payload: logos.json 2.8MB = 93% of first load.

NEXT (ranked): human playback test on 2 devices -> fix what breaks; per-client sync keys in worker.js; nightly stream re-test cron (Workers Cron) publishing a working-shortlist JSON; pick winning UX and point production at it.

---

## ADDENDUM 2026-08-23T0910Z — P0 SHIPPED (Alpha)
- worker.js: per-device sync keys live (X-Device-Id UUIDv4 header -> dev:{uuid}:favorites / dev:{uuid}:statuses). Legacy shared-key fallback intact for old clients. Verified isolation on prod.
- worker.js: /shortlist endpoint + scheduled() nightly 03:00 UTC cron (wrangler.toml [triggers]). First build: 40 sampled / 31 ok / cached 286ms. Stale-rebuild guard prevents write storms.
- KV budget: ~300 writes/day @50 devices (<1000 cap).
- Deployed via CF REST API multipart upload (npm is broken on this machine - ECOMPROMISED - wrangler CLI unusable until fixed).
- NEXT (needs ses_fd96bc97 or override): frontends send X-Device-Id from localStorage UUID + render /shortlist section first (P1 items follow per IMPLEMENTATION_PLAN_2026-08-23T0459Z_p0-p2-roadmap.md).

## ADDENDUM 2026-08-23T0935Z - P0 HARDENED after V4 adversarial review (NVIDIA_DEEPSEEKV4_p0-review_2026-08-23T0922Z.md)
Applied (verified live): CORS allowlist (only our two pages.dev origins echoed; foreign origins get no ACAO) / legacy-fallback REMOVED for named devices (fresh device sees {}, no cross-user leak) / shortlist rebuild lock via probe:building TTL 300s + 30min cooldown buffer + lastRun check in scheduled() too / probes now redirect:manual + strict content-type (no octet-stream false positives, 3xx = not confirmed) / sample 40->30 (subrequest headroom vs redirect chains) / PUT bodies capped 64KB -> 413 / Knuth-mixed seed.
Deferred to backlog: HMAC-signed device tokens (needs DEVICE_SECRET), Durable Objects migration if write volume grows.
Redeployed via CF REST API; full verification suite green on prod.

## ADDENDUM 2026-08-23T1720Z - PRISM dead-UI ROOT CAUSE + FIX (V4-assisted)
User device test: no buttons, no scrolling, 42,535 'Uncategorized'.
ROOT CAUSES (confirmed in code):
1. bindGrid imported but NEVER called -> grid had zero listeners (cards/fav/mv dead).
2. grid.js referenced main.js-scoped selectedChannelIds bare -> ReferenceError on any card click even if bound.
3. Quad WIP hijacked card clicks to selection-only mode -> normal browsing impossible.
FIXED: selection+viewMode moved to shared state object; click=watch outside quad, click=toggle-select inside quad; bindGrid({onOpen:{watch,addMulti}}) now invoked at boot; syntax-checked via node --check (npm still broken).
'42,535 Uncategorized' is DATA not crash: most iptv-org channels carry no provider metadata; tree groups them under Uncategorized. Proper fix = brand/letter-first grouping (roadmap P1, tree.js).
Deployed: push b4a2c31-era -> CI. Frontend files touched under human override of touch-rule (user ordered fix).

## ADDENDUM 2026-08-23T1750Z - ZOMBIE SERVICE WORKER IDENTIFIED (the real 'nothing works')
sw.js used stale-while-revalidate ('cached || refresh') -> returning browsers were served FROZEN old app shells across every deploy today. All upstream fixes since first visit never reached the user. sw.js now NETWORK-ONLY (prism-v3-network-only): installs skipWaiting, activate purges ALL caches, zero fetch interception. index.html gained client error trap -> /api/client-error (KV-backed, GET-readable) + visible red error banner for user reports. Worker redeployed via REST API; endpoints smoke-tested.
USER RECOVERY PROTOCOL: two consecutive hard refreshes (Ctrl+Shift+R x2). First swap-purges old SW; second loads clean network build. Fallback nuke: DevTools > Application > Service Workers > Unregister.

## ADDENDUM 2026-08-24T0300Z - Sidebar IA v2 (V4-designed) + pill instrumentation
- New routes: #/c/<country> #/g/<genre> #/p/<prov>[/<cat>]
- Sidebar order: Library -> Countries(top60) -> Genres(11 w/ live counts) -> Providers(real desc, Uncategorized LAST) -> A-Z (brands by count desc)
- Uncategorized expanded = clustered submenus (prefix-token >=5, Category-Misc >=5, Country+Category >=10, Other) via js/clustering.js
- Chips: hover counts, aria-pressed, click+render beacons for remote diagnosis of 'pills do nothing' report

## ADDENDUM 2026-08-24T0545Z - ENTERPRISE AUDIT (V4) + P0 quick-wins applied
Artifact: NVIDIA_DEEPSEEKV4_enterprise-audit_2026-08-23T2301Z.md (30+ findings P0-P4, exec verdict: NOT commercializable until SSRF/legal/rate-limit P0s land; viable free product in ~30 days per its plan).
Applied immediately: click/render beacons REMOVED (KV write amplification + GDPR risk); error-trap kept (errors only); SSRF guard in proxy (private/link-local/metadata + non-http(s) -> 403); /health endpoint (kv status); shortlist Cache-Control max-age=60.
Backlog adopted (30-day plan weeks 1-4 in artifact): rate limiting, DMCA/ToS/Privacy pages, geo-consent decision, JSON validation 400s, playlist rewrite edge cases (EXT-X-MAP/KEY), dedup + status decay, sidebar memoization/virtualization, a11y pass (focus traps, contrast, touch targets 44px), structured logging, favorites export/import.
NOTE: permanent CF API token still required (OAuth refresh dance every ~60min continues).

## ADDENDUM 2026-08-24T0615Z - TONIGHT HARDENING BATCH SHIPPED (enterprise standard, personal deployment)
FRONTEND: fetch timeouts(15s)x3 retries on all upstream loads / status flush exponential backoff (3 tries, gives up cleanly) / X-Device-Id UUID now sent by tracking sync (device isolation LIVE end-to-end) / duplicate background-tester queue removed (single queue in tracking.js) / boot-failure Retry button / updateVisibleDots skips hidden tabs / favorites Export+Import buttons in profile dialog / a11y: aria-modal on dialogs, aria-live moved to resultCount only, 40px touch targets, :focus-visible outlines.
WORKER: JSON validation -> 400 on malformed PUTs / rate limiting (CF Rate Limiting binding REJECTED on this plan via API -> in-isolate memory limiter 30/min per device-IP as best-effort deterrent; native binding = upgrade-path item) / SSRF private-target guard verified / /health for uptime monitors / shortlist Cache-Control 60s.
VERIFIED LIVE: health OK, bad-JSON->400, SSRF->403, retry/backoff/device-id markers served.
DEFERRED w/ reason: HMAC device tokens (needs secret mgmt), DO migration (scale), admin panel/DMCA/billing (non-monetized), geo-blocking (personal use).

## ADDENDUM 2026-08-24T0045Z - RENDER-FATAL ReferenceErrors FIXED (user console report)
renderSidebar threw 'matchesCategory is not defined' + 'sortedProviders is not defined' on EVERY render -> grid never populated. matchesCategory was NEVER imported into main.js (this also explains original 'category pills do nothing' - currentChannels used it since inception). sortedProviders declaration lost in IA-v2 edit. Both fixed (6977b73). LESSON: node --check catches syntax only, not undefined identifiers; consider adding a real linter (eslint no-undef) to CI.

## ADDENDUM 2026-08-24T0530Z - SQUARE-ONE IA (V4-designed) + REAL PROBE PIPELINE
MEASURED TRUTH: 30,751/40,715 channels have ZERO streams; channels.json no longer contains ANY logos; ~10k streamable = the real catalog.
SHIPPED: (a) api.js drops zero-stream entries -> every view/count now honest (~10k); (b) logo fallback chain: upstream https -> iptv-org.github.io/logos/<id>.png -> flagcdn country flag -> initial; (c) WORKER PIPELINE v2: cron */5min probes 40 rotating + 10 stale-rechecks, persistent working:v1 map, cursor rotation covers full catalog ~daily, writes ~864/day (<1000 cap); /shortlist serves merged set w/ per-channel checked-ts; (d) frontend merges working set into status map -> Working Now/quality badges use fresh global data; (e) 'Working only' toggle ON by default next to Good only; (f) 12-group genre taxonomy replacing 11 raw chips (V4 mapping).
ESPN/NFL PATH (legitimate): per-device custom M3U ingestion designed (V4 section 5) - user adds THEIR provider line URL; channels appear under 'My Channels'. Implementation = next session item #1.
