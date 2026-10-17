// Showcaller Hub's list of apps (GET /hub/catalog.json) with each app's full download filled in from the
// GitHub releases of this repo, and short download links for the website (GET /download/<app>/<platform>).
// Publishing is just a release: "Publish to the Hub.command" on the Mac uploads the zips the Install scripts
// make, as a release tagged <app>-<version> (e.g. timer-1.6.4), so nothing here needs a commit.
// Asset names: Showcaller-<Name>-<version>-mac-arm64.zip, …-mac-x64.zip, …-win-x64.exe
const REPO = 'GothamMediaHouse/stagewallstudio';
const VERSION = /^\d+\.\d+\.\d+$/;
const PLATFORM = /-(mac-arm64|mac-x64)\.zip$|-(win-x64)\.exe$/;
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

// { <app>: { version, builds: { <platform>: { url, sha256, size } } } }, newest release per app.
// Cached for 10 minutes (GitHub allows only so many requests without a token; GITHUB_TOKEN raises that).
async function releases(env) {
  const cache = caches.default, key = new Request('https://showcallerstudio.com/__hub-releases');
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const out = {};
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
      headers: { 'User-Agent': 'showcallerstudio.com', Accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) },
    });
    if (!r.ok) return out; // not cached, so the next request tries again
    for (const rel of await r.json()) {
      const m = String(rel.tag_name || '').match(/^([a-z]+)-(\d+\.\d+\.\d+)$/);
      if (!m || rel.draft || rel.prerelease) continue;
      const [, app, version] = m;
      if (out[app] && !newer(version, out[app].version)) continue;
      const builds = {};
      for (const a of rel.assets || []) {
        const p = String(a.name || '').match(PLATFORM);
        if (!p || a.state !== 'uploaded') continue;
        const sha = String(a.digest || '').replace(/^sha256:/, '');
        builds[p[1] || p[2]] = { url: a.browser_download_url, sha256: /^[0-9a-f]{64}$/.test(sha) ? sha : undefined, size: a.size };
      }
      if (Object.keys(builds).length) out[app] = { version, builds };
    }
    await cache.put(key, new Response(JSON.stringify(out), { headers: { 'Cache-Control': 'max-age=600' } }));
  } catch {}
  return out;
}

export async function hubCatalog(request, env) {
  // The list itself is public/hub/apps.json (a static file at /hub/catalog.json would be served without this)
  const r = await env.ASSETS.fetch(new Request(new URL('/hub/apps.json', request.url)));
  if (!r.ok) return r;
  const cat = await r.json();
  const rel = await releases(env);
  for (const a of cat.apps || []) {
    const got = rel[a.id];
    // A release wins over builds written into the file by hand, unless that one is newer
    if (got && (!VERSION.test(a.buildVersion || '') || !newer(a.buildVersion, got.version))) { a.buildVersion = got.version; a.builds = got.builds; }
  }
  return new Response(JSON.stringify(cat), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
}

// /download/hub/mac-arm64 → the newest Hub for Apple silicon Macs (for the website's Download buttons)
export async function download(request, env) {
  const m = new URL(request.url).pathname.match(/^\/download\/([a-z]+)\/(mac-arm64|mac-x64|win-x64)\/?$/);
  const b = m && (await releases(env))[m[1]]?.builds?.[m[2]];
  if (!b) return new Response('That download isn’t available yet.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return Response.redirect(b.url, 302);
}
