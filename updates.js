// One-click app updates: the version checks every Showcaller app makes (GET /api/<app>/latest). When
// public/updates/<app>/latest.json is there, the answer also carries its signed update zip, which the
// app downloads, checks against the update key and installs itself (sc-update.js in each app).
// latest.json: { "version": "1.6.3", "notes": "one line", "zip": "/updates/timer/<file>.zip", "sha256": "…", "size": 123 }
// Made by `node sc-update.js pack` on the Mac with the update key; see README.md.
// Used by worker.js; multiview, timer and testkit keep their older answers (from the Cloudflare
// variables) when there's no newer zip.
const TOOLS = 'https://showcallerstudio.com/tools/';
export const APPS = {
  multiview: null, timer: null, testkit: null, // answered by multiview.js / tools.js first
  replay: TOOLS, iso: TOOLS, switcher: TOOLS, playback: TOOLS, intercom: 'https://showcallerstudio.com/intercom/', ndiwebcam: TOOLS, hub: TOOLS,
};
const VERSION = /^\d+\.\d+\.\d+$/;
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

async function readLatest(app, request, env) {
  try {
    const r = await env.ASSETS.fetch(new Request(new URL(`/updates/${app}/latest.json`, request.url)));
    if (!r.ok) return null;
    const u = await r.json();
    return u && VERSION.test(u.version || '') && typeof u.zip === 'string' && u.zip.startsWith(`/updates/${app}/`) ? u : null;
  } catch { return null; }
}

export const latestWithUpdate = (app, base) => async (request, env) => {
  const out = base ? await (await base(request, env)).json() : { version: null, notes: '', page: APPS[app], downloads: false };
  const u = await readLatest(app, request, env);
  if (u && (!VERSION.test(out.version || '') || !newer(out.version, u.version))) {
    Object.assign(out, { version: u.version, notes: String(u.notes || out.notes || '').slice(0, 300), zip: new URL(u.zip, request.url).href,
      sha256: /^[0-9a-f]{64}$/.test(u.sha256 || '') ? u.sha256 : undefined, size: Number(u.size) || undefined });
  }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
};
