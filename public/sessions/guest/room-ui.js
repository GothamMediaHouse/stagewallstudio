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
  // a small icon button with its words as the tooltip and for screen readers
  const ib = (cls, icon, label, pid, extra = '') => `<button class="ib ${cls}"${pid ? ` data-p="${esc(pid)}"` : ''} ${extra} title="${esc(label)}" aria-label="${esc(label)}">${ico(icon)}</button>`;
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
 <symbol id="i-screen" viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4M12 13V8M9.5 10.5 12 8l2.5 2.5"/></symbol>
<symbol id="i-panel" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></symbol>
 <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>
 <symbol id="i-power" viewBox="0 0 24 24"><path d="M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0"/></symbol>
 <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></symbol>
 <symbol id="i-spot" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></symbol>
 <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></symbol>
 <symbol id="i-timer" viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></symbol>
 <symbol id="i-list" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></symbol>
 <symbol id="i-pen" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></symbol>
 <symbol id="i-headset" viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13" width="4" height="6" rx="1.5"/><rect x="17.5" y="13" width="4" height="6" rx="1.5"/><path d="M19.5 19c0 1.5-2 2.5-5 2.5"/></symbol>
</svg>`;
  const injectIcons = () => { if (!document.getElementById('i-mic')) document.body.insertAdjacentHTML('afterbegin', ICONS); };

  class RoomUI {
    // opts: { el, session, host (bool), producer (bool: a producer's page, runs the room but isn't recorded), self: { stream },
    //        share (a SessionsCore.ScreenShare, or none), onLeave, inviteUrl, producerUrl (host), selfStatus() }
    constructor(opts) {
      Object.assign(this, opts);
      this.ctrl = !!(opts.host || opts.producer); // can let people in, record and mark
      if (this.share) this.share.on('change', () => { this.drawDock(); this.sync(); });
      injectIcons();
      this.tiles = new Map(); this.levels = new Map(); this.status = new Map(); this.drawerOpen = !!(opts.host || opts.producer); this.extras = opts.extras || [];
      this.talk = null; // a private talk: { a (who started it), b } — nobody else hears those two while it lasts
      this.studio = []; // the host's studio cameras and mics, as the host app tells producers: [{ pid, name, kind, off, rec, res }]
      this.mutedBy = ''; // a host or producer muted this person's mic (so they can turn it back on without asking)
      this.render();
      const s = this.session;
      s.on('peers', () => { this.sync(); this.talkCheck(); }).on('stream', (p) => this.attach(p.pid, p.stream)).on('gone', (p) => this.sync())
        .on('chat', (m) => this.addChat(m)).on('waiting', () => this.drawWaiting()).on('cfg', () => this.drawTop()).on('rec', () => { this.drawTop(); this.drawDock(); })
        .on('data', (from, d) => {
          if (!d) return;
          if (d.st) { this.status.set(from, { ...d.st, at: Date.now() }); this.drawTracks(); this.drawUploads(); }
          if (d.ctl && s.isCtrl(from)) this.onCtl(from, d);
          if (d.studio && from === 'host' && this.ctrl) { this.studio = d.studio; this.drawTracks(); }
        })
        .on('board', () => this.drawBoard()).on('plan', () => this.drawPlan())
        .on('host', () => this.drawTop());
      this.sync();
      this.tick = setInterval(() => this.everySecond(), 1000);
      this.raf = () => { this.meters(); this.rafId = requestAnimationFrame(this.raf); }; this.rafId = requestAnimationFrame(this.raf);
      this.ro = new ResizeObserver(() => { this.fit(); this.fitFs(); }); this.ro.observe(this.el);
      addEventListener('keydown', this.keys = (e) => { if (e.key === 'Escape' && !this.fsEl.hidden) this.full(false); });
    }
    destroy() { clearInterval(this.tick); cancelAnimationFrame(this.rafId); this.ro.disconnect(); removeEventListener('keydown', this.keys); try { this.ac && this.ac.close(); } catch {} this.el.innerHTML = ''; this.fsEl.remove(); }

    render() {
      const h = this.host;
      const tabs = this.ctrl ? [['people', 'People'], ['show', 'Show'], ['chat', 'Chat'], ...(h ? [['invite', 'Invite']] : [])] : [['you', 'You'], ['chat', 'Chat']];
      this.tab = this.tab || tabs[0][0];
      this.el.innerHTML = `<div class="room ${this.drawerOpen ? '' : 'closed'}">
        <div class="rtop">
          <div class="ttl"><b class="js-name"></b><span class="js-sub"></span></div>
          <div class="sp"></div>
          <div class="people js-people"></div>
          ${this.ctrl ? `<div class="recp cdp js-cdp" hidden title="Countdown (only the host and producers see it)">${ico('timer')}<span class="num js-cdpt"></span><span class="cdl js-cdpl"></span></div>` : ''}
          <div class="recp idle js-recp"><span class="dot red"></span><span class="num js-clock">Not recording</span></div>
          <button class="iconb js-drawer" aria-label="Show or hide the side panel" title="Side panel">${ico('panel')}<span class="badge js-badge" hidden></span></button>
          <button class="iconb js-full" aria-label="Full screen" title="Full screen (double-click someone to show just them)">${ico('full')}</button>
        </div>
        <div class="rmain">
          <div class="rstage js-stage">
            <div class="tiles js-tiles"></div>
            <div class="talkbar js-talkbar" hidden></div>
          </div>
          <aside class="drawer">
            <div class="dtabs" role="tablist" aria-label="Side panel">${tabs.map(([k, l]) => `<button role="tab" class="js-tab" data-t="${k}" aria-selected="${k === this.tab}">${l}<span class="tbadge js-tb-${k}" hidden></span></button>`).join('')}</div>
            <div class="dpane" data-t="${this.ctrl ? 'people' : 'you'}">
              ${this.ctrl ? `<div class="dsec js-waitsec" hidden><span class="lbl">Waiting to come in</span><div class="dsec js-wait"></div></div>` : ''}
              <div class="dsec"><span class="lbl">${this.ctrl ? 'In the session' : 'Your recording'}</span><div class="trks js-trks"></div></div>
              ${h && this.onAddCamera ? `<button class="btn soft sm js-addcam" style="align-self:flex-start">${ico('plus')} Add a studio camera or mic</button>` : ''}
            </div>
            ${this.ctrl ? `<div class="dpane" data-t="show">
              <div class="dsec js-rosec" hidden><span class="lbl">Running order <span class="js-rotot" style="letter-spacing:0;text-transform:none;font-weight:500"></span></span><div class="rolist js-ro"></div></div>
              <div class="dsec"><span class="lbl">Countdown</span>
                <div class="board">
                  <div class="row"><span class="num cdbig js-cdt">00:00</span><input type="text" class="js-cdl" placeholder="What for (Break, Wrap…)" maxlength="60" aria-label="Countdown label"></div>
                  <div class="row cdset">${[1, 5, 10, 15, 30].map((m) => `<button class="btn soft sm js-cdm" data-m="${m}">${m}m</button>`).join('')}</div>
                  <div class="row"><input type="text" class="js-cdc" placeholder="mm:ss" aria-label="Countdown length (minutes, or mm:ss)" style="width:72px;flex:none;padding:6px 9px"><button class="btn sm js-cdgo">Start</button><button class="btn soft sm js-cdrs">Reset</button><span class="hint js-cdby" style="margin-left:auto"></span></div>
                </div></div>
              <div class="dsec"><span class="lbl">Notes</span><textarea class="js-notes" rows="6" maxlength="5000" placeholder="Notes for the host and producers (guests don’t see these)"></textarea><span class="hint js-nby"></span></div>
              <div class="dsec js-marksec" hidden><span class="lbl">Marks this take</span><div class="chat js-marks"></div></div>
            </div>` : ''}
            <div class="dpane" data-t="chat">
              <div class="chat js-chat"><div class="empty">No messages yet.</div></div>
              <form class="chatin js-chatf"><input type="text" class="js-chatin" placeholder="Message everyone" aria-label="Chat message" maxlength="500"><button class="btn sm">Send</button></form>
            </div>
            ${h ? `<div class="dpane" data-t="invite">
              <div class="dsec"><span class="lbl">Guest link</span><div class="invite"><code class="js-inv"></code><span class="hint">Opens in Chrome, Edge or Safari, on a computer or a phone. Nothing to install.</span><div class="row"><button class="btn sm js-copy">${ico('link')} Copy link</button><label class="chk" style="font-size:12px;margin-left:auto"><input type="checkbox" class="js-wr"> Waiting room</label></div></div></div>
              ${this.producerUrl ? `<div class="dsec"><span class="lbl">Producer link</span><div class="invite"><span class="hint">A producer sees and hears everyone, lets people in, records, marks, mutes, talks privately and runs the countdown. They aren’t recorded.</span><div class="row"><button class="btn soft sm js-pcopy">${ico('headset')} Copy producer link</button></div></div></div>` : ''}
              ${this.onAddCamera ? `<div class="dsec"><span class="lbl">Studio cameras and mics</span><span class="hint">Each camera, capture input, NDI source, USB mic or sound interface input records as its own track, next to yours.</span><button class="btn soft sm js-addcam2" style="align-self:flex-start">${ico('plus')} Add a camera or mic</button></div>` : ''}
            </div>` : ''}
          </aside>
        </div>
        <div class="dockwrap">
          <div class="uploads js-uploads"></div>
          <div class="dock js-dock" role="toolbar" aria-label="Controls"></div>
          <div class="endw"><button class="btn soft js-leave">${ico('leave')} ${h ? 'Close room' : 'Leave'}</button></div>
        </div>
      </div>`;
      this.fsEl = document.createElement('div'); this.fsEl.className = 'fs'; this.fsEl.hidden = true;
      this.fsEl.innerHTML = `<div class="fgrid js-fgrid"></div>
        <div class="ftop"><div class="glass fttl js-fttl"></div><div class="fright"><div class="row" style="gap:8px">${this.ctrl ? `<div class="glass fcd js-fcd" hidden>${ico('timer')}<span class="num js-fcdt"></span><span class="js-fcdl"></span></div>` : ''}<div class="glass frec js-frec"><i></i><span class="js-fclock"></span></div></div><div class="glass fup js-fup"></div></div></div>
        <div class="glass fdock js-fdock"></div>`;
      document.body.appendChild(this.fsEl);
      const q = (c) => $(c, this.el);
      q('.js-drawer').onclick = () => { this.drawerOpen = !this.drawerOpen; q('.room').classList.toggle('closed', !this.drawerOpen); this.fit(); if (this.drawerOpen) this.showTab(this.tab); };
      for (const b of this.el.querySelectorAll('.js-tab')) b.onclick = () => this.showTab(b.dataset.t);
      this.showTab(this.tab);
      q('.js-full').onclick = () => this.full(true);
      q('.js-leave').onclick = () => this.onLeave && this.onLeave();
      q('.js-chatf').onsubmit = (e) => { e.preventDefault(); const i = q('.js-chatin'); if (i.value.trim()) this.session.chat(i.value.trim()); i.value = ''; };
      if (h) {
        q('.js-inv').textContent = this.inviteUrl.replace(/^https?:\/\//, '');
        q('.js-copy').onclick = () => { navigator.clipboard.writeText(this.inviteUrl).then(() => toast('Invite link copied')); };
        q('.js-wr').onchange = (e) => this.session.setCfg({ wait: e.target.checked });
        for (const b of this.el.querySelectorAll('.js-addcam,.js-addcam2')) b.onclick = () => this.onAddCamera();
        if (q('.js-pcopy')) q('.js-pcopy').onclick = () => { navigator.clipboard.writeText(this.producerUrl).then(() => toast('Producer link copied. Only send it to someone you trust to run the room.', 3500)); };
      }
      if (this.ctrl) this.wireBoard();
      this.drawTop(); this.drawDock(); this.drawWaiting(); this.drawTracks(); this.drawUploads(); this.drawBoard();
    }

    // the side panel's tabs (People / Show / Chat / Invite for the host and producers; You / Chat for a guest)
    showTab(t) {
      if (!this.el.querySelector(`.dpane[data-t="${t}"]`)) t = this.el.querySelector('.dpane').dataset.t;
      this.tab = t;
      for (const b of this.el.querySelectorAll('.js-tab')) b.setAttribute('aria-selected', String(b.dataset.t === t));
      for (const p of this.el.querySelectorAll('.dpane')) p.hidden = p.dataset.t !== t;
      if (t === 'chat') { const b = $('.js-tb-chat', this.el); if (b) b.hidden = true; const c = $('.js-chat', this.el); c.scrollTop = c.scrollHeight; }
      if (!this.drawerOpen) { this.drawerOpen = true; $('.room', this.el).classList.remove('closed'); this.fit(); }
      this.badges();
    }
    badges() {
      const w = this.ctrl ? this.session.waiting.size : 0, chat = $('.js-tb-chat', this.el), unread = chat && !chat.hidden;
      const pb = $(`.js-tb-${this.ctrl ? 'people' : 'you'}`, this.el); if (pb) { pb.hidden = !w; pb.textContent = w; }
      const b = $('.js-badge', this.el); b.hidden = this.drawerOpen || !(w || unread); b.textContent = w || '•';
    }

    // ---- countdown and notes (host and producers; the website keeps them for the session) ----
    cdLeft() { const c = this.session.board && this.session.board.cd; if (!c) return null; return c.end ? c.end - this.session.now() : c.left; }
    wireBoard() {
      const q = (c) => $(c, this.el), s = this.session;
      const cd = () => s.board.cd || { label: '', dur: 0, end: 0, left: 0 };
      const set = (ms) => { s.setBoard({ cd: { label: q('.js-cdl').value, dur: ms, end: 0, left: ms } }); };
      for (const b of this.el.querySelectorAll('.js-cdm')) b.onclick = () => set(Number(b.dataset.m) * 60000);
      // 5 = five minutes, 4:30, 1:00:00
      q('.js-cdc').onchange = () => { const p = q('.js-cdc').value.trim().split(':').map(Number); if (!p.length || p.length > 3 || p.some((x) => !Number.isFinite(x) || x < 0)) return toast('Type a time like 4:30'); const sec = p.length === 1 ? p[0] * 60 : p.reduce((a, x) => a * 60 + x, 0); if (sec > 0) set(sec * 1000); q('.js-cdc').value = ''; };
      q('.js-cdgo').onclick = () => {
        const c = cd(); if (!c.dur && !c.end) return toast('Pick a length first');
        if (c.end) s.setBoard({ cd: { ...c, end: 0, left: Math.max(-36e5, c.end - s.now()) } });
        else s.setBoard({ cd: { ...c, label: q('.js-cdl').value, end: s.now() + c.left } });
      };
      q('.js-cdrs').onclick = () => { const c = cd(); s.setBoard({ cd: c.dur ? { ...c, end: 0, left: c.dur } : null }); };
      q('.js-cdl').onchange = () => { const c = s.board.cd; if (c) s.setBoard({ cd: { ...c, label: q('.js-cdl').value } }); };
      let h = 0; q('.js-notes').oninput = () => { clearTimeout(h); h = setTimeout(() => s.setBoard({ notes: q('.js-notes').value }), 500); };
      q('.js-notes').onblur = () => { clearTimeout(h); if (q('.js-notes').value !== (s.board.notes || '')) s.setBoard({ notes: q('.js-notes').value }); };
    }
    // the show's running order from the plan: press a segment to start its countdown
    drawPlan() {
      if (!this.ctrl) return;
      const p = this.session.plan, ro = (p && p.rundown) || [], sec = $('.js-rosec', this.el); if (!sec) return;
      sec.hidden = !ro.length; if (!ro.length) return;
      const cur = this.session.board && this.session.board.cd && this.session.board.cd.label;
      const tot = ro.reduce((t, x) => t + (x.min || 0), 0);
      $('.js-rotot', this.el).textContent = tot ? `· ${tot} min` : '';
      const html = ro.map((x, i) => `<button class="ro${cur && x.t && cur === x.t ? ' on' : ''}" data-i="${i}"><span class="rn">${i + 1}</span><span class="rt">${esc(x.t || `Segment ${i + 1}`)}</span><span class="rm">${x.min ? `${x.min}m` : ''}</span></button>`).join('');
      const el = $('.js-ro', this.el); if (el.innerHTML === html) return; el.innerHTML = html;
      for (const b of el.querySelectorAll('.ro')) b.onclick = () => {
        const x = ro[b.dataset.i], ms = (x.min || 0) * 60000, s = this.session;
        s.setBoard({ cd: { label: x.t || `Segment ${Number(b.dataset.i) + 1}`, dur: ms, end: ms ? s.now() + ms : 0, left: ms } });
      };
    }
    drawBoard() {
      if (!this.ctrl) return;
      const q = (c) => $(c, this.el), b = this.session.board || {}, c = b.cd;
      const n = q('.js-notes'); if (document.activeElement !== n && n.value !== (b.notes || '')) n.value = b.notes || '';
      const l = q('.js-cdl'); if (document.activeElement !== l) l.value = (c && c.label) || '';
      q('.js-nby').textContent = b.by && b.at ? `Last change by ${b.by}, ${new Date(b.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
      q('.js-cdgo').textContent = c && c.end ? 'Pause' : c && c.left !== c.dur ? 'Carry on' : 'Start';
      this.drawPlan(); this.drawCountdown();
    }
    drawCountdown() {
      if (!this.ctrl) return;
      const q = (c) => $(c, this.el), c = this.session.board && this.session.board.cd, left = this.cdLeft();
      const f = (ms) => { const neg = ms < 0, t = Math.abs(ms), sec = neg ? Math.floor(t / 1000) : Math.ceil(t / 1000), h = Math.floor(sec / 3600); return `${neg ? '−' : ''}${h ? `${h}:` : ''}${String(Math.floor(sec / 60) % 60).padStart(h ? 2 : 2, '0')}:${String(sec % 60).padStart(2, '0')}`; };
      const txt = left === null ? '00:00' : f(left);
      q('.js-cdt').textContent = txt; q('.js-cdt').classList.toggle('over', left !== null && left < 0); q('.js-cdt').classList.toggle('soon', left !== null && left >= 0 && left < 30000 && !!(c && c.end));
      const p = q('.js-cdp'); p.hidden = !(c && (c.end || c.left !== c.dur));
      q('.js-cdpt').textContent = txt; q('.js-cdpl').textContent = (c && c.label) || '';
      p.classList.toggle('over', left !== null && left < 0); p.classList.toggle('paused', !!(c && !c.end));
      const fc = $('.js-fcd', this.fsEl); if (fc) { fc.hidden = p.hidden; $('.js-fcdt', this.fsEl).textContent = txt; $('.js-fcdl', this.fsEl).textContent = (c && c.label) || ''; fc.classList.toggle('over', left !== null && left < 0); }
    }

    // ---- what a host or producer asks of this person: mute, private talk, studio cameras ----
    onCtl(from, d) {
      const s = this.session, who = from === 'host' ? 'The host' : (s.peers.get(from) || {}).name || 'The producer';
      const a = this.self.stream && this.self.stream.getAudioTracks()[0];
      if (d.ctl === 'mute' && a) {
        if (d.on === false) { if (a.enabled) { a.enabled = false; this.mutedBy = who; toast(`${who} muted your mic`, 3500); } }
        else if (!a.enabled) {
          if (this.mutedBy) { a.enabled = true; this.mutedBy = ''; toast(`${who} turned your mic back on`, 3500); }
          else this.askBar(`${who} asks you to turn your mic on`, 'Turn mic on', () => { a.enabled = true; this.drawDock(); });
        }
        this.drawDock(); this.onSelfChange && this.onSelfChange();
      }
      if (d.ctl === 'talk') { this.talk = d.talk && d.talk.a && d.talk.b ? { a: d.talk.a, b: d.talk.b } : null; this.applyTalk(); }
      if (d.ctl === 'studio' && this.host && this.onStudioToggle) this.onStudioToggle(d.pid, !!d.on);
    }
    askBar(text, btn, go) {
      const el = $('.js-talkbar', this.el); this.asking = { text, btn, go };
      el.hidden = false; el.innerHTML = `<span>${esc(text)}</span><button class="btn sm js-ask">${esc(btn)}</button><button class="muted js-askno" style="font-size:12px">Not now</button>`;
      $('.js-ask', el).onclick = () => { this.asking = null; go(); this.applyTalk(); };
      $('.js-askno', el).onclick = () => { this.asking = null; this.applyTalk(); };
    }
    // tell everyone about the private talk (or that it's over); late arrivals are told again when they join
    sendTalk() { for (const p of this.session.peers.values()) this.session.tell(p.pid, { ctl: 'talk', talk: this.talk }); }
    startTalk(pid) { const me = this.session.pid; this.talk = this.talk && this.talk.a === me && this.talk.b === pid ? null : { a: me, b: pid }; this.sendTalk(); this.applyTalk(); }
    endTalk() { this.talk = null; this.sendTalk(); this.applyTalk(); }
    talkCheck() {
      const s = this.session, t = this.talk; if (!t) return;
      const here = (pid) => pid === s.pid || s.peers.has(pid);
      if (!here(t.a) || !here(t.b)) { const mine = t.a === s.pid; this.talk = null; if (mine) this.sendTalk(); this.applyTalk(); return; }
      if (t.a === s.pid) this.sendTalk();
    }
    applyTalk() {
      const s = this.session, t = this.talk, me = s.pid, el = $('.js-talkbar', this.el);
      const inIt = t && (t.a === me || t.b === me), nm = (pid) => pid === me ? 'you' : (s.peers.get(pid) || {}).name || 'someone';
      for (const [pid, tile] of this.tiles) {
        if (tile.el.classList.contains('local') || pid === me || pid.endsWith('~s')) continue;
        const v = $('video', tile.el), hush = !!(t && !inIt && (pid === t.a || pid === t.b));
        v.muted = hush; tile.el.classList.toggle('pvt', !!(t && (pid === t.a || pid === t.b)));
      }
      if (this.asking) return;
      el.hidden = !t;
      if (!t) { el.innerHTML = ''; this.drawTracks(); return; }
      const other = t.a === me ? t.b : t.a;
      el.innerHTML = inIt
        ? `${ico('headset')}<span><b>Private talk with ${esc(nm(other))}</b> · nobody else hears you two${this.ctrl || this.producer ? '' : ' (your recording carries on)'}</span><button class="btn sm js-tend">End</button>`
        : `${ico('headset')}<span>${esc(nm(t.a))} and ${esc(nm(t.b))} are talking privately</span>${this.ctrl ? '<button class="muted js-tend" style="font-size:12px">End it</button>' : ''}`;
      const e = $('.js-tend', el); if (e) e.onclick = () => this.endTalk();
      this.drawTracks();
    }
    mutePeer(pid, on) { this.session.tell(pid, { ctl: 'mute', on }); toast(on ? 'Unmute sent' : 'Muted', 2000); }
    studioToggle(pid, on) { if (this.host && this.onStudioToggle) this.onStudioToggle(pid, on); else this.session.tell('host', { ctl: 'studio', pid, on }); }

    // ---- tiles ----
    people() {
      const s = this.session, list = [{ pid: s.pid, name: s.name, role: s.role, self: true }];
      if (s.screen) list.push({ pid: `${s.pid}~s`, name: `${s.name} · screen`, role: 'screen', stream: s.screen, local: true, screen: true });
      for (const x of this.extras) list.push({ pid: x.pid, name: x.name, role: 'cam', stream: x.stream, local: true });
      for (const p of s.peers.values()) {
        list.push({ pid: p.pid, name: p.name, role: p.role, stream: p.stream });
        if (p.screen && p.screen.getVideoTracks().some((t) => t.readyState === 'live')) list.push({ pid: `${p.pid}~s`, name: `${p.name} · screen`, role: 'screen', stream: p.screen, screen: true });
      }
      return list;
    }
    // the host's extra studio cameras (each its own recorded track): [{ pid, name, stream, rec, res }]
    setExtras(list) { this.extras = list; this.sync();
    }
    sync() {
      const list = this.people(), grid = $('.js-tiles', this.el);
      for (const [pid, t] of this.tiles) if (!list.some((p) => p.pid === pid)) { t.el.remove(); t.fs.remove(); this.tiles.delete(pid); this.levels.delete(pid); }
      for (const p of list) {
        let t = this.tiles.get(p.pid);
        if (!t) {
          t = { el: document.createElement('div'), fs: document.createElement('div') };
          t.el.className = `tl${p.self ? ' self' : ''}`;
          t.el.innerHTML = `<video autoplay playsinline ${p.self || p.local ? 'muted' : ''}></video><div class="off" hidden><span class="av"></span></div><span class="rectag" hidden></span><span class="nm"><i></i><svg class="ico mi"><use href="#i-micoff"/></svg><span class="js-n"></span></span><span class="st" hidden></span><button class="tspot" title="Show just this person, full screen (or double-click)" aria-label="Show ${esc(p.name)} full screen">${ico('spot')}</button>`;
          t.fs.className = `ft${p.self ? ' self' : ''}`;
          t.fs.innerHTML = `<video autoplay playsinline muted></video><div class="off" hidden><span class="av"></span></div><div class="fnm"><span class="js-n"></span><small></small></div>`;
          this.tiles.set(p.pid, t);
          t.el.dataset.pid = p.pid; t.fs.dataset.pid = p.pid;
          // one person full screen: double-click their tile (or its corner button); double-click again for everyone
          const spot = () => this.full(true, p.pid);
          t.el.ondblclick = spot; $('.tspot', t.el).onclick = (e) => { e.stopPropagation(); spot(); };
          t.fs.ondblclick = () => this.full(true, this.spot === p.pid ? null : p.pid);
          if (p.self) grid.prepend(t.el); else if (p.local) { const after = [...grid.children].filter((c) => c.classList.contains('self') || c.classList.contains('local')).pop(); after ? after.after(t.el) : grid.prepend(t.el); } else grid.appendChild(t.el);
          if (p.local) t.el.classList.add('local');
          if (p.screen) { t.el.classList.add('scr'); t.fs.classList.add('scr'); $('video', t.el).muted = true; }
          if (p.role === 'producer') t.el.classList.add('prod');
          $('.js-fgrid', this.fsEl).appendChild(t.fs);
          if (p.self) this.attach(p.pid, this.self.stream);
        }
        t.name = p.name;
        for (const n of [t.el, t.fs]) { $('.js-n', n).textContent = p.self ? `${p.name} (you)` : p.role === 'producer' ? `${p.name} · producer` : p.name; $('.off .av', n).textContent = initials(p.name); }
        if (!p.self && p.stream && t.stream !== p.stream) this.attach(p.pid, p.stream);
      }
      const n = list.length, c = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
      grid.className = `tiles js-tiles c${c}`;
      $('.js-fgrid', this.fsEl).className = `fgrid js-fgrid c${n <= 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : 4}`;
      this.fit(); this.fitFs(); this.drawTop(); this.drawTracks();
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
      // the room fills the window below it (on a wide screen), and the 16:9 tiles fit inside the stage
      const room = $('.room', this.el), grid = $('.js-tiles', this.el); if (!room || !grid) return;
      const wide = innerWidth > 1100;
      room.style.height = wide ? `${Math.max(540, innerHeight - Math.max(0, room.getBoundingClientRect().top + scrollY) - +(this.el.dataset.fitpad ?? 16))}px` : '';
      const st = $('.js-stage', this.el), bar = $('.js-talkbar', this.el);
      const n = this.tiles.size || 1, g = 10;
      const availH = wide ? st.clientHeight - 40 - (bar.hidden ? 0 : bar.offsetHeight + 10) : innerHeight * 0.7, availW = st.clientWidth - 40;
      // the column count that gives the biggest tiles
      let best = 0, c = 1;
      for (let k = 1; k <= Math.min(n, 5); k++) { const r = Math.ceil(n / k), tw = Math.min((availW - (k - 1) * g) / k, ((availH - (r - 1) * g) / r) * 16 / 9); if (tw > best + 1) { best = tw; c = k; } }
      grid.style.gridTemplateColumns = wide ? `repeat(${c}, minmax(0, 1fr))` : "";
      grid.style.maxWidth = `${Math.max(280, Math.round(best * c + (c - 1) * g))}px`;
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
      const s = this.session;
      const q = (c) => $(c, this.el), n = this.people().filter((p) => p.role !== 'producer' && !(p.self && this.producer)).length || 1;
      const name = s.cfg.name || 'Session';
      q('.js-name').textContent = name;
      q('.js-sub').textContent = this.ctrl ? `${this.producer ? 'Producing · ' : ''}${n} ${n === 1 ? 'track' : 'tracks'} · ${(SessionsCore.QUALITY[s.cfg.quality] || {}).label || '1080p'} · ${this.producer ? 'you aren’t recorded' : 'each person records on their own computer'}`
        : s.hostOnline === false ? 'The host is offline. You can stay here; recording starts when they’re back.' : `Recording in ${(SessionsCore.QUALITY[s.cfg.quality] || {}).label || '1080p'} on this computer`;
      q('.js-people').innerHTML = this.people().filter((p) => !p.screen).slice(0, 6).map((p) => `<span style="${avStyle(p.pid)}" title="${esc(p.name)}">${esc(initials(p.name))}</span>`).join('');
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
      this.drawTracks(); this.drawCountdown(); if (!this.host) this.drawUploads();
      if (this.host) for (const [pid, st] of this.status) if (Date.now() - st.at > 15000 && !s.peers.has(pid)) this.status.delete(pid);
    }
    drawDock() {
      const s = this.session, d = $('.js-dock', this.el), on = s.rec && s.rec.on;
      const a = this.self.stream && this.self.stream.getAudioTracks()[0], v = this.self.stream && this.self.stream.getVideoTracks()[0];
      const micOn = a && a.enabled, camOn = v && v.enabled;
      const html = `<button class="rb js-mic ${micOn ? '' : 'off'}" aria-label="${micOn ? 'Mute your mic' : 'Unmute your mic'}" title="${micOn ? 'Mute (recorded silence)' : 'Unmute'}">${ico(micOn ? 'mic' : 'micoff')}</button>
        <button class="rb js-cam ${camOn ? '' : 'off'}" aria-label="${camOn ? 'Turn your camera off' : 'Turn your camera on'}" title="${camOn ? 'Camera off' : 'Camera on'}">${ico(camOn ? 'cam' : 'camoff')}</button>
        ${this.share ? `<button class="rb js-share ${this.share.active ? 'on' : ''}" aria-label="${this.share.active ? 'Stop sharing your screen' : 'Share your screen'}" title="${this.share.active ? 'Stop sharing' : 'Share your screen (recorded as its own track)'}">${ico('screen')}</button>` : ''}
        ${this.ctrl ? `<button class="recb ${on ? '' : 'stopped'} js-rec"><i></i>${on ? 'Stop' : 'Record'}</button>
        <button class="rb js-mark" aria-label="Add a mark" title="Mark this moment for the edit" ${on ? '' : 'disabled style="opacity:.45"'}>${ico('flag')}</button>` : ''}`;
      d.innerHTML = html;
      $('.js-fdock', this.fsEl).innerHTML = html + `<span class="fsep"></span>`
        + (this.spot ? `<button class="rb js-fall" aria-label="Show everyone" title="Show everyone">${ico('grid')}</button>` : '')
        + `<button class="rb js-fpanel ${this.fsPanel ? 'on' : ''}" aria-label="Side panel" title="Side panel (people, chat${this.ctrl ? ', countdown' : ''})">${ico('panel')}</button>`
        + `<button class="rb js-exit" aria-label="Leave full screen" title="Leave full screen (Esc)">${ico('exit')}</button>`;
      for (const root of [d, $('.js-fdock', this.fsEl)]) {
        $('.js-mic', root).onclick = () => { if (a) { a.enabled = !a.enabled; this.mutedBy = ''; this.drawDock(); this.onSelfChange && this.onSelfChange(); } };
        $('.js-cam', root).onclick = () => { if (v) { v.enabled = !v.enabled; this.drawDock(); this.everySecond(); } };
        if (this.share) $('.js-share', root).onclick = () => { (this.share.active ? this.share.stop() : this.share.start()).catch((e) => { if (e && e.name !== 'NotAllowedError') toast(`Screen sharing didn’t start: ${e.message || e}`, 4000); }); };
        if (this.ctrl) {
          $('.js-rec', root).onclick = () => this.onRecord ? this.onRecord(!on) : s.record(!on);
          $('.js-mark', root).onclick = () => { s.mark(''); toast('Mark added'); };
        }
      }
      const ex = $('.js-exit', this.fsEl); if (ex) ex.onclick = () => this.full(false);
      const fa = $('.js-fall', this.fsEl); if (fa) fa.onclick = () => this.full(true, null);
      const fp = $('.js-fpanel', this.fsEl); if (fp) fp.onclick = () => this.panelFs(!this.fsPanel);
    }
    drawWaiting() {
      if (!this.ctrl) return;
      const w = [...this.session.waiting.values()], q = (c) => $(c, this.el);
      q('.js-waitsec').hidden = !w.length;
      this.badges();
      q('.js-wait').innerHTML = w.map((p) => `<div class="wait"><span class="av" style="${avStyle(p.pid)}">${esc(initials(p.name))}</span><div style="flex:1;min-width:0"><b>${esc(p.name)}</b><span>Wants to join</span></div><button class="btn soft js-no" data-p="${p.pid}" style="padding:0 10px">No</button><button class="btn js-yes" data-p="${p.pid}">Let in</button></div>`).join('');
      for (const x of q('.js-wait').querySelectorAll('button')) x.onclick = () => this.session.admit(x.dataset.p, x.classList.contains('js-yes'));
      if (w.length && (!this.drawerOpen || this.tab !== 'people')) this.showTab('people');
    }
    drawTracks() {
      const s = this.session, el = $('.js-trks', this.el), on = s.rec && s.rec.on;
      const rows = [];
      const scrRow = () => this.share && this.share.active ? this.trackRow(`${s.pid}~s`, `${s.name} · screen`, this.share.recording ? `Recording your screen ${this.host ? 'to this Mac' : 'here'}` : on ? 'Starting…' : 'Shared. Recorded when the recording starts.', 100, true, false, 'screen') : '';
      if (this.ctrl) {
        const me = this.selfStatus ? this.selfStatus() : {};
        if (this.host && me.producing) rows.push(this.trackRow(s.pid, `${s.name} (you)`, `Producer · not recorded${me.input ? ` · ${me.input}` : ''}`, 100, true, false, false, !!this.onChangeSelf));
        else if (this.host) rows.push(this.trackRow(s.pid, `${s.name} (you)`, me.rec ? 'Recording to this Mac' : on ? 'Starting…' : `${me.input ? `${me.input} · ` : ''}saves straight to this Mac`, 100, true, false, false, !!this.onChangeSelf));
        else rows.push(this.trackRow(s.pid, `${s.name} (you)`, 'Producer · not recorded', 100, true));
        rows.push(scrRow());
        const onoff = (pid, off) => ib(`js-son${off ? ' warn' : ''}`, 'power', off ? 'Turn it on: seen and recorded' : 'Turn it off: not shown or recorded', pid, `data-on="${off ? 1 : 0}"`);
        for (const x of this.extras) rows.push(this.trackRow(x.pid, x.name, x.off ? 'Off · not recorded' : x.rec ? `Recording ${x.res || ''} to this Mac` : on ? 'Starting…' : `${x.iface ? `${x.iface} · input ${x.ch + 1}` : x.ndi ? `NDI · ${x.ndi}` : x.cam ? `Studio camera${x.audio ? ' + sound' : ''}` : 'Studio mic (sound only)'} · saves straight to this Mac`, x.off ? 0 : 100, true, false, x.cam || x.ndi ? true : 'mic', false, onoff(x.pid, x.off)));
        // a producer sees the studio's own cameras and mics (from the host app) and can turn them on and off
        if (!this.host) for (const x of this.studio) rows.push(this.trackRow(x.pid, x.name, x.off ? 'Off · not recorded' : x.rec ? `Recording ${x.res || ''} on the studio computer` : `${x.kind === 'mic' ? 'Studio mic' : 'Studio camera'} · on the studio computer`, x.off ? 0 : 100, true, false, x.kind === 'mic' ? 'mic' : true, false, onoff(x.pid, x.off)));
        for (const p of s.peers.values()) {
          const st = this.status.get(p.pid) || {};
          if (p.role === 'producer' || p.role === 'host') {
            const hs = p.role === 'host' ? st : {};
            const sub = p.role === 'producer' ? 'Producer · not recorded' : hs.producing ? 'Host computer · not recorded' : `Host · ${hs.rec ? 'recording' : 'records'} on the studio computer${hs.free ? ` · ${this.room(hs)}` : ''}`;
            rows.push(this.trackRow(p.pid, p.name, sub, 100, !(hs.hours !== undefined && hs.hours < 1), false, false, false, this.acts(p.pid, st))); continue;
          }
          if (p.screen) rows.push(this.trackRow(`${p.pid}~s`, `${p.name} · screen`, st.scr ? 'Recording their screen' : 'Sharing their screen', 100, true, false, 'screen'));
          const sub = st.err ? st.err : st.rec ? `Recording ${st.res || ''} · ${st.pending ? `${mb(st.bytes)} to upload` : 'uploaded so far'}` : st.pending ? `Uploading · ${mb(st.bytes)} left` : st.sent ? 'All uploaded' : on ? 'Not recording yet' : 'Ready';
          const pct = st.pending ? Math.round(100 * st.sentBytes / Math.max(1, st.sentBytes + st.bytes)) : 100;
          rows.push(this.trackRow(p.pid, p.name, `${!st.at ? (on ? 'Recording on their computer' : 'Ready') : sub}${st.free ? ` · ${this.room(st)}` : ''}`, pct, !st.pending, true, false, false, this.acts(p.pid, st)));
        }
        const t = s.takes.find((x) => x.id === s.rec.take), ms = $('.js-marksec', this.el);
        ms.hidden = !(on && t && t.marks && t.marks.length);
        if (!ms.hidden) $('.js-marks', this.el).innerHTML = t.marks.map((m) => `<p><b>${esc(m.label)}</b> <span class="num muted">${clock(m.at - s.rec.at)}</span></p>`).join('');
      } else {
        const st = this.selfStatus ? this.selfStatus() : {};
        rows.push(scrRow());
        rows.unshift(this.trackRow(s.pid, s.name, st.rec ? `Recording ${st.res || ''} here` : st.pending ? 'Uploading the last pieces…' : st.sent ? 'All uploaded. Safe to leave.' : 'Ready. The host starts the recording.', st.pending ? Math.round(100 * st.sentBytes / Math.max(1, st.sentBytes + st.bytes)) : 100, !st.pending));
        if (st.pending) rows.push(`<div class="hint">${st.pending} pieces (${mb(st.bytes)}) still to upload. Keep this tab open; if it closes, open the same link again and they carry on.</div>`);
      }
      // only redrawn when something changed, so a button isn't swapped out under the pointer mid-click
      const html = rows.join('');
      if (html !== this.trkHtml) { this.trkHtml = html; el.innerHTML = html; }
      for (const x of el.querySelectorAll('.js-kick')) x.onclick = () => { if (confirm('Remove this person from the session?')) s.kick(x.dataset.p); };
      for (const x of el.querySelectorAll('.js-xrm')) x.onclick = () => this.onRemoveCamera && this.onRemoveCamera(x.dataset.p);
      for (const x of el.querySelectorAll('.js-chg')) x.onclick = () => this.onChangeSelf && this.onChangeSelf();
      for (const x of el.querySelectorAll('.js-pmute')) x.onclick = () => this.mutePeer(x.dataset.p, x.dataset.on === '1');
      for (const x of el.querySelectorAll('.js-ptalk')) x.onclick = () => this.startTalk(x.dataset.p);
      for (const x of el.querySelectorAll('.js-son')) x.onclick = () => this.studioToggle(x.dataset.p, x.dataset.on === '1');
      // tile corner tag
      for (const [pid, t] of this.tiles) {
        const ex = this.extras.find((x) => x.pid === pid);
        const st = pid === s.pid ? (this.producer ? {} : this.selfStatus ? this.selfStatus() : {}) : pid === `${s.pid}~s` ? { rec: this.share && this.share.recording, res: 'Screen' } : pid.endsWith('~s') ? { rec: (this.status.get(pid.slice(0, -2)) || {}).scr, res: 'Screen' } : ex || this.status.get(pid) || {};
        const tag = $('.rectag', t.el), stt = $('.st', t.el);
        tag.hidden = !st.rec; if (st.rec) tag.innerHTML = `<span class="dot red"></span>${esc(st.res || 'REC')}`;
        const show = this.host && pid !== s.pid && !ex && !pid.endsWith('~s') && (st.pending || st.rec);
        stt.hidden = !show; if (show) stt.innerHTML = `${ico('up')}<b>${st.pending ? mb(st.bytes) : 'Up to date'}</b>`;
        $('small', t.fs).textContent = st.rec ? `${st.res || ''} REC` : '';
        const mut = pid === s.pid ? !!(this.self.stream && this.self.stream.getAudioTracks()[0] && !this.self.stream.getAudioTracks()[0].enabled) : st.mic === false;
        t.el.classList.toggle('mut', mut); t.el.classList.toggle('offair', !!(ex && ex.off));
      }
    }
    // a guest's free space: about how many hours more of recording fit
    room(st) { return st.hours === undefined ? `${mb(st.free)} free` : st.hours < 1 ? `only ${Math.max(0, Math.round(st.hours * 60))} min of space left` : `${mb(st.free)} free (${st.hours >= 20 ? '20+' : Math.floor(st.hours)} h)`; }
    // a host's or producer's buttons for someone in the room: mute or unmute, talk privately
    acts(pid, st) {
      if (!this.ctrl) return '';
      const t = this.talk, me = this.session.pid, talking = t && t.a === me && t.b === pid;
      return (st.mic === false ? ib('js-pmute warn', 'micoff', 'Unmute them (asks them if they muted themselves)', pid, 'data-on="1"') : ib('js-pmute', 'mic', 'Mute them (their recording is silent too)', pid, 'data-on="0"'))
        + ib(`js-ptalk${talking ? ' on' : ''}`, 'headset', talking ? 'End the private talk' : 'Talk privately: nobody else hears you two', pid);
    }
    trackRow(pid, name, sub, pct, ok, kick, cam, change, acts) {
      const busy = this.session.rec && this.session.rec.on;
      const btns = (acts || '') + (change && !busy ? ib('js-chg', 'sliders', 'Change your camera or microphone') : '')
        + (kick ? ib('js-kick', 'x', 'Remove them from the session', pid) : '')
        + (cam && cam !== 'screen' && this.host && !busy ? ib('js-xrm', 'x', 'Remove this source', pid) : '');
      return `<div class="trk"><span class="av" style="${avStyle(pid)}">${cam ? ico(cam === 'mic' ? 'mic' : cam === 'screen' ? 'screen' : 'cam') : esc(initials(name.replace(/\s*\(you\)$/, '')))}</span><div class="tinfo"><b>${esc(name)}</b><small>${esc(sub)}</small></div>${btns ? `<div class="tbtns">${btns}</div>` : ''}<div class="bar"><i class="${ok ? 'ok' : ''}" style="width:${pct}%"></i></div></div>`;
    }
    drawUploads() {
      const s = this.session, el = $('.js-uploads', this.el), fup = $('.js-fup', this.fsEl);
      let pending = 0, bytes = 0, sent = 0;
      if (this.ctrl) for (const st of this.status.values()) { pending += st.pending || 0; bytes += st.bytes || 0; sent += st.sentBytes || 0; }
      else { const st = this.selfStatus ? this.selfStatus() : {}; pending = st.pending || 0; bytes = st.bytes || 0; sent = st.sentBytes || 0; }
      const pct = Math.round(100 * sent / Math.max(1, sent + bytes));
      const txt = pending ? `${mb(bytes)} still to upload` : sent ? (this.ctrl ? 'Every guest is uploaded' : 'All uploaded') : this.ctrl ? 'Guests upload while you talk' : 'Uploads while you talk';
      el.innerHTML = `${ico('cloud')}<div class="bar"><i class="${pending ? '' : 'ok'}" style="width:${pending ? pct : sent ? 100 : 0}%"></i></div><span class="num">${esc(txt)}</span>`;
      fup.innerHTML = `<span>${esc(txt)}</span><div class="bar"><i style="width:${pending ? pct : sent ? 100 : 0}%"></i></div>`;
    }
    addChat(m) {
      const el = $('.js-chat', this.el), e = el.querySelector('.empty'); if (e) e.remove();
      const t = new Date(m.at || Date.now());
      el.insertAdjacentHTML('beforeend', `<p><b>${esc(m.name)}</b> ${esc(m.text)}<small>${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}</small></p>`);
      el.scrollTop = el.scrollHeight;
      if ((!this.drawerOpen || this.tab !== 'chat') && m.from !== this.session.pid) { const b = $('.js-tb-chat', this.el); b.hidden = false; b.textContent = '•'; this.badges(); }
    }
    // full screen: everyone edge to edge with the controls floating over them, or just one person (pid)
    fitFs() {
      // full screen: whole 16:9 pictures, as big as the screen allows, centred (Stage look)
      const g = this.fsEl && $('.js-fgrid', this.fsEl); if (!g) return;
      const n = this.tiles.size || 1, W = innerWidth, H = innerHeight, gap = 4;
      if (W <= 700 || this.spot) { g.style.gridTemplateColumns = ''; g.style.gridTemplateRows = ''; g.style.placeContent = ''; return; }
      let best = 0, c = 1;
      for (let k = 1; k <= Math.min(n, 6); k++) { const r = Math.ceil(n / k), tw = Math.min((W - (k - 1) * gap) / k, ((H - (r - 1) * gap) / r) * 16 / 9); if (tw > best + 1) { best = tw; c = k; } }
      const r = Math.ceil(n / c), tw = Math.floor(best), th = Math.floor(best * 9 / 16);
      g.style.gridTemplateColumns = `repeat(${c}, ${tw}px)`; g.style.gridTemplateRows = `repeat(${r}, ${th}px)`; g.style.placeContent = 'center';
    }
    full(on, pid) {
      const was = !this.fsEl.hidden;
      this.spot = on && pid && this.tiles.has(pid) ? pid : null;
      this.fsEl.hidden = !on;
      this.fsEl.classList.toggle('spotting', !!this.spot);
      for (const [k, t] of this.tiles) t.fs.classList.toggle('spot', k === this.spot);
      if (on && !was) { try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); } catch {} for (const t of this.tiles.values()) $('video', t.fs).play().catch(() => {}); }
      else if (!on) { this.panelFs(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
      this.fitFs(); this.drawDock(); this.drawCountdown();
    }
    // the side panel floating over the full-screen view (the same panel, fixed above it, so nothing moves)
    panelFs(on) {
      this.fsPanel = !!on;
      $('.drawer', this.el).classList.toggle('floating', this.fsPanel);
      if (on) this.showTab(this.tab); else this.fit();
      if (!this.fsEl.hidden) this.drawDock();
    }
  }

  function toast(msg, ms = 2200) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; t.style.opacity = 1;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.style.opacity = 0; setTimeout(() => { t.hidden = true; }, 300); }, ms);
  }
  // dark (the Console look) or light, remembered per computer
  function theme(btn) {
    const get = () => { try { return localStorage.getItem('sess-theme'); } catch { return null; } };
    const apply = (v) => { if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; };
    apply(get());
    if (btn) btn.onclick = () => {
      const dark = (document.documentElement.dataset.theme || 'dark') === 'dark'; // dark unless you chose light
      const v = dark ? 'light' : 'dark'; apply(v); try { localStorage.setItem('sess-theme', v); } catch {}
    };
  }

  root.SessionsUI = { RoomUI, toast, theme, esc, initials, avStyle, mb, clock, ico, injectIcons };
})(window);
