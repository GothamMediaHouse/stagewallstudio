// Showcaller Intercom: the crew page (opened from the link the director sends). It joins the director's intercom
// over WebRTC: the microphone goes up only while talking, and the director's computer sends back this person's mix.
(function () {
  const $ = (id) => document.getElementById(id);
  // a link on the director's network (https://<computer>:4810/c/<key>), or from anywhere through showcallerstudio.com
  // (https://showcallerstudio.com/i/<room>/<key>), where the site passes the page through to the director's computer
  const anywhere = location.pathname.match(/^\/i\/([a-z0-9]{8,24})\/(d\/)?([A-Za-z0-9_-]+)/);
  const key = anywhere ? anywhere[3] : (location.pathname.match(/\/c\/([A-Za-z0-9_-]+)/) || [])[1] || '';
  const wsUrl = anywhere ? `${location.protocol === "http:" ? "ws" : "wss"}://${location.host}/intercom/ws?r=${anywhere[1]}&k=${encodeURIComponent(key)}` : `wss://${location.host}/ws?k=${encodeURIComponent(key)}`;
  let ice = []; // relay servers for the sound (only through showcallerstudio.com)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let ws = null, S = null, joined = false, mic = null, pc = null, bye = false, retry = 0, wake = null, lv = {};
  const talking = new Set(); // what this page is pressing right now (the app's state follows)

  // ---- connection to the director's computer ----
  function connect() {
    if (anywhere && anywhere[2]) { // the director link: that's for the iPad app
      $('joinBtn').hidden = true; $('joinName').textContent = 'Director link';
      $('joinShow').textContent = 'Open the Showcaller Intercom app on the iPad, tap Scan the crew QR code, and scan it there.'; $('joinNote').textContent = ''; return;
    }
    ws = new WebSocket(wsUrl);
    ws.onopen = () => { retry = 0; setConn('ok', 'Connected'); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'wait') { setConn('bad', 'Director offline'); $('joinShow').textContent = m.why || 'The director’s computer isn’t online right now.'; return; }
      if (m.t === 'hello') { if (Array.isArray(m.ice)) ice = m.ice; S = m.state; render(); $('joinBtn').disabled = false; $('joinName').textContent = S.name; $('joinShow').textContent = S.show ? `${S.show} · Showcaller Intercom` : 'Showcaller Intercom'; if (joined) startRtc(); }
      else if (m.t === 'state') { S = m.s; render(); }
      else if (m.t === 'answer' && pc) pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch((err) => console.warn(err));
      else if (m.t === 'lv') { lv = m.v || {}; meter(); }
      else if (m.t === 'bye') { bye = true; showBye(m.why); }
    };
    ws.onclose = () => {
      if (pc) { try { pc.close(); } catch {} pc = null; }
      if (bye) return;
      setConn('bad', 'Reconnecting…');
      setTimeout(connect, Math.min(5000, 800 * ++retry));
    };
  }
  const sendCmd = (c) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'cmd', c })); };
  function setConn(k, txt) { const c = $('conn'); c.className = `conn ${k}`; c.lastElementChild.textContent = txt; }
  function showBye(why) {
    setConn('bad', 'Disconnected');
    $('join').hidden = false; $('joinBtn').hidden = true;
    $('joinShow').textContent = why || 'The director closed the intercom.';
    $('joinNote').textContent = '';
    if (mic) mic.getTracks().forEach((t) => t.stop());
  }

  // ---- joining: the microphone and the sound back ----
  $('joinBtn').onclick = async () => {
    $('joinBtn').disabled = true;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      $('joinShow').textContent = 'The microphone isn’t allowed. Allow it for this page in your browser’s settings, then reload.';
      $('joinBtn').disabled = false; return;
    }
    joined = true; $('join').hidden = true;
    startSide();
    $('out').play().catch(() => {});
    keepAwake();
    startRtc();
  };
  async function startRtc() {
    if (pc) { try { pc.close(); } catch {} }
    const p = pc = new RTCPeerConnection({ iceServers: ice });
    if (mic) { const t = mic.getAudioTracks()[0]; t.enabled = talking.size > 0; p.addTrack(t, mic); } else p.addTransceiver('audio', { direction: 'recvonly' });
    p.ontrack = (e) => { const o = $('out'); o.srcObject = e.streams[0] || new MediaStream([e.track]); o.play().catch(() => {}); };
    p.onconnectionstatechange = () => {
      if (p !== pc) return;
      if (p.connectionState === 'connected') setConn('ok', 'On the intercom');
      else if (p.connectionState === 'failed') { setConn('bad', 'No sound: retrying…'); setTimeout(() => { if (p === pc && ws?.readyState === 1) startRtc(); }, 1500); }
    };
    await p.setLocalDescription(await p.createOffer());
    await new Promise((res) => { if (p.iceGatheringState === 'complete') return res(); const t = setTimeout(res, ice.length ? 3000 : 1500); p.addEventListener('icegatheringstatechange', () => { if (p.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
    if (p === pc && ws?.readyState === 1) ws.send(JSON.stringify({ t: 'offer', sdp: p.localDescription.sdp }));
  }
  async function keepAwake() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joined) { keepAwake(); $('out').play().catch(() => {}); } });

  // ---- talk keys: tap to keep talking, hold to talk only while held ----
  // sidetone: your own voice in your headphones while you talk, played on this phone (so it has no network delay)
  let side = null;
  const sideLevel = () => { try { return Math.max(0, Math.min(1, +(localStorage.getItem('ic.side') || 0) / 100)); } catch { return 0; } };
  function startSide() {
    try {
      const ctx = new AudioContext(), g = ctx.createGain();
      g.gain.value = 0; ctx.createMediaStreamSource(mic).connect(g).connect(ctx.destination);
      side = { ctx, g }; ctx.resume().catch(() => {});
    } catch {}
    $('side').value = Math.round(sideLevel() * 100);
  }
  function applySide() { if (side) side.g.gain.setTargetAtTime(talking.size ? sideLevel() : 0, side.ctx.currentTime, 0.01); }
  $('side').oninput = () => { try { localStorage.setItem('ic.side', $('side').value); } catch {} applySide(); };
  function setTalk(target, on) {
    if (on) talking.add(target); else talking.delete(target);
    if (mic) mic.getAudioTracks()[0].enabled = talking.size > 0;
    applySide();
    sendCmd({ op: 'talk', target, on });
    render();
  }
  function smart(el, target) {
    let down = null;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} down = { t: performance.now(), was: talking.has(target) }; if (!down.was) setTalk(target, true); });
    const up = () => { if (!down) return; const held = performance.now() - down.t; if (down.was || held > 350) setTalk(target, false); down = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- drawing ----
  const mainLine = () => S.lines.find((l) => l.talk && l.id === S.main) || S.lines.find((l) => l.talk); // the big button: the first line they talk on
  let built = '';
  function render() {
    if (!S) return;
    document.title = `${S.name} · Showcaller Intercom`;
    $('name').textContent = S.name;
    $('show').textContent = S.show ? `${S.show} · Showcaller Intercom` : 'Showcaller Intercom';
    // what the app says this page is talking on (after a reconnect, say)
    const T = $('tally'); T.hidden = !S.tally; T.className = `tally ${S.tally}`;
    T.innerHTML = S.tally === 'pgm' ? '<b>ON AIR</b><span>Program</span>' : S.tally === 'pvw' ? '<b>PREVIEW</b><span>You’re next</span>' : '';
    document.body.classList.toggle('pgm', S.tally === 'pgm');
    const C = $('cue'); C.hidden = !S.cue; C.className = `cue ${S.cue}`; C.textContent = S.cue === 'go' ? 'GO' : S.cue === 'standby' ? 'STAND BY' : '';
    const tm = $('toMe'); tm.hidden = !S.toMe.length; tm.textContent = S.toMe.length ? `${S.toMe.join(', ')} talking to you` : '';
    const m = S.msgs[S.msgs.length - 1];
    $('msg').hidden = !m;
    if (m) { $('msg').classList.toggle('done', m.seen); $('msgText').textContent = m.text; $('msgTime').textContent = m.time; $('msgSeen').onclick = () => sendCmd({ op: 'seen', id: m.id }); }
    // the line rows and talk buttons are rebuilt only when the lines change (so a press isn't interrupted)
    const shape = JSON.stringify([S.lines.map((l) => [l.id, l.name, l.color, l.talk]), !!S.program, S.talent, S.main, (S.ifbs || []).map((t) => [t.id, t.name])]);
    if (shape !== built) { build(); built = shape; }
    for (const l of S.lines) {
      const row = document.querySelector(`.ln[data-l="${l.id}"]`); if (!row) continue;
      const sub = row.querySelector('.tx span');
      sub.className = l.cue === 'standby' ? 'sb' : l.active.length ? 'act' : '';
      sub.textContent = l.cue === 'standby' ? 'Stand by' : l.cue === 'go' ? 'GO' : l.active.length ? `${l.active.join(', ')} talking` : l.on ? 'Quiet' : 'Not listening';
      row.querySelector('.lis').classList.toggle('on', l.on); row.querySelector('.lis').textContent = l.on ? 'LISTEN' : 'OFF';
      row.querySelector('.tk')?.classList.toggle('on', talking.has(`line:${l.id}`));
    }
    const pr = document.querySelector('.ln[data-l="pgm"]');
    if (pr && S.program) { pr.querySelector('.lis').classList.toggle('on', S.program.on); pr.querySelector('.lis').textContent = S.program.on ? 'ON' : 'OFF'; }
    $('sideRow').hidden = false;
    $('progVolRow').hidden = !(S.program && S.program.on);
    if (S.program && document.activeElement !== $('progVol')) $('progVol').value = Math.round(S.program.vol * 100);
    if (document.activeElement !== $('vol')) $('vol').value = Math.round(S.master * 100);
    const ml = mainLine();
    $('ptt').classList.toggle('on', !!ml && talking.has(`line:${ml.id}`));
    document.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', talking.has(b.dataset.t)));
  }
  function build() {
    const rows = S.lines.map((l) => `<div class="ln" data-l="${esc(l.id)}" style="--c:${esc(l.color)}"><div class="bar"></div><div class="tx"><b>${esc(l.name)}</b><span></span></div>${l.talk ? `<button type="button" class="tk">TALK</button>` : '<span></span>'}<button type="button" class="lis">LISTEN</button></div>`);
    if (S.program) rows.push(`<div class="ln" data-l="pgm" style="--c:#8d9099"><div class="bar"></div><div class="tx"><b>Program feed</b><span>The show’s sound</span></div><span></span><button type="button" class="lis">OFF</button></div>`);
    $('lines').innerHTML = rows.join('');
    S.lines.forEach((l) => {
      const row = document.querySelector(`.ln[data-l="${l.id}"]`);
      row.querySelector('.lis').onclick = () => sendCmd({ op: 'listen', line: l.id, on: !S.lines.find((x) => x.id === l.id).on });
      const tk = row.querySelector('.tk'); if (tk) smart(tk, `line:${l.id}`);
    });
    const pr = document.querySelector('.ln[data-l="pgm"] .lis'); if (pr) pr.onclick = () => sendCmd({ op: 'program', on: !S.program.on });
    const ml = mainLine(), other = S.lines.filter((l) => l.talk && l !== ml);
    $('ptt').hidden = !ml;
    if (ml) { $('pttLabel').textContent = 'Hold to talk'; $('pttSub').textContent = `${ml.name} · tap to keep talking`; }
    $('two').innerHTML = [...(other.length ? [`<button type="button" data-t="line:${esc(other[0].id)}">Talk on ${esc(other[0].name)}</button>`] : []), `<button type="button" data-t="to:dir">${S.talent ? 'Talk to the director' : 'Call the director'}</button>`,
      ...(S.ifbs || []).map((t) => `<button type="button" data-t="to:${esc(t.id)}">Talk to ${esc(t.name)}</button>`)].join('');
    $('two').querySelectorAll('[data-t]').forEach((b) => smart(b, b.dataset.t));
    $('foot').textContent = S.talent ? 'You hear the program and the director. Keep this page open.' : 'Keep this page open. The screen stays on while you’re on the intercom.';
  }
  let pttBound = false;
  function bindPtt() { if (pttBound) return; pttBound = true; let target = null; const el = $('ptt'); let down = null;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); const ml = mainLine(); if (!ml) return; target = `line:${ml.id}`; try { el.setPointerCapture(e.pointerId); } catch {} down = { t: performance.now(), was: talking.has(target) }; if (!down.was) setTalk(target, true); });
    const up = () => { if (!down) return; if (down.was || performance.now() - down.t > 350) setTalk(target, false); down = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindPtt();
  function meter() { $('pttLv').style.width = `${talking.size ? Math.round((lv.me || 0) * 100) : 0}%`; }
  $('vol').oninput = () => sendCmd({ op: 'master', vol: $('vol').value / 100 });
  $('progVol').oninput = () => sendCmd({ op: 'program', vol: $('progVol').value / 100 });

  if (!key) showBye('This link isn’t complete. Ask the director for it again.'); else connect();
})();
