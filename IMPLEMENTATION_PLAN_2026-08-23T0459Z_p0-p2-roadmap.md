# IMPLEMENTATION PLAN — P0→P2 roadmap (2026-08-23T0459Z)

Synthesis of DeepSeek V4 solicitation (`NVIDIA_DEEPSEEKV4_impl-plan_2026-08-23T0459Z.md`) + engineering review. Corrections from round 1 are enforced throughout.

## Owners
| Files | Owner |
|---|---|
| `worker.js`, `wrangler.toml` | Alpha (fd7f96d0) — owns Cloudflare |
| `js/api.js`, `js/main.js`, `styles.css` | ses_fd96bc97 — **needs its sign-off or human override before Alpha touches** |
| Deploy pipeline | Alpha |

## KV key schema (final)
| Pattern | Value | Writer | TTL | Notes |
|---|---|---|---|---|
| `dev:{uuid}:favs` | `{channels:[ids]}` | device PUT | none | single key per device |
| `dev:{uuid}:statuses` | `{chId:{state,lastChecked},…}` | device PUT | none | ONE map key, not per-channel (fewer writes) |
| `shortlist:v1` | `{ts,channels:[{id,ok,latency}]}` | cron | none (overwritten nightly) | served at GET `/shortlist` |
| `probe:lastRun` | `{ts,count}` | cron | none | health signal |
| legacy unprefixed keys | — | read-only fallback | — | migrated lazily on first device write |

## Daily KV-write budget @ 50 devices
favs ~50 · statuses ~250 (batched) · cron 50 probes batched into ~3 writes → **≈300/day < 1000 cap** ✅

## Phases
### P0-A Per-device sync keys — worker.js
1. `getDeviceId(req)`: validate `X-Device-Id` UUIDv4 (400 if missing/invalid)
2. `kvGet/kvPut` helpers: prefixed read w/ legacy fallback, prefixed write
3. Keep existing `/status` response shape byte-compatible (both frontends depend on it)
Rollback: revert commit → CI redeploys previous worker instantly.
Test (no Chrome): curl PUT/GET with test UUID; assert isolation between two UUIDs; assert 400 without header.

### P0-B Nightly Cron shortlist — worker.js + wrangler.toml
1. `[triggers] crons = ["0 3 * * *"]`
2. Deterministic rotating sample (date-seeded) of 50 channels; probe via ranged GET (`Range: bytes=0-2048`) on playlist URL, 8s AbortController, concurrency 3
3. Batch-write `shortlist:v1` + `probe:lastRun`; expose GET `/shortlist`
4. Frontend (after sign-off): render shortlist section first while full index loads
Rollback: remove cron line; endpoint degrades to empty list.
Test: Actions step POSTs internal `__cron_now` (secret-guarded) then asserts `/shortlist` JSON shape + fresh ts.

### P1-A Playback fallback tree — js/*
native HLS check → hls.js (already global) → dynamic `import()` dash.js only for `.mpd` → styled error card with retry. No third-party embed iframes ever.
Test: synthetic unit asserts decision function given url fixtures (curl-safe, no browser).

### P1-B Logo lazy-loading — js/main.js, styles.css
IntersectionObserver + `data-src`, placeholder shimmer CSS. Later: split logos.json per-region (P2).

### P2 NEON→PRISM convergence — blocked on human merge decision (#open-item-1)

## Sequencing & dependency
P0-A and P0-B are independent → parallelizable immediately. P1-A/B wait only on frontend-owner sign-off. Each phase ships behind instant-revert CI.

## Verification gates
Every phase ends with: green CI deploy → live-URL curl assertions → entry appended to dated coordination log.
