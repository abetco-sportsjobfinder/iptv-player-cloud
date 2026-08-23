// PRISM TV - clustering for the provider-less "uncategorized" mass.
// Rules (DeepSeek V4 proposal, tuned):
//   1. Prefix-token clusters: first brand token shared by >=5 channels ("ABC*")
//   2. Category-Misc: leftover channels sharing a primary category, >=5
//   3. Country+Category buckets: >=10
//   4. Everything else -> "Other"

import { primaryCategoryKeyFor } from './tree.js';

function firstToken(name) {
  const bk = String(name || '').toUpperCase();
  const m = bk.match(/^[A-Z0-9]{2,}/);
  return m ? m[0] : '?';
}

export function buildUncategorizedClusters(channels) {
  const byToken = new Map();
  for (const c of channels) {
    const t = firstToken(c.name);
    if (!byToken.has(t)) byToken.set(t, []);
    byToken.get(t).push(c);
  }

  const clusters = [];
  const leftovers = [];
  for (const [tok, list] of [...byToken.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (tok !== '?' && list.length >= 5) {
      clusters.push({ label: tok + '*', chans: list });
    } else {
      leftovers.push(...list);
    }
  }

  const byCat = new Map();
  for (const c of leftovers) {
    const k = primaryCategoryKeyFor(c);
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(c);
  }
  const stillLeft = [];
  for (const [cat, list] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length >= 5) clusters.push({ label: cap(cat) + ' — Misc', chans: list });
    else stillLeft.push(...list);
  }

  const byCC = new Map();
  for (const c of stillLeft) {
    const k = ((c.country || '').toUpperCase() || '??') + ' — ' + cap(primaryCategoryKeyFor(c));
    if (!byCC.has(k)) byCC.set(k, []);
    byCC.get(k).push(c);
  }
  const finalLeft = [];
  for (const [k, list] of [...byCC.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length >= 10) clusters.push({ label: k, chans: list });
    else finalLeft.push(...list);
  }
  if (finalLeft.length) clusters.push({ label: 'Other', chans: finalLeft });

  return clusters.sort((a, b) => b.chans.length - a.chans.length);
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
