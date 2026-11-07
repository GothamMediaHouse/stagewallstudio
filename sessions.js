// Showcaller Sessions: Riverside-style remote recording. Guests open https://showcallerstudio.com/s/<room> (no install),
// see and hear each other through a small call, and each person's camera and microphone are recorded at full quality
// in their own browser. The recording goes up in 2-second pieces to cloud storage (R2 bucket SESSIONS) while they
// talk; the Showcaller Sessions app on the studio Mac downloads the pieces and puts each person's files back together
// for editing. Nothing here is a live show: there is no mix, only one clean file per person.
//
//   wss://…/sessions/host?r=R&secret=S&name=N        the Sessions app (the first computer to use a room owns it)
//   wss://…/sessions/ws?r=R&pid=P&name=N             a guest page (…&prod=K: a producer, who runs the room but isn't recorded)
//   PUT  …/sessions/up?r&pid&tok&take&kind&seq       one recorded piece (kind v video, a sound, m the person's notes)
//   GET  …/sessions/api/list|get|takes, POST …/del   the app's downloads (header X-Session-Secret)
//   https://…/s/R                                    the guest page (public/sessions/guest/)
//   GET/POST …/sessions/api/plan, POST …/api/invite   the show plan: when, rundown, guest list; invite emails (app only)
//   https://…/s/R/edit/T?k=K                         editing a take together in a browser (public/sessions/edit/); K is that take's edit key
//   wss://…/sessions/editws?r&take&k&name             the live edit: cuts and word fixes, who's editing (the app joins the same way)
//   POST …/sessions/api/share?take&op=start|part|done|data   the app puts the take's small preview video and transcript up
//   GET  …/sessions/editmedia?r&take&k&f=proxy|data    the browser editor gets them (proxy supports Range)
//   POST …/sessions/api/clips   AI-picked clips from a take's transcript (app only; sessions-ai.js, 20 a day per room)
//   …/sessions/auth/*, …/sessions/acct/*   accounts: sign in by email, the dashboard at /sessions/account/ (sessions-accounts.js)
//   GET …/sessions/info?r&g, POST …/sessions/techcheck?r&g, GET/POST …/sessions/speed   the guest page before the day
//
// Cloud keys: r/<room>/<take>/<pid>/<v|a|m>/<000001>. A page that reloads mid-take records a new part: its pieces
// start at part × 100000, and its notes (m) are 2 × part (start) and 2 × part + 1 (finished). The guest page keeps its own copy
// of every piece until this site says it arrived with the same SHA-256, so a dropped connection or a closed tab loses nothing.
// A person's shared screen is its own track: pid + 's', uploaded with that person's key.
// The producer key is made from the room's owner hash (the app works it out from its secret), so nothing extra is stored.
import { DurableObject } from 'cloudflare:workers';
import { pickClips } from './sessions-ai.js';
import { accounts, SessionsAccount } from './sessions-accounts.js';

const ROOM = /^[a-z0-9]{8,24}$/, PID = /^[a-z0-9]{8,16}$/, UPID = /^[a-z0-9]{8,17}$/, TAKE = /^t\d{2,4}$/;
export const producerKey = async (ownerHash) => (await sha(`showcaller-sessions-producer:${ownerHash}`)).slice(0, 32);
// a take's edit key: anyone with the link can edit that one take (and nothing else); the app works it out from its secret
export const editKey = async (ownerHash, take) => (await sha(`showcaller-sessions-editor:${ownerHash}:${take}`)).slice(0, 32);
const MAX_PIECE = 64 * 1024 * 1024;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? new TextEncoder().encode(s) : s));
const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const clean = (s, n = 40) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

// a few seconds of memory, so every piece doesn't have to ask the room whether its upload key is good
const okCache = new Map();
const cached = (k) => { const t = okCache.get(k); return t && t > Date.now(); };
const remember = (k, ms) => { if (okCache.size > 5000) okCache.clear(); okCache.set(k, Date.now() + ms); };

const room = (env, r) => env.SESSIONS_ROOM.get(env.SESSIONS_ROOM.idFromName(r));

export async function sessions(request, env) {
  const url = new URL(request.url), p = url.pathname, r = url.searchParams.get('r') || '';
  // accounts: emailed sign-in links and the dashboard's data (sessions-accounts.js)
  if (p.startsWith('/sessions/auth/') || p.startsWith('/sessions/acct/')) return accounts(request, env);
  if (p === '/sessions/' && request.method === 'GET') return Response.redirect(new URL('/sessions/account/', url), 302);
  if (!ROOM.test(r)) return j({ error: 'No such session' }, 404);
  if (p === '/sessions/host' || p === '/sessions/ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Use a WebSocket', { status: 426 });
    return room(env, r).fetch(request);
  }
  // planning ahead works without cloud storage
  if (p === '/sessions/info' && request.method === 'GET') return room(env, r).fetch(new Request(`https://room/info?g=${encodeURIComponent(url.searchParams.get('g') || '')}`));
  if (p === '/sessions/techcheck' && request.method === 'POST') {
    const body = await request.text(); if (body.length > 4000) return j({ error: 'Too big' }, 413);
    return room(env, r).fetch(new Request(`https://room/techcheck?g=${encodeURIComponent(url.searchParams.get('g') || '')}`, { method: 'POST', body }));
  }
  if (p === '/sessions/speed') return speed(request, url);
  if (p === '/sessions/api/plan' || p === '/sessions/api/invite') {
    const res = await room(env, r).fetch(new Request(`https://room/${p.slice(14)}?r=${r}&origin=${encodeURIComponent(url.origin)}`, { method: request.method, headers: { 'X-Session-Secret': request.headers.get('X-Session-Secret') || '', 'Content-Type': 'application/json' }, body: request.method === 'POST' ? await request.text() : undefined }));
    return res;
  }
  if (p === '/sessions/api/clips' && request.method === 'POST') {
    if (!env.ANTHROPIC_API_KEY && !env.SESSIONS_AI_FAKE) return j({ error: 'AI clips aren’t set up on this site yet' }, 503);
    const body = await request.text(); if (body.length > 600000) return j({ error: 'This take is too long for AI clips' }, 413);
    return room(env, r).fetch(new Request('https://room/clips', { method: 'POST', headers: { 'X-Session-Secret': request.headers.get('X-Session-Secret') || '' }, body }));
  }
  if (p === '/sessions/editws') {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Use a WebSocket', { status: 426 });
    if (!TAKE.test(url.searchParams.get('take') || '')) return j({ error: 'No such take' }, 404);
    return room(env, r).fetch(request);
  }
  if (!env.SESSIONS) return j({ error: 'Cloud storage for Sessions isn’t set up on this site yet' }, 503);
  if (p === '/sessions/editmedia') return editMedia(request, env, url, r);
  if (p === '/sessions/up') return upload(request, env, url, r);
  return api(request, env, url, r);
}

// the browser editor's preview video and transcript, for whoever has the take's edit key
async function editMedia(request, env, url, r) {
  const take = url.searchParams.get('take') || '', k = url.searchParams.get('k') || '', f = url.searchParams.get('f');
  if (!TAKE.test(take) || !/^(proxy|data)$/.test(f) || k.length !== 32) return j({ error: 'Bad request' }, 400);
  const ck = `${r}|ed|${take}|${k}`;
  if (!cached(ck)) {
    const res = await room(env, r).fetch(new Request(`https://room/editkey?take=${take}&k=${encodeURIComponent(k)}`));
    if (!res.ok) return j({ error: 'This edit link isn’t good any more' }, 403);
    remember(ck, 300e3);
  }
  const key = `e/${r}/${take}/${f === 'proxy' ? 'proxy.mp4' : 'data.json'}`;
  if (f === 'data') { const o = await env.SESSIONS.get(key); return o ? new Response(o.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) : j({ error: 'This take hasn’t been shared yet' }, 404); }
  const o = await env.SESSIONS.get(key, { range: request.headers, onlyIf: request.headers });
  if (!o) return j({ error: 'No preview yet' }, 404);
  const h = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', ETag: o.httpEtag });
  if (!o.body) return new Response(null, { status: 304, headers: h });
  if (o.range && request.headers.has('Range')) {
    const off = o.range.offset ?? (o.size - o.range.suffix), len = o.range.length ?? (o.size - off);
    h.set('Content-Range', `bytes ${off}-${off + len - 1}/${o.size}`); h.set('Content-Length', String(len));
    return new Response(o.body, { status: 206, headers: h });
  }
  h.set('Content-Length', String(o.size));
  return new Response(o.body, { headers: h });
}

async function upload(request, env, url, r) {
  if (request.method !== 'PUT') return j({ error: 'Use PUT' }, 405);
  const q = (k) => url.searchParams.get(k) || '';
  const pid = q('pid'), tok = q('tok'), take = q('take'), kind = q('kind'), seq = Number(q('seq'));
  if (!UPID.test(pid) || !TAKE.test(take) || !/^[vam]$/.test(kind) || !(Number.isInteger(seq) && seq >= 0 && seq < 1e6) || tok.length < 20) return j({ error: 'Bad piece' }, 400);
  const ck = `${r}|${pid}|${tok}|${take}`;
  if (!cached(ck)) {
    const res = await room(env, r).fetch(new Request(`https://room/check?pid=${pid}&tok=${encodeURIComponent(tok)}&take=${take}`));
    if (!res.ok) return j({ error: 'This upload key isn’t good for this session' }, 403);
    remember(ck, 60e3);
  }
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_PIECE) return j({ error: 'Piece too big' }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_PIECE) return j({ error: 'Piece too big' }, 413);
  const sum = await sha(body), want = (request.headers.get('X-Sha256') || '').toLowerCase();
  if (want && want !== sum) return j({ error: 'Piece arrived damaged, send it again', sha: sum }, 422);
  const key = `r/${r}/${take}/${pid}/${kind}/${String(seq).padStart(6, '0')}`;
  await env.SESSIONS.put(key, body, {
    httpMetadata: { contentType: kind === 'm' ? 'application/json' : 'application/octet-stream' },
    customMetadata: { sha: sum },
  });
  return j({ ok: true, sha: sum, size: body.byteLength });
}

// a quick connection test for the tech check: download n bytes, or upload and throw away
async function speed(request, url) {
  if (request.method === 'GET') {
    const n = Math.max(1, Math.min(8e6, Number(url.searchParams.get('n')) || 2e6));
    return new Response(new Uint8Array(n), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
  }
  if (request.method === 'POST') {
    if (Number(request.headers.get('Content-Length') || 0) > 16e6) return j({ error: 'Too big' }, 413);
    const b = await request.arrayBuffer();
    return j({ ok: true, got: b.byteLength });
  }
  return j({ error: 'Use GET or POST' }, 405);
}

// the Sessions app on the studio computer: list, download and delete this room's pieces
async function api(request, env, url, r) {
  const secret = request.headers.get('X-Session-Secret') || '';
  const ak = `${r}|auth|${await sha(secret)}`;
  if (!cached(ak)) {
    const res = await room(env, r).fetch(new Request('https://room/auth', { headers: { 'X-Session-Secret': secret } }));
    if (!res.ok) return j({ error: 'Wrong session key' }, 403);
    remember(ak, 300e3);
  }
  const op = url.pathname.slice('/sessions/api/'.length), base = `r/${r}/`;
  const rel = (k) => String(k || '').replace(/^\/+/, '');
  const safe = (k) => /^t\d{2,4}\/[a-z0-9]{8,17}\/[vam]\/\d{6}$/.test(k);
  if (op === 'list' && request.method === 'GET') {
    const prefix = rel(url.searchParams.get('prefix'));
    if (prefix && !/^[a-z0-9/]{1,60}$/.test(prefix)) return j({ error: 'Bad prefix' }, 400);
    const l = await env.SESSIONS.list({ prefix: base + prefix, cursor: url.searchParams.get('cursor') || undefined, limit: 1000, include: ['customMetadata'] });
    return j({ objects: l.objects.map((o) => ({ k: o.key.slice(base.length), size: o.size, at: o.uploaded, sha: o.customMetadata?.sha || '' })), cursor: l.truncated ? l.cursor : null });
  }
  if (op === 'get' && request.method === 'GET') {
    const k = rel(url.searchParams.get('k'));
    if (!safe(k)) return j({ error: 'Bad key' }, 400);
    const o = await env.SESSIONS.get(base + k);
    if (!o) return j({ error: 'Not found' }, 404);
    return new Response(o.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(o.size), 'X-Sha256': o.customMetadata?.sha || '', 'Cache-Control': 'no-store' } });
  }
  if (op === 'del' && request.method === 'POST') {
    let keys; try { keys = (await request.json()).keys; } catch {}
    if (!Array.isArray(keys) || !keys.length || keys.length > 1000 || !keys.every((k) => typeof k === 'string' && safe(rel(k)))) return j({ error: 'Bad keys' }, 400);
    await env.SESSIONS.delete(keys.map((k) => base + rel(k)));
    return j({ ok: true, deleted: keys.length });
  }
  if (op === 'share' && request.method === 'POST') {
    // the app puts a take up for editing in a browser: a small preview video (in parts, R2 multipart) and the transcript
    const take = url.searchParams.get('take') || '', sop = url.searchParams.get('op'), ekey = `e/${r}/${take}/`;
    if (!TAKE.test(take)) return j({ error: 'Bad take' }, 400);
    if (sop === 'data') {
      const body = await request.text(); if (body.length > 20e6) return j({ error: 'Too big' }, 413);
      try { JSON.parse(body); } catch { return j({ error: 'Bad data' }, 400); }
      await env.SESSIONS.put(ekey + 'data.json', body, { httpMetadata: { contentType: 'application/json' } });
      const kr = await room(env, r).fetch(new Request(`https://room/editkey?take=${take}&make=1`, { headers: { 'X-Session-Secret': secret } }));
      return j(await kr.json());
    }
    if (sop === 'start') { const m = await env.SESSIONS.createMultipartUpload(ekey + 'proxy.mp4', { httpMetadata: { contentType: 'video/mp4' } }); return j({ upload: m.uploadId }); }
    const up = url.searchParams.get('upload') || '';
    if (!up) return j({ error: 'Bad upload' }, 400);
    const m = env.SESSIONS.resumeMultipartUpload(ekey + 'proxy.mp4', up);
    if (sop === 'part') {
      const n = Number(url.searchParams.get('n'));
      if (!(Number.isInteger(n) && n >= 1 && n <= 10000) || !request.body) return j({ error: 'Bad part' }, 400);
      const len = Number(request.headers.get('Content-Length') || 0); if (len > 95 * 1024 * 1024) return j({ error: 'Part too big' }, 413);
      const part = await m.uploadPart(n, request.body);
      return j({ part: { partNumber: part.partNumber, etag: part.etag } });
    }
    if (sop === 'done') {
      let parts; try { parts = (await request.json()).parts; } catch {}
      if (!Array.isArray(parts) || !parts.length) return j({ error: 'Bad parts' }, 400);
      await m.complete(parts.map((x) => ({ partNumber: Number(x.partNumber), etag: String(x.etag) })));
      return j({ ok: true });
    }
    return j({ error: 'Unknown' }, 404);
  }
  if (op === 'takes' && request.method === 'GET') return room(env, r).fetch(new Request('https://room/takes', { headers: { 'X-Session-Secret': secret } }));
  return j({ error: 'Unknown' }, 404);
}

// the guest page, for /s/<room>
export function sessionsPage(request, env) {
  if (/\/edit\/t\d{2,4}\/?$/.test(new URL(request.url).pathname)) return env.ASSETS.fetch(new Request(new URL('/sessions/edit/', request.url), request));
  return env.ASSETS.fetch(new Request(new URL('/sessions/guest/', request.url), request));
}

export class SessionRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  open(tag) { return this.ctx.getWebSockets(tag).filter((w) => w.readyState === WebSocket.OPEN); }
  send(w, o) { try { w.send(typeof o === 'string' ? o : JSON.stringify(o)); } catch {} }
  each(o, filter = () => true) { const s = JSON.stringify(o); for (const w of this.open('in')) if (filter(w.deserializeAttachment())) this.send(w, s); }
  async state() {
    if (!this.st) {
      const m = await this.ctx.storage.get(['owner', 'cfg', 'admitted', 'rec', 'takes', 'board', 'plan', 'prompt', 'solo']);
      this.st = { owner: m.get('owner') || '', cfg: m.get('cfg') || { name: 'Session', quality: '1080', wait: true }, admitted: m.get('admitted') || {}, rec: m.get('rec') || { on: false, n: 0 }, takes: m.get('takes') || [], board: m.get('board') || { notes: '', cd: null }, plan: m.get('plan') || emptyPlan(), prompt: m.get('prompt') || { script: '', to: 'off', run: false, speed: 1.2, pos: 0, at: 0 }, solo: m.get('solo') || {} };
    }
    return this.st;
  }
  async save(...keys) { const s = await this.state(); const o = {}; for (const k of keys) o[k] = s[k]; await this.ctx.storage.put(o); }
  async isOwner(secret) { const s = await this.state(); return secret.length >= 20 && !!s.owner && s.owner === await sha(`showcaller-sessions:${secret}`); }
  peers() { return this.open('in').map((w) => { const a = w.deserializeAttachment(); return { pid: a.pid, name: a.name, role: a.role }; }); }
  ctrls() { return [...this.open('host'), ...this.open('prod')]; }
  waiting() { return this.open('wait').map((w) => { const a = w.deserializeAttachment(); return { pid: a.pid, name: a.name }; }); }

  async fetch(request) {
    // an account (sessions-accounts.js), kept in an object of this class so the site needs no extra Durable Object class
    if (request.url.startsWith('https://acct.sessions/')) return (this.account ??= new SessionsAccount(this.ctx, this.env)).fetch(request);
    const url = new URL(request.url), s = await this.state();
    if (url.pathname === '/check') {
      // a shared screen (pid + 's') uploads with its person's key
      const pid = url.searchParams.get('pid'), a = s.admitted[pid] || (/s$/.test(pid) ? s.admitted[pid.slice(0, -1)] : null);
      const ok = a && a.tok === url.searchParams.get('tok') && s.takes.some((t) => t.id === url.searchParams.get('take'));
      return new Response(ok ? 'ok' : 'no', { status: ok ? 200 : 403 });
    }
    if (url.pathname === '/info') {
      // what the guest page shows before the day: the show's name and time, and who this invite is for
      const g = s.plan.guests.find((x) => x.id === url.searchParams.get('g'));
      return j({ name: s.cfg.name, quality: s.cfg.quality, at: s.plan.at, tz: s.plan.tz, mins: s.plan.rundown.reduce((t, x) => t + x.min, 0), guest: g ? { name: g.name, role: g.role } : null, host: this.open('host').length > 0 });
    }
    if (url.pathname === '/techcheck') {
      let c; try { c = JSON.parse(await request.text()); } catch { return j({ error: 'Bad check' }, 400); }
      const r = cleanCheck(c), g = s.plan.guests.find((x) => x.id === url.searchParams.get('g'));
      if (g) g.check = r;
      else { s.plan.checks = [r, ...(s.plan.checks || []).filter((x) => x.name !== r.name)].slice(0, 30); }
      await this.save('plan');
      for (const w of this.ctrls()) this.send(w, { t: 'plan', plan: s.plan });
      return j({ ok: true });
    }
    if (url.pathname === '/plan' || url.pathname === '/invite') {
      // planning can come before the room is first opened: the first computer to use a room owns it, as with /sessions/host
      const sec = request.headers.get('X-Session-Secret') || '';
      if (!s.owner && sec.length >= 20) { s.owner = await sha(`showcaller-sessions:${sec}`); await this.save('owner'); }
      if (!await this.isOwner(request.headers.get('X-Session-Secret') || '')) return j({ error: 'Wrong session key' }, 403);
      if (url.pathname === '/plan' && request.method === 'GET') return j({ plan: s.plan, cfg: s.cfg, script: s.prompt.script });
      let b; try { b = JSON.parse(await request.text()); } catch { return j({ error: 'Bad plan' }, 400); }
      if (url.pathname === '/plan') {
        s.plan = cleanPlan(b.plan || {}, s.plan);
        if (b.name !== undefined || b.solo !== undefined || b.quality !== undefined) { if (b.name !== undefined) s.cfg.name = clean(b.name, 60) || s.cfg.name; if (b.solo !== undefined) s.cfg.solo = !!b.solo; if (['720', '1080', '4k'].includes(b.quality)) s.cfg.quality = b.quality; await this.save('cfg'); this.each({ t: 'cfg', cfg: s.cfg }); }
        if (typeof b.script === 'string' && b.script !== s.prompt.script) { s.prompt = { ...s.prompt, script: b.script.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 20000), at: Date.now() }; await this.save('prompt'); this.each({ t: 'prompt', prompt: s.prompt }); }
        await this.save('plan');
        for (const w of this.ctrls()) this.send(w, { t: 'plan', plan: s.plan });
        return j({ plan: s.plan });
      }
      const g = s.plan.guests.find((x) => x.id === b.id);
      if (!g || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.email)) return j({ error: 'Add an email address for this person first' }, 400);
      if (!this.env.RESEND_API_KEY) return j({ error: 'Email isn’t set up on this site' }, 503);
      const origin = /^https?:\/\/[a-z0-9.:-]+$/i.test(url.searchParams.get('origin') || '') ? url.searchParams.get('origin') : 'https://showcallerstudio.com';
      const link = await this.guestLink(origin, g, url.searchParams.get('r') || '');
      const mail = inviteMail({ show: s.cfg.name, plan: s.plan, g, link });
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.env.CONTACT_FROM || 'Showcaller Studio <hello@showcallerstudio.com>', to: [g.email], ...(s.plan.reply ? { reply_to: s.plan.reply } : {}), ...mail }),
      });
      if (!res.ok) return j({ error: `The email didn’t send (${res.status})` }, 502);
      g.sent = Date.now(); await this.save('plan');
      for (const w of this.ctrls()) this.send(w, { t: 'plan', plan: s.plan });
      return j({ ok: true, plan: s.plan });
    }
    if (url.pathname === '/editkey') {
      // ?k: is this the take's edit key. ?make=1 with the room's secret: here it is (the app shares the link)
      const take = url.searchParams.get('take') || ''; if (!TAKE.test(take) || !s.owner) return j({ error: 'No' }, 403);
      const key = await editKey(s.owner, take);
      if (url.searchParams.get('make')) return await this.isOwner(request.headers.get('X-Session-Secret') || '') ? j({ key }) : j({ error: 'Wrong session key' }, 403);
      return new Response(null, { status: url.searchParams.get('k') === key ? 204 : 403 });
    }
    if (url.pathname === '/sessions/editws') {
      const take = url.searchParams.get('take') || '', k = url.searchParams.get('k') || '';
      const [c2, s2] = Object.values(new WebSocketPair());
      if (!s.owner || k !== await editKey(s.owner, take)) { this.ctx.acceptWebSocket(s2, ['x']); s2.close(4003, 'This edit link isn’t good any more'); return new Response(null, { status: 101, webSocket: c2 }); }
      const id = Math.random().toString(36).slice(2, 10), app = url.searchParams.get('app') === '1';
      this.ctx.acceptWebSocket(s2, ['ed', `ed:${take}`]);
      s2.serializeAttachment({ ed: take, id, name: clean(url.searchParams.get('name')) || (app ? 'Studio' : 'Editor'), app });
      const d = await this.edDoc(take);
      this.send(s2, { t: 'doc', me: id, cuts: d.cuts, rev: d.rev, fixes: d.fixes, by: d.by });
      this.edPeople(take);
      return new Response(null, { status: 101, webSocket: c2 });
    }
    if (url.pathname === '/aibudget') {
      // one shared counter for the whole site, so AI clips can't run up the bill (this object is named 'ai-budget', not a room)
      const day = new Date().toISOString().slice(0, 10), b = (await this.ctx.storage.get('aib')) || {};
      if (b.day !== day) { b.day = day; b.n = 0; }
      if (b.n >= Number(this.env.SESSIONS_AI_DAILY || 400)) return new Response('no', { status: 429 });
      b.n++; await this.ctx.storage.put('aib', b);
      return new Response('ok');
    }
    if (url.pathname === '/clips') {
      // as with planning, a room the app made but hasn't opened yet is claimed by its key
      const sec = request.headers.get('X-Session-Secret') || '';
      if (!s.owner && sec.length >= 20) { s.owner = await sha(`showcaller-sessions:${sec}`); await this.save('owner'); }
      if (!await this.isOwner(request.headers.get('X-Session-Secret') || '')) return j({ error: 'Wrong session key' }, 403);
      let b; try { b = JSON.parse(await request.text()); } catch { return j({ error: 'Bad request' }, 400); }
      const lines = String(b.lines || '').slice(0, 500000);
      if (lines.length < 40) return j({ error: 'Make a transcript first' }, 400);
      const day = new Date().toISOString().slice(0, 10), u = (await this.ctx.storage.get('ai')) || {};
      if (u.day !== day) { u.day = day; u.n = 0; }
      if (u.n >= 20) return j({ error: 'That’s 20 AI picks today for this session, try again tomorrow' }, 429);
      const g = await this.env.SESSIONS_ROOM.get(this.env.SESSIONS_ROOM.idFromName('ai-budget')).fetch(new Request('https://room/aibudget'));
      if (!g.ok) return j({ error: 'AI clips are busy today, try again tomorrow' }, 429);
      u.n++; await this.ctx.storage.put('ai', u);
      const o = { lines, title: clean(b.title, 80), count: Math.max(1, Math.min(10, b.count | 0 || 6)), min: Math.max(5, Math.min(120, +b.min || 20)), max: Math.max(10, Math.min(180, +b.max || 60)),
        marks: (Array.isArray(b.marks) ? b.marks : []).filter((x) => isFinite(x)).slice(0, 50).map((x) => Math.round(x)) };
      if (this.env.SESSIONS_AI_FAKE && !this.env.ANTHROPIC_API_KEY) {
        // for the tests: the first and the last line that start a long enough stretch
        const t = [...lines.matchAll(/^\[(\d+(?:\.\d+)?)\]/gm)].map((m) => +m[1]);
        return j({ clips: [{ start: t[0], end: Math.min(t[0] + o.max, t[t.length - 1] + 3), title: 'The opening', why: 'Test pick', hook: lines.split('\n')[0].replace(/^\[[^\]]*\]\s*/, '').slice(0, 60) }], left: 20 - u.n, fake: true });
      }
      try { return j({ clips: await pickClips(this.env, o), left: 20 - u.n }); }
      catch (e) { u.n--; await this.ctx.storage.put('ai', u); return j({ error: e.ours ? e.message : `The AI didn’t answer (${e.status || 'no connection'})` }, e.status === 429 ? 429 : 502); }
    }
    if (url.pathname === '/auth') return new Response(null, { status: await this.isOwner(request.headers.get('X-Session-Secret') || '') ? 204 : 403 });
    if (url.pathname === '/takes') {
      if (!await this.isOwner(request.headers.get('X-Session-Secret') || '')) return j({ error: 'Wrong session key' }, 403);
      return j({ cfg: s.cfg, takes: s.takes, people: Object.fromEntries(Object.entries(s.admitted).map(([k, v]) => [k, v.name])) });
    }

    const [client, server] = Object.values(new WebSocketPair());
    const name = clean(url.searchParams.get('name')) || 'Guest';
    if (url.pathname === '/sessions/host') {
      const secret = url.searchParams.get('secret') || '';
      const h = await sha(`showcaller-sessions:${secret}`);
      if (secret.length < 20 || (s.owner && s.owner !== h)) { this.ctx.acceptWebSocket(server, ['x']); server.close(4001, 'This session belongs to another computer'); return new Response(null, { status: 101, webSocket: client }); }
      if (!s.owner) { s.owner = h; await this.save('owner'); }
      for (const w of this.ctx.getWebSockets('host')) { try { w.close(4000, 'Opened on another window'); } catch {} }
      this.ctx.acceptWebSocket(server, ['in', 'host', 'p:host']);
      server.serializeAttachment({ pid: 'host', name, role: 'host' });
      this.hello(server, { pid: 'host', role: 'host' });
      this.each({ t: 'join', peer: { pid: 'host', name, role: 'host' } }, (a) => a.pid !== 'host');
      this.each({ t: 'host', online: true }, (a) => a.pid !== 'host');
      return new Response(null, { status: 101, webSocket: client });
    }
    const pid = url.searchParams.get('pid') || '';
    if (!PID.test(pid)) { this.ctx.acceptWebSocket(server, ['x']); server.close(4003, 'Bad page address'); return new Response(null, { status: 101, webSocket: client }); }
    if (this.ctx.getWebSockets().length >= 40) { this.ctx.acceptWebSocket(server, ['x']); server.close(4002, 'This session is full'); return new Response(null, { status: 101, webSocket: client }); }
    for (const w of this.ctx.getWebSockets(`p:${pid}`)) { try { w.close(4000, 'Opened in another tab'); } catch {} }
    const ua = (request.headers.get('User-Agent') || '').slice(0, 200);
    const prod = url.searchParams.get('prod') || '';
    if (prod) {
      if (!s.owner || prod !== await producerKey(s.owner)) { this.ctx.acceptWebSocket(server, ['x']); server.close(4001, 'This producer link isn’t right for this session. Ask the host for a new one.'); return new Response(null, { status: 101, webSocket: client }); }
      this.ctx.acceptWebSocket(server, ['in', 'prod', `p:${pid}`]);
      server.serializeAttachment({ pid, name, role: 'producer', ua });
      this.hello(server, { pid, role: 'producer' });
      this.each({ t: 'join', peer: { pid, name, role: 'producer' } }, (a) => a.pid !== pid);
      return new Response(null, { status: 101, webSocket: client });
    }
    // an invited guest (their own link) can come in while the host is away when the room lets guests record on their own
    const invited = s.cfg.solo && !this.open('host').length && s.plan.guests.some((x) => x.id === url.searchParams.get('g') && x.role === 'guest');
    if (s.admitted[pid] || !s.cfg.wait || invited) {
      await this.admit(pid, name);
      this.ctx.acceptWebSocket(server, ['in', `p:${pid}`]);
      server.serializeAttachment({ pid, name, role: 'guest', ua });
      this.hello(server, { pid, role: 'guest' });
      this.each({ t: 'join', peer: { pid, name, role: 'guest' } }, (a) => a.pid !== pid);
    } else {
      this.ctx.acceptWebSocket(server, ['wait', `p:${pid}`]);
      server.serializeAttachment({ pid, name, role: 'guest', ua });
      this.send(server, { t: 'wait', now: Date.now(), name: s.cfg.name, host: this.open('host').length > 0 });
      for (const w of this.ctrls()) this.send(w, { t: 'knock', pid, name });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  soloTell(pid, t, on) {
    for (const w of this.open(`p:${pid}`)) this.send(w, { t: 'rec', on, n: t.n, take: t.id, at: t.at, end: t.end || 0, solo: true, now: Date.now() });
    for (const w of this.ctrls()) this.send(w, { t: 'solo', pid, take: t.id, on });
  }
  async soloEnd(pid) {
    const s = await this.state(), t = s.takes.find((x) => x.id === s.solo[pid]);
    delete s.solo[pid];
    if (t && !t.end) { t.end = Date.now(); this.soloTell(pid, t, false); }
    await this.save('takes', 'solo');
  }

  async guestLink(origin, g, room) {
    const s = await this.state();
    return `${origin}/s/${room}?${g.role === 'producer' ? `producer=${await producerKey(s.owner)}&` : ''}g=${g.id}`;
  }

  async admit(pid, name) {
    const s = await this.state();
    if (!s.admitted[pid]) { s.admitted[pid] = { name, tok: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8) }; }
    else s.admitted[pid].name = name;
    const keys = Object.keys(s.admitted);
    if (keys.length > 300) delete s.admitted[keys[0]];
    await this.save('admitted');
  }

  async hello(w, you) {
    const s = await this.state();
    const solo = s.solo[you.pid] && s.takes.find((t) => t.id === s.solo[you.pid] && !t.end);
    const o = { t: 'hello', you, now: Date.now(), cfg: s.cfg, rec: solo ? { on: true, n: solo.n, take: solo.id, at: solo.at, solo: true } : s.rec, prompt: s.prompt, peers: this.peers().filter((p) => p.pid !== you.pid), ice: await this.ice(), host: this.open('host').length > 0 };
    if (you.role === 'host' || you.role === 'producer') { o.waiting = this.waiting(); o.takes = s.takes; o.board = s.board; o.plan = s.plan; }
    else o.tok = s.admitted[you.pid]?.tok;
    this.send(w, o);
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 65536) return;
    let m; try { m = JSON.parse(msg); } catch { return; }
    const a = ws.deserializeAttachment(), tags = this.ctx.getTags(ws), s = await this.state();
    if (m.t === 'time') return this.send(ws, { t: 'time', c: m.c, s: Date.now() });
    if (tags.includes('ed')) return this.edMsg(ws, a, m);
    if (!tags.includes('in')) return;
    const isHost = tags.includes('host'), isProd = tags.includes('prod');
    if (m.t === 'sig' && typeof m.to === 'string') {
      for (const w of this.open(`p:${m.to}`)) if (this.ctx.getTags(w).includes('in')) this.send(w, { t: 'sig', from: a.pid, data: m.data });
      return;
    }
    if (m.t === 'chat') {
      const text = clean(m.text, 500); if (!text) return;
      return this.each({ t: 'chat', from: a.pid, name: a.name, text, at: Date.now() });
    }
    if (m.t === 'name') {
      a.name = clean(m.name) || a.name; ws.serializeAttachment(a);
      if (s.admitted[a.pid]) { s.admitted[a.pid].name = a.name; await this.save('admitted'); }
      // just the new name: a 'join' would make everyone hang up and call them again
      return this.each({ t: 'name', pid: a.pid, name: a.name }, (b) => b.pid !== a.pid);
    }
    // a guest recording on their own (the host away): a take of just them
    if (m.t === 'solo' && a.role === 'guest') {
      const mine = s.solo[a.pid] && s.takes.find((t) => t.id === s.solo[a.pid] && !t.end);
      if (m.on) {
        if (!s.cfg.solo) return this.send(ws, { t: 'error', error: 'The host hasn’t turned on recording on your own for this session' });
        if (s.rec.on) return this.send(ws, { t: 'error', error: 'The host is already recording' });
        if (mine) return this.soloTell(a.pid, mine, true);
        const now = Date.now(), n = (s.rec.n || 0) + 1, id = `t${String(n).padStart(2, '0')}`;
        const t = { id, n, at: now + 1500, end: 0, quality: s.cfg.quality, people: { [a.pid]: a.name }, marks: [], solo: a.pid };
        s.rec = { ...s.rec, n }; s.takes.push(t); if (s.takes.length > 500) s.takes.shift(); s.solo[a.pid] = id;
        await this.save('rec', 'takes', 'solo');
        return this.soloTell(a.pid, t, true);
      }
      if (mine) { await this.soloEnd(a.pid); }
      return;
    }
    if (!isHost && !isProd) return;
    if (m.t === 'admit') {
      for (const w of this.ctrls()) if (w !== ws) this.send(w, { t: 'unknock', pid: m.pid });
      for (const w of this.open(`p:${m.pid}`)) {
        if (!this.ctx.getTags(w).includes('wait')) continue;
        const b = w.deserializeAttachment();
        if (!m.yes) { this.send(w, { t: 'denied' }); try { w.close(4004, 'The host didn’t let you in'); } catch {} continue; }
        await this.admit(b.pid, b.name);
        // move the socket from the waiting room to the session: hibernation tags are fixed, so the page reconnects
        this.send(w, { t: 'admitted' });
        try { w.close(4005, 'Let in'); } catch {}
      }
      return;
    }
    if (m.t === 'kick') {
      for (const w of this.ctx.getWebSockets(`p:${m.pid}`)) { this.send(w, { t: 'kicked' }); try { w.close(4006, 'Removed by the host'); } catch {} }
      if (m.forget && s.admitted[m.pid]) { delete s.admitted[m.pid]; await this.save('admitted'); }
      return;
    }
    if (m.t === 'cfg' && m.cfg && typeof m.cfg === 'object' && isHost) {
      s.cfg = { name: clean(m.cfg.name ?? s.cfg.name, 60) || 'Session', quality: ['720', '1080', '4k'].includes(m.cfg.quality) ? m.cfg.quality : s.cfg.quality, wait: m.cfg.wait === undefined ? s.cfg.wait : !!m.cfg.wait, solo: m.cfg.solo === undefined ? !!s.cfg.solo : !!m.cfg.solo };
      await this.save('cfg');
      return this.each({ t: 'cfg', cfg: s.cfg });
    }
    if (m.t === 'rec') {
      if (!!m.on === s.rec.on) return this.send(ws, { t: 'rec', ...s.rec });
      const now = Date.now();
      if (m.on) {
        for (const pid of Object.keys(s.solo)) await this.soloEnd(pid);
        const n = (s.rec.n || 0) + 1, id = `t${String(n).padStart(2, '0')}`;
        s.rec = { on: true, n, take: id, at: now + 1500 };
        s.takes.push({ id, n, at: s.rec.at, end: 0, quality: s.cfg.quality, people: Object.fromEntries(this.peers().filter((p) => p.role !== 'producer').map((p) => [p.pid, p.name])), marks: [] });
        if (s.takes.length > 500) s.takes.shift();
      } else {
        const t = s.takes.find((x) => x.id === s.rec.take); if (t) { t.end = now; for (const p of this.peers()) if (p.role !== 'producer') t.people[p.pid] = p.name; }
        s.rec = { on: false, n: s.rec.n, take: s.rec.take, at: s.rec.at, end: now };
      }
      await this.save('rec', 'takes');
      return this.each({ t: 'rec', ...s.rec, now });
    }
    // the countdown and notes only the host and producers see: { notes, cd: { label, dur, end (running: when it reaches 0), left (paused) } }
    if (m.t === 'board' && m.board && typeof m.board === 'object') {
      const b = m.board, c = b.cd && typeof b.cd === 'object' ? b.cd : null, n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
      s.board = {
        notes: b.notes === undefined ? s.board.notes : String(b.notes).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 5000),
        cd: b.cd === undefined ? s.board.cd : c ? { label: clean(c.label, 60), dur: n(c.dur, 864e5), end: n(c.end, 9e15), left: n(c.left, 864e5) } : null,
        by: a.name, at: Date.now(),
      };
      await this.save('board');
      for (const w of this.ctrls()) this.send(w, { t: 'board', board: s.board });
      return;
    }
    // the teleprompter: the script, who sees it, and where it is (pos in lines of text, rolling at speed from at)
    if (m.t === 'prompt' && m.prompt && typeof m.prompt === 'object') {
      const p = m.prompt, o = s.prompt;
      s.prompt = {
        script: p.script === undefined ? o.script : String(p.script).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 20000),
        to: p.to === undefined ? o.to : ['off', 'ctrl', 'all', 'host'].includes(p.to) || PID.test(p.to) ? p.to : o.to,
        run: p.run === undefined ? o.run : !!p.run,
        speed: p.speed === undefined ? o.speed : Math.max(0.1, Math.min(8, Number(p.speed) || 1.2)),
        pos: Math.max(0, Math.min(1e5, Number(p.pos) || 0)), at: Date.now(),
      };
      await this.save('prompt');
      return this.each({ t: 'prompt', prompt: s.prompt });
    }
    if (m.t === 'mark' && s.rec.on) {
      const t = s.takes.find((x) => x.id === s.rec.take); if (!t) return;
      t.marks.push({ at: Date.now(), label: clean(m.label, 60) || `Mark ${t.marks.length + 1}` });
      await this.save('takes');
      for (const w of this.ctrls()) this.send(w, { t: 'marks', take: t.id, marks: t.marks });
      return;
    }
  }

  // ---- editing a take together: one shared list of cuts per take (last change wins, everyone sees it at once)
  async edDoc(take) {
    this.eds = this.eds || {};
    if (!this.eds[take]) this.eds[take] = (await this.ctx.storage.get(`ed:${take}`)) || { cuts: [], rev: 0, fixes: {}, by: '' };
    return this.eds[take];
  }
  edPeople(take) {
    const list = this.open(`ed:${take}`).map((w) => { const a = w.deserializeAttachment(); return { id: a.id, name: a.name, app: a.app }; });
    for (const w of this.open(`ed:${take}`)) this.send(w, { t: 'people', list });
  }
  async edMsg(ws, a, m) {
    const take = a.ed, d = await this.edDoc(take), others = (o) => { for (const w of this.open(`ed:${take}`)) if (w !== ws) this.send(w, o); };
    if (m.t === 'cuts' && Array.isArray(m.cuts) && m.cuts.length <= 5000) {
      const cuts = m.cuts.filter((c) => Array.isArray(c) && c.length === 2 && isFinite(c[0]) && isFinite(c[1]) && c[0] >= 0 && c[1] > c[0] && c[1] < 1e6).map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
      d.cuts = cuts; d.rev++; d.by = a.name;
      await this.ctx.storage.put(`ed:${take}`, d);
      this.send(ws, { t: 'ack', rev: d.rev });
      return others({ t: 'cuts', cuts, rev: d.rev, by: a.name });
    }
    if (m.t === 'fix' && Number.isInteger(m.i) && m.i >= 0 && m.i < 1e6) {
      const w = clean(m.w, 60); if (!w) return;
      d.fixes[m.i] = w; if (Object.keys(d.fixes).length > 5000) return;
      await this.ctx.storage.put(`ed:${take}`, d);
      return others({ t: 'fix', i: m.i, w, by: a.name });
    }
    if (m.t === 'at' && isFinite(m.tk)) return others({ t: 'at', id: a.id, name: a.name, tk: Math.max(0, +m.tk) });
  }

  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const tags = this.ctx.getTags(ws), a = ws.deserializeAttachment?.() || {};
    if (tags.includes('ed')) { const ed = a.ed; setTimeout(() => this.edPeople(ed), 0); return; }
    if (tags.includes('in')) {
      if (this.open(`p:${a.pid}`).some((w) => w !== ws)) return;
      this.each({ t: 'leave', pid: a.pid }, (b) => b.pid !== a.pid);
      if (tags.includes('host')) this.each({ t: 'host', online: false }, (b) => b.pid !== 'host');
    } else if (tags.includes('wait') && !this.open(`p:${a.pid}`).some((w) => w !== ws)) for (const w of this.ctrls()) this.send(w, { t: 'unknock', pid: a.pid });
  }

  // relay servers for the call (as in Intercom): Cloudflare TURN when it's set up, else just STUN
  async ice() {
    const now = Date.now();
    if (this.iceCache && now - this.iceCache.at < 12 * 3600e3) return this.iceCache.list;
    let list = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
    if (this.env.TURN_KEY_ID && this.env.TURN_KEY_API_TOKEN) {
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method: 'POST', headers: { Authorization: `Bearer ${this.env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }) });
        const o = await r.json();
        const s = Array.isArray(o.iceServers) ? o.iceServers : o.iceServers ? [o.iceServers] : [];
        if (r.ok && s.length) list = s;
      } catch {}
    }
    this.iceCache = { at: now, list };
    return list;
  }
}

// ---- the show plan: { at (ms, 0 = not set), tz, reply, rundown: [{ t, min }], guests: [{ id, name, email, role, sent, check }], checks }
const emptyPlan = () => ({ at: 0, tz: 'UTC', reply: '', rundown: [], guests: [], checks: [] });
const cleanCheck = (c) => {
  const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  return { at: Date.now(), name: clean(c.name), ok: !!c.ok, cam: clean(c.cam, 60), mic: clean(c.mic, 60), res: clean(c.res, 20), up: n(c.up, 1e5), down: n(c.down, 1e5), free: n(c.free, 1e7), browser: clean(c.browser, 40), notes: (Array.isArray(c.notes) ? c.notes : []).slice(0, 6).map((x) => clean(x, 120)) };
};
function cleanPlan(p, old) {
  const tz = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/.test(p.tz || '') ? p.tz : old.tz;
  const at = Number(p.at) >= 0 && Number(p.at) < 9e15 ? Math.round(Number(p.at)) : old.at;
  const rundown = (Array.isArray(p.rundown) ? p.rundown : old.rundown).slice(0, 60).map((x) => ({ t: clean(x.t, 80), min: Math.max(0, Math.min(600, Math.round(Number(x.min) || 0))) })).filter((x) => x.t || x.min);
  const keep = new Map(old.guests.map((g) => [g.id, g]));
  const guests = (Array.isArray(p.guests) ? p.guests : old.guests).slice(0, 40).map((g) => {
    const was = keep.get(g.id), id = /^[a-z0-9]{10}$/.test(g.id || '') ? g.id : Math.random().toString(36).slice(2, 12).padEnd(10, '0');
    return { id, name: clean(g.name), email: clean(g.email, 120).toLowerCase(), role: g.role === 'producer' ? 'producer' : 'guest', sent: was?.sent || 0, check: was?.check || null };
  });
  const reply = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.reply || '') ? clean(p.reply, 120) : p.reply === '' ? '' : old.reply;
  return { at, tz, reply, rundown, guests, checks: old.checks || [] };
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function when(plan) {
  if (!plan.at) return '';
  try { return new Date(plan.at).toLocaleString('en-US', { timeZone: plan.tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); }
  catch { return new Date(plan.at).toUTCString(); }
}
// the invite email, with a calendar file when the time is set
function inviteMail({ show, plan, g, link }) {
  const mins = plan.rundown.reduce((t, x) => t + x.min, 0) || 60, w = when(plan), first = g.name.split(' ')[0] || 'there';
  const prod = g.role === 'producer';
  const lines = [
    `Hi ${first},`,
    prod ? `You're producing "${show}". You'll run the room with the host: let guests in, mute, talk privately, the countdown and notes. You aren't recorded.`
         : `You're invited to record "${show}". Each person is recorded in full quality on their own computer, so a bad connection never spoils the recording.`,
    w ? `When: ${w} (about ${mins} minutes).` : '',
    `Your link: ${link}`,
    `Before the day, open the link and press "Do a tech check". It checks your camera, mic, connection and space in about a minute, and the host sees the result.`,
    'Use Chrome, Edge or Safari on a computer, with headphones if you have them. Nothing to install.',
  ].filter(Boolean);
  const rundown = plan.rundown.length ? `<p style="margin:16px 0 6px;color:#555"><b>Running order</b></p><ol style="margin:0;padding-left:20px;color:#333">${plan.rundown.map((x) => `<li>${esc(x.t)}${x.min ? ` <span style="color:#888">(${x.min} min)</span>` : ''}</li>`).join('')}</ol>` : '';
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Inter,sans-serif;color:#16181d;max-width:560px">
<p>Hi ${esc(first)},</p><p>${esc(lines[1])}</p>${w ? `<p><b>${esc(w)}</b><br><span style="color:#666">about ${mins} minutes</span></p>` : ''}
<p><a href="${esc(link)}" style="display:inline-block;background:#6d4aff;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${prod ? 'Open the producer page' : 'Open my link'}</a></p>
<p style="color:#444">Before the day, open the link and press <b>Do a tech check</b>. It checks your camera, mic, connection and space in about a minute, and the host sees the result.</p>
<p style="color:#666;font-size:13px">Chrome, Edge or Safari on a computer, with headphones if you have them. Nothing to install.</p>${rundown}
<p style="color:#999;font-size:12px;margin-top:24px">Sent with Showcaller Sessions</p></div>`;
  const o = { subject: `${prod ? 'Producing' : 'Invite'}: ${show}${w ? `, ${w}` : ''}`, text: lines.join('\n\n'), html };
  if (plan.at) {
    const d = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Showcaller Studio//Sessions//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${g.id}-${plan.at}@showcallerstudio.com`, `DTSTAMP:${d(Date.now())}`, `DTSTART:${d(plan.at)}`, `DTEND:${d(plan.at + mins * 60e3)}`,
      `SUMMARY:${show.replace(/([,;\\])/g, '\\$1')}`, `DESCRIPTION:Your link: ${link}`, `URL:${link}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    o.attachments = [{ filename: 'invite.ics', content: btoa(String.fromCharCode(...new TextEncoder().encode(ics))) }];
  }
  return o;
}
