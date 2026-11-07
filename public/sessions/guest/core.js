// Showcaller Sessions: the part shared by the guest page (showcallerstudio.com/s/<room>) and the Sessions app's room.
// Session = the room connection (people, waiting room, clock, chat) and the small call everyone sees and hears.
// Recorder = this person's full-quality recording: camera + mic through MediaRecorder (2-second pieces) and the mic again
// as 24-bit PCM for a WAV. Pieces go to a sink: CloudSink (guest: kept in this browser's private storage until the site
// confirms the SHA-256, then deleted) or the app's own sink that writes straight to the studio Mac's disk.
(function (root) {
  'use strict';
  const QUALITY = {
    '720': { w: 1280, h: 720, vbps: 5e6, label: '720p' },
    '1080': { w: 1920, h: 1080, vbps: 10e6, label: '1080p' },
    '4k': { w: 3840, h: 2160, vbps: 25e6, label: '4K' },
  };
  const PIECE_MS = 2000, RATE = 48000, PART = 100000;
  const rid = (n = 12) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  const sha256 = async (buf) => hex(await crypto.subtle.digest('SHA-256', buf));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class Emitter {
    constructor() { this._h = {}; }
    on(t, f) { (this._h[t] ||= []).push(f); return this; }
    emit(t, ...a) { for (const f of this._h[t] || []) { try { f(...a); } catch (e) { console.error(e); } } }
  }

  // ---------- the room ----------
  class Session extends Emitter {
    // opts: { server, room, role: 'host'|'guest', pid, name, secret (host), stream (MediaStream for the call) }
    constructor(opts) {
      super();
      Object.assign(this, { server: opts.server.replace(/\/$/, ''), room: opts.room, role: opts.role, pid: opts.role === 'host' ? 'host' : opts.pid, name: opts.name, secret: opts.secret || '' });
      this.stream = opts.stream || null;
      this.peers = new Map(); // pid -> { pid, name, role, pc, stream, polite, making, ignore }
      this.offset = 0; this.rtt = Infinity; this.state = 'connecting'; this.cfg = {}; this.rec = { on: false }; this.ice = [];
      this.waiting = new Map(); this.takes = []; this.closed = false; this.tries = 0;
    }
    now() { return Date.now() + this.offset; }
    wsUrl() {
      const u = new URL(this.server + (this.role === 'host' ? '/sessions/host' : '/sessions/ws'));
      u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
      u.searchParams.set('r', this.room); u.searchParams.set('name', this.name);
      if (this.role === 'host') u.searchParams.set('secret', this.secret); else u.searchParams.set('pid', this.pid);
      return u.toString();
    }
    connect() {
      if (this.closed) return;
      const ws = this.ws = new WebSocket(this.wsUrl());
      ws.onopen = () => { this.tries = 0; this.ping = setInterval(() => { try { ws.send('ping'); } catch {} }, 25000); };
      ws.onmessage = (e) => { if (e.data === 'pong') return; let m; try { m = JSON.parse(e.data); } catch { return; } this.onmsg(m); };
      ws.onclose = (e) => {
        clearInterval(this.ping);
        if (this.ws !== ws) return;
        for (const p of this.peers.values()) this.drop(p.pid, true);
        if ([4001, 4002, 4003, 4004, 4006].includes(e.code) || this.closed) { this.setState('closed', e.reason || 'Disconnected', e.code); return; }
        if (e.code === 4000) { this.setState('closed', e.reason, e.code); return; }
        const soon = e.code === 4005; // let in from the waiting room: join straight away
        this.setState(soon ? 'connecting' : 'reconnecting');
        setTimeout(() => this.connect(), soon ? 50 : Math.min(8000, 500 * 2 ** this.tries++));
      };
    }
    leave() { this.closed = true; try { this.ws && this.ws.close(1000); } catch {} for (const p of [...this.peers.keys()]) this.drop(p); }
    setState(s, why, code) { this.state = s; this.emit('state', s, why, code); }
    send(o) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(o)); return true; } return false; }
    async syncClock() {
      for (let i = 0; i < 6; i++) { this.send({ t: 'time', c: Date.now() }); await sleep(150); }
    }
    onmsg(m) {
      switch (m.t) {
        case 'time': {
          const t = Date.now(), rtt = t - m.c;
          if (rtt < this.rtt + 5) { this.rtt = Math.min(rtt, this.rtt); this.offset = m.s - (m.c + rtt / 2); }
          break;
        }
        case 'wait': this.offset = m.now - Date.now(); this.cfg.name = m.name; this.setState('waiting', '', m.host); break;
        case 'admitted': this.setState('connecting'); break;
        case 'denied': case 'kicked': this.setState('closed', m.t === 'denied' ? 'The host didn’t let you in' : 'The host removed you from the session', m.t); break;
        case 'hello': {
          this.offset = m.now - Date.now(); this.rtt = Infinity; this.syncClock();
          this.ice = m.ice || []; this.cfg = m.cfg || {}; this.tok = m.tok; this.hostOnline = m.host;
          if (m.takes) this.takes = m.takes;
          if (m.waiting) { this.waiting = new Map(m.waiting.map((w) => [w.pid, w])); this.emit('waiting', [...this.waiting.values()]); }
          for (const p of [...this.peers.keys()]) this.drop(p, true);
          for (const p of m.peers) this.add(p, true); // the newcomer calls everyone (no glare)
          this.setState('in');
          this.emit('cfg', this.cfg);
          this.emit('rec', m.rec, true);
          this.rec = m.rec;
          this.emit('peers');
          break;
        }
        case 'join': this.drop(m.peer.pid, true); this.add(m.peer, false); this.emit('peers'); break;
        case 'leave': this.drop(m.pid); this.emit('peers'); break;
        case 'host': this.hostOnline = m.online; this.emit('host', m.online); break;
        case 'knock': this.waiting.set(m.pid, m); this.emit('waiting', [...this.waiting.values()]); break;
        case 'unknock': this.waiting.delete(m.pid); this.emit('waiting', [...this.waiting.values()]); break;
        case 'cfg': this.cfg = m.cfg; this.emit('cfg', m.cfg); break;
        case 'rec': {
          this.rec = m;
          if (this.role === 'host' && m.on && !this.takes.some((t) => t.id === m.take)) this.takes.push({ id: m.take, n: m.n, at: m.at, end: 0, marks: [] });
          if (this.role === 'host' && !m.on) { const t = this.takes.find((x) => x.id === m.take); if (t) t.end = m.end; }
          this.emit('rec', m, false); break;
        }
        case 'marks': { const t = this.takes.find((x) => x.id === m.take); if (t) t.marks = m.marks; this.emit('marks', m); break; }
        case 'chat': this.emit('chat', m); break;
        case 'sig': this.onsig(m.from, m.data); break;
      }
    }
    // host controls
    admit(pid, yes = true) { this.send({ t: 'admit', pid, yes }); this.waiting.delete(pid); this.emit('waiting', [...this.waiting.values()]); }
    kick(pid) { this.send({ t: 'kick', pid }); }
    setCfg(cfg) { this.send({ t: 'cfg', cfg }); }
    record(on) { this.send({ t: 'rec', on }); }
    mark(label) { this.send({ t: 'mark', label }); }
    chat(text) { this.send({ t: 'chat', text }); }
    rename(name) { this.name = name; this.send({ t: 'name', name }); }
    tell(pid, data) { this.send({ t: 'sig', to: pid, data: { k: 'x', d: data } }); }

    // ---- the call: one small peer connection to each person (perfect negotiation) ----
    // call: true when this side makes the offer (the person who just arrived); the other side answers with its tracks
    add(info, call) {
      if (info.pid === this.pid) return;
      const p = { ...info, polite: this.pid > info.pid, making: false, ignore: false, stream: new MediaStream(), sent: false, early: [] };
      const pc = p.pc = new RTCPeerConnection({ iceServers: this.ice });
      this.peers.set(info.pid, p);
      pc.ontrack = (e) => { if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track); e.track.onunmute = () => this.emit('stream', p); this.emit('stream', p); };
      pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'sig', to: p.pid, data: { ice: e.candidate } }); };
      pc.onnegotiationneeded = async () => {
        try { p.making = true; await pc.setLocalDescription(); this.send({ t: 'sig', to: p.pid, data: { sdp: pc.localDescription } }); }
        catch (e) { console.warn(e); } finally { p.making = false; }
      };
      pc.onconnectionstatechange = () => { this.emit('link', p, pc.connectionState); if (pc.connectionState === 'failed') pc.restartIce(); };
      if (call) this.addTracks(p);
    }
    addTracks(p) {
      if (p.sent) return; p.sent = true;
      if (this.stream) for (const t of this.stream.getTracks()) this.addCallTrack(p, t);
      else { p.pc.addTransceiver('audio', { direction: 'recvonly' }); p.pc.addTransceiver('video', { direction: 'recvonly' }); }
    }
    addCallTrack(p, t) {
      const s = p.pc.addTrack(t, this.stream);
      if (t.kind === 'video') this.lowCall(s, t);
    }
    // the call only needs a small picture (the recording is the full one), about 360p at 900 kb/s
    async lowCall(sender, track) {
      try {
        const h = (track.getSettings && track.getSettings().height) || 720;
        const prm = sender.getParameters(); if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
        prm.encodings[0].maxBitrate = 900000; prm.encodings[0].scaleResolutionDownBy = Math.max(1, h / 360);
        await sender.setParameters(prm);
      } catch {}
    }
    // the camera's size changed: keep the call picture small
    rescale() { for (const p of this.peers.values()) for (const s of p.pc.getSenders()) if (s.track && s.track.kind === 'video') this.lowCall(s, s.track); }
    // swap the camera or mic in every call without renegotiating
    replaceTrack(kind, track) {
      for (const p of this.peers.values()) for (const s of p.pc.getSenders()) if (s.track && s.track.kind === kind) { s.replaceTrack(track); if (kind === 'video') this.lowCall(s, track); }
    }
    drop(pid, quiet) {
      const p = this.peers.get(pid); if (!p) return;
      try { p.pc.close(); } catch {}
      this.peers.delete(pid);
      if (!quiet) this.emit('gone', p);
    }
    async onsig(from, d) {
      if (!d) return;
      if (d.k === 'x') return this.emit('data', from, d.d);
      const p = this.peers.get(from); if (!p) return;
      const pc = p.pc;
      try {
        if (d.sdp) {
          const collide = d.sdp.type === 'offer' && (p.making || pc.signalingState !== 'stable');
          p.ignore = !p.polite && collide; if (p.ignore) return;
          await pc.setRemoteDescription(d.sdp);
          for (const c of p.early.splice(0)) { try { await pc.addIceCandidate(c); } catch {} }
          if (d.sdp.type === 'offer') {
            if (!p.sent) { p.sent = true; if (this.stream) for (const t of this.stream.getTracks()) this.addCallTrack(p, t); }
            await pc.setLocalDescription(); this.send({ t: 'sig', to: from, data: { sdp: pc.localDescription } });
          }
        } else if (d.ice) {
          if (!pc.remoteDescription) { p.early.push(d.ice); return; }
          try { await pc.addIceCandidate(d.ice); } catch (e) { if (!p.ignore) throw e; }
        }
      } catch (e) { console.warn('call', e); }
    }
  }

  // ---------- recording ----------
  const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.on=false;this.buf=new Float32Array(4800);this.n=0;this.first=true;this.port.onmessage=e=>{if(e.data==='start'){this.on=true;this.first=true;this.n=0}else if(e.data==='stop'){if(this.n)this.port.postMessage({d:this.buf.slice(0,this.n)});this.on=false;this.n=0;this.port.postMessage({end:true})}}}
process(i){const c=i[0]&&i[0][0];if(!this.on)return true;const L=c?c.length:128;if(this.first){this.first=false;this.port.postMessage({t0:currentTime})}
for(let k=0;k<L;k++){let v=0;if(c){v=c[k];if(i[0].length>1)v=(v+i[0][1][k])/2}this.buf[this.n++]=v;if(this.n===this.buf.length){this.port.postMessage({d:this.buf.slice()});this.n=0}}return true}}
registerProcessor('sc-pcm',P)`;

  function pickMime() {
    const list = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const m of list) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }

  // 24-bit little-endian PCM from float samples
  function s24(f32) {
    const out = new Uint8Array(f32.length * 3);
    for (let i = 0, o = 0; i < f32.length; i++, o += 3) {
      let v = Math.max(-1, Math.min(1, f32[i])); v = v < 0 ? Math.round(v * 8388608) : Math.round(v * 8388607);
      out[o] = v & 255; out[o + 1] = (v >> 8) & 255; out[o + 2] = (v >> 16) & 255;
    }
    return out.buffer;
  }

  class Recorder extends Emitter {
    // opts: { session, stream (full-quality camera + mic), quality, sink }
    constructor(opts) { super(); Object.assign(this, opts); this.running = false; }
    // part: 0 for a normal take; 1, 2… when this page rejoined a take that was already running (after a reload)
    async start(take, atServer, part = 0) {
      if (this.running) return;
      this.running = true; this.take = take; this.part = part; this.vSeq = part * PART; this.aSeq = part * PART; this.vBytes = 0; this.aBytes = 0;
      const q = QUALITY[this.quality] || QUALITY['1080'], s = this.session;
      const mime = pickMime(), vt = this.stream.getVideoTracks()[0], at = this.stream.getAudioTracks()[0];
      const set = vt ? vt.getSettings() : {};
      this.meta = { v: 1, room: s.room, take, part, pid: s.pid, name: s.name, quality: this.quality, mime, ext: mime.includes('mp4') ? 'mp4' : 'webm',
        width: set.width || 0, height: set.height || 0, fps: set.frameRate || 0, sampleRate: RATE, channels: 1, bits: 24,
        vStart: 0, aStart: 0, vCount: 0, aCount: 0, done: false, ua: navigator.userAgent, startedAt: 0 };
      // the mic as 24-bit PCM, on its own audio clock
      this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      await this.ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.ctx, 'sc-pcm', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'clamped-max' });
      if (at) this.ctx.createMediaStreamSource(new MediaStream([at])).connect(this.node);
      const sink0 = this.ctx.createGain(); sink0.gain.value = 0; this.node.connect(sink0).connect(this.ctx.destination);
      this.pcm = []; this.pcmN = 0;
      this.node.port.onmessage = (e) => {
        const d = e.data;
        if (d.t0 !== undefined) this.meta.aStart = this.ctxToServer(d.t0);
        if (d.d) { this.pcm.push(d.d); this.pcmN += d.d.length; if (this.pcmN >= RATE * PIECE_MS / 1000) this.flushPcm(); }
        if (d.end) { this.flushPcm(); this.aDone && this.aDone(); }
      };
      if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
      // camera + mic as a normal video file
      this.mr = new MediaRecorder(this.stream, { mimeType: mime || undefined, videoBitsPerSecond: q.vbps, audioBitsPerSecond: 256000, videoKeyFrameIntervalDuration: PIECE_MS });
      this.mr.ondataavailable = (e) => { if (e.data && e.data.size) { this.vBytes += e.data.size; this.put('v', this.vSeq++, e.data); } };
      this.mr.onstart = () => { this.meta.vStart = s.now(); };
      // start together at the time the room gave everyone
      const wait = Math.max(0, atServer - s.now());
      await sleep(wait);
      if (!this.running) return;
      this.meta.startedAt = s.now();
      this.mr.start(PIECE_MS);
      this.node.port.postMessage('start');
      this.t0 = performance.now();
      this.put('m', part * 2, new Blob([JSON.stringify(this.meta)], { type: 'application/json' }));
      this.emit('started', this.meta);
    }
    ctxToServer(t) {
      try { const ts = this.ctx.getOutputTimestamp(); return performance.timeOrigin + ts.performanceTime + (t - ts.contextTime) * 1000 + this.session.offset; }
      catch { return this.session.now(); }
    }
    flushPcm() {
      if (!this.pcmN) return;
      const all = new Float32Array(this.pcmN); let o = 0; for (const b of this.pcm) { all.set(b, o); o += b.length; }
      this.pcm = []; this.pcmN = 0;
      const buf = s24(all); this.aBytes += buf.byteLength;
      this.put('a', this.aSeq++, buf);
    }
    put(kind, seq, data) { this.sink.put(this.take, kind, seq, data).catch((e) => this.emit('error', e)); this.emit('piece', kind, seq); }
    elapsed() { return this.running && this.t0 ? performance.now() - this.t0 : 0; }
    async stop() {
      const dur = this.elapsed();
      if (!this.running) return; this.running = false;
      const vDone = new Promise((r) => { if (!this.mr || this.mr.state === 'inactive') return r(); this.mr.onstop = () => setTimeout(r, 30); try { this.mr.stop(); } catch { r(); } });
      const aDone = new Promise((r) => { this.aDone = r; try { this.node.port.postMessage('stop'); } catch { r(); } setTimeout(r, 1500); });
      await Promise.all([vDone, aDone]);
      try { this.node.disconnect(); await this.ctx.close(); } catch {}
      Object.assign(this.meta, { vCount: this.vSeq - this.part * PART, aCount: this.aSeq - this.part * PART, vBytes: this.vBytes, aBytes: this.aBytes, done: true, dur: Math.round(dur), endedAt: this.session.now() });
      this.put('m', this.part * 2 + 1, new Blob([JSON.stringify(this.meta)], { type: 'application/json' }));
      this.emit('stopped', this.meta);
      return this.meta;
    }
  }

  // ---------- guest uploads: keep every piece in this browser until the site confirms it ----------
  class CloudSink extends Emitter {
    constructor({ server, room, pid, tok }) {
      super(); Object.assign(this, { server: server.replace(/\/$/, ''), room, pid, tok });
      this.q = []; this.busy = 0; this.sent = 0; this.sentBytes = 0; this.mem = new Map(); this.fail = 0; this.last = '';
    }
    async dir() {
      if (this._dir !== undefined) return this._dir;
      try {
        const r = await navigator.storage.getDirectory();
        const a = await r.getDirectoryHandle('showcaller-sessions', { create: true });
        this._dir = await a.getDirectoryHandle(this.room, { create: true });
        try { await navigator.storage.persist(); } catch {}
      } catch { this._dir = null; }
      return this._dir;
    }
    name(take, kind, seq) { return `${take}~${kind}~${String(seq).padStart(6, '0')}`; }
    async put(take, kind, seq, data) {
      const buf = data instanceof Blob ? await data.arrayBuffer() : data;
      const n = this.name(take, kind, seq), d = await this.dir();
      let saved = false;
      if (d) { try { const fh = await d.getFileHandle(n, { create: true }); const w = await fh.createWritable(); await w.write(buf); await w.close(); saved = true; } catch (e) { console.warn('OPFS', e); } }
      if (!saved) this.mem.set(n, buf);
      if (kind === 'm') this.q = this.q.filter((x) => !(x.take === take && x.kind === 'm' && !x.busy && x.seq >> 1 === seq >> 1 && x.seq < seq));
      this.q.push({ n, take, kind, seq, size: buf.byteLength });
      this.pump(); this.stat();
    }
    // after a reload or a crash: everything still in this browser for this room goes up
    async resume() {
      const d = await this.dir(); if (!d) return 0;
      const have = new Set(this.q.map((x) => x.n)); let n = 0;
      for await (const [name, h] of d.entries()) {
        const m = /^(t\d{2,4})~([vam])~(\d{6})$/.exec(name); if (!m || have.has(name)) continue;
        const f = await h.getFile();
        this.q.push({ n: name, take: m[1], kind: m[2], seq: Number(m[3]), size: f.size }); n++;
      }
      // only the newest notes file for each take
      const metaMax = {}; for (const x of this.q) if (x.kind === 'm') { const k = `${x.take}/${x.seq >> 1}`; metaMax[k] = Math.max(metaMax[k] ?? -1, x.seq); }
      this.q = this.q.filter((x) => x.kind !== 'm' || x.seq === metaMax[`${x.take}/${x.seq >> 1}`]);
      this.q.sort((a, b) => a.take.localeCompare(b.take) || a.seq - b.seq);
      this.pump(); this.stat();
      return n;
    }
    pending() { return this.q.length; }
    pendingBytes() { return this.q.reduce((s, x) => s + x.size, 0); }
    stat() { this.emit('stat', { pending: this.q.length, bytes: this.pendingBytes(), sent: this.sent, sentBytes: this.sentBytes, fail: this.fail, last: this.last }); }
    async read(n) {
      if (this.mem.has(n)) return this.mem.get(n);
      const d = await this.dir(); const f = await (await d.getFileHandle(n)).getFile(); return f.arrayBuffer();
    }
    async forget(n) {
      this.mem.delete(n);
      const d = await this.dir(); if (d) { try { await d.removeEntry(n); } catch {} }
    }
    pump() {
      while (this.busy < 3) {
        // notes files go last for their take, once nothing else of that take is waiting
        const i = this.q.findIndex((x) => !x.busy && (x.kind !== 'm' || !this.q.some((y) => y !== x && y.take === x.take && (y.kind !== 'm' || y.busy))));
        if (i < 0 || !this.tok) return;
        const x = this.q[i]; x.busy = true; this.busy++;
        this.send(x).then((ok) => {
          this.busy--; x.busy = false;
          if (ok) { this.q = this.q.filter((y) => y !== x); this.sent++; this.sentBytes += x.size; this.fail = 0; this.forget(x.n); this.stat(); this.pump(); }
          else { this.fail++; this.stat(); setTimeout(() => this.pump(), Math.min(15000, 500 * 2 ** Math.min(this.fail, 5))); }
        });
      }
    }
    async send(x) {
      try {
        const buf = await this.read(x.n), sum = await sha256(buf);
        const u = `${this.server}/sessions/up?r=${this.room}&pid=${this.pid}&tok=${encodeURIComponent(this.tok)}&take=${x.take}&kind=${x.kind}&seq=${x.seq}`;
        const r = await fetch(u, { method: 'PUT', body: buf, headers: { 'X-Sha256': sum } });
        if (!r.ok) { this.last = `${r.status}`; if (r.status === 403) this.last = 'key'; return false; }
        const j = await r.json();
        return j.ok && j.sha === sum;
      } catch (e) { this.last = 'offline'; return false; }
    }
  }

  async function freeSpace() {
    try { const e = await navigator.storage.estimate(); return { free: (e.quota || 0) - (e.usage || 0), quota: e.quota || 0 }; } catch { return null; }
  }
  // the camera + mic at the room's quality (mic processing off unless they're on speakers)
  async function openMedia({ quality, cam, mic, speakers }) {
    const q = QUALITY[quality] || QUALITY['1080'];
    const video = cam === 'off' ? false : { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: 30 }, ...(cam ? { deviceId: { exact: cam } } : {}) };
    const audio = { channelCount: { ideal: 1 }, sampleRate: { ideal: RATE }, echoCancellation: !!speakers, noiseSuppression: false, autoGainControl: false, ...(mic ? { deviceId: { exact: mic } } : {}) };
    return navigator.mediaDevices.getUserMedia({ video, audio });
  }
  // GB an hour for one person at a quality (video + 48 kHz 24-bit WAV)
  const gbPerHour = (q) => ((QUALITY[q] || QUALITY['1080']).vbps + 256000 + RATE * 24) * 3600 / 8 / 1e9;

  root.SessionsCore = { QUALITY, PIECE_MS, RATE, PART, Session, Recorder, CloudSink, freeSpace, openMedia, gbPerHour, rid, sha256, pickMime, Emitter };
})(typeof window !== 'undefined' ? window : globalThis);
