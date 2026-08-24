// PRISM TV - brand extraction + Letter -> Brand -> Channel hierarchy.
// This is what finally groups "Bally Sports Arizona / Extra / Plus" and
// "ABC News Live 1,2,3" under one collapsible node.

const QUALIFIERS = new Set([
  'PLUS', 'EXTRA', 'HD', 'FHD', 'SD', 'UHD', '4K', '8K',
  'EAST', 'WEST', 'NORTH', 'SOUTH', 'FEED',
]);
const NUMBERY = /^\+?\d+(\.\d+)?$/;

export function brandKey(name) {
  let s = String(name || '').toUpperCase();
  s = s.replace(/[\u2019'`]/g, '');
  s = s.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ');   // drop (...) segments
  s = s.split(/[|\u2022\u00b7\u2013\u2014:\/\\]/)[0];   // cut at separators
  s = s.replace(/[^A-Z0-9]+/g, ' ').trim();             // normalize junk to spaces
  let toks = s.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && NUMBERY.test(toks[toks.length - 1])) toks.pop();     // "ABC NEWS LIVE 9" -> ABC NEWS LIVE
  let changed = true;
  while (changed && toks.length > 1) {
    if (QUALIFIERS.has(toks[toks.length - 1]) || NUMBERY.test(toks[toks.length - 1])) toks.pop();
    else changed = false;
  }
  return toks.join(' ') || String(name || '').toUpperCase().trim() || '?';
}

export function letterFor(brand) {
  const c = brand[0];
  return (c >= 'A' && c <= 'Z') ? c : '#';
}

// Build { letters: Map<letter, Map<brandKey, channel[]>>, counts } once after data load.
export function buildTree(channels) {
  const letters = new Map();
  for (const c of channels) {
    const bk = brandKey(c.name);
    c.brand = bk;
    const L = letterFor(bk);
    if (!letters.has(L)) letters.set(L, new Map());
    const brands = letters.get(L);
    if (!brands.has(bk)) brands.set(bk, []);
    brands.get(bk).push(c);
  }
  // sort: channels by rank then name; brands alphabetically
  for (const brands of letters.values()) {
    for (const list of brands.values()) {
      list.sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name));
    }
  }
  return letters;
}

export function sortedLetters(tree) {
  return [...tree.keys()].sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));
}

// Genre taxonomy (V4 square-one): 12 groups mapping ~50 raw iptv-org tags.
export const GENRE_GROUPS = [
  ['general', 'General', ['general', 'mixed', 'lifestyle', 'other']],
  ['entertainment', 'Entertainment', ['entertainment', 'variety', 'reality']],
  ['news', 'News', ['news', 'business', 'politics']],
  ['sports', 'Sports', ['sports', 'motorsport', 'extreme']],
  ['music', 'Music', ['music', 'classical', 'jazz', 'rock', 'pop']],
  ['movies', 'Movies', ['movies', 'cinema', 'action', 'drama']],
  ['series', 'Series', ['series', 'sitcom', 'soap', 'anime']],
  ['kids', 'Kids', ['kids', 'cartoon', 'preschool', 'family']],
  ['documentary', 'Documentary', ['documentary', 'history', 'nature', 'science']],
  ['religious', 'Religious', ['religious', 'christian', 'islam', 'jewish', 'hindu', 'buddhist']],
  ['education', 'Education', ['education', 'learning', 'university']],
  ['local', 'Local & Regional', ['local', 'regional', 'community', 'legislative', 'city', 'shop', 'travel', 'weather']],
];
export const CATEGORY_CHIPS = GENRE_GROUPS.map(([k, l]) => [k, l]);

export function matchesCategory(c, chip) {
  if (chip === 'all') return true;
  if (chip === 'general') {
    // General = explicit general tags OR channels whose tags map to nothing.
    return (c.categories || []).length === 0 ||
      (c.categories || []).some(cat => GENRE_GROUPS[0][2].includes(cat.toLowerCase()));
  }
  const grp = GENRE_GROUPS.find(([k]) => k === chip);
  if (grp) return (c.categories || []).some(cat => grp[2].includes(cat.toLowerCase()));
  return (c.categories || []).some(cat => cat.toLowerCase() === String(chip).toLowerCase());
}

// Shared: first known group for a channel, else 'general'.
export function primaryCategoryKeyFor(c) {
  for (const cat of (c.categories || [])) {
    const cl = String(cat).toLowerCase();
    for (const [key, , tags] of GENRE_GROUPS) {
      if (tags.includes(cl)) return key;
    }
  }
  return 'general';
}

export function flag(code) {
  if (!code || code.length !== 2) return '';
  const A = code.toUpperCase().charCodeAt(0), B = code.toUpperCase().charCodeAt(1);
  if (A < 65 || A > 90 || B < 65 || B > 90) return '';
  return String.fromCodePoint(0x1F1E6 + A - 65, 0x1F1E6 + B - 65);
}
