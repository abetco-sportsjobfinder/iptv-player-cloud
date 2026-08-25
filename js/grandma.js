// PRISM TV - Easy TV (grandma mode).
// Design rules, in priority order:
//   1. Zero jargon. No "sources", no "streams", no "providers".
//   2. Five taps maximum from open to watching.
//   3. Huge targets (>=84px), huge text (>=1.4rem), AAA contrast.
//   4. Only channels that are confirmed working. Dead weight is invisible.
//   5. Escape hatch for the owner: press-and-HOLD the small ⚙ for setup.
// It reuses player.js/openWatch() — no second HLS pipeline to maintain.

import { db } from './api.js';
import { state, patch, esc, onStateChange } from './state.js';
import { matchesCategory } from './tree.js';
import { getStatus } from './tracking.js';
import { openWatch } from './main.js';
import { stopPlayback, primeStatus } from './player.js';

let mounted = false;
let root = null;
let clockTimer = null;
let unsub = null;
let renderQueued = false;
let gTab = 'tv';

const TABS = [
  ['tv', '📺 TV'],
  ['fav', '⭐ Mine'],
  ['sports', '⚽ Sports'],
  ['news', '📰 News'],
  ['find', '🔍 Find'],
];

export function mountGrandma() {
  if (mounted) return;
  mounted = true;
  document.body.classList.add('grandma-on');

  root = document.createElement('div');
  root.id = 'grandma';
  root.innerHTML = `
    <header class="g-top">
      <div class="g-clock" id="gClock">--:--</div>
      <div class="g-hello" id="gHello"></div>
      <button id="gSetup" class="g-setup" title="Hold for setup">⚙</button>
    </header>
    <nav class="g-tabs">${TABS.map(([k, l]) =>
      `<button class="g-tab${k === gTab ? ' on' : ''}" data-g="${k}">${l}</button>`).join('')}
    </nav>
    <main class="g-body" id="gBody"></main>`;

  // Giant controls injected into the EXISTING watch dialog — one HLS path.
  const watch = document.getElementById('watch');
  if (watch && !watch.querySelector('.g-ctrl')) {
    const bar = document.createElement('div');
    bar.className = 'g-ctrl';
    bar.innerHTML = `
      <button id="gPP" class="g-big">▶ Play</button>
      <button id="gVolDn" class="g-big">🔉 Softer</button>
      <button id="gVolUp" class="g-big">🔊 Louder</button>
      <button id="gFull" class="g-big">⛶ Bigger</button>
      <button id="gClose" class="g-big g-exit">✕ Done</button>`;
    watch.appendChild(bar);
    bindPlayerControls(watch);
    watch.addEventListener('close', () => stopPlayback());
  }

  document.body.appendChild(root);

  root.querySelector('.g-tabs').addEventListener('click', e => {
    const t = e.target.closest('[data-g]');
    if (!t) return;
    gTab = t.dataset.g;
    root.querySelectorAll('.g-tab').forEach(b => b.classList.toggle('on', b.dataset.g === gTab));
    refresh();
  });

  bindSetupHold(root.querySelector('#gSetup'));
  tickClock();
  clockTimer = setInterval(tickClock, 30000);
  refresh();

  unsub = onStateChange(() => {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => { renderQueued = false; if (mounted) refresh(); }, 400);
  });
}

function unmountGrandma() {
  mounted = false;
  clearInterval(clockTimer);
  unsub?.(); unsub = null;
  stopPlayback();
  root?.remove(); root = null;
  document.body.classList.remove('grandma-on');
}

// ---------- data ----------
function workingPool() {
  const pool = db.channels.filter(c => getStatus(c.id) === 'working');
  // Cold start: nothing probed yet — show rank<2 so the screen is never empty.
  return pool.length ? pool : db.channels.filter(c => c.rank < 2);
}

function listFor(tab) {
  let list = workingPool();
  if (tab === 'fav') list = list.filter(c => state.favorites.has(c.id));
  else if (tab === 'sports') list = list.filter(c => matchesCategory(c, 'sports'));
  else if (tab === 'news') list = list.filter(c => matchesCategory(c, 'news'));
  list.sort((a, b) => (a.rank - b.rank) || String(a.name).localeCompare(String(b.name)));
  return tab === 'fav' ? list.slice(0, 24) : list.slice(0, 60);
}

const EMPTY_MSGS = {
  fav: 'Tap the ⭐ on any show to pin it here.',
  tv: 'Still finding shows… one moment.',
  sports: 'No sports on right now. Check back soon!',
  news: 'News is warming up… one moment.',
};

function cardHTML(c) {
  const st = getStatus(c.id);
  return `
  <button class="g-card" data-id="${esc(c.id)}">
    ${c.logo ? `<img class="g-logo" loading="lazy" src="${esc(c.logo)}"
        onerror="this.style.display='none'" alt="">`
             : `<span class="g-initial">${esc((c.name[0] || '?').toUpperCase())}</span>`}
    <span class="g-name">${esc(c.name)}</span>
    <span class="g-dot g-${st === 'working' ? 'ok' : st === 'dead' ? 'dead' : 'wait'}"></span>
  </button>`;
}

function refresh() {
  if (!mounted) return;
  const body = root?.querySelector('#gBody');
  if (!body) return;

  if (gTab === 'find') { renderFind(body); return; }

  const list = listFor(gTab);
  body.innerHTML = list.length
    ? `<div class="g-grid">${list.map(cardHTML).join('')}</div>`
    : `<div class="g-empty">${EMPTY_MSGS[gTab] || EMPTY_MSGS.tv}</div>`;

  body.querySelectorAll('.g-card').forEach(card => {
    card.addEventListener('click', () => {
      primeStatus(card.dataset.id);
      openWatch(card.dataset.id);
    });
  });
}

// Find: giant A-Z guide of every working channel, like scrolling an old
// newspaper TV listing. Letters jump; rows are full-width tap targets.
let findLetter = '#';
function renderFind(body) {
  const all = workingPool()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const letters = [...new Set(all.map(c => {
    const ch = String(c.name || '?')[0].toUpperCase();
    return /[A-Z]/.test(ch) ? ch : '#';
  }))].sort();
  const rows = all.filter(c => {
    const ch = String(c.name || '?')[0].toUpperCase();
    const L = /[A-Z]/.test(ch) ? ch : '#';
    return L === findLetter || findLetter === '*';
  }).slice(0, 200);
  body.innerHTML = `
    <div class="g-letters">
      ${['*', ...letters].map(L =>
        `<button class="g-letter${L === findLetter ? ' on' : ''}" data-L="${L}">${L === '*' ? 'All' : L}</button>`).join('')}
    </div>
    <div class="g-list">
      ${rows.map(c => `<button class="g-row" data-id="${esc(c.id)}"><span>${esc(c.name)}</span><span class="g-dot g-ok"></span></button>`).join('')
        || '<div class="g-empty">Nothing here yet.</div>'}
    </div>`;
  body.querySelectorAll('.g-letter').forEach(b =>
    b.addEventListener('click', () => { findLetter = b.dataset.L; refresh(); }));
  body.querySelectorAll('.g-row').forEach(b =>
    b.addEventListener('click', () => { primeStatus(b.dataset.id); openWatch(b.dataset.id); }));
}

// ---------- playback bridge ----------
// openWatch/stopPlayback come from main.js via a hoisted-function circular
// import — safe because both sides only invoke them from event handlers.

function bindPlayerControls(watch) {
  const v = () => document.getElementById('video');
  const toast = (msg) => {
    let t = watch.querySelector('#gToast');
    if (!t) { t = document.createElement('div'); t.id = 'gToast'; t.className = 'g-toast'; watch.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 1400);
  };
  const pp = watch.querySelector('#gPP');
  pp.addEventListener('click', () => {
    const vid = v(); if (!vid) return;
    if (vid.paused) { vid.play().catch(() => {}); pp.textContent = '⏸ Pause'; toast('Playing'); }
    else { vid.pause(); pp.textContent = '▶ Play'; toast('Paused'); }
  });
  watch.querySelector('#gVolDn').addEventListener('click', () => {
    const vid = v(); if (!vid) return;
    vid.volume = Math.max(0, Math.round((vid.volume - 0.2) * 10) / 10);
    vid.muted = false;
    toast(vid.volume === 0 ? 'Muted' : `Softer (${Math.round(vid.volume * 100)}%)`);
  });
  watch.querySelector('#gVolUp').addEventListener('click', () => {
    const vid = v(); if (!vid) return;
    vid.muted = false;
    vid.volume = Math.min(1, Math.round((vid.volume + 0.2) * 10) / 10);
    toast(`Louder (${Math.round(vid.volume * 100)}%)`);
  });
  watch.querySelector('#gFull').addEventListener('click', () => {
    const vid = v(); if (!vid) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else vid.requestFullscreen?.().catch(() => toast('Bigger not available here'));
  });
  watch.querySelector('#gClose').addEventListener('click', () => {
    if (watch.open) watch.close(); // 'close' listener stops playback
  });
  // Keep the big button label honest if the video ends or errors.
  const vid = v();
  vid?.addEventListener('pause', () => { if (watch.open) pp.textContent = '▶ Play'; });
  vid?.addEventListener('playing', () => { pp.textContent = '⏸ Pause'; });
}

// ---------- owner escape hatch ----------
function bindSetupHold(btn) {
  let timer = null;
  const start = () => {
    btn.classList.add('holding');
    timer = setTimeout(() => {
      btn.classList.remove('holding');
      askLeaveEasyTV();
    }, 1600);
  };
  const cancel = () => { btn.classList.remove('holding'); clearTimeout(timer); };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
}

function askLeaveEasyTV() {
  let dlg = document.getElementById('gConfirm');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'gConfirm';
    dlg.className = 'g-confirm';
    dlg.innerHTML = `
      <p class="g-confirm-text">Leave Easy TV and open setup?</p>
      <div class="g-confirm-row">
        <button id="gCancel" class="g-big">No, stay</button>
        <button id="gYes" class="g-big g-exit">Yes, setup</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#gCancel').addEventListener('click', () => dlg.close());
    dlg.querySelector('#gYes').addEventListener('click', () => {
      dlg.close();
      patch({ grandma: false });
      unmountGrandma();
      location.hash = '#/';
    });
  }
  if (!dlg.open) dlg.showModal();
}

// Back into Easy TV from the advanced app (Settings → 📺 Easy TV button).
export function reenterEasyTV() {
  patch({ grandma: true });
  setTimeout(() => location.reload(), 150);
}

// ---------- clock / greeting ----------
function tickClock() {
  const el = root?.querySelector('#gClock');
  const hello = root?.querySelector('#gHello');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const h = now.getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const name = state.profile?.name ? `, ${state.profile.name}` : '';
  if (hello) hello.textContent = `${part}${name}. Pick something to watch.`;
}
