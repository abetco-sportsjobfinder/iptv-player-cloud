# SOURCES — pluggable adapters + Easy TV (2026-08-25T0126Z)

Owner-directed build: (1) pluggable SOURCES system so premium networks come
from entitlements the owner already has; (2) "Easy TV" — an 85-year-old-friendly
default interface.

## Architecture

```
js/sources/adapter.js    registerSource() registry + normalizeChannel()
                         contract: {id:`src_<sourceid>_<nativeid>`, name,
                         categories[], logo, source} — proxy routing is
                         CENTRAL (player.js proxied()); adapters return raw URLs.
js/sources/m3u.js        Priority A: M3U playlist + Xtream Codes provider line
                         (ESPN/NFL Network tiers live here). Xtream emits both
                         /hls/ and /live/ transports; player failover tries both.
js/sources/hdhomerun.js  Priority B: OTA tuner. Streams flagged direct:true —
                         NEVER proxied (worker cannot reach a LAN; SSRF guard).
js/sources/tve.js        Priority C: Adobe Pass scaffold + headless-blocker
                         matrix per MVPD. Interactive-only by design.
js/sources/ott.js        Priority D: Max/P+/Prime stub — official-apps-only
                         policy, no scraping, no DRM circumvention.
js/sources/store.js      Per-device persistence mirror (localStorage + PUT).
js/sources/index.js      Orchestrator: initSources / testConfig / upsert /
                         removeConfig / refreshIntoDb (purge-before-merge).
js/sources.js            COMPAT SHIM so the pre-existing Settings UI keeps working.
```

Worker: ONE `/api/sources` route (GET/PUT). Requires X-Device-Id UUIDv4 →
`dev:{uuid}:sources`. Rate limit 10/min. Body ≤64KB. Per-type validation
(m3u needs http(s) url; xtream needs http(s) host+user+pass; hdhomerun needs
http(s) base; cap 20 sources). Replaces two competing drafts from parallel
sessions (both were merged into this one).

## Easy TV (grandma mode) — js/grandma.js

- DEFAULT ON for this deployment (`state.grandma`, localStorage `prism_grandma`).
- Five tabs, giant type/targets (≥84px buttons, ≥1.5rem names, AAA contrast):
  📺 TV · ⭐ Mine · ⚽ Sports · 📰 News · 🔍 Find (A–Z listing).
- Only confirmed-working channels render; cold start falls back to rank<2 so
  the screen is never empty.
- Playback REUSES player.js via exported openWatch() — one HLS pipeline. Giant
  controls (Play/Softer/Louder/Bigger/Done) injected into the existing watch
  dialog; Done stops playback cleanly.
- Owner escape hatch: press-and-hold ⚙ (1.6s) → confirm → advanced app.
  Return via Profile → 📺 Easy TV mode.
- Clock + time-of-day greeting in the header.

## Owner quick-start

1. Deploy, open site → hold ⚙ → setup → Profile dialog.
2. "My Sources": paste your provider's M3U URL → Add. Button tests the URL
   (#EXTM3U check) before saving, then merges channels live.
   Xtream host/user/pass: currently config/API-level (see adapter), UI fieldset
   is m3u-first by design for simplicity.
3. Channels appear in Easy TV automatically (working ones surface as probes
   confirm; custom lines usually verify within seconds on first play).
4. Favorites sync per-device like before.

## Known constraints (honest section)

- **HDHomeRun**: production page is HTTPS → browsers block fetching the
  HTTP tuner (mixed content), and CF workers can't reach LANs at all. Adapter
  is complete against discovery.json/lineup.json; usable today only when the
  page itself is served over http on the home LAN, or behind a small TLS relay.
- **TVE**: token capture intentionally NOT implemented. Xfinity/Spectrum are
  bot-checked headless-hostile; DirecTV historically viable. Tokens are also
  IP-bound → playback must originate from the minting network.
- **OTT**: stub by policy. Max/Paramount+/Prime = Widevine apps only.
- **Secrets**: Xtream credentials sit plaintext in per-device KV + localStorage.
  Acceptable single-user; rotate the line if the device UUID ever leaks.
- **KV budget**: sources add ~1 write per edit (debounced); probe cron still
  dominates (~864/day). Within free tier.

## Verification

- `node --input-type=module --check`: ALL 16 touched files PASS (npm broken on
  this machine; eslint unavailable — see COORDINATION lessons re: linters).
- Live curl assertions + human play-test still REQUIRED after next deploy
  (headless Chrome broken per coordination log): GET /api/sources with fresh
  UUID must return {"sources":[]}; PUT valid/invalid payloads assert 200/400;
  then add a real playlist through the UI and confirm Easy TV shows it.

## Merge notes (parallel-session reconciliation)

Parallel session had shipped: flat js/sources.js (my_ namespace), Settings UI
(srcName/srcUrl/srcList), its own /api/sources draft, boot double-merge, and
v2 docked-player openWatch(id,{muted}). Resolution: engine owns parsing/
persistence/namespacing; shim preserves their UI; worker route unified;
duplicate boot pass removed; their stricter privacy posture (device-required)
adopted for /api/sources.
