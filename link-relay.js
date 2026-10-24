// Showcaller Link relay: a studio's Showcaller Link without opening a port on its router. The studio computer
// (Showcaller Hub, the Link app, or an app letting clients in) keeps one connection out to its relay here (one
// Durable Object per studio); a client app connects here too, and the relay asks the studio computer to open a
// matching connection for it, then passes the bytes between the two. Everything it passes is already encrypted
// end to end by Showcaller Link (sc-link.js), with keys the relay never sees: it can't read or change any of it.
//
//   wss://…/link/relay/host?s=STUDIO&secret=S        the studio computer (the first one to use an id owns it)
//   wss://…/link/relay/data?s=STUDIO&secret=S&c=C    the studio computer, for client connection C
//   wss://…/link/relay/c?s=STUDIO                    a client app, one per connection (as with the direct port)
//
// To the studio computer, on its host connection: { open: C }. 'ping' is answered 'pong'.
import { DurableObject } from 'cloudflare:workers';

const STUDIO = /^[A-Za-z0-9_-]{12,40}$/;
const CONN = /^[a-f0-9]{16}$/;
const MAX_CONNS = 1000; // client connections open at once, per studio
const WAIT_MS = 10000;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export function linkRelay(request, env) {
  const url = new URL(request.url);
  if (!STUDIO.test(url.searchParams.get('s') || '')) return new Response('No such studio', { status: 404 });
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Use a WebSocket', { status: 426 });
  return env.LINK_RELAY.get(env.LINK_RELAY.idFromName(url.searchParams.get('s'))).fetch(request);
}

export class LinkRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.waiting = new Map(); // C -> what the client sent before the studio's side was there
  }

  host() { return this.ctx.getWebSockets('host').find((w) => w.readyState === WebSocket.OPEN) || null; }
  other(ws) {
    const t = this.ctx.getTags(ws).find((x) => /^[cd]:/.test(x));
    if (!t) return null;
    return this.ctx.getWebSockets(`${t[0] === 'c' ? 'd' : 'c'}:${t.slice(2)}`)[0] || null;
  }
  async owner(secret) {
    const h = await sha(`showcaller-link:${secret}`), saved = await this.ctx.storage.get('owner');
    if (secret.length < 20 || (saved && saved !== h)) return false;
    if (!saved) await this.ctx.storage.put('owner', h);
    return true;
  }

  async fetch(request) {
    const url = new URL(request.url), kind = url.pathname.split('/').pop();
    const [client, server] = Object.values(new WebSocketPair());
    const refuse = (code, why) => { this.ctx.acceptWebSocket(server, ['x']); server.close(code, why); return new Response(null, { status: 101, webSocket: client }); };
    if (kind === 'host') {
      if (!(await this.owner(url.searchParams.get('secret') || ''))) return refuse(4001, 'This studio link belongs to another computer');
      this.ctx.acceptWebSocket(server, ['host']);
      for (const w of this.ctx.getWebSockets('host')) if (w !== server) { try { w.close(4000, 'Replaced by a newer connection'); } catch {} }
    } else if (kind === 'data') {
      const c = url.searchParams.get('c') || '';
      if (!CONN.test(c) || !(await this.owner(url.searchParams.get('secret') || ''))) return refuse(4001, 'Not this studio');
      const cl = this.ctx.getWebSockets(`c:${c}`)[0];
      if (!cl) return refuse(4004, 'That connection has gone');
      this.ctx.acceptWebSocket(server, [`d:${c}`]);
      for (const m of this.waiting.get(c) || []) server.send(m);
      this.waiting.delete(c);
    } else if (kind === 'c') {
      const host = this.host();
      if (!host) return refuse(4004, 'The studio isn’t online right now');
      if (this.ctx.getWebSockets('c').length >= MAX_CONNS) return refuse(4002, 'Too many connections');
      const c = hex(crypto.getRandomValues(new Uint8Array(8)));
      this.ctx.acceptWebSocket(server, ['c', `c:${c}`]);
      this.waiting.set(c, []);
      host.send(JSON.stringify({ open: c }));
      // the studio computer didn't answer: give up on this one
      setTimeout(() => { if (this.waiting.has(c)) { this.waiting.delete(c); try { server.close(4004, 'The studio didn’t answer'); } catch {} } }, WAIT_MS);
    } else return refuse(4004, 'Unknown');
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    if (this.ctx.getTags(ws).includes('host')) return; // only 'ping', answered above
    const o = this.other(ws);
    if (o) { try { o.send(msg); } catch {} return; }
    const t = this.ctx.getTags(ws).find((x) => x.startsWith('c:'));
    const q = t && this.waiting.get(t.slice(2));
    if (q && q.length < 64) q.push(msg); else { try { ws.close(4004, 'Not connected'); } catch {} }
  }

  webSocketClose(ws, code, reason) {
    const o = this.other(ws);
    if (o) { try { o.close(1000, 'Closed'); } catch {} }
    const t = this.ctx.getTags(ws).find((x) => x.startsWith('c:'));
    if (t) this.waiting.delete(t.slice(2));
  }

  webSocketError(ws) { this.webSocketClose(ws); }
}
