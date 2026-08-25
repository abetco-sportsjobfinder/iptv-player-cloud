// PRISM TV - pluggable source adapters: registry + normalization contract.
//
// A source adapter teaches PRISM how to list channels from ONE entitlement the
// owner already has (a provider playlist line, an OTA tuner, a pay-TV login).
// Adapters never touch playback transport: every URL they return is played by
// player.js through the Cloudflare worker proxy (?u=...) — with one documented
// exception, LAN-direct streams flagged `direct:true` (see hdhomerun.js).
//
// Contract (all fields required unless marked ?):
//   registerSource({
//     id:            string            - registry key, also the type in configs
//     name:          string            - human label shown in Settings
//     type:          string            - same as id today; kept separate for future splits
//     auth:          'none'|'m3u'|'xtream'|'tve'|'oauth'
//     experimental?: boolean           - true = hidden from grandma surface
//     configSchema?: object            - documentation of accepted config keys
//     test(config)      -> {ok:boolean, msg:string}   - cheap reachability check
//     fetchChannels(cfg)-> {channels:[], streams:[]}  - normalized below
//     getPlayUrl(id,cfg)-> url string                  - raw upstream URL
//   })
//
// Channel normalization (matches db.channels shape in api.js):
//   { id:`src_<sourceid>_<nativeid>`, name, country(2), categories[],
//     logo, favicon:'', source:<sourceid>, altNames:[], provider, blocked:false }

const AUTH_TYPES = ['none', 'm3u', 'xtream', 'tve', 'oauth'];
const registry = new Map();

export function registerSource(def) {
  for (const k of ['id', 'name', 'type', 'auth']) {
    if (!def[k]) throw new Error(`registerSource: "${k}" is required`);
  }
  if (!AUTH_TYPES.includes(def.auth)) throw new Error(`registerSource(${def.id}): bad auth "${def.auth}"`);
  for (const fn of ['test', 'fetchChannels', 'getPlayUrl']) {
    if (typeof def[fn] !== 'function') throw new Error(`registerSource(${def.id}): ${fn}() must be a function`);
  }
  const entry = { experimental: false, configSchema: {}, ...def };
  registry.set(def.id, entry);
  return entry;
}

export function getSource(id) { return registry.get(id) || null; }
export function listSources() { return [...registry.values()]; }

// Stable, collision-free channel id namespace per source instance.
export function normalizeChannel(sourceId, nativeId, ch = {}) {
  if (!sourceId || nativeId === undefined || nativeId === null || nativeId === '') {
    throw new Error('normalizeChannel requires sourceId and nativeId');
  }
  return {
    id: `src_${sourceId}_${nativeId}`,
    name: String(ch.name || 'Unknown'),
    country: String(ch.country || '').slice(0, 2),
    categories: Array.isArray(ch.categories) ? ch.categories : [],
    logo: ch.logo || '',
    favicon: '',
    source: sourceId,
    altNames: [],
    provider: ch.provider || '',
    blocked: false,
  };
}

export function normalizeStream(channelId, url) {
  return { channelId, url };
}

// Only http(s) upstreams are ever allowed into the pipeline.
export function assertPlayableUrl(u) {
  const s = String(u || '');
  if (!/^https?:\/\//i.test(s)) throw new Error(`non-http stream URL rejected: ${s.slice(0, 60)}`);
  return s;
}

// Slugify a display name into a safe nativeId fragment.
export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ch';
}
