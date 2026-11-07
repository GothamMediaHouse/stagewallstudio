// Showcaller Sessions: Riverside-style remote recording. Guests open https://showcallerstudio.com/s/<room> (no install),
// see and hear each other through a small call, and each person's camera and microphone are recorded at full quality
// in their own browser. The recording goes up in 2-second pieces to cloud storage (R2 bucket SESSIONS) while they
// talk; the Showcaller Sessions app on the studio Mac downloads the pieces and puts each person's files back together
// for editing. Nothing here is a live show: there is no mix, only one clean file per person.
//
//   wss://…/sessions/host?r=R&secret=S&name=N        the Sessions app (the first computer to use a room owns it)
//   wss://…/sessions/ws?r=R&pid=P&name=N             a guest page
//   PUT  …/sessions/up?r&pid&tok&take&kind&seq       one recorded piece (kind v video, a sound, m the person's notes)
//   GET  …/sessions/api/list|get|takes, POST …/del   the app's downloads (header X-Session-Secret)
//   https://…/s/R                                    the guest page (public/sessions/guest/)
//
// Cloud keys: r/<room>/<take>/<pid>/<v|a|m>/<000001>. A page that reloads mid-take records a new part: its pieces
// start at part × 100000, and its notes (m) are 2 × part (start) and 2 × part + 1 (finished). The guest page keeps its own copy
// of every piece until this site says it arrived with the same SHA-256, so a dropped connection or a closed tab loses nothing.
import { DurableObject } from 'cloudflare:workers';

const ROOM = /^[a-z0-9]{8,24}$/, PID = /^[a-z0-9]{8,16}$/, TAKE = /^t\d{2,4}$/;
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
  if (!ROOM.test(r)) return j({ error: 'No such session' }, 404);
  if (p === '/sessions/host' || p === '/sessions/ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Use a WebSocket', { status: 426 });
    return room(env, r).fetch(request);
  }
  if (!env.SESSIONS) return j({ error: 'Cloud storage for Sessions isn’t set up on this site yet' }, 503);
  if (p === '/sessions/up') return upload(request, env, url, r);
  return api(request, env, url, r);
}

async function upload(request, env, url, r) {
  if (request.method !== 'PUT') return j({ error: 'Use PUT' }, 405);
  const q = (k) => url.searchParams.get(k) || '';
  const pid = q('pid'), tok = q('tok'), take = q('take'), kind = q('kind'), seq = Number(q('seq'));
  if (!PID.test(pid) || !TAKE.test(take) || !/^[vam]$/.test(kind) || !(Number.isInteger(seq) && seq >= 0 && seq < 1e6) || tok.length < 20) return j({ error: 'Bad piece' }, 400);
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
  const safe = (k) => /^t\d{2,4}\/[a-z0-9]{8,16}\/[vam]\/\d{6}$/.test(k);
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
  if (op === 'takes' && request.method === 'GET') return room(env, r).fetch(new Request('https://room/takes', { headers: { 'X-Session-Secret': secret } }));
  return j({ error: 'Unknown' }, 404);
}

// the guest page, for /s/<room>
export function sessionsPage(request, env) {
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
      const m = await this.ctx.storage.get(['owner', 'cfg', 'admitted', 'rec', 'takes']);
      this.st = { owner: m.get('owner') || '', cfg: m.get('cfg') || { name: 'Session', quality: '1080', wait: true }, admitted: m.get('admitted') || {}, rec: m.get('rec') || { on: false, n: 0 }, takes: m.get('takes') || [] };
    }
    return this.st;
  }
  async save(...keys) { const s = await this.state(); const o = {}; for (const k of keys) o[k] = s[k]; await this.ctx.storage.put(o); }
  async isOwner(secret) { const s = await this.state(); return secret.length >= 20 && !!s.owner && s.owner === await sha(`showcaller-sessions:${secret}`); }
  peers() { return this.open('in').map((w) => { const a = w.deserializeAttachment(); return { pid: a.pid, name: a.name, role: a.role }; }); }
  waiting() { return this.open('wait').map((w) => { const a = w.deserializeAttachment(); return { pid: a.pid, name: a.name }; }); }

  async fetch(request) {
    const url = new URL(request.url), s = await this.state();
    if (url.pathname === '/check') {
      const pid = url.searchParams.get('pid'), a = s.admitted[pid];
      const ok = a && a.tok === url.searchParams.get('tok') && s.takes.some((t) => t.id === url.searchParams.get('take'));
      return new Response(ok ? 'ok' : 'no', { status: ok ? 200 : 403 });
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
    if (s.admitted[pid] || !s.cfg.wait) {
      await this.admit(pid, name);
      this.ctx.acceptWebSocket(server, ['in', `p:${pid}`]);
      server.serializeAttachment({ pid, name, role: 'guest', ua });
      this.hello(server, { pid, role: 'guest' });
      this.each({ t: 'join', peer: { pid, name, role: 'guest' } }, (a) => a.pid !== pid);
    } else {
      this.ctx.acceptWebSocket(server, ['wait', `p:${pid}`]);
      server.serializeAttachment({ pid, name, role: 'guest', ua });
      this.send(server, { t: 'wait', now: Date.now(), name: s.cfg.name, host: this.open('host').length > 0 });
      for (const w of this.open('host')) this.send(w, { t: 'knock', pid, name });
    }
    return new Response(null, { status: 101, webSocket: client });
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
    const o = { t: 'hello', you, now: Date.now(), cfg: s.cfg, rec: s.rec, peers: this.peers().filter((p) => p.pid !== you.pid), ice: await this.ice(), host: this.open('host').length > 0 };
    if (you.role === 'host') { o.waiting = this.waiting(); o.takes = s.takes; }
    else o.tok = s.admitted[you.pid]?.tok;
    this.send(w, o);
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 65536) return;
    let m; try { m = JSON.parse(msg); } catch { return; }
    const a = ws.deserializeAttachment(), tags = this.ctx.getTags(ws), s = await this.state();
    if (m.t === 'time') return this.send(ws, { t: 'time', c: m.c, s: Date.now() });
    if (!tags.includes('in')) return;
    const isHost = tags.includes('host');
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
      return this.each({ t: 'join', peer: { pid: a.pid, name: a.name, role: a.role } }, (b) => b.pid !== a.pid);
    }
    if (!isHost) return;
    if (m.t === 'admit') {
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
    if (m.t === 'cfg' && m.cfg && typeof m.cfg === 'object') {
      s.cfg = { name: clean(m.cfg.name ?? s.cfg.name, 60) || 'Session', quality: ['720', '1080', '4k'].includes(m.cfg.quality) ? m.cfg.quality : s.cfg.quality, wait: m.cfg.wait === undefined ? s.cfg.wait : !!m.cfg.wait };
      await this.save('cfg');
      return this.each({ t: 'cfg', cfg: s.cfg });
    }
    if (m.t === 'rec') {
      if (!!m.on === s.rec.on) return this.send(ws, { t: 'rec', ...s.rec });
      const now = Date.now();
      if (m.on) {
        const n = (s.rec.n || 0) + 1, id = `t${String(n).padStart(2, '0')}`;
        s.rec = { on: true, n, take: id, at: now + 1500 };
        s.takes.push({ id, n, at: s.rec.at, end: 0, quality: s.cfg.quality, people: Object.fromEntries(this.peers().map((p) => [p.pid, p.name])), marks: [] });
        if (s.takes.length > 500) s.takes.shift();
      } else {
        const t = s.takes.find((x) => x.id === s.rec.take); if (t) { t.end = now; for (const p of this.peers()) t.people[p.pid] = p.name; }
        s.rec = { on: false, n: s.rec.n, take: s.rec.take, at: s.rec.at, end: now };
      }
      await this.save('rec', 'takes');
      return this.each({ t: 'rec', ...s.rec, now });
    }
    if (m.t === 'mark' && s.rec.on) {
      const t = s.takes.find((x) => x.id === s.rec.take); if (!t) return;
      t.marks.push({ at: Date.now(), label: clean(m.label, 60) || `Mark ${t.marks.length + 1}` });
      await this.save('takes');
      return this.send(ws, { t: 'marks', take: t.id, marks: t.marks });
    }
  }

  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const tags = this.ctx.getTags(ws), a = ws.deserializeAttachment?.() || {};
    if (tags.includes('in')) {
      if (this.open(`p:${a.pid}`).some((w) => w !== ws)) return;
      this.each({ t: 'leave', pid: a.pid }, (b) => b.pid !== a.pid);
      if (tags.includes('host')) this.each({ t: 'host', online: false }, (b) => b.pid !== 'host');
    } else if (tags.includes('wait') && !this.open(`p:${a.pid}`).some((w) => w !== ws)) for (const w of this.open('host')) this.send(w, { t: 'unknock', pid: a.pid });
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
