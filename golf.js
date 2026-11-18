// Flagcast (golf): live scoring for golf tournaments. One Durable Object per tournament holds the
// setup and every score, and pushes each change to the open pages over a WebSocket. The scoring math lives in
// public/golf/core.js and runs in the pages, so this file only checks who may change what and stores it.
//
//   POST /golf/api/new                    { name, pass? }  → { id, key }   (GOLF_CREATE_PASS, when set, must match)
//   GET  /golf/api/<id>/state              the public state (setup without codes, scores, contests…)
//   GET  /golf/api/<id>/ws                 WebSocket: { t: 'state', s } on connect and after every change
//   POST /golf/api/<id>/cart               { code } → { teams: [ids] }   which teams a cart's QR code scores for
//   POST /golf/api/<id>/score              { code, team, list: [{ p, h, v, at }] }   p = player id or 'T'
//   POST /golf/api/<id>/desk               { key, op, … }   the tournament desk (see desk() below)
//   POST /golf/api/<id>/pro                { pin, op, … }   a golf pro or marshal with a PIN from the Manager (see pro() below)
//   POST /golf/api/<id>/hit                { list: [{ s: sponsorId, k: 'view'|'tap'|'secs', n }] }   sponsor counts for the report
//
// Pages: /g/<id> live page · /g/<id>/board screens · /g/<id>/desk#<key> desk · /g/<id>/s/<code> cart · /g/<id>/cards QR cards
import { DurableObject } from 'cloudflare:workers';
import { defaultHoles } from './public/golf/core.js';

const ID = /^[a-z0-9]{8}$/;
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const rand = (n, abc) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => abc[x % abc.length]).join(''); };
const newId = () => rand(8, 'abcdefghijkmnpqrstuvwxyz23456789');
export const newCode = () => rand(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
// the Flagcast phone app runs its pages from the phone itself, so the API answers those origins too
const APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost', 'ionic://localhost']);
const cors = (request, r) => {
  const o = request.headers.get('Origin');
  if (!o || !APP_ORIGINS.has(o) || r.status === 101) return r;
  const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', o); h.set('Vary', 'Origin');
  return new Response(r.body, { status: r.status, headers: h });
};
const preflight = (request) => new Response(null, { status: 204, headers: {
  'Access-Control-Allow-Origin': APP_ORIGINS.has(request.headers.get('Origin')) ? request.headers.get('Origin') : 'null',
  'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } });

const PAGES = { '': '/golf/live/', board: '/golf/board/', desk: '/golf/desk/', cards: '/golf/cards/' };

export async function golf(request, env) {
  const url = new URL(request.url);
  let m;
  if (request.method === 'OPTIONS' && url.pathname.startsWith('/golf/api/')) return preflight(request);
  if (url.pathname === '/golf/api/new') {
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
    let b = {}; try { b = await request.json(); } catch {}
    // live sites need the GOLF_CREATE_PASS secret; without it only local dev (localhost) can make tournaments
    const local = /^(localhost|127\.0\.0\.1)$/.test(new URL(request.url).hostname);
    if (!env.GOLF_CREATE_PASS && !local) return json({ error: 'New tournaments are not open yet. Ask Flagcast to set one up.' }, 403);
    if (env.GOLF_CREATE_PASS && b.pass !== env.GOLF_CREATE_PASS) return json({ error: 'That passcode is not right.' }, 403);
    const id = newId();
    const r = await env.GOLF.get(env.GOLF.idFromName(id)).fetch(new Request(`https://golf/init?id=${id}`, { method: 'POST', body: JSON.stringify({ name: String(b.name || '').slice(0, 80) }) }));
    return json(await r.json(), r.status);
  }
  if ((m = url.pathname.match(/^\/golf\/api\/([a-z0-9]{8})\/(state|ws|cart|score|desk|pro|hit)$/))) {
    const stub = env.GOLF.get(env.GOLF.idFromName(m[1]));
    return cors(request, await stub.fetch(request));
  }
  if ((m = url.pathname.match(/^\/g\/([a-z0-9]{8})(?:\/(board|desk|cards|s\/[A-HJ-NP-Z2-9]{6}))?\/?$/)) && request.method === 'GET') {
    const page = m[2]?.startsWith('s/') ? '/golf/score/' : PAGES[m[2] || ''];
    const r = await env.ASSETS.fetch(new Request(new URL(page, url), request));
    const h = new Headers(r.headers); h.set('Cache-Control', 'no-cache'); h.set('X-Robots-Tag', 'noindex'); h.set('Referrer-Policy', 'no-referrer');
    return new Response(r.body, { status: r.status, headers: h });
  }
  return null;
}

const clip = (s, n) => String(s ?? '').slice(0, n);
// sponsor spots: title (everywhere), leaderboard, hole (scorecard + the hole's page), cam (bug on a par 3 camera),
// contest (closest to the pin / long drive on its holes), turn (card after the 9th), ace (hole-in-one take-over), slide (big-screen slide)
export const SPOTS = ['title', 'leaderboard', 'hole', 'cam', 'contest', 'turn', 'ace', 'slide'];
// what a screen's playlist can hold
export const PAGE_KINDS = ['lb', 'p3', 'contests', 'skins', 'fund', 'sponsors', 'sponsor', 'schedule'];
// changes made on the day (desk or a pro's PIN); marshals only post contest results
const DAY_OPS = new Set(['fix', 'ctp', 'contest', 'flash', 'nudge', 'screen', 'take', 'lock', 'fund', 'stats']);
const MARSHAL_OPS = new Set(['ctp']);
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// the setup as the desk sends it, tidied so nothing odd gets stored
function cleanSetup(s, old) {
  const holes = Array.from({ length: 18 }, (_, i) => {
    const h = (s.course?.holes || [])[i] || old.course.holes[i] || {};
    return { n: i + 1, par: num(h.par, 3, 6, 4), yds: num(h.yds, 0, 999, 0), hcp: num(h.hcp, 1, 18, i + 1) };
  });
  const codes = new Map((old.teams || []).map((t) => [t.id, t.code]));
  const teams = (Array.isArray(s.teams) ? s.teams : []).slice(0, 200).map((t) => {
    const id = /^[a-z0-9]{4,12}$/.test(t.id || '') ? t.id : rand(6, 'abcdefghijkmnpqrstuvwxyz23456789');
    return {
      id, code: codes.get(id) || newCode(), name: clip(t.name, 60), flight: clip(t.flight, 12), start: num(t.start, 1, 18, 1),
      hcp: num(t.hcp, -10, 54, 0), cart: clip(t.cart, 12),
      players: (Array.isArray(t.players) ? t.players : []).slice(0, 4).map((p) => ({
        id: /^[a-z0-9]{2,12}$/.test(p.id || '') ? p.id : rand(5, 'abcdefghijkmnpqrstuvwxyz23456789'),
        name: clip(p.name, 50), hcp: num(p.hcp, -10, 54, 0), guest: !!p.guest,
      })),
    };
  });
  const f = s.format || {};
  return {
    name: clip(s.name, 80), club: clip(s.club, 80), date: clip(s.date, 20), course: { name: clip(s.course?.name, 80), holes },
    format: { type: ['bestball', 'stroke', 'scramble', 'stableford'].includes(f.type) ? f.type : 'bestball',
      count: num(f.count, 1, 4, 1), allowance: num(f.allowance, 0, 100, 100), show: f.show === 'gross' ? 'gross' : 'net' },
    flights: (Array.isArray(s.flights) ? s.flights : []).slice(0, 12).map((x) => clip(x, 12)).filter(Boolean),
    teams,
    screens: { title: clip(s.screens?.title, 80), ticker: clip(s.screens?.ticker, 300), seconds: num(s.screens?.seconds, 5, 60, 12),
      skins: !!s.screens?.skins, rows: num(s.screens?.rows, 5, 20, 10) },
    cams: Object.fromEntries(Object.entries(s.cams || {}).filter(([h, u]) => num(h, 1, 18, 0) && /^https:\/\//.test(u || '')).map(([h, u]) => [Number(h), clip(u, 500)])),
    // spot: where the sponsor shows (see SPOTS). holes: which holes, for hole, camera and contest spots
    sponsors: (Array.isArray(s.sponsors) ? s.sponsors : []).slice(0, 60).map((x) => {
      const holes = (Array.isArray(x.holes) ? x.holes : []).map(Number).filter((h) => h >= 1 && h <= 18);
      return {
        id: clip(x.id, 12) || rand(5, 'abcdefghijkmnpqrstuvwxyz23456789'), name: clip(x.name, 60), line: clip(x.line, 120),
        spot: SPOTS.includes(x.spot) ? x.spot : (holes.length ? 'hole' : 'slide'), holes,
        logo: typeof x.logo === 'string' && x.logo.startsWith('data:image/') && x.logo.length < 200000 ? x.logo : '',
        url: /^https:\/\//.test(x.url || '') ? clip(x.url, 300) : '', offer: clip(x.offer, 200),
      };
    }),
    schedule: (Array.isArray(s.schedule) ? s.schedule : []).slice(0, 20).map((x) => ({ time: clip(x.time, 20), what: clip(x.what, 80) })).filter((x) => x.what),
    // golf pros and marshals sign in to the phone app with these. Never sent to the public pages
    pins: (Array.isArray(s.pins) ? s.pins : []).slice(0, 20).map((x) => ({
      id: /^[a-z0-9]{3,12}$/.test(x.id || '') ? x.id : rand(5, 'abcdefghijkmnpqrstuvwxyz23456789'),
      name: clip(x.name, 40), role: x.role === 'marshal' ? 'marshal' : 'pro', pin: String(x.pin || '').replace(/\D/g, '').slice(0, 8),
    })).filter((x) => x.name && x.pin.length >= 4),
    // each TV or LED wall at the club and what it plays (a board page opened with ?screen=<id>)
    displays: (Array.isArray(s.displays) ? s.displays : []).slice(0, 20).map((d) => ({
      id: /^[a-z0-9]{3,12}$/.test(d.id || '') ? d.id : rand(5, 'abcdefghijkmnpqrstuvwxyz23456789'), name: clip(d.name, 40),
      playlist: (Array.isArray(d.playlist) ? d.playlist : []).slice(0, 30).filter((x) => PAGE_KINDS.includes(x.k)).map((x) => ({
        k: x.k, fl: clip(x.fl, 12), hole: num(x.hole, 0, 18, 0), sponsor: clip(x.sponsor, 12), secs: num(x.secs, 4, 300, 12) })),
    })),
    fund: { on: !!s.fund?.on, label: clip(s.fund?.label, 80), goal: num(s.fund?.goal, 0, 1e9, 0), raised: num(s.fund?.raised, 0, 1e9, 0), give: /^https:\/\//.test(s.fund?.give || '') ? clip(s.fund.give, 300) : '' },
    contests: (Array.isArray(s.contests) ? s.contests : []).slice(0, 30).map((c) => ({
      id: clip(c.id, 12) || rand(5, 'abcdefghijkmnpqrstuvwxyz23456789'), kind: c.kind === 'ld' ? 'ld' : 'ctp', hole: num(c.hole, 1, 18, 1),
      label: clip(c.label, 60), sponsor: clip(c.sponsor, 60),
      entries: (Array.isArray(c.entries) ? c.entries : []).slice(0, 50).map((e) => ({ name: clip(e.name, 50), dist: num(e.dist, 0, 999, 0) })).filter((e) => e.name),
    })),
  };
}

export class GolfEvent extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async load() {
    if (!this.ev) this.ev = await this.ctx.storage.get('event');
    return this.ev;
  }
  async scores() {
    if (!this.sc) {
      this.sc = {};
      for (const [k, v] of await this.ctx.storage.list({ prefix: 's:' })) this.sc[k.slice(2)] = v;
    }
    return this.sc;
  }

  // what anyone can see: the setup without the cart codes or the desk key
  async publicState() {
    const ev = await this.load(), sc = await this.scores();
    const { key, pins, log, ...rest } = ev;
    const teams = ev.teams.map(({ code, ...t }) => t);
    const online = Object.fromEntries((ev.displays || []).map((d) => [d.id, this.ctx.getWebSockets(`d:${d.id}`).length]));
    const scores = {};
    for (const t of ev.teams) {
      const s = sc[t.id]; if (!s) continue;
      scores[t.id] = Object.fromEntries(Object.entries(s).map(([p, arr]) => [p, arr.map((x) => (x ? x.v : null))]));
    }
    return { ...rest, teams, scores, online };
  }

  async broadcast() {
    const s = JSON.stringify({ t: 'state', s: await this.publicState() });
    for (const w of this.ctx.getWebSockets()) { try { w.send(s); } catch {} }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/init') {
      if (await this.load()) return json({ error: 'Taken' }, 409);
      const b = await request.json();
      const s = cleanSetup({ name: b.name || 'Golf tournament', format: { type: 'bestball', count: 1, allowance: 85 }, flights: ['A', 'B'],
        screens: { seconds: 12, rows: 10 } }, { course: { holes: defaultHoles() }, teams: [] });
      this.ev = { ...s, id: url.searchParams.get('id'), key: rand(24, 'abcdefghijkmnpqrstuvwxyz23456789'), locked: false, aces: [], created: Date.now(), v: 1 };
      await this.ctx.storage.put('event', this.ev);
      return json({ id: this.ev.id, key: this.ev.key });
    }
    const ev = await this.load();
    if (!ev) return json({ error: 'There is no tournament at this address.' }, 404);
    const op = url.pathname.split('/').pop();
    if (op === 'state') return json(await this.publicState());
    if (op === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Use a WebSocket', { status: 426 });
      if (this.ctx.getWebSockets().length > 900) return new Response('Too many viewers', { status: 503 });
      const [client, server] = Object.values(new WebSocketPair());
      const disp = url.searchParams.get('screen') || '';
      this.ctx.acceptWebSocket(server, /^[a-z0-9]{3,12}$/.test(disp) ? [`d:${disp}`] : []);
      server.send(JSON.stringify({ t: 'state', s: await this.publicState() }));
      if (disp) this.ctx.waitUntil(this.broadcast()); // the Manager and pro phones see the screen come on
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
    let b; try { b = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
    if (op === 'cart') {
      const code = String(b.code || '').toUpperCase();
      const teams = ev.teams.filter((t) => t.code === code).map((t) => t.id);
      if (!teams.length) return json({ error: 'That scorecard code isn’t in this tournament. Check the code on your cart card.' }, 404);
      return json({ teams });
    }
    if (op === 'score') return this.score(b);
    if (op === 'desk') {
      if (!b.key || b.key !== ev.key) return json({ error: 'This desk link is not right. Open the link you were given when the tournament was made.' }, 403);
      return this.desk(b);
    }
    if (op === 'pro') return this.pro(b);
    if (op === 'hit') return this.hit(b);
    return json({ error: 'Not found' }, 404);
  }

  // a cart sends scores: only for its own team, and not after the results are locked.
  // Each score carries the time it was typed, so a phone that was out of signal can send late without undoing newer fixes.
  async score(b) {
    const ev = this.ev, code = String(b.code || '').toUpperCase();
    const team = ev.teams.find((t) => t.id === b.team && (t.code === code || b.desk === ev.key));
    if (!team) return json({ error: 'This scorecard can’t enter scores for that team.' }, 403);
    if (ev.locked && b.desk !== ev.key) return json({ error: 'Scoring is closed. The results are final.' }, 423);
    const sc = await this.scores();
    const mine = sc[team.id] || {};
    const ids = new Set(ev.format.type === 'scramble' ? ['T'] : team.players.map((p) => p.id));
    const now = Date.now(); let changed = false; const aces = [];
    for (const e of (Array.isArray(b.list) ? b.list : []).slice(0, 200)) {
      if (!ids.has(e.p)) continue;
      const h = Number(e.h); if (!(h >= 1 && h <= 18)) continue;
      const v = e.v === null ? null : Number(e.v);
      if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 15)) continue;
      const at = Math.min(Number(e.at) || now, now);
      const arr = mine[e.p] || Array(18).fill(null);
      const old = arr[h - 1];
      if (old && old.at > at) continue; // a newer change is already here
      arr[h - 1] = v === null ? null : { v, at };
      mine[e.p] = arr; changed = true;
      if (v === 1 && (!old || old.v !== 1)) {
        const p = team.players.find((x) => x.id === e.p);
        aces.push({ hole: h, name: p ? p.name : team.name, team: team.name, at: now });
      }
    }
    if (changed) {
      sc[team.id] = mine;
      await this.ctx.storage.put(`s:${team.id}`, mine);
      if (aces.length) { ev.aces = [...(ev.aces || []), ...aces].slice(-20); await this.ctx.storage.put('event', ev); }
      await this.broadcast();
    }
    return json({ ok: true });
  }

  // the desk: { op: 'get' } (the full setup with codes, PINs and sponsor counts) | 'save' (setup) | 'clear' { team } | 'ace' { remove: at }
  // plus every day op (see dayOp): lock, contest, ctp, fund, flash, nudge, fix, screen, take, stats
  async desk(b) {
    const ev = this.ev;
    if (b.op === 'get') return json({ ...ev, stats: await this.getStats() });
    if (DAY_OPS.has(b.op)) return this.dayOp(b, 'Desk');
    if (b.op === 'save') {
      const s = cleanSetup(b.setup || {}, ev);
      Object.assign(ev, s, { v: (ev.v || 0) + 1 });
      // scores of teams that were removed go too
      const keep = new Set(ev.teams.map((t) => t.id)), sc = await this.scores();
      for (const id of Object.keys(sc)) if (!keep.has(id)) { delete sc[id]; await this.ctx.storage.delete(`s:${id}`); }
    } else if (b.op === 'ace') ev.aces = (ev.aces || []).filter((a) => a.at !== b.remove);
    else if (b.op === 'clear') {
      const sc = await this.scores(); delete sc[b.team]; await this.ctx.storage.delete(`s:${b.team}`);
    } else return json({ error: 'Unknown change' }, 400);
    await this.ctx.storage.put('event', ev);
    await this.broadcast();
    return json(b.op === 'save' ? ev : { ok: true });
  }

  // a golf pro or marshal signs in with the PIN the Manager gave them. Pros run the day; marshals post contest results.
  async pro(b) {
    const ev = this.ev, now = Date.now();
    this.fails = (this.fails || []).filter((t) => now - t < 10 * 60000);
    if (this.fails.length >= 20) return json({ error: 'Too many wrong PINs. Try again in a few minutes.' }, 429);
    const who = (ev.pins || []).find((x) => x.pin && x.pin === String(b.pin || ''));
    if (!who) { this.fails.push(now); return json({ error: 'That PIN is not right.' }, 403); }
    if (b.op === 'hello') return json({ name: who.name, role: who.role });
    if (!(who.role === 'pro' ? DAY_OPS : MARSHAL_OPS).has(b.op)) return json({ error: 'Your PIN can’t make that change. Ask the golf pro.' }, 403);
    return this.dayOp(b, who.name);
  }

  // changes made on the day, by the desk (Manager) or a pro's phone
  async dayOp(b, by) {
    const ev = this.ev, now = Date.now();
    ev.live = ev.live || { force: {}, take: null };
    if (b.op === 'stats') return json({ stats: await this.getStats(), log: ev.log || [] });
    if (b.op === 'fix') {
      const team = ev.teams.find((t) => t.id === b.team); if (!team) return json({ error: 'No such team' }, 404);
      const sc = await this.scores(), h = Number(b.h);
      const before = ((sc[team.id] || {})[b.p] || [])[h - 1];
      const r = await this.score({ team: team.id, desk: ev.key, list: [{ p: b.p, h, v: b.v, at: now }] });
      if (r.status !== 200) return r;
      const pl = team.players.find((x) => x.id === b.p);
      ev.log = [...(ev.log || []), { at: now, by: clip(by, 40), team: team.name, player: pl ? pl.name : 'Team', h, from: before ? before.v : null, to: b.v === null ? null : Number(b.v) }].slice(-300);
      await this.ctx.storage.put('event', ev);
      return json({ ok: true });
    }
    if (b.op === 'ctp') { // a marshal at the hole: one result, replacing that player's earlier one
      const c = ev.contests.find((x) => x.id === b.id); if (!c) return json({ error: 'No such contest' }, 404);
      const name = clip(b.name, 50).trim(); if (!name) return json({ error: 'Who was it?' }, 400);
      const entries = [...c.entries.filter((e) => e.name.toLowerCase() !== name.toLowerCase()), { name, dist: num(b.dist, 0, 999, 0) }];
      c.entries = cleanSetup({ contests: [{ ...c, entries }] }, ev).contests[0].entries;
    } else if (b.op === 'contest') {
      const c = ev.contests.find((x) => x.id === b.id); if (!c) return json({ error: 'No such contest' }, 404);
      c.entries = cleanSetup({ contests: [{ ...c, entries: b.entries }] }, ev).contests[0].entries;
    } else if (b.op === 'flash') {
      ev.flash = b.text ? { text: clip(b.text, 140), at: now } : null;
      if (b.text) ev.news = [...(ev.news || []), { text: clip(b.text, 140), at: now, by: clip(by, 40) }].slice(-30);
    } else if (b.op === 'nudge') {
      const team = ev.teams.find((t) => t.id === b.team); if (!team) return json({ error: 'No such team' }, 404);
      ev.nudges = [...(ev.nudges || []), { team: team.id, text: clip(b.text || 'Please keep up the pace of play. Thank you!', 140), at: now }].slice(-50);
    } else if (b.op === 'screen') { // switch one screen to a page, or back to its playlist (page: null)
      if (!(ev.displays || []).find((d) => d.id === b.display)) return json({ error: 'No such screen' }, 404);
      if (b.page && PAGE_KINDS.includes(b.page.k)) ev.live.force[b.display] = { k: b.page.k, fl: clip(b.page.fl, 12), hole: num(b.page.hole, 0, 18, 0), sponsor: clip(b.page.sponsor, 12), at: now };
      else delete ev.live.force[b.display];
    } else if (b.op === 'take') { // take over every screen: an ace, an announcement, a sponsor moment, or clear back to the playlists
      if (b.kind === 'clear') { ev.live = { force: {}, take: null }; }
      else if (['ace', 'msg', 'sponsor'].includes(b.kind)) ev.live.take = { kind: b.kind, text: clip(b.text, 140), sponsor: clip(b.sponsor, 12), at: now, secs: num(b.secs, 5, 120, 25) };
      else return json({ error: 'Unknown take-over' }, 400);
    } else if (b.op === 'lock') ev.locked = !!b.locked;
    else if (b.op === 'fund') ev.fund.raised = num(b.raised, 0, 1e9, ev.fund.raised);
    else return json({ error: 'Unknown change' }, 400);
    await this.ctx.storage.put('event', ev);
    await this.broadcast();
    return json({ ok: true });
  }

  // sponsor counts for the report: app views and taps, and seconds on the big screens
  async getStats() {
    if (!this.st) this.st = (await this.ctx.storage.get('stats')) || {};
    return this.st;
  }
  async hit(b) {
    const ev = this.ev, st = await this.getStats(), ids = new Set(ev.sponsors.map((x) => x.id));
    let n = 0;
    for (const e of (Array.isArray(b.list) ? b.list : []).slice(0, 50)) {
      if (!ids.has(e.s) || !['view', 'tap', 'secs'].includes(e.k)) continue;
      const row = st[e.s] || (st[e.s] = { view: 0, tap: 0, secs: 0 });
      row[e.k] += e.k === 'secs' ? num(e.n, 0, 600, 0) : 1; n++;
    }
    if (n) await this.ctx.storage.put('stats', st);
    return json({ ok: true });
  }

  async webSocketMessage() {}
  async webSocketClose(ws) { try { ws.close(); } catch {} }
  async webSocketError() {}
}
