// The free tools page (/tools/): its "Get notified" forms (POST /api/notify) and the version checks the
// coming apps make (GET /api/timer/latest, GET /api/testkit/latest). Used by worker.js.
// Settings (Cloudflare → Workers & Pages → stagewallstudio → Settings → Variables and secrets):
//   TIMER_VERSION, TESTKIT_VERSION   the current version of each app, e.g. 1.0.0 (null in the check until set)
//   TIMER_NOTES, TESTKIT_NOTES       (optional) one line on what's new, shown in the app
// It also uses RESEND_API_KEY, CONTACT_TO and CONTACT_FROM from contact.js.
import { json } from './contact.js';
import { clean, send, multiviewDownload } from './multiview.js';

const PAGE = 'https://showcallerstudio.com/tools/';
const TOOLS = {
  multiview: 'Showcaller Multiview',
  timer: 'Showcaller Timer',
  testkit: 'Showcaller Test Kit',
  companion: 'Showcaller Studio for Bitfocus Companion',
  hub: 'Showcaller Hub', // the apps page (/apps/), until the Hub's download is online
};

// POST /api/notify {tool, email, name?, ms, website}: puts the visitor on a tool's waiting list.
// Multiview goes through its own handler, so it behaves exactly as the form on /multiview/ does.
export async function toolNotify(request, env) {
  let d;
  try { d = await request.clone().json(); } catch { return json({ error: 'That request couldn’t be read.' }, 400); }
  const tool = clean(d.tool, 20);
  if (!TOOLS[tool]) return json({ error: 'Pick one of the tools.' }, 400);
  if (tool === 'multiview') return multiviewDownload(request, env);
  if (clean(d.website, 200) || Number(d.ms) < 1500) return json({ ok: true, waitlist: true }); // spam
  const email = clean(d.email, 200), name = clean(d.name, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'That email doesn’t look right.' }, 400);
  if (!env.RESEND_API_KEY || !env.CONTACT_TO) return json({ error: 'Sign-ups aren’t set up yet.' }, 503);

  // tell Gotham Media House who asked, and for which tool
  const ok = await send(env, {
    to: env.CONTACT_TO.split(',').map((s) => s.trim()).filter(Boolean),
    reply_to: email,
    subject: `${TOOLS[tool]} waiting list: ${name || email}`,
    text: `${name ? `Name: ${name}\n` : ''}Email: ${email}\nTool: ${TOOLS[tool]} (${tool})\nIt isn’t out yet: they asked to be told when it is.\n`,
  });
  if (!ok) return json({ error: 'It didn’t send.' }, 502);
  return json({ ok: true, waitlist: true, tool });
}

// GET /api/timer/latest and /api/testkit/latest: what each app checks to offer an update, in the same
// shape as /api/multiview/latest. There are no downloads to hand out from here yet.
const latest = (prefix, anchor) => (request, env) => {
  const v = clean(env[`${prefix}_VERSION`], 20);
  return new Response(JSON.stringify({ version: /^\d+\.\d+\.\d+$/.test(v) ? v : null, notes: clean(env[`${prefix}_NOTES`], 300), page: `${PAGE}#${anchor}`, downloads: false }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
};
export const timerLatest = latest('TIMER', 'timer');
export const testkitLatest = latest('TESTKIT', 'testkit');
