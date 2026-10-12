// The "Book a demo" form handler, used by worker.js for POST /api/contact. Sends the request through Resend.
// Settings (Cloudflare → Workers & Pages → stagewallstudio → Settings → Variables and secrets):
//   RESEND_API_KEY  (secret)  an API key from resend.com
//   CONTACT_TO                where requests go, e.g. you@yourcompany.com (comma-separate several)
//   CONTACT_FROM   (optional) defaults to "Showcaller Studio <hello@showcallerstudio.com>";
//                             the domain must be verified in Resend
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function contact(request, env) {
  let d;
  try { d = await request.json(); } catch { return json({ error: 'That request couldn’t be read.' }, 400); }
  // Spam: a hidden field people never fill in, and forms sent faster than a person could type
  if (clean(d.website, 200) || Number(d.ms) < 2500) return json({ ok: true });
  const f = { name: clean(d.name, 120), email: clean(d.email, 200), company: clean(d.company, 160), phone: clean(d.phone, 40), message: clean(d.message, 5000), plan: clean(d.plan, 120) };
  if (!f.name || !f.message) return json({ error: 'Add your name and a line about your set.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return json({ error: 'That email doesn’t look right.' }, 400);
  if (!env.RESEND_API_KEY || !env.CONTACT_TO) return json({ error: 'The form isn’t set up yet.' }, 503);

  const rows = [['Name', f.name], ['Email', f.email], ['Company', f.company], ['Phone', f.phone], ['Pricing picked', f.plan]].filter(([, v]) => v);
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${f.message}\n`;
  const html = `<table style="font:14px/1.5 system-ui,sans-serif">${rows.map(([k, v]) => `<tr><td style="color:#666;padding-right:12px">${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>`
    + `<p style="font:14px/1.6 system-ui,sans-serif;white-space:pre-wrap">${esc(f.message)}</p>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.CONTACT_FROM || 'Showcaller Studio <hello@showcallerstudio.com>',
      to: env.CONTACT_TO.split(',').map((s) => s.trim()).filter(Boolean),
      reply_to: f.email,
      subject: `Demo request: ${f.name}${f.company ? ` (${f.company})` : ''}`,
      text, html,
    }),
  });
  if (!r.ok) { console.log('resend', r.status, await r.text().catch(() => '')); return json({ error: 'It didn’t send.' }, 502); }
  return json({ ok: true });
}

export { json };
