# NVIDIA NIM / DeepSeek V4 — square-one IA redesign (2026-08-24T0429ZZ)

- model: deepseek-ai/deepseek-v4-flash-0731
- tokens: prompt=817 completion=1092

## Response

### 1) Default IA (Working Set as Primary Universe)

**Default view = Working Set only** (top-level universe). Everything else behind **"Advanced"** gate.

```
#/ (default) → Working Set
├── By Country (top 8 + "Other" + "All")
├── By Genre (12 groups, see below)
├── By Letter (A–Z)
└── Featured (curated: KCPQ, Stingray, etc.)

#/advanced (toggle "Include untested")
├── Full Catalog (40k)
│   ├── By Country
│   ├── By Genre
│   ├── By Provider (Amagi/Pluto/Wurl)
│   └── By Letter
└── Zero-Stream Channels (hidden by default, search-only)
```

**Rationale:** 10k is still large; country/genre/letter are the only proven mental models. No provider view in default (empty field). "Advanced" is a single toggle, not a separate route — keeps URL scheme stable.

---

### 2) Genre Taxonomy (12 groups)

| Group | Raw Tags Mapped |
|---|---|
| **General** | general, mixed, lifestyle |
| **Entertainment** | entertainment, variety, reality |
| **News** | news, business, politics |
| **Sports** | sports, motorsport, extreme |
| **Music** | music, classical, jazz, rock, pop |
| **Movies** | movies, cinema, action, comedy, drama |
| **Series** | series, sitcom, soap, anime |
| **Kids** | kids, cartoon, preschool |
| **Documentary** | documentary, history, nature, science |
| **Religious** | religious, christian, islam, jewish, hindu, buddhist |
| **Education** | education, learning, university |
| **Local/Regional** | local, regional, community, city |

**Unmapped tags** (e.g., shopping, adult) → fall into "General" or hidden behind Advanced.

---

### 3) Quality Signals (per channel card)

Show **only 3 compact badges** (no clutter):

- **● Live** (green dot) — last probe OK within 24h
- **⏱ 3h** — hours since last check (tooltip: "Checked 3h ago")
- **🔗 2** — stream source count (tooltip: "2 working streams")

**Logo presence** = subtle gray placeholder icon if missing (not a quality signal — too many missing).

**Sort default:** Working channels by `last_checked` ascending (oldest first) → naturally surfaces stale ones.

---

### 4) Logo Strategy (URL-construction fallback chain)

```
1. Direct: https://logo.iptv.org/{channel_id}.png
2. Google favicon: https://www.google.com/s2/favicons?domain={guess_domain}&sz=64
   (guess from name: "KCPQ" → kcpq.com, "Stingray" → stingray.com)
3. Country flag: https://flagcdn.com/w40/{country_code}.png
4. Generic TV icon (inline SVG)
```

**Cache:** Store resolved logo URL in KV on first successful fetch. Never block channel render on logo load (lazy-load with placeholder).

---

### 5) Custom M3U Ingestion UX

- **Location:** Settings → "My Playlists" (gear icon, top-right)
- **Add:** Paste URL → validate (fetch, parse, count streams) → store per-device in KV
- **Naming:** Prefix all custom channels with `[My]` in the tree
- **Namespace:** Separate route `#/my/<playlist_id>` — never merged into main catalog groups
- **Merge behavior:** In default Working Set view, custom channels appear under a **"My Channels"** section at top (always visible, even if untested). They never appear in Country/Genre/Letter groups.
- **Conflict:** If a custom channel has same name as catalog channel, show both with `[My]` prefix — no dedup logic (simpler, predictable).

---

### 6) Ranked Implementation Order (TONIGHT)

**Minimal slice that transforms UX:**

1. **Cron probe loop** (every minute, 40 streams) → KV working set (2 writes/min) — *this is the foundation*
2. **Default view filter** — Working Set only, toggle for "Include untested" (reuse existing grid, just filter)
3. **Quality badges** — green dot + last-checked time (read from KV, no new UI)
4. **Genre taxonomy mapping** — static JS object, apply to existing genre filter
5. **Logo fallback chain** — implement 4-step resolver, lazy-load

**Defer (tomorrow):** Custom M3U ingestion, Featured section, Advanced gate polish.

**Why this order:** Steps 1–3 immediately fix the core problem (40k dead channels). Step 4 improves navigation. Step 5 is cosmetic but high-impact. Step 6 is a separate feature, not a blocker.
