// Showcaller Sessions accounts: sign in with an emailed link (no passwords). An account holds its sessions (rooms), so
// they work on any Mac the owner signs in on, and the dashboard at /sessions/account/ lists each session's plan, takes
// and edit links, and invites editors by email. One Durable Object per account, named by a hash of the email.
//
//   POST …/sessions/auth/start {email, device?}   emails a sign-in link (device: the app's own code, to collect its key)
//   GET  …/sessions/auth/verify?a&t               a page with a Sign in button (email scanners open links; only the POST signs in)
//   POST …/sessions/auth/verify                   signs this browser in (cookie sss) and hands the app its key if it asked
//   GET  …/sessions/auth/poll?a&d                 the app waiting for its key: {wait} until the link is used, then {token, email} once
//   POST …/sessions/auth/logout
//   GET  …/sessions/acct/me                       the account and its sessions
//   POST …/sessions/acct/rooms {rooms:[{id, secret, name, created}]}   the app adds its sessions (checked with each room's key)
//   POST …/sessions/acct/rooms/remove {id}
//   GET  …/sessions/acct/rooms/keys               the app on another Mac gets the sessions with their keys (app sign-ins only)
//   GET  …/sessions/acct/room?id                  one session for the dashboard: plan, takes, guest and edit links
//   POST …/sessions/acct/invite {room, take, email}   emails an editor the take's edit link
//   POST …/sessions/acct/members {room, email, remove?}   lets someone else (a client producing the show) see one session
//        on their own dashboard: plan, links, takes and edit links, never the room's key or the owner's other sessions
// Signed in = header "Authorization: Bearer <account>.<key>" (the app) or the cookie sss=<account>.<key> (the dashboard).
// Tests: with SESSIONS_AUTH_FAKE set and no RESEND_API_KEY, emails aren't sent and their links come back in the answer.
import { DurableObject } from 'cloudflare:workers';
import { editKey, producerKey } from './sessions.js';

const ACCT = /^[a-f0-9]{32}$/, ROOM = /^[a-z0-9]{8,24}$/, TAKE = /^t\d{2,4}$/;
const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const rand = (n = 24) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const j = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h } });
const clean = (s, n = 60) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400e3, WEB_DAYS = 30, APP_DAYS = 365, LINK_MIN = 15;
export const accountId = async (email) => (await sha(`showcaller-sessions-account:${email}`)).slice(0, 32);
const acct = (env, a) => env.SESSIONS_ACCOUNT.get(env.SESSIONS_ACCOUNT.idFromName(a));
const roomDO = (env, r) => env.SESSIONS_ROOM.get(env.SESSIONS_ROOM.idFromName(r));
const cookieOf = (request) => (/(?:^|;\s*)sss=([a-f0-9]{32}\.[A-Za-z0-9_-]{20,80})/.exec(request.headers.get('Cookie') || '') || [])[1] || '';
const setCookie = (v, days) => `sss=${v}; Path=/sessions; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.round(days * 86400)}`;

async function mail(env, to, subject, text, html) {
  if (!env.RESEND_API_KEY) return { fake: !!env.SESSIONS_AUTH_FAKE };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.CONTACT_FROM || 'Showcaller Studio <hello@showcallerstudio.com>', to: [to], subject, text, html }),
  });
  if (!r.ok) { console.log('resend', r.status, await r.text().catch(() => '')); throw Object.assign(new Error(`The email didn’t send (${r.status})`), { status: 502 }); }
  return {};
}
const button = (link, label) => `<p style="margin:22px 0"><a href="${esc(link)}" style="background:#7d58f0;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;display:inline-block">${esc(label)}</a></p>`;
const wrap = (body) => `<div style="font:15px/1.55 system-ui,-apple-system,sans-serif;color:#16171a;max-width:520px">${body}<p style="color:#777;font-size:12px;margin-top:28px">Showcaller Sessions · showcallerstudio.com</p></div>`;

export async function accounts(request, env) {
  const url = new URL(request.url), p = url.pathname;
  if (!env.SESSIONS_ACCOUNT) return j({ error: 'Accounts aren’t set up on this site yet' }, 503);
  const post = request.method === 'POST';
  // the dashboard signs in with a cookie, so its POSTs must come from this site
  const sameSite = !post || !request.headers.get('Origin') || request.headers.get('Origin') === url.origin;
  if (p === '/sessions/auth/start' && post) {
    if (!sameSite && !request.headers.get('X-Sessions-App')) return j({ error: 'Not from this site' }, 403);
    let b; try { b = await request.json(); } catch { return j({ error: 'That request couldn’t be read' }, 400); }
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    if (!EMAIL.test(email)) return j({ error: 'That email doesn’t look right' }, 400);
    const device = /^[A-Za-z0-9_-]{20,80}$/.test(b.device || '') ? b.device : '';
    const a = await accountId(email);
    return acct(env, a).fetch(new Request(`https://acct/start?origin=${encodeURIComponent(url.origin)}`, { method: 'POST', body: JSON.stringify({ email, a, device }) }));
  }
  if (p === '/sessions/auth/verify') {
    const a = url.searchParams.get('a') || '', t = url.searchParams.get('t') || '';
    if (request.method === 'GET') return verifyPage(a, t);
    if (!post || !sameSite) return j({ error: 'Use the button in the email' }, 405);
    const f = await request.formData().catch(() => null), fa = String(f?.get('a') || ''), ft = String(f?.get('t') || '');
    if (!ACCT.test(fa)) return verifyPage('', '', 'This sign-in link isn’t right. Ask for a new one.');
    const res = await acct(env, fa).fetch(new Request('https://acct/verify', { method: 'POST', body: JSON.stringify({ t: ft }) }));
    const o = await res.json();
    if (!res.ok) return verifyPage('', '', o.error || 'That didn’t work. Ask for a new link.');
    return new Response(null, { status: 303, headers: { Location: `/sessions/account/${o.app ? '?app=1' : ''}`, 'Set-Cookie': setCookie(`${fa}.${o.token}`, WEB_DAYS), 'Cache-Control': 'no-store' } });
  }
  if (p === '/sessions/auth/poll' && request.method === 'GET') {
    const a = url.searchParams.get('a') || '', d = url.searchParams.get('d') || '';
    if (!ACCT.test(a) || !/^[A-Za-z0-9_-]{20,80}$/.test(d)) return j({ error: 'Bad request' }, 400);
    return acct(env, a).fetch(new Request(`https://acct/poll?d=${encodeURIComponent(d)}`));
  }
  // everything else needs a sign-in
  const bearer = (/^Bearer\s+([a-f0-9]{32}\.[A-Za-z0-9_-]{20,80})$/.exec(request.headers.get('Authorization') || '') || [])[1] || '';
  const tok = bearer || cookieOf(request);
  if (!bearer && !sameSite) return j({ error: 'Not from this site' }, 403);
  if (p === '/sessions/auth/logout' && post) {
    if (tok) await acct(env, tok.slice(0, 32)).fetch(new Request('https://acct/logout', { method: 'POST', headers: { 'X-Tok': tok.slice(33) } }));
    return j({ ok: true }, 200, bearer ? {} : { 'Set-Cookie': setCookie('', 0) });
  }
  if (!tok) return j({ error: 'Sign in first', signin: true }, 401);
  const op = p.slice('/sessions/acct/'.length);
  if (!['me', 'rooms', 'rooms/remove', 'rooms/keys', 'room', 'invite', 'members'].includes(op)) return j({ error: 'Unknown' }, 404);
  const body = post ? await request.text() : undefined; if (body && body.length > 200000) return j({ error: 'Too big' }, 413);
  return acct(env, tok.slice(0, 32)).fetch(new Request(`https://acct/${op}?${url.searchParams}&origin=${encodeURIComponent(url.origin)}`, { method: request.method, headers: { 'X-Tok': tok.slice(33) }, body }));
}

function verifyPage(a, t, error) {
  const ok = !error && ACCT.test(a) && /^[A-Za-z0-9_-]{20,80}$/.test(t);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Sign in · Showcaller Sessions</title><link rel="icon" href="/favicon-32.png"><link rel="stylesheet" href="/sessions/guest/sessions.css"><link rel="stylesheet" href="/sessions/account/account.css"></head>
<body><main class="acc-center"><div class="card acc-box"><h1>Showcaller Sessions</h1>${ok
    ? `<p>Sign in to see your sessions, plans and takes.</p><form method="post" action="/sessions/auth/verify"><input type="hidden" name="a" value="${esc(a)}"><input type="hidden" name="t" value="${esc(t)}"><button class="btn big" id="go">Sign in</button></form>`
    : `<p class="acc-err">${esc(error || 'This sign-in link isn’t right. Ask for a new one.')}</p><p><a class="btn soft" href="/sessions/account/">Get a new link</a></p>`}</div></main>
<script>try{const t=localStorage.getItem('sess-theme');if(t)document.documentElement.dataset.theme=t}catch{}</script></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin' } });
}

export class SessionsAccount extends DurableObject {
  async get(k, d) { return (await this.ctx.storage.get(k)) ?? d; }

  async fetch(request) {
    const url = new URL(request.url), op = url.pathname.slice(1), now = Date.now();
    const origin = /^https?:\/\/[a-z0-9.:-]+$/i.test(url.searchParams.get('origin') || '') ? url.searchParams.get('origin') : 'https://showcallerstudio.com';
    try {
      if (op === 'start') {
        const b = await request.json(), sent = (await this.get('sent', [])).filter((x) => x > now - 3600e3);
        if (sent.length >= 5) return j({ error: 'That’s 5 sign-in emails this hour. Use the newest one, or try again later.' }, 429);
        const t = rand(), logins = (await this.get('logins', [])).filter((x) => x.exp > now).slice(-4);
        logins.push({ h: await sha(t), exp: now + LINK_MIN * 60e3, dev: b.device ? await sha(b.device) : '' });
        sent.push(now);
        await this.ctx.storage.put({ logins, sent, email: b.email, a: b.a });
        const link = `${origin}/sessions/auth/verify?a=${b.a}&t=${t}`;
        const m = await mail(this.env, b.email, 'Sign in to Showcaller Sessions',
          `Sign in to Showcaller Sessions:\n${link}\n\nThe link works once, for ${LINK_MIN} minutes. If you didn’t ask for it, you can ignore this email.`,
          wrap(`<p>Here’s your link to sign in to Showcaller Sessions${b.device ? ' on your Mac' : ''}.</p>${button(link, 'Sign in')}<p style="color:#666;font-size:13px">It works once, for ${LINK_MIN} minutes. If you didn’t ask for it, you can ignore this email.</p>`));
        return j({ ok: true, a: b.a, ...(m.fake ? { link } : {}) });
      }
      if (op === 'verify') {
        const b = await request.json(), h = await sha(String(b.t || '')), logins = await this.get('logins', []);
        const l = logins.find((x) => x.h === h && x.exp > now);
        if (!l) return j({ error: 'This sign-in link has been used or has run out. Ask for a new one.' }, 403);
        await this.ctx.storage.put('logins', logins.filter((x) => x !== l));
        const token = await this.newSession('web');
        if (l.dev) await this.ctx.storage.put(`dev:${l.dev}`, { token: await this.newSession('app'), exp: now + LINK_MIN * 60e3 });
        return j({ token, app: !!l.dev });
      }
      if (op === 'poll') {
        const k = `dev:${await sha(url.searchParams.get('d') || '')}`, d = await this.get(k);
        if (!d) return j({ wait: true });
        await this.ctx.storage.delete(k);
        if (d.exp < now) return j({ error: 'That sign-in ran out. Try again.' }, 410);
        return j({ token: `${await this.get('a')}.${d.token}`, email: await this.get('email') });
      }
      // between accounts only (the worker never sends these paths): the owner shares a session with this account,
      // and this account asks the owner's for a session it was given
      if (op === 'share') {
        const b = await request.json(), shared = (await this.get('shared', [])).filter((x) => !(x.owner === b.owner && x.id === b.room));
        if (!b.remove) shared.push({ owner: b.owner, id: b.room, name: clean(b.name), by: clean(b.by, 120), at: now });
        await this.ctx.storage.put(b.email && !(await this.get('email')) ? { shared, email: b.email, a: b.a } : { shared });
        return j({ ok: true });
      }
      if (op === 'sharedview') {
        const r = (await this.get('rooms', [])).find((x) => x.id === url.searchParams.get('room'));
        if (!r || !(r.members || []).some((m) => m.a === url.searchParams.get('m'))) return j({ error: 'This session isn’t shared with you any more' }, 404);
        const v = await this.roomView(r, origin); delete v.members; return j({ ...v, shared: true, by: await this.get('email') });
      }
      // signed in from here on
      const sk = `s:${await sha(request.headers.get('X-Tok') || '')}`, sess = await this.get(sk);
      if (!sess || sess.exp < now) { if (sess) await this.ctx.storage.delete(sk); return j({ error: 'Sign in again', signin: true }, 401); }
      if (op === 'logout') { await this.ctx.storage.delete(sk); return j({ ok: true }); }
      const rooms = await this.get('rooms', []), email = await this.get('email');
      const pub = (r) => ({ id: r.id, name: r.name, created: r.created, added: r.added });
      if (op === 'me') return j({ email, app: sess.kind === 'app', rooms: rooms.map(pub), shared: (await this.get('shared', [])).map((x) => ({ id: x.id, name: x.name, by: x.by, created: x.at, shared: true })) });
      if (op === 'rooms' && request.method === 'POST') {
        const b = JSON.parse(await request.text() || '{}'), bad = [];
        for (const x of (Array.isArray(b.rooms) ? b.rooms : []).slice(0, 50)) {
          if (!ROOM.test(x.id || '') || typeof x.secret !== 'string' || x.secret.length < 20) { bad.push(x.id); continue; }
          // the room's own key decides: it claims a room nobody has opened yet, and refuses one that belongs to another key
          const res = await roomDO(this.env, x.id).fetch(new Request('https://room/plan', { headers: { 'X-Session-Secret': x.secret } }));
          if (!res.ok) { bad.push(x.id); continue; }
          const cfg = (await res.json()).cfg || {}, was = rooms.find((r) => r.id === x.id);
          const r = { id: x.id, secret: x.secret, name: clean(x.name) || cfg.name || 'Session', created: Number(x.created) || was?.created || now, added: was?.added || now };
          if (was) Object.assign(was, r); else rooms.push(r);
        }
        if (rooms.length > 300) return j({ error: 'That’s too many sessions for one account' }, 400);
        await this.ctx.storage.put('rooms', rooms);
        return j({ rooms: rooms.map(pub), bad });
      }
      if (op === 'rooms/remove' && request.method === 'POST') {
        const id = JSON.parse(await request.text() || '{}').id;
        await this.ctx.storage.put('rooms', rooms.filter((r) => r.id !== id));
        return j({ ok: true });
      }
      if (op === 'rooms/keys') {
        if (sess.kind !== 'app') return j({ error: 'Only the Sessions app can get the keys' }, 403);
        return j({ rooms: rooms.map((r) => ({ ...pub(r), secret: r.secret })) });
      }
      const r = rooms.find((x) => x.id === (url.searchParams.get('id') || url.searchParams.get('room')));
      if (op === 'room') {
        if (!r) {
          const sh = (await this.get('shared', [])).find((x) => x.id === url.searchParams.get('id'));
          if (!sh) return j({ error: 'That session isn’t in your account' }, 404);
          const res = await acct(this.env, sh.owner).fetch(new Request(`https://acct/sharedview?room=${sh.id}&m=${await this.get('a')}&origin=${encodeURIComponent(origin)}`));
          return new Response(res.body, res);
        }
        return j(await this.roomView(r, origin));
      }
      if (op === 'members' && request.method === 'POST') {
        const b = JSON.parse(await request.text() || '{}'), to = String(b.email || '').trim().toLowerCase().slice(0, 120), rr = rooms.find((x) => x.id === b.room);
        if (!rr) return j({ error: 'That session isn’t in your account' }, 404);
        if (!EMAIL.test(to)) return j({ error: 'That email doesn’t look right' }, 400);
        if (to === email) return j({ error: 'That’s you' }, 400);
        const ma = await accountId(to), members = (rr.members || []).filter((m) => m.a !== ma);
        if (!b.remove) { if (members.length >= 10) return j({ error: 'That’s 10 people on this session already' }, 400); members.push({ email: to, a: ma, at: now }); }
        rr.members = members; await this.ctx.storage.put('rooms', rooms);
        await acct(this.env, ma).fetch(new Request('https://acct/share', { method: 'POST', body: JSON.stringify({ owner: await this.get('a'), room: rr.id, name: rr.name, by: email, remove: !!b.remove, email: to, a: ma }) }));
        let m = {};
        if (!b.remove) {
          const link = `${origin}/sessions/account/?s=${rr.id}`;
          m = await mail(this.env, to, `${email} shared “${rr.name}” with you`,
            `${email} shared the session “${rr.name}” with you in Showcaller Sessions: the plan, the guest and producer links, and the takes.\n\nSign in with this email address to see it: ${link}`,
            wrap(`<p><b>${esc(email)}</b> shared the session <b>${esc(rr.name)}</b> with you in Showcaller Sessions: the plan, the guest and producer links, and the takes.</p>${button(link, 'See the session')}<p style="color:#666;font-size:13px">Sign in with this email address (${esc(to)}). There’s no password.</p>`));
        }
        return j({ ok: true, members: members.map((x) => ({ email: x.email, at: x.at })), ...(m.fake ? { link: `${origin}/sessions/account/?s=${rr.id}` } : {}) });
      }
      if (op === 'invite' && request.method === 'POST') {
        const b = JSON.parse(await request.text() || '{}'), to = String(b.email || '').trim().toLowerCase().slice(0, 120);
        const rr = rooms.find((x) => x.id === b.room);
        if (!rr) return j({ error: 'That session isn’t in your account' }, 404);
        if (!TAKE.test(b.take || '')) return j({ error: 'No such take' }, 404);
        if (!EMAIL.test(to)) return j({ error: 'That email doesn’t look right' }, 400);
        const link = await this.editLink(rr, b.take, origin);
        if (!link) return j({ error: 'Share this take from the studio app first (Edit together)' }, 409);
        const day = new Date().toISOString().slice(0, 10), u = await this.get('inv', {});
        if (u.day !== day) { u.day = day; u.n = 0; }
        if (u.n >= 40) return j({ error: 'That’s 40 invites today, try again tomorrow' }, 429);
        u.n++; await this.ctx.storage.put('inv', u);
        const show = esc(rr.name), name = clean(b.take);
        const m = await mail(this.env, to, `Help edit “${rr.name}” (${name})`,
          `${email} asked you to help edit “${rr.name}” (${name}) in Showcaller Sessions.\n\nOpen the edit in your browser: ${link}\n\nYou edit by deleting words from the transcript. Anyone with this link can edit this take, so keep it to yourself.`,
          wrap(`<p><b>${esc(email)}</b> asked you to help edit <b>${show}</b> (${esc(name)}) in Showcaller Sessions.</p><p>It opens in your browser. You edit by deleting words from the transcript, and everyone editing sees each change as it happens.</p>${button(link, 'Open the edit')}<p style="color:#666;font-size:13px">Anyone with this link can edit this take, so keep it to yourself.</p>`));
        return j({ ok: true, ...(m.fake ? { link } : {}) });
      }
      return j({ error: 'Unknown' }, 404);
    } catch (e) { return j({ error: e.status ? e.message : 'Something went wrong' }, e.status || (e instanceof SyntaxError ? 400 : 500)); }
  }

  async newSession(kind) {
    const t = rand(), now = Date.now();
    // drop old sign-ins as new ones come
    const old = await this.ctx.storage.list({ prefix: 's:' });
    for (const [k, v] of old) if (v.exp < now) await this.ctx.storage.delete(k);
    await this.ctx.storage.put(`s:${await sha(t)}`, { kind, at: now, exp: now + (kind === 'app' ? APP_DAYS : WEB_DAYS) * DAY });
    return t;
  }

  async editLink(r, take, origin) {
    if (!this.env.SESSIONS || !await this.env.SESSIONS.head(`e/${r.id}/${take}/data.json`)) return '';
    return `${origin}/s/${r.id}/edit/${take}?k=${await editKey(await sha(`showcaller-sessions:${r.secret}`), take)}`;
  }

  async roomView(r, origin) {
    const h = { 'X-Session-Secret': r.secret };
    const [pr, tr] = await Promise.all([roomDO(this.env, r.id).fetch(new Request('https://room/plan', { headers: h })), roomDO(this.env, r.id).fetch(new Request('https://room/takes', { headers: h }))]);
    if (!pr.ok) return { id: r.id, name: r.name, error: 'This session’s key has changed. Open it in the studio app to fix it.' };
    const { plan, cfg } = await pr.json(), t = tr.ok ? await tr.json() : { takes: [] };
    const owner = await sha(`showcaller-sessions:${r.secret}`), pk = await producerKey(owner);
    // takes shared for editing are listed even if the room's own list no longer has them
    const list = (t.takes || []).slice(-40);
    const shared = this.env.SESSIONS ? (await this.env.SESSIONS.list({ prefix: `e/${r.id}/`, delimiter: '/' })).delimitedPrefixes.map((x) => x.split('/')[2]) : [];
    for (const id of shared) if (TAKE.test(id) && !list.some((x) => x.id === id)) list.push({ id, n: Number(id.slice(1)), at: 0, end: 0, people: {} });
    list.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const takes = await Promise.all(list.reverse().map(async (x) => ({
      id: x.id, n: x.n, at: x.at, end: x.end, quality: x.quality, solo: !!x.solo, people: Object.values(x.people || {}), marks: (x.marks || []).length,
      edit: await this.editLink(r, x.id, origin),
    })));
    return {
      id: r.id, name: r.name || cfg.name, quality: cfg.quality, link: `${origin}/s/${r.id}`, producer: `${origin}/s/${r.id}?producer=${pk}`,
      plan: { at: plan.at, tz: plan.tz, rundown: plan.rundown, mins: plan.rundown.reduce((s, x) => s + x.min, 0), checks: plan.checks || [],
        guests: plan.guests.map((g) => ({ name: g.name, email: g.email, role: g.role, sent: g.sent, check: g.check, link: `${origin}/s/${r.id}?${g.role === 'producer' ? `producer=${pk}&` : ''}g=${g.id}` })) },
      takes, members: (r.members || []).map((x) => ({ email: x.email, at: x.at })),
    };
  }
}
