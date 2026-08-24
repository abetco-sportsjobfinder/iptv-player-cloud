# NVIDIA NIM / DeepSeek V4 — v2 layout adversarial review (2026-08-24T2135ZZ)

- tokens: prompt=21592 completion=1137

## Response

# ADVERSARIAL UX/IMPLEMENTATION REVIEW

## P0 Findings

**1. Muted flag never clears on auto-resume** (`main.js:openWatch`, `player.js:play`)
- `openWatch(resumeId, { muted: true })` sets `v.muted = true` but nothing ever sets it back to `false` unless user clicks unmute (no UI exists for docked player).
- **Patch**: Add unmute button to docked player; or auto-unmute on first user interaction (`document.addEventListener('pointerdown', () => v.muted = false, { once: true })`).

**2. Docked dialog close path stops audio but not video element cleanup** (`main.js:wClose`)
- `wClose` calls `stopPlayback()` then `dlg.close()`. However, `stopPlayback()` only pauses/destroys HLS; it doesn't reset `currentId` in `player.js`. Next `openWatch` may reuse stale state.
- **Patch**: In `stopPlayback()`, add `currentId = null;`.

**3. Home rows full DB scan per render** (`main.js:renderHomeRows`)
- For each genre group, `db.channels.filter(c => matchesCategory(c, key) && c.rank === 1)` scans all channels. With ~10k channels × 20 genres = 200k iterations per render, plus `getStatus()` calls (localStorage reads) per channel.
- **Patch**: Precompute `rank1ByGenre` map once after `loadAll()`; reuse in `renderHomeRows`. Also cache `working` list with timestamp, invalidate every 60s.

## P1 Findings

**4. `?ch=` parameter injection** (`main.js:boot`)
- `qp.get('ch')` is used directly as `resumeId` without validation against `db.byId`. If arbitrary ID passed, `openWatch` silently returns (no error UI). Also `?ch=` plays unmuted — could auto-play audio on embed.
- **Patch**: Validate `db.byId.has(resumeId)` before `openWatch`; for `?embed=1`, force `muted: true` unless explicit `?sound=1`.

**5. Guide drawer overlaps docked player on mobile** (`styles.css`)
- `body.guide-open #tree` is `58vh` bottom sheet; docked player is `top: calc(var(--topbar-h) + 8px)` fixed. On ≤900px, both visible → player covers drawer top.
- **Patch**: Add `@media (max-width: 900px) { body.guide-open .watch.docked { display: none; } }` or reposition player above drawer.

**6. `renderHomeRows` ignores `workingOnly`/`hideBlocked` toggles** (`main.js`)
- Home rows show all channels regardless of filter state. `clean()` only filters blocklist, not `workingOnly`. Inconsistent with grid view.
- **Patch**: Apply `state.workingOnly` filter to `working` and genre rows.

## P2 Findings

**7. Focus trap loss in non-modal dialog** (`main.js:openWatch`)
- `dlg.show()` (non-modal) doesn't trap focus. Keyboard users can tab into background; ESC closes dialog but doesn't stop playback (no `cancel` handler).
- **Patch**: Add `dlg.addEventListener('cancel', (e) => { e.preventDefault(); stopPlayback(); dlg.close(); })`.

**8. Embed mode CSS leaks** (`styles.css`)
- `body.embed` hides `#tree`, `#hero`, etc., but `.watch.docked` still shows. If `?embed=1&ch=X`, player appears but no close button visible (header hidden).
- **Patch**: In embed mode, add `body.embed .watch.docked { position: static; width: 100%; }` and ensure `wClose` button visible.

**9. Throttled emit interplay** (`main.js:bindChrome`)
- `onStateChange` throttles renders to 120ms, but `renderHomeRows` calls `getStatus()` per channel — during background testing, status emits fire rapidly, causing repeated full re-renders.
- **Patch**: In `renderHomeRows`, use cached `workingCountMap()` instead of live `getStatus()` calls.

## P3 Findings

**10. `windowManager` global leak** (`main.js`)
- `windowManager` exposed via `Object.assign(window, ...)` — potential XSS vector if channel names contain `'` (used in `onclick="windowManager.setActiveWindow('${w.id}')"`).
- **Patch**: Use event delegation instead of inline handlers.

---

## Verdict

**Fix P0s #1–#3 and P1 #4 first.** The muted-flag lifecycle bug is a UX blocker (users resume to silent video with no way to unmute), and the `?ch=` injection could cause unexpected audio playback in embeds. Home row perf will degrade with larger catalogs but is acceptable for current scale. The mobile drawer overlap is cosmetic but noticeable. After these four fixes, ship to device testing — the core architecture is sound, and real-device feedback on the docked player interaction model is more valuable than further static review.
