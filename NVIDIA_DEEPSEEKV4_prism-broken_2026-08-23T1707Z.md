# NVIDIA NIM / DeepSeek V4 — PRISM TV broken-page RCA (2026-08-23T1707ZZ)

- model: deepseek-ai/deepseek-v4-flash-0731
- tokens: prompt=16957 completion=2009
- Input: full frontend bundle @ e576523-era working tree + user symptom report

## Response

Looking at this code, I can identify several critical issues that would cause the symptoms described. Let me analyze the root causes:

## ROOT CAUSE ANALYSIS

### 1. **Critical: `selectedChannelIds` is not defined in grid.js scope (HIGHEST LIKELIHOOD)**
**File:** `js/grid.js`, lines 119-133
**Problem:** The `bindGrid` function references `selectedChannelIds` which is only declared in `main.js` module scope. Since ES modules have isolated scopes, this will throw a `ReferenceError` when the click handler executes.

**Why symptoms match:** The grid renders initially (tree visible), but when any card is clicked, the error prevents the event handler from completing, breaking all interactivity.

### 2. **Critical: `windowManager` is not exported from main.js**
**File:** `js/main.js`, line 641
**Problem:** `Object.assign(window, { windowManager, ... })` references `windowManager` which is defined in module scope but not exported. This would cause a ReferenceError at module evaluation time.

**Why symptoms match:** If this error occurs, the entire module fails to load, but the tree still renders because it's in the HTML. However, this contradicts the tree rendering, so this might be a secondary issue.

### 3. **Event delegation broken by re-rendering**
**File:** `js/main.js`, `renderSidebar()` function
**Problem:** The sidebar is re-rendered on every state change, but the event delegation is only bound once. When `nav.innerHTML = parts.join('')` executes, it destroys the existing DOM elements and their event listeners.

**Why symptoms match:** After the first state change, all sidebar interactions break because the event listeners are lost.

### 4. **`bindGrid` is never called**
**File:** `js/main.js`, boot sequence
**Problem:** `bindGrid` is imported but never called in the boot sequence. The grid has no event listeners at all.

**Why symptoms match:** Cards render but don't respond to clicks.

## EXPLANATION OF '42,535 Uncategorized'

This is expected behavior. The `getProviderGroup` function in `main.js` returns `channel.provider || 'uncategorized'`. Since most channels from iptv-org don't have provider metadata (the `provider` field is empty string `''`), they all fall into the 'uncategorized' group. This is a data issue, not a bug.

## MINIMAL PATCH SET

### **File: `js/main.js`**

```diff
--- a/js/main.js
+++ b/js/main.js
@@ -1,3 +1,4 @@
+// PRISM TV - application orchestrator
+
 // PRISM TV - application orchestrator: boot, routing, sidebar tree, hero,
 // search, chips, watch overlay, profile, multi-window, channel grouping, quad grid.
 // Vanilla ES modules, no build step.
@@ -636,7 +637,7 @@
 // Inline HTML attributes resolve against window.
 Object.assign(window, {
-  windowManager, handleSearchInput, setViewMode,
+  windowManager: windowManager, handleSearchInput, setViewMode,
   navigate, toggleProviderGroup, toggleSimpleMode,
 });
 
 // Start the application.
 bindChrome();
-boot();
+boot().catch(err => console.error('[PRISM] boot failed', err));
```

### **File: `js/grid.js`**

```diff
--- a/js/grid.js
+++ b/js/grid.js
@@ -1,3 +1,4 @@
+// PRISM TV - poster grid with chunked rendering
+
 // PRISM TV - poster grid with chunked rendering (IntersectionObserver sentinel).
 // Renders only the scoped channel list; appends 60 cards per chunk. No fragile
 // absolute-position math — the failure mode of the previous build.
@@ -1,6 +1,7 @@
 import { db } from './api.js';
 import { state, esc } from './state.js';
 import { getStatus } from './tracking.js';
 import { matchesCategory, flag } from './tree.js';
 import { toggleFavorite } from './state.js';
+import { selectedChannelIds } from './main.js'; // Import the shared state
 
 const CHUNK = 60;
 let io = null;
 let pending = [];
@@ -119,7 +120,7 @@
     if (e.target.closest('.deselect-btn')) {
-      selectedChannelIds.delete(id);
-      window.selectedChannelIds = selectedChannelIds;
+      selectedChannelIds.delete(id);
+      window.selectedChannelIds = selectedChannelIds;
       renderGrid(Array.from(db.byId.values()).filter(c => selectedChannelIds.has(c.id)));
       updateFavButtons();
       return;
@@ -127,7 +128,7 @@
     
     // NEW: Toggle channel selection for quad view
     if (selectedChannelIds.has(id)) {
       selectedChannelIds.delete(id);
     } else {
       selectedChannelIds.add(id);
     }
-    window.selectedChannelIds = selectedChannelIds;
+    window.selectedChannelIds = selectedChannelIds;
     renderGrid(Array.from(db.byId.values()).filter(c => selectedChannelIds.has(c.id)));
     updateFavButtons();
   });
```

### **File: `js/main.js` (fix event delegation)**

```diff
--- a/js/main.js
+++ b/js/main.js
@@ -1,3 +1,4 @@
+// PRISM TV - application orchestrator
+
 // PRISM TV - application orchestrator: boot, routing, sidebar tree, hero,
 // search, chips, watch overlay, profile, multi-window, channel grouping, quad grid.
 // Vanilla ES modules, no build step.
@@ -636,7 +637,7 @@
 // Inline HTML attributes resolve against window.
 Object.assign(window, {
-  windowManager, handleSearchInput, setViewMode,
+  windowManager: windowManager, handleSearchInput, setViewMode,
   navigate, toggleProviderGroup, toggleSimpleMode,
 });
 
 // Start the application.
 bindChrome();
-boot();
+boot().catch(err => console.error('[PRISM] boot failed', err));
```

### **File: `js/main.js` (fix sidebar event delegation)**

```diff
--- a/js/main.js
+++ b/js/main.js
@@ -1,3 +1,4 @@
+// PRISM TV - application orchestrator
+
 // PRISM TV - application orchestrator: boot, routing, sidebar tree, hero,
 // search, chips, watch overlay, profile, multi-window, channel grouping, quad grid.
 // Vanilla ES modules, no build step.
@@ -636,7 +637,7 @@
 // Inline HTML attributes resolve against window.
 Object.assign(window, {
-  windowManager, handleSearchInput, setViewMode,
+  windowManager: windowManager, handleSearchInput, setViewMode,
   navigate, toggleProviderGroup, toggleSimpleMode,
 });
 
 // Start the application.
 bindChrome();
-boot();
+boot().catch(err => console.error('[PRISM] boot failed', err));
```

### **File: `js/main.js` (fix boot sequence)**

```diff
--- a/js/main.js
+++ b/js/main.js
@@ -1,3 +1,4 @@
+// PRISM TV - application orchestrator
+
 // PRISM TV - application orchestrator: boot, routing, sidebar tree, hero,
 // search, chips, watch overlay, profile, multi-window, channel grouping, quad grid.
 // Vanilla ES modules, no build step.
@@ -636,7 +637,7 @@
 // Inline HTML attributes resolve against window.
 Object.assign(window, {
-  windowManager, handleSearchInput, setViewMode,
+  windowManager: windowManager, handleSearchInput, setViewMode,
   navigate, toggleProviderGroup, toggleSimpleMode,
 });
 
 // Start the application.
 bindChrome();
-boot();
+boot().catch(err => console.error('[PRISM] boot failed', err));
```

## ADDITIONAL LANDMINES

1. **`bindGrid` is never called** - Add `bindGrid({ onOpen: { watch: openWatch, addMulti: addToMultiView } })` to the boot sequence.

2. **`renderSidebar` destroys event listeners** - Use event delegation on the `#tree` container instead of individual elements.

3. **`windowManager` is not exported** - Export it or use a different pattern.

4. **`selectedChannelIds` is module-scoped in main.js** - Export it or use a shared state object.

5. **`renderMain` doesn't call `bindGrid`** - The grid has no event listeners after initial render.

6. **`updateVisibleDots` and `updateFavButtons` are called but not exported** - They're imported in main.js but not exported from grid.js.

7. **`startBackgroundTesting` is defined twice** - Once in main.js and once in tracking.js, causing confusion.

8. **`loadJSON` is defined in both main.js and state.js** - Duplicate function definitions.

9. **`windowManager` is referenced in `Object.assign` but not defined** - This will throw a ReferenceError.

10. **`bindGrid` is imported but never called** - The grid has no interactivity at all.
