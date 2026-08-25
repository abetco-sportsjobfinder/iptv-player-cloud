// PRISM TV - Priority C scaffold: TV-Everywhere (ESPN, NFL Network via pay-TV
// login). EXPERIMENTAL by design — read this header before "finishing" it.
//
// How Adobe Pass ("TV Everywhere") device auth actually works:
//   1) Each network registers a requestorId + signed public key with Adobe
//      (you cannot self-issue one — this is the hard gate).
//   2) GET  /api/v1/config/{requestor}            -> MVPD list
//   3) POST /regcode/regcode/{requestor}          -> {regcode, validUntil}
//   4) User opens the network's activation URL on phone/PC and enters the code
//   5) Poll /api/v1/token/{requestor}/{regcode}   -> shortMediaToken (SAML)
//   6) shortMediaToken + resource id are attached to the network's OWN CDN
//      manifest requests. ESPN/NFLN never publish anonymous HLS; every stream
//      is license-bound per request.
//
// Why full headless TVE is mostly blocked, provider by provider:
//   Xfinity/Comcast : activation runs behind their own SSO + bot checks.
//                     Headless-hostile in practice.
//   Spectrum        : same pattern as Comcast (own app/web SSO).
//   DirecTV / DISH  : plain regcode activation screens; historically the only
//                     flows automatable end-to-end from a web page.
//   Hulu+Live TV,   : Adobe Pass participants but activation UX varies;
//   YouTube TV        treat as interactive-only.
//
// Additional structural blocker: tokens are typically IP-bound to the device
// that authenticated. Our playback proxy egresses from Cloudflare IPs, so
// entitlement checks fail unless the browser plays direct from the home
// network where the token was minted. Plan accordingly: TVE = home-network,
// interactive-login feature, not a headless one.

import { registerSource } from './adapter.js';

export const PROVIDER_MATRIX = {
  espn:   { label: 'ESPN', requestor: 'ESPN', headless: 'partial', note: 'Regcode flow exists; activation page is bot-checked. Needs ESPN+ or a pay-TV tier carrying ESPN.' },
  nflnet: { label: 'NFL Network', requestor: 'NFL', headless: 'partial', note: 'Pay-TV carry only; regcode via activation page.' },
  sho:    { label: 'Showtime', requestor: 'Showtime', headless: 'blocked', note: 'Folded into Paramount+; TVE token path deprecated.' },
  xfinity:{ label: 'Xfinity (as MVPD)', requestor: null, headless: 'blocked', note: 'Own SSO + bot checks; not headless-able.' },
  directv:{ label: 'DirecTV (as MVPD)', requestor: null, headless: 'partial', note: 'Plain regcode screen; most viable MVPD for automation.' },
};

registerSource({
  id: 'tve',
  name: 'TV Everywhere (cable login)',
  type: 'tve',
  auth: 'tve',
  experimental: true,
  configSchema: { provider: 'key of PROVIDER_MATRIX' },

  async test(cfg) {
    const p = PROVIDER_MATRIX[cfg?.provider];
    if (!p) {
      const keys = Object.keys(PROVIDER_MATRIX).join(', ');
      return { ok: false, msg: `Pick a provider (${keys})` };
    }
    return {
      ok: false,
      msg: `${p.label}: ${p.headless}. ${p.note} Interactive login required — token capture is NOT implemented (SOURCES doc §TVE).`,
    };
  },

  async fetchChannels() {
    return { channels: [], streams: [] };
  },

  getPlayUrl() {
    throw new Error('TVE playback not implemented — every stream is license-bound; see SOURCES doc §TVE');
  },
});
