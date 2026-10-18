// Online purchase through Stripe Checkout, used by worker.js:
//   POST /api/checkout        makes a Checkout page for what the price calculator shows and returns its address
//   POST /api/stripe-webhook  Stripe calls this when a payment goes through: a license key is made, emailed
//                             to the buyer (copy to CONTACT_TO), and kept on the payment in Stripe
//   GET  /api/order?s=…       the thank-you page asks for the key here
//   GET  /api/store           whether buying online is set up (the Buy button stays hidden until it is)
// Settings (Cloudflare → Workers & Pages → stagewallstudio → Settings → Variables and secrets):
//   STRIPE_SECRET_KEY      (secret)  sk_live_… (or sk_test_… to try it out) from Stripe → Developers → API keys
//   STRIPE_WEBHOOK_SECRET  (secret)  whsec_… from the webhook endpoint for /api/stripe-webhook
//   LICENSE_SIGNING_KEY    (secret)  the line in web-store-key-for-cloudflare.txt in the private Admin folder
//   RESEND_API_KEY, CONTACT_TO, CONTACT_FROM: the same ones the demo form uses
import { json } from './contact.js';

// Prices in US dollars per computer. Keep in step with the calculator in public/index.html.
const BASE = 590, ADD = 390, ALL = 990, RENT = { week: 79, month: 149 }, RENT_DAYS = { week: 7, month: 30 };
const SITE = 'https://showcallerstudio.com';
const DAY = 86400e3;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// What's being bought, worked out here from the choices (never from a price the page sends)
export function order(d) {
  const term = ['year', 'month', 'week'].includes(d.term) ? d.term : null;
  const n = Math.round(Number(d.n));
  if (!term || !(n >= 1 && n <= 20)) return { error: 'Pick yearly or a rental, and 1 to 20 computers.' };
  const rent = term !== 'year';
  const led = rent || !!d.led, proj = rent || !!d.proj;
  const each = rent ? RENT[term] : led && proj ? ALL : BASE + (led ? ADD : 0) + (proj ? ADD : 0);
  let start = null;
  if (rent) {
    start = /^\d{4}-\d{2}-\d{2}$/.test(String(d.start || '')) ? d.start : ymd(Date.now());
    const s = Date.parse(start + 'T00:00:00Z'), today = Date.parse(ymd(Date.now()) + 'T00:00:00Z');
    if (!(s >= today - DAY && s <= today + 365 * DAY)) return { error: 'Pick a first show day within the next year.' };
  }
  const name = rent ? `Showcaller Screens rental, one ${term}, everything included`
    : led && proj ? 'Showcaller Screens Everything, one year' : `Showcaller Screens${led ? ' + LED' : ''}${proj ? ' + Projection' : ''}, one year`;
  return { term, n, led, proj, each, start, name };
}
// The date the key ends: a year from today, or the rental's length from its first show day
export function endDate(o, now = Date.now()) {
  if (o.term === 'year') { const d = new Date(now); d.setUTCFullYear(d.getUTCFullYear() + 1); return ymd(d); }
  return ymd(Date.parse(o.start + 'T00:00:00Z') + (RENT_DAYS[o.term] - 1) * DAY);
}

async function stripe(env, method, path, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const r = await fetch(`https://api.stripe.com/v1${path}${method === 'GET' && body ? `?${body}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) },
    body: method === 'GET' ? undefined : body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${j.error?.message || 'no detail'}`);
  return j;
}

export async function checkout(request, env) {
  if (!env.STRIPE_SECRET_KEY || !env.LICENSE_SIGNING_KEY) return json({ error: 'Online purchase isn’t set up yet. Book a demo below and we’ll send a key.' }, 503);
  let d; try { d = await request.json(); } catch { return json({ error: 'That request couldn’t be read.' }, 400); }
  const o = order(d);
  if (o.error) return json({ error: o.error }, 400);
  const meta = { term: o.term, n: String(o.n), led: o.led ? '1' : '0', proj: o.proj ? '1' : '0', ...(o.start ? { start: o.start } : {}) };
  const p = {
    mode: 'payment',
    'line_items[0][quantity]': String(o.n),
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(o.each * 100),
    'line_items[0][price_data][product_data][name]': o.name,
    'line_items[0][price_data][product_data][description]': o.term === 'year' ? 'License key for one year, per set computer. Updates and support included.' : `License key for ${RENT_DAYS[o.term]} days from ${o.start}, per set computer.`,
    'custom_fields[0][key]': 'licensee',
    'custom_fields[0][label][type]': 'custom',
    'custom_fields[0][label][custom]': 'Name on the license (studio or company)',
    'custom_fields[0][type]': 'text',
    'custom_fields[0][optional]': 'true',
    'custom_fields[0][text][maximum_length]': '60',
    billing_address_collection: 'auto',
    allow_promotion_codes: 'true',
    success_url: `${SITE}/thanks.html?s={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/#pricing`,
  };
  for (const [k, v] of Object.entries(meta)) { p[`metadata[${k}]`] = v; p[`payment_intent_data[metadata][${k}]`] = v; }
  try {
    const s = await stripe(env, 'POST', '/checkout/sessions', p);
    return json({ url: s.url });
  } catch (e) { console.log('checkout', e.message); return json({ error: 'The checkout page couldn’t be opened. Please try again in a minute.' }, 502); }
}

// ---------- Stripe's signed calls ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function stripeSignatureOk(raw, header, secret, now = Date.now()) {
  const parts = Object.fromEntries(String(header || '').split(',').map((x) => x.split('=')).filter((x) => x.length === 2 && x[0] !== 'v1'));
  const sigs = String(header || '').split(',').filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${t}.${raw}`)));
  return sigs.some((s) => s.length === want.length && [...s].reduce((a, c, i) => a | (c.charCodeAt(0) ^ want.charCodeAt(i)), 0) === 0);
}

// ---------- license keys, in the same form the app and the Admin app use ----------
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function makeKey(env, { to, seats, exp, addons }) {
  const der = Uint8Array.from(atob(String(env.LICENSE_SIGNING_KEY).trim()), (c) => c.charCodeAt(0));
  let k;
  try { k = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']); }
  catch { k = await crypto.subtle.importKey('pkcs8', der, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }, false, ['sign']); }
  const id = 'WEB-' + hex(crypto.getRandomValues(new Uint8Array(4))).toUpperCase();
  const payload = { v: 1, id, to, seats, exp, ...(addons.length ? { f: addons } : {}), iat: ymd(Date.now()), src: 'web' };
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(k.algorithm.name === 'Ed25519' ? 'Ed25519' : { name: 'NODE-ED25519' }, k, body);
  return { payload, key: `UPS2-${b64url(body)}.${b64url(sig)}` };
}

async function sendMail(env, msg) {
  if (!env.RESEND_API_KEY) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.CONTACT_FROM || 'Showcaller Studio <hello@showcallerstudio.com>', ...msg }),
  });
  if (!r.ok) console.log('resend', r.status, await r.text().catch(() => ''));
  return r.ok;
}

// A paid Checkout: make the key once (it's kept on the payment, so a repeated call sends nothing new)
export async function fulfil(env, sessionId) {
  const s = await stripe(env, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`, { 'expand[]': 'payment_intent' });
  if (s.payment_status !== 'paid') return { pending: true };
  const pi = s.payment_intent;
  if (pi?.metadata?.license_key) return { done: false, key: pi.metadata.license_key };
  const m = s.metadata || {};
  const o = order({ term: m.term, n: m.n, led: m.led === '1', proj: m.proj === '1', start: m.start });
  if (o.error) throw new Error(`Session ${s.id} has no order details`);
  const buyer = s.customer_details || {};
  const named = (s.custom_fields || []).find((f) => f.key === 'licensee')?.text?.value;
  const to = clean(named || buyer.name || buyer.email || 'Showcaller Screens customer', 60);
  const exp = endDate(o);
  const addons = [...(o.led ? ['led'] : []), ...(o.proj ? ['projection'] : [])];
  const { payload, key } = await makeKey(env, { to, seats: o.n, exp, addons });
  // Kept on the payment: the thank-you page reads it there, the Admin app imports it, and it's never made twice
  await stripe(env, 'POST', `/payment_intents/${pi.id}`, { 'metadata[license_key]': key, 'metadata[license_id]': payload.id, 'metadata[licensee]': to, 'metadata[exp]': exp });

  const what = `${o.name}, ${o.n} computer${o.n === 1 ? '' : 's'}`;
  const amount = `$${((s.amount_total || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  const steps = ['Open Showcaller Screens on the set computer.', 'Go to Settings → License.', 'Paste the whole key below (it starts with UPS2-) and press Save.'];
  const text = `Thank you for buying Showcaller Screens.\n\n${what}\nLicensed to: ${to}\nKey ${payload.id}, ends ${exp}\n\nTo enter it:\n${steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n${key}\n\n`
    + `If the app isn't installed yet, reply to this email and we'll send the installer.\nA linked computer in the same set uses the main computer's key.\n\nGotham Media House`;
  const html = `<div style="font:15px/1.6 system-ui,sans-serif;max-width:560px">`
    + `<p>Thank you for buying Showcaller Screens.</p>`
    + `<p><b>${esc(what)}</b><br>Licensed to ${esc(to)}<br>Key ${esc(payload.id)}, ends ${esc(exp)}</p>`
    + `<p>To enter it:</p><ol>${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`
    + `<p style="font:13px/1.5 ui-monospace,Menlo,monospace;word-break:break-all;background:#f3f3f1;padding:12px;border-radius:6px">${esc(key)}</p>`
    + `<p>If the app isn’t installed yet, reply to this email and we’ll send the installer.</p><p>Gotham Media House</p></div>`;
  const team = String(env.CONTACT_TO || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (buyer.email) await sendMail(env, { to: [buyer.email], ...(team.length ? { reply_to: team[0] } : {}), subject: `Your Showcaller Screens license key (${payload.id})`, text, html });
  if (team.length) await sendMail(env, { to: team, ...(buyer.email ? { reply_to: buyer.email } : {}), subject: `Sold online: ${what} to ${to} (${amount})`,
    text: `${what}\nLicensed to: ${to}\nBuyer: ${buyer.name || ''} <${buyer.email || ''}>\nPaid: ${amount}\nKey ${payload.id}, ends ${exp}\nStripe: https://dashboard.stripe.com/payments/${pi.id}\n\nIn the Admin app, Sales → Import from Stripe adds it with the sale filled in.\n\n${key}\n` });
  return { done: true, key };
}

export async function webhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !env.LICENSE_SIGNING_KEY) return json({ error: 'Not set up' }, 503);
  const raw = await request.text();
  if (!(await stripeSignatureOk(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) return json({ error: 'Bad signature' }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: 'Bad body' }, 400); }
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    try { await fulfil(env, ev.data.object.id); }
    catch (e) { console.log('fulfil', e.message); return json({ error: 'Try again' }, 500); } // Stripe retries
  }
  return json({ received: true });
}

// The thank-you page: shows the key once the payment has gone through
export async function orderStatus(request, env) {
  const id = new URL(request.url).searchParams.get('s') || '';
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id) || !env.STRIPE_SECRET_KEY) return json({ error: 'No such order' }, 404);
  try {
    const s = await stripe(env, 'GET', `/checkout/sessions/${id}`, { 'expand[]': 'payment_intent' });
    const md = s.payment_intent?.metadata || {};
    if (!md.license_key) return json({ pending: true, paid: s.payment_status === 'paid' });
    return json({ key: md.license_key, id: md.license_id, to: md.licensee, exp: md.exp, email: s.customer_details?.email || '' });
  } catch (e) { console.log('order', e.message); return json({ error: 'That order couldn’t be looked up.' }, 502); }
}

export const storeOpen = (request, env) => json({ open: !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.LICENSE_SIGNING_KEY) });
