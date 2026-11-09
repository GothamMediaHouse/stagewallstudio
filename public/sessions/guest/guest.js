// Showcaller Sessions guest page: check the camera, mic and space, join (through the waiting room if the host has one),
// record in full quality here when the host presses Record, and upload every piece while talking.
(function () {
  'use strict';
  const C = window.SessionsCore, U = window.SessionsUI, $ = (s) => document.querySelector(s);
  U.injectIcons(); U.theme($('#themeb'));
  const m = /^\/s\/([a-z0-9]{8,24})\/?$/.exec(location.pathname) || /[?&]r=([a-z0-9]{8,24})/.exec(location.search);
  const room = m && m[1];
  // a producer's link (…/s/<room>?producer=<key>): runs the room with the host, isn't recorded, skips the waiting room
  const prod = (/[?&]producer=([a-f0-9]{32})/.exec(location.search) || [])[1] || '';
  const phone = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const show = (id) => { for (const v of ['join', 'wait', 'room', 'done']) $(`#v-${v}`).hidden = v !== id; };
  if (!room) { show('done'); $('#donep').innerHTML = '<h2 class="h2">This link isn’t complete</h2><p class="muted">Ask the host to send it again.</p>'; return; }

  let pid = store.get(`sess-pid-${room}`); if (!/^[a-z0-9]{8,16}$/.test(pid || '')) { pid = C.rid(12); store.set(`sess-pid-${room}`, pid); }
  let stream = null, quality = '1080', rcfg = {}, session = null, ui = null, rec = null, sink = null, recRes = '', recErr = '', share = null, wake = null;
  if (prod) {
    $('#jtitle').textContent = 'You’re producing this session';
    $('#jsub').textContent = 'You’ll see and hear everyone, let guests in, start and stop the recording and add marks. You aren’t recorded, so the camera is up to you.';
    $('#join').textContent = 'Join as producer';
  }
  if (phone) $('#jhint').textContent = 'On a phone: keep this page open and the screen on while you record. Switching to another app pauses the camera.';
  $('#name').value = store.get('sess-name') || '';
  // 1.4: "Open this in the app" (showcaller-sessions://…), on a computer, when this page isn't already inside the app
  if (!phone && !/Electron|ShowcallerSessions/.test(navigator.userAgent)) {
    const q = new URLSearchParams(); if (prod) q.set('producer', prod);
    const g0 = (/[?&]g=([a-z0-9]{10})/.exec(location.search) || [])[1]; if (g0) q.set('g', g0);
    $('#inappa').href = `showcaller-sessions://s/${room}${q.toString() ? `?${q}` : ''}`; $('#inapp').hidden = false;
  }
  // an invite link (…?g=<id>) knows who it's for; the page shows when the show is, before the day
  const gid = (/[?&]g=([a-z0-9]{10})/.exec(location.search) || [])[1] || '';
  fetch(`/sessions/info?r=${room}${gid ? `&g=${gid}` : ''}`).then((r) => r.ok ? r.json() : null).then((i) => {
    if (!i) return;
    applyBrand(i.brand);
    const opts = { fps: i.fps, high: i.high, audio: i.audio };
    if ((i.quality && C.QUALITY[i.quality] && i.quality !== quality) || JSON.stringify(opts) !== JSON.stringify(rcfg)) {
      if (i.quality && C.QUALITY[i.quality]) quality = i.quality; rcfg = opts; recOptsNote();
      const v = fx ? fx.inTrack : stream && stream.getVideoTracks()[0]; if (v) v.applyConstraints(C.videoAsk(quality, rcfg)).then(() => { const st = v.getSettings(); recRes = `${st.height >= 2000 ? '4K' : `${st.height}p`}`; }).catch(() => {});
    }
    if (i.guest && i.guest.name && !$('#name').value) { $('#name').value = i.guest.name; $('#pvav').textContent = U.initials(i.guest.name); }
    if (i.at) {
      const d = new Date(i.at), soon = i.at - Date.now();
      const w = d.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      $('#jwhen').hidden = false;
      $('#jwhen').innerHTML = `<svg class="ico"><use href="#i-timer"/></svg><div><b>${U.esc(i.name)}</b><span>${U.esc(w)}${i.mins ? ` · about ${i.mins} min` : ''}</span>${soon > 3600e3 && !i.host ? '<small>It isn’t on yet. Do a tech check now so the host knows you’re ready.</small>' : ''}</div>`;
    }
  }).catch(() => {});

  // the studio's own name, logo and colour (set in the studio app: Settings → Your guest page)
  function applyBrand(b) {
    if (!b) return;
    const st = document.documentElement.style, c = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '';
    if (c) {
      const n = parseInt(c.slice(1), 16), lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
      st.setProperty('--v', c); st.setProperty('--v2', `color-mix(in srgb, ${c} 78%, #fff)`); st.setProperty('--vsoft', `color-mix(in srgb, ${c} 16%, transparent)`);
      st.setProperty('--vtext', `color-mix(in srgb, ${c} 72%, var(--fg))`); st.setProperty('--onv', lum > 0.55 ? '#0b0c0f' : '#fff');
    }
    if (/^data:image\/(png|jpeg|webp);base64,/.test(b.logo || '')) {
      const im = document.createElement('img'); im.className = 'blogo'; im.alt = b.name || ''; im.src = b.logo;
      const lg = $('.topnav .logo'); if (lg) lg.replaceWith(im);
    }
    if (b.name) { $('.topnav .brand b').textContent = b.name; document.title = `${b.name} · Remote recording`; }
    $('#powered').hidden = false; document.documentElement.classList.add('branded');
  }

  // a sound-only session: say so where the camera check is (the camera is still seen in the call)
  function recOptsNote() {
    const n = $('#ck-audio'); if (!n) return;
    n.hidden = !rcfg.audio; if (rcfg.audio) ok(n, 'Sound-only session: just your microphone is recorded');
  }

  // ---------- pre-join checks ----------
  const ok = (el, txt, good = true) => { el.innerHTML = `<svg class="ico ${good ? 'ok' : 'wa'}"><use href="#i-check"/></svg><span>${U.esc(txt)}</span>`; };
  const okBrowser = !!(window.MediaRecorder && window.RTCPeerConnection && window.AudioWorkletNode && navigator.mediaDevices);
  ok($('#ck-browser'), okBrowser ? (C.pickMime().includes('mp4') ? 'This browser records MP4' : 'This browser records WebM (the app turns it into MP4)') : 'This browser can’t record. Use Chrome, Edge or Safari.', okBrowser);
  C.freeSpace().then((f) => {
    if (!f) return ok($('#ck-space'), 'Couldn’t check free space', false);
    const hours = f.free / (C.gbPerHour(quality, rcfg) * 1e9);
    ok($('#ck-space'), hours >= 2 ? `Plenty of room to keep a copy (${hours > 20 ? '20+' : hours.toFixed(0)} h at ${C.QUALITY[quality].label})` : `Only about ${Math.max(0, hours * 60).toFixed(0)} min of space for a safety copy`, hours >= 1);
  });

  async function openPreview() {
    const q0 = quality, o0 = JSON.stringify(rcfg);
    const cam = $('#cam').value || undefined, mic = $('#mic').value || undefined;
    if (stream) for (const t of stream.getTracks()) t.stop();
    try {
      stream = await C.openMedia({ quality, cfg: rcfg, cam, mic, speakers: $('#speakers').checked });
    } catch (e) {
      try { stream = await C.openMedia({ quality, cfg: rcfg, cam: 'off', mic, speakers: $('#speakers').checked }); ok($('#ck-cam'), 'No camera found. You can still join with sound.', false); }
      catch (e2) { $('#jerr').hidden = false; $('#jerr').textContent = 'Allow the camera and microphone for this page (the icon in the address bar), then reload.'; return; }
    }
    $('#pv').srcObject = stream;
    const v = stream.getVideoTracks()[0];
    // the session's quality or options arrived while the camera was opening
    if (v && (q0 !== quality || o0 !== JSON.stringify(rcfg))) { try { await v.applyConstraints(C.videoAsk(quality, rcfg)); } catch {} }
    if (v) { const s = v.getSettings(); ok($('#ck-cam'), `Camera ${s.width}×${s.height}${s.frameRate ? ` at ${Math.round(s.frameRate)} fps` : ''}`, (s.height || 0) >= 720); recRes = `${s.height >= 2000 ? '4K' : `${s.height}p`}`; }
    await listDevices();
    meter();
    $('#join').disabled = !okBrowser; $('#tcheck').disabled = false;
    return stream;
  }
  async function listDevices() {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const cur = { cam: stream && stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings().deviceId, mic: stream && stream.getAudioTracks()[0] && stream.getAudioTracks()[0].getSettings().deviceId };
    const fill = (sel, kind, now) => { sel.innerHTML = devs.filter((d) => d.kind === kind).map((d, i) => `<option value="${U.esc(d.deviceId)}" ${d.deviceId === now ? 'selected' : ''}>${U.esc(d.label || `${kind === 'videoinput' ? 'Camera' : 'Mic'} ${i + 1}`)}</option>`).join(''); };
    fill($('#cam'), 'videoinput', cur.cam); fill($('#mic'), 'audioinput', cur.mic);
  }
  let mac, man, mbuf;
  function meter() {
    try {
      if (!mac) { mac = new AudioContext(); man = mac.createAnalyser(); man.fftSize = 512; mbuf = new Float32Array(512); (function loop() { man.getFloatTimeDomainData(mbuf); let p = 0; for (const x of mbuf) p = Math.max(p, Math.abs(x)); $('#miclv').style.width = `${Math.min(100, p * 250)}%`; if (!$('#v-join').hidden) requestAnimationFrame(loop); })(); }
      const a = stream.getAudioTracks()[0]; if (a) mac.createMediaStreamSource(new MediaStream([a])).connect(man);
    } catch {}
  }
  const togglePv = (kind, btn) => { const t = stream && (kind === 'a' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0]); if (!t) return; t.enabled = !t.enabled; btn.classList.toggle('off', !t.enabled); if (kind === 'v') $('#pvoff').hidden = t.enabled; };
  addEventListener('pointerdown', () => { try { if (mac && mac.state === 'suspended') mac.resume(); } catch {} }, true);
  $('#pvmic').onclick = () => togglePv('a', $('#pvmic')); $('#pvcam').onclick = () => togglePv('v', $('#pvcam'));
  $('#cam').onchange = $('#mic').onchange = $('#speakers').onchange = () => openPreview();
  $('#name').oninput = () => { $('#pvav').textContent = U.initials($('#name').value); };
  $('#pvav').textContent = U.initials($('#name').value);

  // pieces left over from an earlier visit (tab closed, crash, no connection)
  (async () => {
    try {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('showcaller-sessions', { create: true });
      const r = await d.getDirectoryHandle(room, { create: true }); let n = 0, b = 0;
      for await (const [, h] of r.entries()) { n++; b += (await h.getFile()).size; }
      if (n) { $('#resume').hidden = false; $('#resume').textContent = `${n} pieces (${U.mb(b)}) from your last visit haven’t uploaded yet. They go up as soon as you join.`; }
    } catch {}
  })();

  openPreview();

  // ---------- tech check: camera, mic, connection and space, a few seconds of yourself to play back; the host sees the result ----------
  async function timed(fn) { const t = performance.now(); await fn(); return (performance.now() - t) / 1000; }
  async function speedTest() {
    const N = 4e6;
    let down = 0, up = 0;
    try { const s = await timed(async () => { const r = await fetch(`/sessions/speed?r=${room}&n=${N}&x=${Date.now()}`, { cache: 'no-store' }); await r.arrayBuffer(); }); down = (N * 8) / s / 1e6; } catch {}
    try { const body = new Uint8Array(N); crypto.getRandomValues(body.subarray(0, 65536)); const s = await timed(() => fetch(`/sessions/speed?r=${room}`, { method: 'POST', body })); up = (N * 8) / s / 1e6; } catch {}
    return { down, up };
  }
  function recordBack(secs) {
    return new Promise((res) => {
      try {
        const mime = C.pickMime(), mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {}), parts = [];
        mr.ondataavailable = (e) => e.data.size && parts.push(e.data);
        mr.onstop = () => res(new Blob(parts, { type: mr.mimeType }));
        mr.start(); setTimeout(() => mr.state !== 'inactive' && mr.stop(), secs * 1000);
      } catch { res(null); }
    });
  }
  let peak = 0; // loudest the mic got during the check
  $('#tcheck').onclick = async () => {
    const box = $('#tcres'), btn = $('#tcheck'); btn.disabled = true; box.hidden = false;
    const step = (t) => { box.innerHTML = `<div class="row"><div class="spin sm"></div><span>${U.esc(t)}</span></div>`; };
    step('Say a few words: recording 5 seconds of you…');
    try { if (mac && mac.state === 'suspended') await mac.resume(); } catch {}
    peak = 0; let an = null, ab = null;
    try { const at = stream && stream.getAudioTracks()[0]; if (mac && at) { an = mac.createAnalyser(); an.fftSize = 2048; ab = new Float32Array(2048); mac.createMediaStreamSource(new MediaStream([at])).connect(an); } } catch {}
    const watch = setInterval(() => { if (an) { an.getFloatTimeDomainData(ab); for (const x of ab) peak = Math.max(peak, Math.abs(x)); } }, 40);
    const clip = await recordBack(5); clearInterval(watch);
    step('Testing your connection…');
    const sp = await speedTest();
    const f = await C.freeSpace().catch(() => null);
    const v = stream && stream.getVideoTracks()[0], vs = v ? v.getSettings() : {}, a = stream && stream.getAudioTracks()[0];
    const need = { '720': 3, '1080': 6, '4k': 15 }[quality] || 6, hours = f ? f.free / (C.gbPerHour(quality, rcfg) * 1e9) : 0;
    const items = [
      [!!v && (vs.height || 0) >= 720, v ? `Camera ${vs.width}×${vs.height}${(vs.height || 0) < 720 ? ': lower than the show’s quality' : ''}` : 'No camera'],
      [!!a && peak > 0.01, a ? (peak > 0.01 ? `Mic works (${(a.label || 'mic').slice(0, 40)})` : 'We didn’t hear you. Check the mic choice above.') : 'No mic'],
      [sp.up >= need, sp.up ? `Upload ${sp.up.toFixed(1)} Mbps${sp.up < need ? `: fine to talk, but your recording finishes uploading after the show (best is ${need}+)` : ''}` : 'Couldn’t test the connection'],
      [sp.down >= 2, sp.down ? `Download ${sp.down.toFixed(1)} Mbps` : ''],
      [hours >= 2, f ? (hours >= 2 ? `Space for ${hours > 20 ? '20+' : hours.toFixed(0)} h at ${C.QUALITY[quality].label}` : `Space for only about ${Math.round(hours * 60)} min. Free up some room before the day.`) : 'Couldn’t check free space'],
      [okBrowser, okBrowser ? 'This browser can record' : 'This browser can’t record. Use Chrome, Edge or Safari.'],
    ].filter((x) => x[1]);
    const good = items.every((x) => x[0]) || (items[0][0] && items[1][0] && okBrowser && hours >= 1);
    const url = clip ? URL.createObjectURL(clip) : '';
    box.innerHTML = `<div class="row"><svg class="ico ${good ? 'ok' : 'wa'}" style="width:22px;height:22px"><use href="#i-check"/></svg><b>${good ? 'You’re ready' : 'Nearly ready'}</b><span class="muted sp">The host can see this.</span></div>
      <div class="tclist">${items.map(([g, t]) => `<div class="row"><svg class="ico ${g ? 'ok' : 'wa'}"><use href="#i-check"/></svg><span>${U.esc(t)}</span></div>`).join('')}</div>
      ${url ? `<div class="tcplay"><span class="lbl">Hear yourself</span><video src="${url}" controls playsinline></video></div>` : ''}`;
    btn.disabled = false; btn.lastChild.textContent = 'Check again';
    const notes = items.filter((x) => !x[0]).map((x) => x[1]);
    fetch(`/sessions/techcheck?r=${room}${gid ? `&g=${gid}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      name: $('#name').value.trim() || 'Someone', ok: good, cam: v ? `${vs.width}×${vs.height}` : 'none', mic: a ? (a.label || 'mic') : 'none', res: recRes, up: Math.round(sp.up * 10), down: Math.round(sp.down * 10), free: f ? Math.round(f.free / 1e6) : 0, browser: (navigator.userAgent.match(/(Edg|Chrome|Firefox|Version)\/[\d]+/) || [''])[0].replace('Version', 'Safari'), notes,
    }) }).catch(() => {});
  };

  // ---------- joining ----------
  $('#join').onclick = () => {
    const name = $('#name').value.trim();
    if (!name) { $('#name').focus(); $('#jerr').hidden = false; $('#jerr').textContent = 'Type your name so the host knows who you are.'; return; }
    store.set('sess-name', name); $('#jerr').hidden = true;
    try { mac && mac.close(); } catch {}
    session = new C.Session({ server: location.origin, room, role: 'guest', pid, name, stream, prod, g: gid });
    session.on('state', onState).on('cfg', onCfg).on('rec', onRec);
    keepAwake();
    session.connect();
    show('wait'); $('#waittxt').textContent = 'Connecting…';
  };

  function onState(s, why, x) {
    if (s === 'waiting') { show('wait'); $('#waittxt').textContent = x ? 'They’ve been told you’re here.' : 'The host isn’t in the room yet. You’ll be let in when they arrive.'; $('#sessname').textContent = session.cfg.name || 'Remote recording'; }
    else if (s === 'in') {
      if (!session.producer) {
        if (!sink) {
          sink = new C.CloudSink({ server: location.origin, room, pid, tok: session.tok }); sink.on('stat', () => ui && ui.drawUploads()); sink.resume();
          // a shared screen is its own track (pid + 's'), with its own pieces kept here until they're up
          if (navigator.mediaDevices.getDisplayMedia && !phone) {
            const ssink = new C.CloudSink({ server: location.origin, room, pid: `${pid}s`, tok: session.tok, sub: '-s' }); ssink.on('stat', () => ui && ui.drawUploads()); ssink.resume();
            share = new C.ScreenShare({ session, quality, sink: ssink, pid: `${pid}s`, name: `${name()} · screen`, store });
            share.sink2 = ssink;
          }
        } else { sink.tok = session.tok; sink.pump(); if (share) { share.sink.tok = session.tok; share.sink.pump(); } }
      }
      if (!ui) { show('room'); ui = new U.RoomUI({ el: $('#roomwin'), session, host: false, producer: !!session.producer, share, self: { stream }, onLeave: leave, selfStatus: status, onSelfChange: tellStatus, onRename: (n) => store.set('sess-name', n), onFx: window.SessionsFx ? setFx : null });
        const fm0 = store.get('sess-fx'); if (window.SessionsFx && fm0 && fm0 !== 'off') setFx(fm0).then(() => ui.drawDock()).catch(() => {}); }
      $('#sessname').textContent = session.cfg.name || 'Remote recording';
    } else if (s === 'reconnecting') U.toast('Connection lost. Reconnecting… (your recording carries on)', 4000);
    else if (s === 'closed') {
      if (rec && rec.running) rec.stop();
      if (share) share.stop();
      done(why || 'You’ve left the session');
    }
  }
  async function onCfg(cfg) {
    const opts = { fps: cfg.fps, high: cfg.high, audio: cfg.audio };
    if (((cfg.quality && cfg.quality !== quality) || JSON.stringify(opts) !== JSON.stringify(rcfg)) && !(rec && rec.running)) {
      if (cfg.quality) quality = cfg.quality; rcfg = opts; recOptsNote();
      const v = stream && stream.getVideoTracks()[0];
      if (v) { try { await v.applyConstraints(C.videoAsk(quality, rcfg)); } catch {} const s = v.getSettings(); recRes = `${s.height >= 2000 ? '4K' : `${s.height}p`}`; session.rescale(); }
    }
    $('#sessname').textContent = cfg.name || 'Remote recording';
  }
  const name = () => (session && session.name) || $('#name').value.trim() || 'Guest';
  async function onRec(r, fromHello) {
    if (session.producer) return; // a producer isn't recorded
    if (share) share.onRec(r, fromHello).catch((e) => console.error(e));
    if (r.on && !(rec && rec.running)) {
      if (fromHello && r.take && rec && rec.take === r.take) return;
      rec = new C.Recorder({ session, stream, quality, sink });
      rec.on('error', (e) => { recErr = 'Couldn’t save a piece on this computer'; console.error(e); });
      // joined (or reloaded) while a take was already running: record a new part of it, so nothing earlier is overwritten
      const pk = `sess-part-${room}-${r.take}`, part = store.get(pk) === null ? 0 : Number(store.get(pk)) + 1;
      store.set(pk, String(part));
      try { await rec.start(r.take, fromHello ? session.now() : r.at, part); } catch (e) { recErr = `This browser couldn’t start recording (${e.message || e})`; console.error(e); }
    } else if (!r.on && rec && rec.running) {
      await rec.stop();
      U.toast('Take saved. Uploading the last pieces…');
    }
  }
  function status() {
    const sinks = [sink, share && share.sink].filter(Boolean);
    const st = { pending: 0, bytes: 0, sent: 0, sentBytes: 0 };
    for (const k of sinks) { st.pending += k.q.length; st.bytes += k.pendingBytes(); st.sent += k.sent; st.sentBytes += k.sentBytes; }
    const a = stream && stream.getAudioTracks()[0];
    return { ...st, rec: !!(rec && rec.running), scr: !!(share && share.recording), res: recRes, err: recErr || (sink && sink.fail > 3 ? 'Upload trouble, retrying' : ''),
      mic: a ? a.enabled : undefined, free: space.free, hours: space.free ? space.free / (C.gbPerHour(quality, rcfg) * 1e9) : undefined };
  }
  // the room this browser has for its safety copy, so the host and producers can see who's running short
  const space = { free: 0 };
  const measure = () => C.freeSpace().then((f) => { if (f) space.free = f.free; }).catch(() => {});
  measure(); setInterval(measure, 30000);
  // the host and producers see everyone's recording, uploads, space and mic
  function tellStatus() {
    if (!session || session.state !== 'in' || session.producer) return;
    const st = status();
    session.tell('host', { st });
    for (const p of session.peers.values()) if (p.role === 'producer') session.tell(p.pid, { st });
  }
  setInterval(tellStatus, 2000);
  // keep a phone's screen on while in the room (the camera stops if it locks)
  async function keepAwake() { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch {} }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (session && !session.closed) keepAwake(); if (rec && rec.running && phone) U.toast('Welcome back. Keep this page in front while recording: the camera pauses in other apps.', 5000); }
  });

  // 1.8: background blur or a picture behind you (fx.js). Turning it on swaps the camera for the effect's picture
  // (not mid-take: the recording uses it); after that, changing the effect is instant.
  let fx = null;
  async function setFx(mode, pic) {
    if (mode !== 'off' && !fx) {
      if (session.rec && session.rec.on) throw new Error('Wait until the recording stops, then turn on a background');
      const v0 = stream && stream.getVideoTracks()[0]; if (!v0) throw new Error('Turn on a camera first');
      const f = new window.SessionsFx.Fx(stream);
      try { await f.set(mode, { image: pic || (mode === 'image' ? store.get('sess-fx-img') : '') }); } catch (e) { f.stop(); throw new Error(`The background effect didn’t start: ${e.message || e}`); }
      if (session.rec && session.rec.on) { f.stop(); throw new Error('The recording started; turn the background on after it stops'); }
      f.track.enabled = v0.enabled; fx = f;
      session.replaceTrack('video', f.track);
      stream = f.stream; session.stream = stream; ui.self.stream = stream; ui.attach(session.pid, stream);
    } else if (fx) await fx.set(mode, { image: pic || (mode === 'image' ? store.get('sess-fx-img') : '') });
    if (pic) try { store.set('sess-fx-img', pic); } catch {}
    store.set('sess-fx', mode); ui.fxMode = mode;
  }

  async function leave() {
    if (rec && rec.running) { if (!confirm('The recording is still running. Leave anyway? What you’ve recorded so far is kept and uploaded.')) return; await rec.stop(); }
    if (share) await share.stop();
    session.leave(); done('You’ve left the session');
  }
  function done(title) {
    show('done');
    if (ui) { ui.destroy(); ui = null; }
    const draw = () => {
      const st = status();
      $('#donep').innerHTML = st.pending
        ? `<div class="spin"></div><h2 class="h2">Uploading your recording</h2><p class="muted" style="margin:0">${st.pending} pieces (${U.mb(st.bytes)}) to go. Keep this tab open until it finishes.</p><div class="bar" style="width:100%"><i style="width:${Math.round(100 * st.sentBytes / Math.max(1, st.sentBytes + st.bytes))}%"></i></div>`
        : `<svg class="ico ok" style="width:40px;height:40px"><use href="#i-check"/></svg><h2 class="h2">${U.esc(title)}</h2><p class="muted" style="margin:0">${st.sent ? 'Everything you recorded is uploaded. You can close this tab.' : 'Thanks for joining.'}</p><button class="btn soft" onclick="location.reload()">Join again</button>`;
      if (st.pending) setTimeout(draw, 1000);
    };
    draw();
    if (stream && !(sink && sink.q.length)) { for (const t of stream.getTracks()) t.stop(); if (fx) fx.stop(); }
  }
  addEventListener('beforeunload', (e) => { if ((rec && rec.running) || (sink && sink.q.length) || (share && share.sink.q.length)) { e.preventDefault(); e.returnValue = ''; } });
})();
