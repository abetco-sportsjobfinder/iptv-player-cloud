// CI-only: deploys worker.js to Cloudflare using the repo's own secrets.
// Never runs locally; never prints credentials.
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
if (!ACCOUNT_ID || !TOKEN) { console.error('missing CF_ACCOUNT_ID / CF_API_TOKEN'); process.exit(1); }

import { readFileSync } from 'node:fs';

const NAME = 'iptv-stream-proxy';
const KV_ID = 'de03ad5ba35e4d32b56e1c569ce2f183';
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;

const meta = {
  main_module: 'worker.js',
  compatibility_date: '2025-08-16',
  bindings: [{ type: 'kv_namespace', name: 'STATUS', namespace_id: KV_ID }],
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok && json.success !== false, json };
}

// 1) Upload module worker (multipart PUT).
{
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('worker.js', new Blob([readFileSync(new URL('../worker.js', import.meta.url), 'utf8')], { type: 'application/javascript+module' }), 'worker.js');
  const r = await api(`/workers/scripts/${NAME}`, { method: 'PUT', body: form });
  console.log('worker upload:', r.status, r.ok ? 'OK' : JSON.stringify(r.json.errors || r.json).slice(0, 300));
  if (!r.ok) process.exit(1);
}

// 2) Preserve the */5 probe cron.
{
  const r = await api(`/workers/scripts/${NAME}/schedules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ cron: '*/5 * * * *' }]),
  });
  console.log('cron:', r.status, r.ok ? 'OK' : JSON.stringify(r.json.errors || r.json).slice(0, 200));
}

// 3) Live verification (public endpoints only).
for (let i = 0; i < 6; i++) {
  await new Promise(r => setTimeout(r, 5000));
  try {
    const h = await (await fetch('https://iptv-stream-proxy.abetscrape.workers.dev/health')).json();
    if (h.ok) { console.log('live health: OK', JSON.stringify(h)); process.exit(0); }
  } catch { /* retry */ }
}
console.error('live health: NOT OK after retries');
process.exit(1);
