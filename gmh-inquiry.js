// The project inquiry form on gothammediahouse.com (a static GitHub Pages site) posts here, to
// POST /api/gmh-inquiry, so it can reuse this Worker's Resend settings (RESEND_API_KEY, CONTACT_FROM).
// Inquiries go to GMH_INQUIRY_TO if set, otherwise info@gothammediahouse.com.
import { json } from './contact.js';

const ORIGINS = ['https://gothammediahouse.com', 'https://www.gothammediahouse.com'];
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cors(request) {
  const origin = request.headers.get('Origin') || '';
  return ORIGINS.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

function withCors(res, request) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors(request))) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export async function gmhInquiry(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== 'POST') return withCors(json({ error: 'Use POST' }, 405), request);
  return withCors(await send(request, env), request);
}

async function send(request, env) {
  let d;
  try { d = await request.json(); } catch { return json({ error: 'That request couldn’t be read.' }, 400); }
  // Spam: a hidden field people never fill in, and forms sent faster than a person could type
  if (clean(d.website, 200) || Number(d.ms) < 3000) return json({ ok: true });
  const f = {
    name: clean(d.name, 120), email: clean(d.email, 200), phone: clean(d.phone, 40), company: clean(d.company, 160),
    type: clean(d.type, 80), when: clean(d.when, 120), budget: clean(d.budget, 40), message: clean(d.message, 5000),
  };
  if (!f.name) return json({ error: 'Add your name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return json({ error: 'That email doesn’t look right.' }, 400);
  if (!f.message) return json({ error: 'Add a line about the project.' }, 400);
  if (!env.RESEND_API_KEY) return json({ error: 'The form isn’t set up yet.' }, 503);

  // Send from the address already verified in Resend, under the Gotham Media House name.
  const fromAddr = (env.CONTACT_FROM || 'hello@showcallerstudio.com').match(/<([^>]+)>/)?.[1] || env.CONTACT_FROM || 'hello@showcallerstudio.com';
  const to = (env.GMH_INQUIRY_TO || 'info@gothammediahouse.com').split(',').map((s) => s.trim()).filter(Boolean);
  const rows = [['Name', f.name], ['Email', f.email], ['Phone', f.phone], ['Company', f.company], ['Project', f.type], ['When', f.when], ['Budget', f.budget]].filter(([, v]) => v);
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${f.message}\n`;
  const html = `<table style="font:14px/1.5 system-ui,sans-serif">${rows.map(([k, v]) => `<tr><td style="color:#666;padding-right:12px">${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>`
    + `<p style="font:14px/1.6 system-ui,sans-serif;white-space:pre-wrap">${esc(f.message)}</p>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Gotham Media House website <${fromAddr}>`,
      to,
      reply_to: f.email,
      subject: `Project inquiry: ${f.name}${f.company ? ` (${f.company})` : ''}${f.type ? ` · ${f.type}` : ''}`,
      text, html,
    }),
  });
  if (!r.ok) { console.log('resend', r.status, await r.text().catch(() => '')); return json({ error: 'It didn’t send.' }, 502); }
  return json({ ok: true });
}
