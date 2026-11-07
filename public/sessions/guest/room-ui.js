// Showcaller Sessions: the recording room screen (look A, with the full-screen look B), shared by the guest page and
// the Sessions app. The host gets the waiting room, REC, marks, the invite link and everyone's upload state; a guest
// gets their own recording and upload state. Talking happens over the small call; every tile's real recording is local.
(function (root) {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ico = (n) => `<svg class="ico"><use href="#i-${n}"/></svg>`;
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const HUES = [258, 200, 340, 150, 30, 290, 180, 10];
  const hueOf = (pid) => HUES[[...String(pid)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  const avStyle = (pid) => { const h = hueOf(pid); return `background:hsl(${h} 70% 92%);color:hsl(${h} 55% 32%)`; };
  const mb = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0, Math.round(b / 1e6))} MB`;
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return [s / 3600, (s / 60) % 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':'); };

  const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
 <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></symbol>
 <symbol id="i-micoff" viewBox="0 0 24 24"><path d="M15 10V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5 2.2M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/></symbol>
 <symbol id="i-cam" viewBox="0 0 24 24"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/></symbol>
 <symbol id="i-camoff" viewBox="0 0 24 24"><path d="M10 6h3a2.5 2.5 0 0 1 2.5 2.5v3l6-4v10M15.5 16A2.5 2.5 0 0 1 13 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 4 6.2M3 3l18 18"/></symbol>
 <symbol id="i-flag" viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></symbol>
 <symbol id="i-chat" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></symbol>
 <symbol id="i-full" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></symbol>
 <symbol id="i-exit" viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></symbol>
 <symbol id="i-people" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.2.3 3.8 2 4.5 5"/></symbol>
 <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></symbol>
 <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></symbol>
 <symbol id="i-cloud" viewBox="0 0 24 24"><path d="M7 18a5 5 0 1 1 1.2-9.9A6 6 0 0 1 20 10a4 4 0 0 1-1 8z"/></symbol>
 <symbol id="i-up" viewBox="0 0 24 24"><path d="M12 19V6M6 12l6-6 6 6"/></symbol>
 <symbol id="i-down" viewBox="0 0 24 24"><path d="M12 5v13M6 12l6 6 6-6"/></symbol>
 <symbol id="i-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></symbol>
 <symbol id="i-leave" viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></symbol>
 <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></symbol>
 <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></symbol>
 <symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></symbol>
 <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
</svg>`;
  const injectIcons = () => { if (!document.getElementById('i-mic')) document.body.insertAdjacentHTML('afterbegin', ICONS); };

  class RoomUI {
    // opts: { el, session, host (bool), self: { stream }, recorder (getter), onLeave, inviteUrl, statusOf(pid) (host), selfStatus() }
    constructor(opts) {
      Object.assign(this, opts);
      injectIcons();
      this.tiles = new Map(); this.levels = new Map(); this.status = new Map(); this.drawerOpen = !!opts.host;
      this.render();
      const s = this.session;
      s.on('peers', () => this.sync()).on('stream', (p) => this.attach(p.pid, p.stream)).on('gone', (p) => this.sync())
        .on('chat', (m) => this.addChat(m)).on('waiting', () => this.drawWaiting()).on('cfg', () => this.drawTop()).on('rec', () => { this.drawTop(); this.drawDock(); })
        .on('data', (from, d) => { if (d && d.st) { this.status.set(from, { ...d.st, at: Date.now() }); this.drawTracks(); this.drawUploads(); } })
        .on('host', () => this.drawTop());
      this.sync();
      this.tick = setInterval(() => this.everySecond(), 1000);
      this.raf = () => { this.meters(); this.rafId = requestAnimationFrame(this.raf); }; this.rafId = requestAnimationFrame(this.raf);
      this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(this.el);
      addEventListener('keydown', this.keys = (e) => { if (e.key === 'Escape' && !this.fsEl.hidden) this.full(false); });
    }
    destroy() { clearInterval(this.tick); cancelAnimationFrame(this.rafId); this.ro.disconnect(); removeEventListener('keydown', this.keys); try { this.ac && this.ac.close(); } catch {} this.el.innerHTML = ''; this.fsEl.remove(); }

    render() {
      const h = this.host;
      this.el.innerHTML = `<div class="room ${this.drawerOpen ? '' : 'closed'}">
        <div class="rtop">
          <div class="ttl"><b class="js-name"></b><span class="js-sub"></span></div>
          <div class="sp"></div>
          <div class="people js-people"></div>
          <div class="recp idle js-recp"><span class="dot red"></span><span class="num js-clock">Not recording</span></div>
          <button class="iconb js-drawer" aria-label="${h ? 'People, uploads and chat' : 'Chat and your recording'}" title="${h ? 'People, uploads and chat' : 'Chat and your recording'}">${ico(h ? 'people' : 'chat')}<span class="badge js-badge" hidden></span></button>
          <button class="iconb js-full" aria-label="Full screen" title="Full screen">${ico('full')}</button>
        </div>
        <div class="tiles js-tiles"></div>
        <aside class="drawer">
          ${h ? `<div class="dsec js-waitsec" hidden><span class="lbl">Waiting to come in</span><div class="dsec js-wait"></div></div>
          <div class="dsec"><span class="lbl">Invite</span><div class="invite"><code class="js-inv"></code><span class="muted" style="font-size:12px">Opens in Chrome, Edge or Safari on a computer. Nothing to install.</span><div class="row"><button class="btn soft js-copy">Copy link</button><label class="chk" style="font-size:12px;margin-left:auto"><input type="checkbox" class="js-wr"> Waiting room</label></div></div></div>` : ''}
          <div class="dsec"><span class="lbl">${h ? 'Recording' : 'Your recording'}</span><div class="dsec js-trks"></div></div>
          ${h ? `<div class="dsec js-marksec" hidden><span class="lbl">Marks this take</span><div class="chat js-marks"></div></div>` : ''}
          <div class="dsec"><span class="lbl">Chat</span><div class="chat js-chat"><div class="empty">No messages yet.</div></div>
            <form class="chatin js-chatf"><input type="text" class="js-chatin" placeholder="Message everyone" aria-label="Chat message" maxlength="500"><button class="btn">Send</button></form></div>
        </aside>
        <div class="dockwrap">
          <div class="uploads js-uploads"></div>
          <div class="dock js-dock" role="toolbar" aria-label="Controls"></div>
          <div class="endw"><button class="btn soft js-leave">${ico('leave')} ${h ? 'Close room' : 'Leave'}</button></div>
        </div>
      </div>`;
      this.fsEl = document.createElement('div'); this.fsEl.className = 'fs'; this.fsEl.hidden = true;
      this.fsEl.innerHTML = `<div class="fgrid js-fgrid"></div>
        <div class="ftop"><div class="glass fttl js-fttl"></div><div class="fright"><div class="glass frec js-frec"><i></i><span class="js-fclock"></span></div><div class="glass fup js-fup"></div></div></div>
        <div class="glass fdock js-fdock"></div>`;
      document.body.appendChild(this.fsEl);
      const q = (c) => $(c, this.el);
      q('.js-drawer').onclick = () => { this.drawerOpen = !this.drawerOpen; q('.room').classList.toggle('closed', !this.drawerOpen); this.fit(); };
      q('.js-full').onclick = () => this.full(true);
      q('.js-leave').onclick = () => this.onLeave && this.onLeave();
      q('.js-chatf').onsubmit = (e) => { e.preventDefault(); const i = q('.js-chatin'); if (i.value.trim()) this.session.chat(i.value.trim()); i.value = ''; };
      if (h) {
        q('.js-inv').textContent = this.inviteUrl.replace(/^https?:\/\//, '');
        q('.js-copy').onclick = () => { navigator.clipboard.writeText(this.inviteUrl).then(() => toast('Invite link copied')); };
        q('.js-wr').onchange = (e) => this.session.setCfg({ wait: e.target.checked });
      }
      this.drawTop(); this.drawDock(); this.drawWaiting(); this.drawTracks(); this.drawUploads();
    }

    // ---- tiles ----
    people() {
      const s = this.session, list = [{ pid: s.pid, name: s.name, role: s.role, self: true }];
      for (const p of s.peers.values()) list.push({ pid: p.pid, name: p.name, role: p.role, stream: p.stream });
      return list;
    }
    sync() {
      const list = this.people(), grid = $('.js-tiles', this.el);
      for (const [pid, t] of this.tiles) if (!list.some((p) => p.pid === pid)) { t.el.remove(); t.fs.remove(); this.tiles.delete(pid); this.levels.delete(pid); }
      for (const p of list) {
        let t = this.tiles.get(p.pid);
        if (!t) {
          t = { el: document.createElement('div'), fs: document.createElement('div') };
          t.el.className = `tl${p.self ? ' self' : ''}`;
          t.el.innerHTML = `<video autoplay playsinline ${p.self ? 'muted' : ''}></video><div class="off" hidden><span class="av"></span></div><span class="rectag" hidden></span><span class="nm"><i></i><span class="js-n"></span></span><span class="st" hidden></span>`;
          t.fs.className = `ft${p.self ? ' self' : ''}`;
          t.fs.innerHTML = `<video autoplay playsinline muted></video><div class="off" hidden><span class="av"></span></div><div class="fnm"><span class="js-n"></span><small></small></div>`;
          this.tiles.set(p.pid, t);
          if (p.self) grid.prepend(t.el); else grid.appendChild(t.el);
          $('.js-fgrid', this.fsEl).appendChild(t.fs);
          if (p.self) this.attach(p.pid, this.self.stream);
        }
        t.name = p.name;
        for (const n of [t.el, t.fs]) { $('.js-n', n).textContent = p.self ? `${p.name} (you)` : p.name; $('.off .av', n).textContent = initials(p.name); }
        if (!p.self && p.stream && t.stream !== p.stream) this.attach(p.pid, p.stream);
      }
      const n = list.length, c = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
      grid.className = `tiles js-tiles c${c}`;
      $('.js-fgrid', this.fsEl).className = `fgrid js-fgrid c${n <= 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : 4}`;
      if (n > 2 && n <= 4) $('.js-fgrid', this.fsEl).style.gridTemplateRows = '1fr 1fr'; else $('.js-fgrid', this.fsEl).style.gridTemplateRows = '';
      this.fit(); this.drawTop(); this.drawTracks();
    }
    attach(pid, stream) {
      const t = this.tiles.get(pid); if (!t || !stream) return;
      t.stream = stream;
      for (const v of [$('video', t.el), $('video', t.fs)]) { if (v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); } }
      // a meter for whoever is talking
      try {
        if (!this.ac) this.ac = new AudioContext();
        if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
        const a = stream.getAudioTracks()[0]; if (!a) return;
        const old = this.levels.get(pid); if (old && old.track === a) return;
        const src = this.ac.createMediaStreamSource(new MediaStream([a])), an = this.ac.createAnalyser(); an.fftSize = 512; src.connect(an);
        this.levels.set(pid, { an, track: a, buf: new Float32Array(512), lv: 0 });
      } catch {}
    }
    fit() {
      // keep the 16:9 tiles inside the window's height
      const grid = $('.js-tiles', this.el); if (!grid) return;
      const n = this.tiles.size || 1, c = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, r = Math.ceil(n / c);
      const top = grid.getBoundingClientRect().top, avail = Math.max(240, innerHeight - Math.max(top, 0) - 130);
      const w = (avail - (r - 1) * 14) / r * 16 / 9 * c + (c - 1) * 14;
      grid.style.maxWidth = `${Math.max(320, Math.round(w))}px`;
    }
    meters() {
      for (const [pid, l] of this.levels) {
        l.an.getFloatTimeDomainData(l.buf); let p = 0; for (let i = 0; i < l.buf.length; i++) p = Math.max(p, Math.abs(l.buf[i]));
        l.lv = Math.max(p, l.lv * 0.85);
        const t = this.tiles.get(pid); if (!t) continue;
        const on = l.track.enabled !== false;
        $('.nm i', t.el).style.height = `${on ? Math.round(6 + Math.min(1, l.lv * 3) * 12) : 6}px`;
        const talk = on && l.lv > 0.06;
        t.el.classList.toggle('talk', talk); t.fs.classList.toggle('talk', talk);
      }
    }

    // ---- top bar, dock, drawer ----
    drawTop() {
      const s = this.session, q = (c) => $(c, this.el), n = this.tiles.size || 1;
      const name = s.cfg.name || 'Session';
      q('.js-name').textContent = name;
      q('.js-sub').textContent = this.host ? `${n} ${n === 1 ? 'person' : 'people'} · ${(SessionsCore.QUALITY[s.cfg.quality] || {}).label || '1080p'} · each person records on their own computer`
        : s.hostOnline === false ? 'The host is offline. You can stay here; recording starts when they’re back.' : `Recording in ${(SessionsCore.QUALITY[s.cfg.quality] || {}).label || '1080p'} on this computer`;
      q('.js-people').innerHTML = this.people().slice(0, 6).map((p) => `<span style="${avStyle(p.pid)}" title="${esc(p.name)}">${esc(initials(p.name))}</span>`).join('');
      $('.js-fttl', this.fsEl).innerHTML = `${esc(name)}<span>${n} ${n === 1 ? 'person' : 'people'}</span>`;
      if (this.host) q('.js-wr').checked = s.cfg.wait !== false;
      this.everySecond();
    }
    everySecond() {
      const s = this.session, q = (c) => $(c, this.el), on = s.rec && s.rec.on;
      const txt = on ? (s.now() < s.rec.at ? 'Starting…' : clock(s.now() - s.rec.at)) : s.rec && s.rec.take ? `Take ${s.rec.n} saved` : 'Not recording';
      q('.js-recp').classList.toggle('idle', !on); q('.js-clock').textContent = txt;
      const fr = $('.js-frec', this.fsEl); fr.hidden = !on; $('.js-fclock', this.fsEl).textContent = txt;
      // camera off shows initials
      for (const [pid, t] of this.tiles) {
        const v = t.stream && t.stream.getVideoTracks()[0], off = !v || v.enabled === false || v.muted || v.readyState === 'ended';
        $('.off', t.el).hidden = !off; $('.off', t.fs).hidden = !off;
      }
      this.drawTracks(); if (!this.host) this.drawUploads();
      if (this.host) for (const [pid, st] of this.status) if (Date.now() - st.at > 15000 && !s.peers.has(pid)) this.status.delete(pid);
    }
    drawDock() {
      const s = this.session, d = $('.js-dock', this.el), on = s.rec && s.rec.on;
      const a = this.self.stream && this.self.stream.getAudioTracks()[0], v = this.self.stream && this.self.stream.getVideoTracks()[0];
      const micOn = a && a.enabled, camOn = v && v.enabled;
      const html = `<button class="rb js-mic ${micOn ? '' : 'off'}" aria-label="${micOn ? 'Mute your mic' : 'Unmute your mic'}" title="${micOn ? 'Mute (recorded silence)' : 'Unmute'}">${ico(micOn ? 'mic' : 'micoff')}</button>
        <button class="rb js-cam ${camOn ? '' : 'off'}" aria-label="${camOn ? 'Turn your camera off' : 'Turn your camera on'}" title="${camOn ? 'Camera off' : 'Camera on'}">${ico(camOn ? 'cam' : 'camoff')}</button>
        ${this.host ? `<button class="recb ${on ? '' : 'stopped'} js-rec"><i></i>${on ? 'Stop' : 'Record'}</button>
        <button class="rb js-mark" aria-label="Add a mark" title="Mark this moment for the edit" ${on ? '' : 'disabled style="opacity:.45"'}>${ico('flag')}</button>` : ''}`;
      d.innerHTML = html; $('.js-fdock', this.fsEl).innerHTML = html + `<button class="rb js-exit" aria-label="Leave full screen" title="Leave full screen (Esc)">${ico('exit')}</button>`;
      for (const root of [d, $('.js-fdock', this.fsEl)]) {
        $('.js-mic', root).onclick = () => { if (a) { a.enabled = !a.enabled; this.drawDock(); } };
        $('.js-cam', root).onclick = () => { if (v) { v.enabled = !v.enabled; this.drawDock(); this.everySecond(); } };
        if (this.host) {
          $('.js-rec', root).onclick = () => this.onRecord && this.onRecord(!on);
          $('.js-mark', root).onclick = () => { s.mark(''); toast('Mark added'); };
        }
      }
      const ex = $('.js-exit', this.fsEl); if (ex) ex.onclick = () => this.full(false);
    }
    drawWaiting() {
      if (!this.host) return;
      const w = [...this.session.waiting.values()], q = (c) => $(c, this.el);
      q('.js-waitsec').hidden = !w.length;
      const b = q('.js-badge'); b.hidden = !w.length; b.textContent = w.length;
      q('.js-wait').innerHTML = w.map((p) => `<div class="wait"><span class="av" style="${avStyle(p.pid)}">${esc(initials(p.name))}</span><div style="flex:1;min-width:0"><b>${esc(p.name)}</b><span>Wants to join</span></div><button class="btn soft js-no" data-p="${p.pid}" style="padding:0 10px">No</button><button class="btn js-yes" data-p="${p.pid}">Let in</button></div>`).join('');
      for (const x of q('.js-wait').querySelectorAll('button')) x.onclick = () => this.session.admit(x.dataset.p, x.classList.contains('js-yes'));
      if (w.length && !this.drawerOpen) { this.drawerOpen = true; q('.room').classList.remove('closed'); this.fit(); }
    }
    drawTracks() {
      const s = this.session, el = $('.js-trks', this.el), on = s.rec && s.rec.on;
      const rows = [];
      if (this.host) {
        const me = this.selfStatus ? this.selfStatus() : {};
        rows.push(this.trackRow(s.pid, `${s.name} (you)`, me.rec ? 'Recording to this Mac' : on ? 'Starting…' : `Saves straight to this Mac`, 100, true));
        for (const p of s.peers.values()) {
          const st = this.status.get(p.pid) || {};
          const sub = st.err ? st.err : st.rec ? `Recording ${st.res || ''} · ${st.pending ? `${mb(st.bytes)} to upload` : 'uploaded so far'}` : st.pending ? `Uploading · ${mb(st.bytes)} left` : st.sent ? 'All uploaded' : on ? 'Not recording yet' : 'Ready';
          const pct = st.pending ? Math.round(100 * st.sentBytes / Math.max(1, st.sentBytes + st.bytes)) : 100;
          rows.push(this.trackRow(p.pid, p.name, sub, pct, !st.pending, true));
        }
        const t = s.takes.find((x) => x.id === s.rec.take), ms = $('.js-marksec', this.el);
        ms.hidden = !(on && t && t.marks && t.marks.length);
        if (!ms.hidden) $('.js-marks', this.el).innerHTML = t.marks.map((m) => `<p><b>${esc(m.label)}</b> <span class="num muted">${clock(m.at - s.rec.at)}</span></p>`).join('');
      } else {
        const st = this.selfStatus ? this.selfStatus() : {};
        rows.push(this.trackRow(s.pid, s.name, st.rec ? `Recording ${st.res || ''} here` : st.pending ? 'Uploading the last pieces…' : st.sent ? 'All uploaded. Safe to leave.' : 'Ready. The host starts the recording.', st.pending ? Math.round(100 * st.sentBytes / Math.max(1, st.sentBytes + st.bytes)) : 100, !st.pending));
        if (st.pending) rows.push(`<div class="hint">${st.pending} pieces (${mb(st.bytes)}) still to upload. Keep this tab open; if it closes, open the same link again and they carry on.</div>`);
      }
      el.innerHTML = rows.join('');
      for (const x of el.querySelectorAll('.js-kick')) x.onclick = () => { if (confirm('Remove this person from the session?')) s.kick(x.dataset.p); };
      // tile corner tag
      for (const [pid, t] of this.tiles) {
        const st = pid === s.pid ? (this.selfStatus ? this.selfStatus() : {}) : this.status.get(pid) || {};
        const tag = $('.rectag', t.el), stt = $('.st', t.el);
        tag.hidden = !st.rec; if (st.rec) tag.innerHTML = `<span class="dot red"></span>${esc(st.res || 'REC')}`;
        const show = this.host && pid !== s.pid && (st.pending || st.rec);
        stt.hidden = !show; if (show) stt.innerHTML = `${ico('up')}<b>${st.pending ? mb(st.bytes) : 'Up to date'}</b>`;
        $('small', t.fs).textContent = st.rec ? `${st.res || ''} REC` : '';
      }
    }
    trackRow(pid, name, sub, pct, ok, kick) {
      return `<div class="trk"><span class="av" style="${avStyle(pid)}">${esc(initials(name.replace(/\s*\(you\)$/, '')))}</span><div class="row" style="min-width:0"><b style="flex:1">${esc(name)}</b>${kick ? `<button class="muted js-kick" data-p="${pid}" title="Remove" style="font-size:12px">Remove</button>` : ''}</div><small>${esc(sub)}</small><div class="bar"><i class="${ok ? 'ok' : ''}" style="width:${pct}%"></i></div></div>`;
    }
    drawUploads() {
      const s = this.session, el = $('.js-uploads', this.el), fup = $('.js-fup', this.fsEl);
      let pending = 0, bytes = 0, sent = 0;
      if (this.host) for (const st of this.status.values()) { pending += st.pending || 0; bytes += st.bytes || 0; sent += st.sentBytes || 0; }
      else { const st = this.selfStatus ? this.selfStatus() : {}; pending = st.pending || 0; bytes = st.bytes || 0; sent = st.sentBytes || 0; }
      const pct = Math.round(100 * sent / Math.max(1, sent + bytes));
      const txt = pending ? `${mb(bytes)} still to upload` : sent ? (this.host ? 'Every guest is uploaded' : 'All uploaded') : this.host ? 'Guests upload while you talk' : 'Uploads while you talk';
      el.innerHTML = `${ico('cloud')}<div class="bar"><i class="${pending ? '' : 'ok'}" style="width:${pending ? pct : sent ? 100 : 0}%"></i></div><span class="num">${esc(txt)}</span>`;
      fup.innerHTML = `<span>${esc(txt)}</span><div class="bar"><i style="width:${pending ? pct : sent ? 100 : 0}%"></i></div>`;
    }
    addChat(m) {
      const el = $('.js-chat', this.el), e = el.querySelector('.empty'); if (e) e.remove();
      const t = new Date(m.at || Date.now());
      el.insertAdjacentHTML('beforeend', `<p><b>${esc(m.name)}</b> ${esc(m.text)}<small>${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}</small></p>`);
      el.scrollTop = el.scrollHeight;
      if (!this.drawerOpen && m.from !== this.session.pid) { const b = $('.js-badge', this.el); b.hidden = false; b.textContent = '•'; }
    }
    full(on) {
      this.fsEl.hidden = !on;
      if (on) { try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); } catch {} for (const t of this.tiles.values()) $('video', t.fs).play().catch(() => {}); }
      else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }

  function toast(msg, ms = 2200) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; t.style.opacity = 1;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.style.opacity = 0; setTimeout(() => { t.hidden = true; }, 300); }, ms);
  }
  // light / dark, remembered per computer
  function theme(btn) {
    const get = () => { try { return localStorage.getItem('sess-theme'); } catch { return null; } };
    const apply = (v) => { if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; };
    apply(get());
    if (btn) btn.onclick = () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      const v = dark ? 'light' : 'dark'; apply(v); try { localStorage.setItem('sess-theme', v); } catch {}
    };
  }

  root.SessionsUI = { RoomUI, toast, theme, esc, initials, avStyle, mb, clock, ico, injectIcons };
})(window);
