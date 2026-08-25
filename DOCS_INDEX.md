# DOCS_INDEX — every markdown doc, what it is, when (UTC where known)

| File | Date (UTC) | What it is |
|---|---|---|
| `COORDINATION_2026-08-23T0250Z_cloud-pipeline-loaders-product-status.md` | 2026-08-23T02:50Z | **CANONICAL session log**: deploy pipeline state, token lifecycle, product status & gap analysis. Read this first. |
| `COORDINATION.md` | 2026-08-23 | Stub pointer to the latest dated coordination file (kept for old references) |
| `NVIDIA_DEEPSEEKV4_solution_2026-08-23T0301Z.md` | 2026-08-23T03:01Z | External model solicitation: DeepSeek V4 (NVIDIA NIM) solutions for gaps 1/2/3/4 + stack critique |
| `NVIDIA_DEEPSEEKV4_impl-plan_2026-08-23T0459Z.md` | 2026-08-23T04:59Z | Raw V4 implementation-plan solicitation (corrections included as constraints) |
| `IMPLEMENTATION_PLAN_2026-08-23T0459Z_p0-p2-roadmap.md` | 2026-08-23T04:59Z | **CANONICAL roadmap**: synthesized P0→P2 plan, owners, KV schema, budgets, tests |
| `NVIDIA_DEEPSEEKV4_p0-review_2026-08-23T0922Z.md` | 2026-08-23T09:22Z | V4 adversarial review of shipped P0 worker code; verdict SHIP w/ fixes 1-6 (applied same day) |
| `NVIDIA_DEEPSEEKV4_prism-broken_2026-08-23T1707Z.md` | 2026-08-23T17:07Z | V4 root-cause analysis of dead-UI report on PRISM; led to bindGrid + selection-scope fix |
| `NVIDIA_DEEPSEEKV4_enterprise-audit_2026-08-23T2301Z.md` | 2026-08-23T23:01Z | **EXHAUSTIVE enterprise audit**: 30+ findings P0-P4 (security/legal/scale/a11y/ops), quick-wins, 30-day hardening plan. P0 subset applied same day |
| `NVIDIA_DEEPSEEKV4_square-one-IA_2026-08-24T0429Z.md` | 2026-08-24T04:29Z | V4 square-one IA redesign based on measured catalog truth (30,751/40,715 channels have zero streams); Working-Set-first model |
| `NVIDIA_DEEPSEEKV4_v2-layout-review_2026-08-24T2135Z.md` | 2026-08-24T21:35Z | V4 adversarial review of v2 layout (docked player/home rows/drawer/embed); P0-P3 findings applied in 679d643 |
| `AGENT_SWARM_PROTOCOL_2026-08-24T0730Z.md` | 2026-08-24T07:30Z | Reusable multi-agent orchestration protocol (roles, contracts, verification gates) — hand this to any new agent |
| `SOURCES_2026-08-25T0126Z_easy-tv-and-my-sources.md` | 2026-08-25T01:26Z | **Pluggable source adapters** (M3U/Xtream/HDHomeRun/TVE/OTT) + Easy TV grandma-mode UI + /api/sources worker route; parallel-session merge notes |
| `DOCS_INDEX.md` | 2026-08-23 | This index |
| `README.md` | 2026-08-17 | Original project readme |
| `NEW_AGENT_PROMPT.md` | 2026-08-17T19:40Z | Onboarding prompt written for fresh agent sessions |
| `AGENT_HANDOFF_DIAGNOSTIC.md` | 2026-08-17T17:41Z | Handoff diagnostics from earlier agent runs |
| `AUDIT_PROMPT.md` | 2026-08-17T00:34Z | Prompt template used for repo audits |
| `DEBUG_PROXY_PROMPT.md` | 2026-08-17T02:51Z | Debug prompt for proxy-worker issues (CORS/403 era) |
| `DEBUG_403_PROMPT.md` | 2026-08-17T03:02Z | Debug prompt for 403 stream errors |

Mirrors of coordination files: `E:\abet\.cache\tmp\opencode\` (same filenames).

Naming rule (mandatory): new docs = `<TOPIC>_<YYYY-MM-DDTHHMMZ>_<short-suffix>.md`. Never edit an old dated doc in place except appending a clearly-dated addendum.
