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
