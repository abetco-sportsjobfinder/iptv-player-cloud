// PRISM TV - Priority D stub: Direct OTT (Max, Paramount+/Showtime, Prime Video).
//
// POLICY — this adapter intentionally does nothing:
//   * Max / Prime Video / Paramount+ are Widevine-protected and their ToS allow
//     consumption ONLY inside official apps. There is no sanctioned third-party
//     manifest access: "Login with Amazon" covers commerce scopes, not video;
//     WBD/HBO partner APIs are contract-gated.
//   * No scraping. No DRM circumvention. Ever.
// The adapters below exist so Settings can explain that boundary honestly and
// so the registry shape is proven against the oauth auth type.

import { registerSource } from './adapter.js';

for (const [id, name] of [
  ['max', 'Max'],
  ['pplus', 'Paramount+ / Showtime'],
  ['prime', 'Prime Video'],
]) {
  registerSource({
    id,
    name,
    type: 'oauth',
    auth: 'oauth',
    experimental: true,
    configSchema: {},
    async test() {
      return { ok: false, msg: `${name} requires its official app (ToS). Watch it there — PRISM carries your linear/live sources.` };
    },
    async fetchChannels() {
      return { channels: [], streams: [] };
    },
    async getPlayUrl() {
      throw new Error('OTT playback requires the official app (ToS) — intentionally unimplemented');
    },
  });
}
