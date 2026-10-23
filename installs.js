// Who has Showcaller Hub and which apps it has installed, for the Installs tab in the Admin app.
//   POST /api/hub/report    the Hub, on start and after it installs or updates an app (only when the person
//                           has left "Share installed app versions" on): a random id for that computer, the Hub's
//                           version, the platform, and each installed app's version, plus the license keys' ids
//                           and client names. Nothing about shows, files or the computer itself.
//   GET  /api/hub/installs  the Admin app: every computer's latest report. Signed with the Admin key
//                           (X-Admin-Time + X-Admin-Sig over "showcaller-installs:<time>"), so only the Admin app reads it.
// Kept in one Durable Object (HubInstalls), one entry per computer.
import { DurableObject } from 'cloudflare:workers';
import { json } from './contact.js';

// The Admin app's public key (the one that signs license keys; the same as in sc-license.js)
const ADMIN_KEY = 'MCowBQYDK2VwAyEAvpyichJqpB8vsa2+8x/TeadG602NYx/7RV4XjNVv5hA=';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const MAX = 20000; // computers kept; new ones are turned away past this (old ones can still report)
const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const store = (env) => env.HUB_INSTALLS.get(env.HUB_INSTALLS.idFromName('all'));

export async function hubReport(request, env) {
  if (Number(request.headers.get('content-length')) > 20000) return json({ error: 'Too large' }, 413);
  let d;
  try { d = await request.json(); } catch { return json({ error: 'That request couldn’t be read.' }, 400); }
  if (!ID.test(d?.install || '')) return json({ error: 'No install id' }, 400);
  const apps = {};
  for (const [id, v] of Object.entries(d.apps && typeof d.apps === 'object' ? d.apps : {}).slice(0, 40)) {
    if (/^[a-z0-9-]{1,30}$/.test(id) && VERSION.test(v)) apps[id] = v;
  }
  const keys = (Array.isArray(d.keys) ? d.keys : []).slice(0, 10).map((k) => ({ id: text(k?.id, 40), c: text(k?.c, 40), to: text(k?.to, 80) })).filter((k) => k.id);
  const rec = {
    install: d.install, hub: VERSION.test(d.hub || '') ? d.hub : null, platform: /^(mac|win|linux)-[a-z0-9]{2,8}$/.test(d.platform || '') ? d.platform : null,
    os: text(d.os, 40), apps, keys, country: text(request.cf?.country, 4),
  };
  const r = await store(env).fetch('https://installs/report', { method: 'POST', body: JSON.stringify(rec) });
  return json(await r.json(), r.status);
}

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (s) => b64(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4));
async function adminSigned(request) {
  const t = Number(request.headers.get('x-admin-time')), sig = request.headers.get('x-admin-sig') || '';
  if (!t || Math.abs(Date.now() - t) > 5 * 60e3 || !/^[A-Za-z0-9_-]{80,100}$/.test(sig)) return false;
  try {
    const key = await crypto.subtle.importKey('spki', b64(ADMIN_KEY), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, b64url(sig), new TextEncoder().encode(`showcaller-installs:${t}`));
  } catch { return false; }
}

export async function hubInstalls(request, env) {
  if (!(await adminSigned(request))) return json({ error: 'Not allowed' }, 403);
  const r = await store(env).fetch('https://installs/list');
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export class HubInstalls extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/report') {
      const rec = await request.json(), k = `i:${rec.install}`;
      const old = await this.ctx.storage.get(k);
      if (!old) {
        const n = (await this.ctx.storage.get('count')) || 0;
        if (n >= MAX) return Response.json({ ok: false }, { status: 503 });
        await this.ctx.storage.put('count', n + 1);
      }
      const now = new Date().toISOString();
      await this.ctx.storage.put(k, { ...rec, first: old?.first || now, last: now });
      return Response.json({ ok: true });
    }
    if (url.pathname === '/list') {
      const all = await this.ctx.storage.list({ prefix: 'i:' });
      return Response.json({ installs: [...all.values()].sort((a, b) => (a.last < b.last ? 1 : -1)) });
    }
    return new Response('Not found', { status: 404 });
  }
}
