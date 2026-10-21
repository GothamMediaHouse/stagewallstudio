// Showcaller Intercom: crew join from anywhere, through this site. The director's computer connects out to a room
// here (one Durable Object per room) and stays connected; crew open https://showcallerstudio.com/i/<room>/<key>, and
// their page's WebSocket is passed through the room to the director's computer, which checks the key and answers
// exactly as it does on its own network. The sound itself goes straight between them where it can, and through
// Cloudflare's TURN relay where it can't (handed out by the room, only to the director's computer and to crew it let in).
//
//   wss://…/intercom/host?room=R&secret=S   the director's computer (the first one to use a room owns it)
//   wss://…/intercom/ws?r=R&k=KEY           a crew page or the Intercom app
//   https://…/i/R/KEY                       the crew page (public/intercom/crew/)
//
// Host frames: from the room { c: id, open: { k, ua, ip } } | { c: id, m: '<crew message>' } | { c: id, close: true }
// | { ice: [...] }; to the room { c: id, m: '<message>' } | { c: id, close: true, why } | { ice: true } | 'ping'.
import { DurableObject } from 'cloudflare:workers';

const ROOM = /^[a-z0-9]{8,24}$/;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export async function intercom(request, env) {
  const url = new URL(request.url);
  const room = url.pathname === '/intercom/host' ? url.searchParams.get('room') : url.searchParams.get('r');
  if (!ROOM.test(room || '')) return new Response('No such intercom', { status: 404 });
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Use a WebSocket', { status: 426 });
  return env.INTERCOM.get(env.INTERCOM.idFromName(room)).fetch(request);
}

// the crew page, for /i/<room>/<key> (the page reads the room and key from its own address)
export function intercomPage(request, env) {
  const url = new URL(request.url);
  return env.ASSETS.fetch(new Request(new URL('/intercom/crew/', url), request));
}

export class IntercomRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  host() { return this.ctx.getWebSockets('host').find((w) => w.readyState === WebSocket.OPEN) || null; }

  async fetch(request) {
    const url = new URL(request.url);
    const [client, server] = Object.values(new WebSocketPair());
    if (url.pathname === '/intercom/host') {
      const secret = url.searchParams.get('secret') || '';
      const h = await sha(`showcaller-intercom:${secret}`), saved = await this.ctx.storage.get('owner');
      this.ctx.acceptWebSocket(server, ['host']);
      if (secret.length < 20 || (saved && saved !== h)) { server.close(4001, 'This intercom address belongs to another computer'); return new Response(null, { status: 101, webSocket: client }); }
      if (!saved) await this.ctx.storage.put('owner', h);
      for (const w of this.ctx.getWebSockets('host')) if (w !== server) { try { w.close(4000, 'Replaced by a newer connection'); } catch {} }
      // crew who were already waiting
      for (const w of this.ctx.getWebSockets('crew')) { const a = w.deserializeAttachment(); server.send(JSON.stringify({ c: a.id, open: { k: a.k, ua: a.ua, ip: a.ip } })); }
    } else {
      const a = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 16), k: (url.searchParams.get('k') || '').slice(0, 80), ua: (request.headers.get('User-Agent') || '').slice(0, 300), ip: request.headers.get('CF-Connecting-IP') || '', ok: false };
      if (this.ctx.getWebSockets('crew').length >= 120) { this.ctx.acceptWebSocket(server, ['x']); server.close(4002, 'Too many people'); return new Response(null, { status: 101, webSocket: client }); }
      this.ctx.acceptWebSocket(server, ['crew', `c:${a.id}`]);
      server.serializeAttachment(a);
      const host = this.host();
      if (host) host.send(JSON.stringify({ c: a.id, open: { k: a.k, ua: a.ua, ip: a.ip } }));
      else server.send(JSON.stringify({ t: 'wait', why: 'The director’s computer isn’t online right now. This page joins as soon as it is.' }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 262144) return;
    const tags = this.ctx.getTags(ws);
    if (tags.includes('host')) {
      let m; try { m = JSON.parse(msg); } catch { return; }
      if (m.ice) return ws.send(JSON.stringify({ ice: await this.ice() }));
      const t = this.ctx.getWebSockets(`c:${m.c}`)[0]; if (!t) return;
      if (m.close) { try { t.close(1000, String(m.why || '').slice(0, 100)); } catch {} return; }
      if (typeof m.m !== 'string') return;
      let out = m.m;
      // the director's computer let them in (its first word to them is hello): hand them the relay servers too
      if (out.startsWith('{"t":"hello"')) {
        const a = t.deserializeAttachment(); a.ok = true; t.serializeAttachment(a);
        try { const o = JSON.parse(out); o.ice = await this.ice(); out = JSON.stringify(o); } catch {}
      }
      try { t.send(out); } catch {}
    } else if (tags.includes('crew')) {
      const a = ws.deserializeAttachment(), h = this.host();
      if (h) h.send(JSON.stringify({ c: a.id, m: msg }));
    }
  }

  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const tags = this.ctx.getTags(ws);
    if (tags.includes('crew')) { const a = ws.deserializeAttachment(), h = this.host(); if (h) { try { h.send(JSON.stringify({ c: a.id, close: true })); } catch {} } }
    else if (tags.includes('host') && !this.ctx.getWebSockets('host').some((w) => w !== ws && w.readyState === WebSocket.OPEN)) {
      for (const w of this.ctx.getWebSockets('crew')) { try { w.send(JSON.stringify({ t: 'wait', why: 'The director’s computer went offline. This page joins again as soon as it’s back.' })); } catch {} }
    }
  }

  // relay servers for the sound: Cloudflare TURN when it's set up (TURN_KEY_ID, TURN_KEY_API_TOKEN), else just STUN
  // (which still gets through most home and phone networks). Credentials last a day; a fresh set every 12 hours.
  async ice() {
    const now = Date.now();
    if (this.iceCache && now - this.iceCache.at < 12 * 3600e3) return this.iceCache.list;
    let list = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
    if (this.env.TURN_KEY_ID && this.env.TURN_KEY_API_TOKEN) {
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method: 'POST', headers: { Authorization: `Bearer ${this.env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }) });
        const j = await r.json();
        const s = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
        if (r.ok && s.length) list = s;
      } catch {}
    }
    this.iceCache = { at: now, list };
    return list;
  }
}
