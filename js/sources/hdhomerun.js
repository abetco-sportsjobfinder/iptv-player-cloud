// PRISM TV - Priority B adapter: SiliconDust HDHomeRun OTA tuners (home LAN).
// Free legal locals after one-time hardware purchase: ABC/CBS/NBC/FOX/PBS etc.
//
// ENVIRONMENT REALITY (read before debugging — this is physics, not bugs):
// 1) Cloudflare Workers cannot reach 192.168.x.x, and the worker's SSRF guard
//    correctly refuses private targets. So these streams are NEVER proxied.
//    Streams are flagged `direct:true`; player.js plays them from the browser,
//    which sits on the same LAN as the tuner.
// 2) PRISM is served over HTTPS. Browsers block active mixed content, so this
//    page CANNOT fetch http://192.168.x.x endpoints at all on the production
//    domain. Direct playback works when: (a) the page itself is opened over
//    http on your LAN, or (b) you front the tuner with a small TLS reverse
//    proxy on your network and put that address in config.base. Safari plays
//    the raw HLS natively once fetched; Chrome/Firefox need hls.js, which also
//    requires the tuner's responses to carry CORS headers — hence the relay.
// The adapter is fully implemented against discovery.json + lineup.json so it
// lights up the moment either condition above is met.

import { registerSource, normalizeChannel, assertPlayableUrl } from './adapter.js';
import { fetchT } from '../api.js';

function base(cfg) {
  return String(cfg.base || '').trim().replace(/\/+$/, '');
}

registerSource({
  id: 'hdhomerun',
  name: 'HDHomeRun antenna (home network)',
  type: 'hdhomerun',
  auth: 'none',
  experimental: true,
  configSchema: { base: 'device address, e.g. http://192.168.1.42 (find it in the HDHomeRun app)' },

  async test(cfg) {
    if (!base(cfg)) return { ok: false, msg: 'Device address required (see the HDHomeRun app or your router DHCP list)' };
    try {
      const j = await (await fetchT(`${base(cfg)}/discovery.json`, {}, 1)).json();
      const d = Array.isArray(j) ? j[0] : j;
      if (!d?.DeviceID) return { ok: false, msg: 'Reached the address but no HDHomeRun answered there' };
      return { ok: true, msg: `Found "${d.FriendlyName || 'HDHomeRun'}" (${d.Model || 'tuner'})` };
    } catch (e) {
      return {
        ok: false,
        msg: 'Browser blocked the LAN request (HTTPS page → HTTP device). Fix options are in SOURCES doc §HDHomeRun.',
      };
    }
  },

  async fetchChannels(cfg) {
    const sid = cfg.id;
    const arr = await (await fetchT(`${base(cfg)}/lineup.json`, {}, 1)).json();
    const out = { channels: [], streams: [] };
    for (const l of (Array.isArray(arr) ? arr : [])) {
      if (!l?.GuideNumber || !l?.URL) continue;
      if (!/^https?:/i.test(l.URL)) continue;
      const nid = 'v' + String(l.GuideNumber).replace(/[^a-z0-9]/gi, '');
      const ch = normalizeChannel(sid, nid, {
        name: l.GuideName || `Channel ${l.GuideNumber}`,
        country: 'us',
        categories: ['local'],
        logo: '',
      });
      out.channels.push(ch);
      out.streams.push({ channelId: ch.id, url: assertPlayableUrl(l.URL), direct: true });
    }
    return out;
  },

  getPlayUrl(_cfg, channelId) {
    // Lineup URLs are stored on the streams themselves; contract parity only.
    throw new Error('HDHomeRun playback resolves through stored direct streams');
  },
});
