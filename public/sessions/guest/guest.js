// Showcaller Sessions guest page: check the camera, mic and space, join (through the waiting room if the host has one),
// record in full quality here when the host presses Record, and upload every piece while talking.
(function () {
  'use strict';
  const C = window.SessionsCore, U = window.SessionsUI, $ = (s) => document.querySelector(s);
  U.injectIcons(); U.theme($('#themeb'));
  const m = /^\/s\/([a-z0-9]{8,24})\/?$/.exec(location.pathname) || /[?&]r=([a-z0-9]{8,24})/.exec(location.search);
  const room = m && m[1];
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const show = (id) => { for (const v of ['join', 'wait', 'room', 'done']) $(`#v-${v}`).hidden = v !== id; };
  if (!room) { show('done'); $('#donep').innerHTML = '<h2 class="h2">This link isn’t complete</h2><p class="muted">Ask the host to send it again.</p>'; return; }

  let pid = store.get(`sess-pid-${room}`); if (!/^[a-z0-9]{8,16}$/.test(pid || '')) { pid = C.rid(12); store.set(`sess-pid-${room}`, pid); }
  let stream = null, quality = '1080', session = null, ui = null, rec = null, sink = null, recRes = '', recErr = '';
  $('#name').value = store.get('sess-name') || '';

  // ---------- pre-join checks ----------
  const ok = (el, txt, good = true) => { el.innerHTML = `<svg class="ico ${good ? 'ok' : 'wa'}"><use href="#i-check"/></svg><span>${U.esc(txt)}</span>`; };
  const okBrowser = !!(window.MediaRecorder && window.RTCPeerConnection && window.AudioWorkletNode && navigator.mediaDevices);
  ok($('#ck-browser'), okBrowser ? (C.pickMime().includes('mp4') ? 'This browser records MP4' : 'This browser records WebM (the app turns it into MP4)') : 'This browser can’t record. Use Chrome, Edge or Safari.', okBrowser);
  C.freeSpace().then((f) => {
    if (!f) return ok($('#ck-space'), 'Couldn’t check free space', false);
    const hours = f.free / (C.gbPerHour(quality) * 1e9);
    ok($('#ck-space'), hours >= 2 ? `Plenty of room to keep a copy (${hours > 20 ? '20+' : hours.toFixed(0)} h at ${C.QUALITY[quality].label})` : `Only about ${Math.max(0, hours * 60).toFixed(0)} min of space for a safety copy`, hours >= 1);
  });

  async function openPreview() {
    const cam = $('#cam').value || undefined, mic = $('#mic').value || undefined;
    if (stream) for (const t of stream.getTracks()) t.stop();
    try {
      stream = await C.openMedia({ quality, cam, mic, speakers: $('#speakers').checked });
    } catch (e) {
      try { stream = await C.openMedia({ quality, cam: 'off', mic, speakers: $('#speakers').checked }); ok($('#ck-cam'), 'No camera found. You can still join with sound.', false); }
      catch (e2) { $('#jerr').hidden = false; $('#jerr').textContent = 'Allow the camera and microphone for this page (the icon in the address bar), then reload.'; return; }
    }
    $('#pv').srcObject = stream;
    const v = stream.getVideoTracks()[0];
    if (v) { const s = v.getSettings(); ok($('#ck-cam'), `Camera ${s.width}×${s.height}${s.frameRate ? ` at ${Math.round(s.frameRate)} fps` : ''}`, (s.height || 0) >= 720); recRes = `${s.height >= 2000 ? '4K' : `${s.height}p`}`; }
    await listDevices();
    meter();
    $('#join').disabled = !okBrowser;
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

  // ---------- joining ----------
  $('#join').onclick = () => {
    const name = $('#name').value.trim();
    if (!name) { $('#name').focus(); $('#jerr').hidden = false; $('#jerr').textContent = 'Type your name so the host knows who you are.'; return; }
    store.set('sess-name', name); $('#jerr').hidden = true;
    try { mac && mac.close(); } catch {}
    session = new C.Session({ server: location.origin, room, role: 'guest', pid, name, stream });
    session.on('state', onState).on('cfg', onCfg).on('rec', onRec);
    session.connect();
    show('wait'); $('#waittxt').textContent = 'Connecting…';
  };

  function onState(s, why, x) {
    if (s === 'waiting') { show('wait'); $('#waittxt').textContent = x ? 'They’ve been told you’re here.' : 'The host isn’t in the room yet. You’ll be let in when they arrive.'; $('#sessname').textContent = session.cfg.name || 'Remote recording'; }
    else if (s === 'in') {
      if (!sink) { sink = new C.CloudSink({ server: location.origin, room, pid, tok: session.tok }); sink.on('stat', () => ui && ui.drawUploads()); sink.resume(); }
      else { sink.tok = session.tok; sink.pump(); }
      if (!ui) { show('room'); ui = new U.RoomUI({ el: $('#roomwin'), session, host: false, self: { stream }, onLeave: leave, selfStatus: status }); }
      $('#sessname').textContent = session.cfg.name || 'Remote recording';
    } else if (s === 'reconnecting') U.toast('Connection lost. Reconnecting… (your recording carries on)', 4000);
    else if (s === 'closed') {
      if (rec && rec.running) rec.stop();
      done(why || 'You’ve left the session');
    }
  }
  async function onCfg(cfg) {
    if (cfg.quality && cfg.quality !== quality && !(rec && rec.running)) {
      quality = cfg.quality;
      const v = stream && stream.getVideoTracks()[0], q = C.QUALITY[quality];
      if (v) { try { await v.applyConstraints({ width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: 30 } }); } catch {} const s = v.getSettings(); recRes = `${s.height >= 2000 ? '4K' : `${s.height}p`}`; session.rescale(); }
    }
    $('#sessname').textContent = cfg.name || 'Remote recording';
  }
  async function onRec(r, fromHello) {
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
    const st = sink ? { pending: sink.q.length, bytes: sink.pendingBytes(), sent: sink.sent, sentBytes: sink.sentBytes } : { pending: 0, bytes: 0, sent: 0, sentBytes: 0 };
    return { ...st, rec: !!(rec && rec.running), res: recRes, err: recErr || (sink && sink.fail > 3 ? 'Upload trouble, retrying' : '') };
  }
  setInterval(() => { if (session && session.state === 'in') session.tell('host', { st: status() }); }, 2000);

  async function leave() {
    if (rec && rec.running) { if (!confirm('The recording is still running. Leave anyway? What you’ve recorded so far is kept and uploaded.')) return; await rec.stop(); }
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
    if (stream && !(sink && sink.q.length)) for (const t of stream.getTracks()) t.stop();
  }
  addEventListener('beforeunload', (e) => { if ((rec && rec.running) || (sink && sink.q.length)) { e.preventDefault(); e.returnValue = ''; } });
})();
