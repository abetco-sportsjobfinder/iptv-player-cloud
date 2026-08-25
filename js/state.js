// PRISM TV - central state store with pub/sub + hash routing
const listeners = new Set();

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

export const state = {
  // navigation: {view:'root'|'letter'|'brand'|'special', letter?, brandKey?, special?}
  route: { view: 'root' },
  query: '',
  category: 'all',           // all|news|sports|kids|movies|music|entertainment|documentary|working-only is a special route instead
  expanded: new Set(loadJSON('prism_expanded', [])),
  favorites: new Set(loadJSON('prism_favs', [])),
  recent: loadJSON('prism_recent', []),   // [{id,time}] newest first
  profile: Object.assign({ name: '', avatar: '\u{1F43A}' }, loadJSON('prism_profile', {})),
  theme: localStorage.getItem('prism_theme') || 'dark',
  accent: localStorage.getItem('prism_accent') || 'indigo',
  ready: false,              // data loaded
  viewMode: 'single',        // single = click-to-play; wall = multi-stream grid
  country: 'all',            // country filter (2-letter code or 'all')
  workingOnly: true,         // enterprise default: verified-working channels only
  hideBlocked: true,         // enterprise default: blocked channels off by default
  grandma: localStorage.getItem('prism_grandma') !== 'off', // Easy TV mode: default ON
};

export function emit() { for (const fn of listeners) fn(state); }
export function onStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function patch(p) {
  Object.assign(state, p);
  if ('expanded' in p) localStorage.setItem('prism_expanded', JSON.stringify([...state.expanded]));
  if ('favorites' in p) localStorage.setItem('prism_favs', JSON.stringify([...state.favorites]));
  if ('recent' in p) localStorage.setItem('prism_recent', JSON.stringify(state.recent.slice(0, 30)));
  if ('profile' in p) localStorage.setItem('prism_profile', JSON.stringify(state.profile));
  if ('grandma' in p) localStorage.setItem('prism_grandma', state.grandma ? 'on' : 'off');
  if ('theme' in p) localStorage.setItem('prism_theme', state.theme);
  if ('accent' in p) localStorage.setItem('prism_accent', state.accent);
  if ('query' in p || 'category' in p || 'country' in p) {
    try { localStorage.setItem('prism_filter_state', JSON.stringify({ query: state.query, category: state.category, country: state.country })); } catch (e) {}
  }
  emit();
}

export function toggleExpanded(key) {
  const next = new Set(state.expanded);
  next.has(key) ? next.delete(key) : next.add(key);
  patch({ expanded: next });
}

export function toggleFavorite(id) {
  const next = new Set(state.favorites);
  next.has(id) ? next.delete(id) : next.add(id);
  patch({ favorites: next });
  return next.has(id);
}

export function pushRecent(id) {
  const rest = state.recent.filter(r => r.id !== id);
  patch({ recent: [{ id, time: Date.now() }, ...rest].slice(0, 30) });
}

// ---------- hash routing ----------
// #/            root (hero + featured)
// #/w/<id>      working-now
// #/f           favorites
// #/r           recent
// #/L/<letter>                          letter scope
// #/L/<letter>/<brandKey>               brand scope (brandKey = encodeURIComponent)
export function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (!h) return { view: 'root' };
  const [head, a, b] = h.split('/');
  if (head === 'w') return { view: 'special', special: 'working' };
  if (head === 'f') return { view: 'special', special: 'fav' };
  if (head === 'r') return { view: 'special', special: 'recent' };
  if (head === 'p' && a) return { view: 'provider', provider: a, category: b || 'all' };
  if (head === 'c' && a) return { view: 'country', country: a.toLowerCase() };
  if (head === 'g' && a) return { view: 'genre', genre: a };
  if (head === 'L' && a && b) return { view: 'brand', letter: a, brandKey: b };
  if (head === 'L' && a) return { view: 'letter', letter: a };
  return { view: 'root' };
}

export function navigate(route) {
  let hash = '#/';
  if (route.view === 'special') hash += { working: 'w', fav: 'f', recent: 'r' }[route.special] ?? '';
  else if (route.view === 'letter') hash += `L/${encodeURIComponent(route.letter)}`;
  else if (route.view === 'brand') hash += `L/${encodeURIComponent(route.letter)}/${encodeURIComponent(route.brandKey)}`;
  if (location.hash === hash) emit();
  else location.hash = hash;
}

window.addEventListener('hashchange', () => patch({ route: parseHash() }));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
