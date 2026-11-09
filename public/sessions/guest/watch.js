// Showcaller Sessions 1.9: the watch page (/s/<room>/watch). The show's picture and sound come straight from the host's
// app (WebRTC, one connection per viewer). A viewer can ask to come on; if the host brings them on, they go to the guest
// page already let in (same browser id), and join the show like any guest.
(function () {
  'use strict';
  const C = window.SessionsCore, U = window.SessionsUI, $ = (s) => document.querySelector(s);
  U.injectIcons(); U.theme($('#themeb'));
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const room = (location.pathname.match(/^\/s\/([a-z0-9]{8,24})/) || [])[1];
  let pid = store.get(`sess-pid-${room}`); if (!/^[a-z0-9]{8,16}$/.test(pid || '')) { pid = C.rid(12); store.set(`sess-pid-${room}`, pid); }
  const v = $('#wv'), over = (msg, btn) => { $('#wover').hidden = !msg; const pb = $('#wplay'); if (pb && msg !== 'Press play to watch with sound') pb.hidden = true; $('#wmsg').textContent = msg || ''; const sp = $('#wover .spin'); if (sp) sp.hidden = !!btn; };
  $('#wn').value = store.get('sess-name') || '';
  let ws = null, pc = null, ice = [], hand = false, tries = 0, closed = false;
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  function connect() {
    const name = $('#wn').value.trim() || 'Viewer';
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sessions/watch?r=${room}&pid=${pid}&name=${encodeURIComponent(name)}`);
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onmsg(m); };
    ws.onclose = (e) => {
      if (closed) return; drop(); $('#hand').disabled = true;
      if (e.code === 4004 || e.code === 4005 || e.code === 4002 || e.code === 4003) { over(e.reason || 'This show isn’t open to watch', true); return; }
      over('Reconnecting…'); setTimeout(connect, Math.min(10000, 1000 * ++tries));
    };
  }
  setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 25000);
  function drop() { if (pc) { try { pc.close(); } catch {} pc = null; } $('#wlive').hidden = true; }
  function onmsg(m) {
    if (m.t === 'ahello') {
      tries = 0; ice = m.ice || []; $('#wshow').textContent = m.name || ''; $('#wtitle').textContent = (m.brand && m.brand.name) || m.name || 'Showcaller Sessions';
      if (m.brand && m.brand.logo) $('#blogo').innerHTML = `<img src="${m.brand.logo}" alt="" style="max-height:28px;max-width:120px">`;
      if (m.brand && m.brand.color) document.documentElement.style.setProperty('--v', m.brand.color);
      $('#hand').disabled = false;
      if (m.host) want(); else over('The show hasn’t started yet. It appears here when it does.', true);
    } else if (m.t === 'host') { if (m.online) want(); else { drop(); over('The show is paused. Stay here; it comes back on its own.', true); } }
    else if (m.t === 'asig') sig(m.data);
    else if (m.t === 'callin') {
      closed = true; store.set('sess-name', $('#wn').value.trim() || store.get('sess-name') || '');
      over('You’re coming on! Getting your camera and mic ready…'); drop(); try { ws.close(); } catch {}
      setTimeout(() => { location.href = `/s/${room}?from=watch`; }, 800);
    }
  }
  function want() { drop(); over('Starting the picture…'); send({ t: 'asig', data: { want: true } }); }
  async function sig(d) {
    if (d.offer) {
      drop();
      pc = new RTCPeerConnection({ iceServers: ice });
      pc.ontrack = (e) => { if (v.srcObject !== e.streams[0]) { v.srcObject = e.streams[0]; play(); } };
      pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'asig', data: { ice: e.candidate } }); };
      pc.onconnectionstatechange = () => { if (pc && pc.connectionState === 'failed') want(); };
      await pc.setRemoteDescription(d.offer);
      const a = await pc.createAnswer(); await pc.setLocalDescription(a);
      send({ t: 'asig', data: { answer: pc.localDescription } });
      for (const c of pc.early || []) pc.addIceCandidate(c).catch(() => {});
    } else if (d.ice && pc) { if (pc.remoteDescription) pc.addIceCandidate(d.ice).catch(() => {}); else (pc.early ||= []).push(d.ice); }
    else if (d.bye) { drop(); over('The show is paused. Stay here; it comes back on its own.', true); }
  }
  async function play() {
    try { v.muted = false; await v.play(); over(''); $('#wlive').hidden = false; }
    catch {
      // the browser wants a click before it plays sound
      over('Press play to watch with sound', true);
      let b = $('#wplay'); if (!b) { b = document.createElement('button'); b.className = 'btn big'; b.id = 'wplay'; b.textContent = 'Watch with sound'; $('#wover').appendChild(b); }
      b.hidden = false; b.onclick = () => { v.muted = false; v.play().then(() => { b.hidden = true; over(''); $('#wlive').hidden = false; }); };
    }
  }
  $('#hand').onclick = () => {
    hand = !hand; const n = $('#wn').value.trim(); if (n) { store.set('sess-name', n); send({ t: 'name', name: n }); }
    send({ t: 'hand', on: hand }); $('#hand').textContent = hand ? 'Put your hand down' : 'Ask to come on';
    $('#whint').textContent = hand ? 'The host can see you’d like to come on. Keep this page open.' : 'If the host brings you on, you’ll join the show with your camera and mic.';
  };
  $('#wn').onchange = () => { const n = $('#wn').value.trim(); if (n) { store.set('sess-name', n); send({ t: 'name', name: n }); } };
  if (!room) over('This link isn’t right', true); else connect();
})();
