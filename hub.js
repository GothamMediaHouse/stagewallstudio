// Showcaller Hub's list of apps (GET /hub/catalog.json) with each app's full download filled in from the
// GitHub releases of this repo, and short download links for the website (GET /download/<app>/<platform>).
// Publishing is just a release: "Publish to the Hub.command" on the Mac uploads the zips the Install scripts
// make, as a release tagged <app>-<version> (e.g. timer-1.6.4), so nothing here needs a commit.
// Asset names: Showcaller-<Name>-<version>-mac-arm64.zip, …-mac-x64.zip, …-win-x64.exe
import { json } from './contact.js';
import { clean, send } from './multiview.js';

const REPO = 'GothamMediaHouse/stagewallstudio';
const VERSION = /^\d+\.\d+\.\d+$/;
const PLATFORM = /-(mac-arm64|mac-x64)\.zip$|-(win-x64)\.exe$/;
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

// { <app>: { version, builds: { <platform>: { url, sha256, size } } } }, newest release per app.
// Cached for 10 minutes. GitHub allows only 60 requests an hour without a token, shared with everything else on
// Cloudflare's addresses, so it often says no. public/hub/releases.json, the same list written by "Publish to the
// Hub.command" each time it publishes, always counts too. GITHUB_TOKEN, if set, makes GitHub say yes.
async function releases(env) {
  const cache = caches.default, key = new Request('https://showcallerstudio.com/__hub-releases');
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const out = await published(env), api = await fromGitHub(env);
  for (const [app, r] of Object.entries(api || {})) out[app] = combine(out[app], r);
  // A list GitHub refused isn't cached, so the next request asks again
  if (api) await cache.put(key, new Response(JSON.stringify(out), { headers: { 'Cache-Control': 'max-age=600' } }));
  return out;
}
// The releases on GitHub, or null when GitHub doesn't answer
async function fromGitHub(env) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
      headers: { 'User-Agent': 'showcallerstudio.com', Accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) },
    });
    return r.ok ? newest(await r.json()) : null;
  } catch { return null; }
}
// GitHub's list of releases → each app's newest download for each platform. A platform's build can be older
// than the app's newest version (the Windows version of an app can come out after the Mac one), so every build
// carries its own version; the app's version is the newest of them.
export function newest(list) {
  const out = {};
  for (const rel of list || []) {
    const m = String(rel.tag_name || '').match(/^([a-z][a-z-]*)-(\d+\.\d+\.\d+)$/); // also intercom-frame-3.7.0
    if (!m || rel.draft || rel.prerelease) continue;
    const [, app, version] = m;
    const builds = {};
    for (const a of rel.assets || []) {
      const p = String(a.name || '').match(PLATFORM);
      if (!p || a.state !== 'uploaded') continue;
      const sha = String(a.digest || '').replace(/^sha256:/, '');
      builds[p[1] || p[2]] = { url: a.browser_download_url, sha256: /^[0-9a-f]{64}$/.test(sha) ? sha : undefined, size: a.size, version };
    }
    if (Object.keys(builds).length) out[app] = combine(out[app], { version, builds });
  }
  return out;
}
// Two lists of one app's builds → the newer build for each platform (a build without its own version is the list's)
function combine(a, b) {
  if (!a) return b;
  if (!b) return a;
  const builds = {};
  for (const r of [a, b]) for (const [p, x] of Object.entries(r.builds || {})) {
    const v = VERSION.test(x.version || '') ? x.version : r.version;
    if (!builds[p] || newer(v, builds[p].version)) builds[p] = { ...x, version: v };
  }
  return { version: newer(b.version, a.version) ? b.version : a.version, builds };
}
// The list Publish to the Hub wrote (public/hub/releases.json: { apps: <the same shape> })
async function published(env) {
  try {
    const r = await env.ASSETS.fetch(new Request('https://showcallerstudio.com/hub/releases.json'));
    const j = r.ok ? await r.json() : null;
    return j && j.apps && typeof j.apps === 'object' ? j.apps : {};
  } catch { return {}; }
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
  const m = new URL(request.url).pathname.match(/^\/download\/([a-z][a-z-]*)\/(mac-arm64|mac-x64|win-x64)\/?$/);
  const b = m && (await releases(env))[m[1]]?.builds?.[m[2]];
  if (!b) return new Response('That download isn’t available yet.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return Response.redirect(b.url, 302);
}

// POST /api/hub-download {email, p, ms, website}: the Apps page asks for an email before the Hub download. Gotham
// Media House gets an email saying who downloaded it, the visitor gets a welcome email with the link and how to
// start (at most one a day per address, so the form can't be used to flood someone), then the page starts the
// download (/download/hub/<p>). A failed email never stops the download.
const PLATFORMS = { 'mac-arm64': 'Mac (Apple silicon)', 'mac-x64': 'Mac (Intel)', 'win-x64': 'Windows' };
export async function hubDownload(request, env) {
  let d;
  try { d = await request.json(); } catch { return json({ error: 'That request couldn’t be read.' }, 400); }
  const p = clean(d.p, 20), email = clean(d.email, 200);
  if (!PLATFORMS[p]) return json({ error: 'Pick a download.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter your email to download.' }, 400);
  const url = `/download/hub/${p}`;
  if (clean(d.website, 200) || Number(d.ms) < 1500) return json({ ok: true, url }); // a bot: nothing to tell anyone
  if (env.RESEND_API_KEY && env.CONTACT_TO) {
    const v = (await releases(env)).hub?.version, us = env.CONTACT_TO.split(',').map((x) => x.trim()).filter(Boolean);
    await Promise.all([
      send(env, { to: us, reply_to: email, subject: `Showcaller Hub download: ${email}`, text: `Email: ${email}\nDownloaded: Showcaller Hub${v ? ` ${v}` : ''} for ${PLATFORMS[p]}\n` }),
      welcome(env, email, p, us[0]),
    ]);
  }
  return json({ ok: true, url });
}

// The visitor's welcome email: the download link again and the first steps
async function welcome(env, email, p, replyTo) {
  const cache = caches.default, key = new Request(`https://showcallerstudio.com/__hub-welcome/${encodeURIComponent(email.toLowerCase())}`);
  if (await cache.match(key)) return;
  await cache.put(key, new Response('1', { headers: { 'Cache-Control': 'max-age=86400' } }));
  const link = `https://showcallerstudio.com/download/hub/${p}`, win = p === 'win-x64';
  const steps = win
    ? ['Open the file you downloaded and follow the installer.', 'Showcaller Hub opens: click Install next to each app you want.', 'Paid apps start with a 14-day free trial. When you have a license key, paste it in the Hub under License.']
    : ['Open the zip you downloaded and drag Showcaller Hub into your Applications folder.', 'Open Showcaller Hub and click Install next to each app you want.', 'Paid apps start with a 14-day free trial. When you have a license key, paste it in the Hub under License.'];
  const esc = (x) => x.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  await send(env, {
    to: [email],
    ...(replyTo ? { reply_to: replyTo } : {}),
    subject: 'Welcome to Showcaller Hub',
    text: `Thanks for downloading Showcaller Hub for ${PLATFORMS[p]}.\n\nIf the download didn't start, here it is again:\n${link}\n\nGetting started:\n${steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nQuestions? Just reply to this email.\n\nShowcaller Studio, by Gotham Media House\nhttps://showcallerstudio.com\n\nYou're getting this because you entered your email to download Showcaller Hub. We'll only email you about Showcaller.\n`,
    html: `<div style="font:15px/1.6 system-ui,sans-serif;color:#111"><p>Thanks for downloading <b>Showcaller Hub</b> for ${esc(PLATFORMS[p])}.</p>`
      + `<p>If the download didn't start: <a href="${esc(link)}" style="color:#b77400;font-weight:600">download Showcaller Hub</a></p>`
      + `<p><b>Getting started</b></p><ol>${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`
      + `<p>Questions? Just reply to this email.</p><p>Showcaller Studio, by Gotham Media House<br><a href="https://showcallerstudio.com">showcallerstudio.com</a></p>`
      + `<p style="color:#777;font-size:12px">You're getting this because you entered your email to download Showcaller Hub. We'll only email you about Showcaller.</p></div>`,
  });
}
