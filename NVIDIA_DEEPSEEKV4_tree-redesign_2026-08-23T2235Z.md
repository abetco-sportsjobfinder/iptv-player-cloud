# NVIDIA NIM / DeepSeek V4 — sidebar/tree IA redesign (2026-08-23T2235ZZ)

- model: deepseek-ai/deepseek-v4-flash-0731
- tokens: prompt=625 completion=1394

## Response

## 1) Proposed Tree IA

**Sidebar Sections (ordered by "watchability"):**

```
📺 WORKING NOW (default expanded, live count badge)
├── All Working Channels (count)
├── By Country (top 20 + "More…")
└── By Genre (top 15 + "More…")

⭐ FAVORITES (collapsed, count badge)
🕐 RECENTLY WATCHED (collapsed, count badge)

📡 PROVIDERS (collapsed, count badge)
├── Real Providers (Amagi, Pluto, etc. — sorted by count desc)
└── Uncategorized (collapsed, shows "Browse by Country/Genre" submenu)

🌍 BROWSE BY COUNTRY (collapsed)
└── Top 60 countries + "All Countries" → #/c/<code>

🎭 BROWSE BY GENRE (collapsed)
└── 11 existing + "All Genres" → #/g/<genre>

🔤 CHANNELS A-Z (collapsed)
└── Letters → #/L/<letter> (brand grouping only for brands with >1 channel)
```

**Key changes:**
- "Working Now" becomes the default landing section (auto-expanded)
- "Uncategorized" gets demoted to a submenu under Providers, not a top-level section
- Country/Genre become first-class navigation, not just filters
- All sections lazy-render children on expand (max 100 visible + "Show more")

## 2) Fixing "Ocean of Count-1 Brands"

**Clustering Rules (applied at build time, cached):**

1. **Prefix Token Clustering**: Extract leading tokens (min 2 chars) from brand name. If ≥5 brands share a prefix token, group as `"{token}*"` (e.g., "ABC*" → 12 channels). Threshold: min 3 channels per cluster.

2. **Category Fallback**: If brand has count=1 AND category exists, group under `"{category} — Misc"` (e.g., "News — Misc"). Only if category has ≥5 such orphans.

3. **Country+Category Bucket**: For remaining count-1 brands, group as `"{country} — {category}"` (e.g., "US — Sports"). Threshold: ≥10 channels per bucket.

4. **Final "Other" Bucket**: Everything else goes to `"Other ({count})"` — capped at 500 channels, then "Show more" pagination.

**Implementation**: Precompute clusters in `data/clustering.js` at app init (async, cached in memory). Store as `Map<clusterKey, channelIds[]>`.

## 3) Category Pill UX Fix

**Behavioral feedback (all instant, no navigation):**

1. **Count Preview on Hover**: Tooltip shows `"~3,240 channels"` (debounced 150ms, computed from pre-filtered index).

2. **Active-State Sync**: Clicking a pill:
   - Sets `state.activeCategory`
   - Updates URL hash to `#/c/<category>` (auto-route)
   - Grid header shows `"{category} — {count} channels"`
   - Sidebar auto-expands matching section (if exists)

3. **Progressive Disclosure**: After selection, show sub-filters inline:
   - Country dropdown (pre-filtered to that category)
   - "Working only" toggle (if >50% are working)

4. **Visual Feedback**: Pill gets `aria-pressed="true"`, background color shift, and a small "×" to clear. Grid shows skeleton shimmer for 200ms while re-rendering.

## 4) File-Level Change List

**`src/data/clustering.js`** (new)
- `buildClusterIndex(channels)` → `{clusters: Map, orphans: []}`
- `getClusterChannels(clusterKey)` → `string[]`
- `clusterBrands(brands)` → `Map<clusterKey, brand[]>` (applies rules 1-4)

**`src/navigation/tree.js`** (rewrite)
- `buildSidebarTree(state)` → `{sections: [], counts: {}}`
- `renderSection(section, container)` — lazy, 100-item cap
- `expandNode(nodeId)` → uses `state.expanded` + IntersectionObserver
- `getSectionCount(sectionKey)` → cached count from precomputed index

**`src/main.js`** (modify)
- `initApp()` → calls `buildClusterIndex()` before first render
- `handleHashChange()` → new routes: `#/c/<country>`, `#/g/<genre>`, `#/w` (working)
- `renderGrid(filter)` → accepts `{category, country, working}` object
- `debounceSearch(query)` → 250ms, uses precomputed index

**`src/styles.css`** (modify)
- `.cluster-group` (collapsible, indented)
- `.pill--active` (pressed state)
- `.pill-count` (hover tooltip)
- `.section-count-badge` (sidebar counts)

**`index.html`** (modify)
- Add `<script type="module" src="src/data/clustering.js">`
- Add `<div id="sidebar-sections">` container (replaces hardcoded sidebar)

## 5) Rollout Order

**Phase 1 (Day 1-2): Clustering + IA**
- Build `clustering.js`, integrate into tree.js
- Restructure sidebar sections (Working Now first, demote Uncategorized)
- Test with 42k channels, verify <100ms render

**Phase 2 (Day 3): Pill UX**
- Add hover counts, active-state sync, auto-route
- Add "Working only" toggle to grid header

**Phase 3 (Day 4): Country/Genre Navigation**
- Add `#/c/` and `#/g/` routes
- Wire sidebar sections to these routes
- Add "More…" pagination for large groups

**Phase 4 (Day 5): Polish + Performance**
- Debounce all search/filter inputs
- Add IntersectionObserver to all lazy sections
- Test on low-end mobile (target: <2s initial load, <100ms interactions)

**Rollback safety**: Keep old sidebar code in `tree.old.js` for one release cycle. All changes are additive (new routes, new sections) — no breaking changes to existing hash routes.
