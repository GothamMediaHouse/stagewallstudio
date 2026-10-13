// Showcaller Multiview (the free multiviewer): the download form on /multiview/ and the version check the
// app makes at /api/multiview/latest. Used by worker.js.
// Settings (Cloudflare → Workers & Pages → stagewallstudio → Settings → Variables and secrets):
//   MULTIVIEW_VERSION          the current version, e.g. 1.4.1 (the app offers it to anyone on an older one)
//   MULTIVIEW_MAC_ARM_URL      download link for Apple Silicon Macs (the -arm64 .dmg)
//   MULTIVIEW_MAC_INTEL_URL    download link for Intel Macs
//   MULTIVIEW_WIN_URL          (optional) download link for Windows
//   MULTIVIEW_NOTES            (optional) one line on what's new, shown in the app
// Until MULTIVIEW_MAC_ARM_URL is set, the form takes emails for a waiting list instead.
// It also uses RESEND_API_KEY, CONTACT_TO and CONTACT_FROM from contact.js.
import { json } from './contact.js';

const PAGE = 'https://showcallerstudio.com/multiview/';
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const httpsOnly = (u) => (/^https:\/\/\S+$/.test(String(u || '')) ? String(u) : '');

function links(env) {
  const l = { macArm: httpsOnly(env.MULTIVIEW_MAC_ARM_URL), macIntel: httpsOnly(env.MULTIVIEW_MAC_INTEL_URL), win: httpsOnly(env.MULTIVIEW_WIN_URL) };
  return l.macArm ? l : null;
}

async function send(env, body) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.CONTACT_FROM || 'Showcaller Studio <hello@showcallerstudio.com>', ...body }),
  });
  if (!r.ok) console.log('resend', r.status, await r.text().catch(() => ''));
  return r.ok;
}

// POST /api/multiview {email, name?, ms, website}: emails the download links (and shows them on the page).
export async function multiviewDownload(request, env) {
  let d;
  try { d = await request.json(); } catch { return json({ error: 'That request couldn’t be read.' }, 400); }
  if (clean(d.website, 200) || Number(d.ms) < 1500) return json({ ok: true, waitlist: true }); // spam
  const email = clean(d.email, 200), name = clean(d.name, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'That email doesn’t look right.' }, 400);
  if (!env.RESEND_API_KEY || !env.CONTACT_TO) return json({ error: 'Downloads aren’t set up yet.' }, 503);
  const l = links(env), v = clean(env.MULTIVIEW_VERSION, 20);

  // tell Gotham Media House who asked
  await send(env, {
    to: env.CONTACT_TO.split(',').map((s) => s.trim()).filter(Boolean),
    reply_to: email,
    subject: `${l ? 'Multiview download' : 'Multiview waiting list'}: ${name || email}`,
    text: `${name ? `Name: ${name}\n` : ''}Email: ${email}\n${l ? `Sent the download links for ${v || 'the current version'}.` : 'Downloads aren’t open yet: they asked to be told.'}\n`,
  });
  if (!l) return json({ ok: true, waitlist: true });

  const rows = [['Mac with Apple silicon (M1 or later)', l.macArm], ['Mac with an Intel chip', l.macIntel], ['Windows', l.win]].filter(([, u]) => u);
  const ok = await send(env, {
    to: [email],
    subject: 'Your Showcaller Multiview download',
    text: `Thanks for trying Showcaller Multiview${v ? ` ${v}` : ''}.\n\n${rows.map(([k, u]) => `${k}:\n${u}`).join('\n\n')}\n\nYou'll also need NDI Tools (free): https://ndi.video/tools/\nSetup help: ${PAGE}\n\nShowcaller Studio, by Gotham Media House\nhttps://showcallerstudio.com\n`,
    html: `<div style="font:15px/1.6 system-ui,sans-serif;color:#111"><p>Thanks for trying <b>Showcaller Multiview</b>${v ? ` ${esc(v)}` : ''}.</p>`
      + rows.map(([k, u]) => `<p><a href="${esc(u)}" style="color:#b77400;font-weight:600">${esc(k)}</a></p>`).join('')
      + `<p>You'll also need <a href="https://ndi.video/tools/">NDI Tools</a> (free). Setup help is on <a href="${PAGE}">the Multiview page</a>.</p>`
      + `<p style="color:#666">Showcaller Studio, by Gotham Media House<br><a href="https://showcallerstudio.com">showcallerstudio.com</a></p></div>`,
  });
  return json({ ok: true, emailed: ok, version: v, links: l });
}

// GET /api/multiview/latest: what the app checks to offer an update.
export function multiviewLatest(request, env) {
  const v = clean(env.MULTIVIEW_VERSION, 20);
  return new Response(JSON.stringify({ version: /^\d+\.\d+\.\d+$/.test(v) ? v : null, notes: clean(env.MULTIVIEW_NOTES, 300), page: PAGE }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
}
