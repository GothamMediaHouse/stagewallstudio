// Showcaller Sessions: editing a take together in a browser. The studio app shares a take (a small preview video and the
// transcript); anyone with the link reads it as text, cuts words like a document, and every change goes to everyone
// editing, including the app, which keeps the full-quality files and makes the real edit from the same list of cuts.
// transcript.js is the app's lib/transcript.js (keep the two copies identical), so both cut in exactly the same places.
(function () {
  'use strict';
  const T = window.SessionsText, U = window.SessionsUI, $ = (s) => document.querySelector(s);
  const m = /^\/s\/([a-z0-9]{8,24})\/edit\/(t\d{2,4})\/?$/.exec(location.pathname) || [];
  const room = m[1], take = m[2], q = new URLSearchParams(location.search), key = q.get('k') || '';
  const media = (f) => `/sessions/editmedia?r=${room}&take=${take}&k=${encodeURIComponent(key)}&f=${f}`;
  const tm = (t) => T.hms(t);
  const S = { cuts: [], rev: 0, undo: [], redo: [], words: [], names: {}, end: 0, who: [], playing: false, me: '', people: [], at: {} };
  let ws = null, retry = 0, spans = [];
  U.theme($('#themeb'));
  U.injectIcons && U.injectIcons();

  const name = (() => {
    let n = q.get('name'); try { n = n || localStorage.getItem('sess-ename'); } catch {}
    if (!n) n = (prompt('Your name, so the others can see who’s editing:') || '').trim();
    n = (n || 'Editor').slice(0, 40); try { localStorage.setItem('sess-ename', n); } catch {}
    return n;
  })();

  function fail(h, p) { $('#main').hidden = true; const b = $('#msg'); b.hidden = false; b.innerHTML = `<h2>${U.esc(h)}</h2><p>${U.esc(p)}</p>`; $('#live').textContent = ''; }

  async function start() {
    if (!room || !take || key.length !== 32) return fail('This link isn’t complete', 'Ask whoever sent it for the whole link.');
    let d;
    try { const r = await fetch(media('data')); if (r.status === 403) return fail('This edit link isn’t good any more', 'Ask for a new one from the studio.'); if (!r.ok) throw new Error(r.status); d = await r.json(); }
    catch { return fail('This take isn’t ready yet', 'The studio is still putting it up. Try again in a minute.'); }
    S.words = d.words || []; S.names = d.names || {}; S.end = d.end || (S.words.length ? S.words[S.words.length - 1].e + 1 : 0); S.who = d.who || [];
    $('#ttl').textContent = d.title || 'Edit together'; document.title = `${d.title || 'Edit'} · Showcaller Sessions`;
    $('#main').hidden = false;
    $('#v').src = media('proxy');
    drawText(); lengths(); connect(); tick();
  }

  // ---------- the live edit ----------
  function connect() {
    const u = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sessions/editws?r=${room}&take=${take}&k=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`;
    ws = new WebSocket(u);
    ws.onopen = () => { retry = 0; live(true); };
    ws.onclose = (ev) => {
      live(false);
      if (ev.code === 4003) return fail('This edit link isn’t good any more', 'Ask for a new one from the studio.');
      setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
    };
    ws.onmessage = (ev) => {
      let o; try { o = JSON.parse(ev.data); } catch { return; }
      if (o.t === 'doc') { S.me = o.me; S.rev = o.rev; S.cuts = T.norm(o.cuts || []); for (const [i, w] of Object.entries(o.fixes || {})) fixWord(+i, w); marks(); lengths(); }
      else if (o.t === 'cuts') { const before = new Set(spans.filter((s) => s.classList.contains('x')).map((s) => s.dataset.i)); S.rev = o.rev; S.cuts = T.norm(o.cuts); marks(); lengths(); flash(before); if (o.by) U.toast(`${o.by} changed the edit`, 1500); }
      else if (o.t === 'ack') S.rev = o.rev;
      else if (o.t === 'fix') fixWord(o.i, o.w);
      else if (o.t === 'people') { S.people = o.list || []; drawPeople(); }
      else if (o.t === 'at') { S.at[o.id] = o.tk; theirs(); }
    };
  }
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  function live(on) { const l = $('#live'); l.textContent = on ? 'Live' : 'Reconnecting…'; l.className = `elive ${on ? 'on' : 'off'}`; }
  function drawPeople() {
    $('#people').innerHTML = S.people.map((p) => `<div class="ep" title="${U.esc(p.name)}${p.id === S.me ? ' (you)' : ''}${p.app ? ' · in the studio app' : ''}"><i class="av" style="${U.avStyle(p.id)}">${U.esc(U.initials(p.name))}</i><span>${U.esc(p.name)}${p.id === S.me ? ' (you)' : p.app ? ' · studio' : ''}</span></div>`).join('');
    for (const id of Object.keys(S.at)) if (!S.people.some((p) => p.id === id)) delete S.at[id];
    theirs();
  }
  function flash(before) { for (const s of spans) if (s.classList.contains('x') !== before.has(s.dataset.i)) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); } }

  // ---------- the edit (same rules as the app's editor) ----------
  const keeps = () => T.keeps(S.cuts, S.end);
  function change(cuts) { S.undo.push(JSON.stringify(S.cuts)); if (S.undo.length > 200) S.undo.shift(); S.redo = []; S.cuts = T.norm(cuts); changed(); }
  function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.cuts)); S.cuts = JSON.parse(S.undo.pop()); changed(); }
  function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.cuts)); S.cuts = JSON.parse(S.redo.pop()); changed(); }
  function changed() { marks(); lengths(); send({ t: 'cuts', cuts: S.cuts }); }
  function lengths() {
    const mm = T.mapper(keeps());
    $('#len').textContent = S.cuts.length ? `Edit ${tm(mm.total)} of ${tm(S.end)} · ${S.cuts.length} cut${S.cuts.length === 1 ? '' : 's'}` : `${tm(S.end)} · nothing cut yet`;
    $('#dur').textContent = tm(mm.total); $('#undo').disabled = !S.undo.length; $('#redo').disabled = !S.redo.length;
  }
  function selected() {
    const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0), idx = [];
    for (const s of spans) if (r.intersectsNode(s)) idx.push(Number(s.dataset.i));
    return idx.length ? [idx[0], idx[idx.length - 1]] : null;
  }
  const without = (a, b) => { const out = []; for (const [x, y] of S.cuts) { if (y <= a || x >= b) out.push([x, y]); else { if (x < a) out.push([x, a]); if (y > b) out.push([b, y]); } } return out; };
  function cutSelection(restore) {
    const s = selected(); if (!s) return U.toast('Select some words first');
    const [a, b] = T.cutWords(S.words, s[0], s[1], restore ? [] : S.cuts);
    change(restore ? without(a, b) : [...S.cuts, [a, b]]);
    getSelection().removeAllRanges();
  }
  function toggle(a, b) { const inside = S.cuts.some(([x, y]) => x <= a + 0.01 && y >= b - 0.01); change(inside ? without(a, b) : [...S.cuts, [a, b]]); }

  // ---------- transcript ----------
  function drawText() {
    const html = [];
    for (const p of T.paragraphs(S.words)) {
      const nm = S.names[p.sp] || 'Someone';
      html.push(`<div class="pp"><div class="ph"><span class="av" style="${U.avStyle(p.sp)}">${U.esc(U.initials(nm))}</span><b>${U.esc(nm)}</b><button class="tcb" data-t="${p.s}">${tm(p.s)}</button></div><p>`);
      for (let k = p.from; k <= p.to; k++) {
        const w = S.words[k], prev = S.words[k - 1];
        if (prev && w.s - prev.e > 1.5) html.push(`<span class="gap" data-a="${(prev.e + 0.25).toFixed(3)}" data-b="${(w.s - 0.25).toFixed(3)}" title="A pause; click to cut it">⋯ ${(w.s - prev.e).toFixed(1)} s</span> `);
        html.push(`<span class="w${T.isFiller(w.w) ? ' fl' : ''}" data-i="${k}">${U.esc(w.w)}</span> `);
      }
      html.push('</p></div>');
    }
    const tx = $('#tx'); tx.innerHTML = html.join('') || '<p class="hint">There’s no transcript for this take yet.</p>';
    spans = [...tx.querySelectorAll('.w')];
    tx.onclick = (ev) => {
      const w = ev.target.closest('.w'), g = ev.target.closest('.gap'), t = ev.target.closest('.tcb');
      if (g) return toggle(Number(g.dataset.a), Number(g.dataset.b));
      if (t) return seek(Number(t.dataset.t));
      if (w && getSelection().isCollapsed) seek(S.words[Number(w.dataset.i)].s);
    };
    tx.ondblclick = (ev) => {
      const w = ev.target.closest('.w'); if (!w) return;
      const i = Number(w.dataset.i), v = prompt('Change this word (the timing stays):', S.words[i].w);
      if (v && v.trim() && v.trim() !== S.words[i].w) { fixWord(i, v.trim()); send({ t: 'fix', i, w: v.trim() }); }
    };
    const fill = T.fillerCuts(S.words), pauses = T.pauseCuts(S.words, 1.5, 0.5);
    $('#fill').textContent = `Cut “um”s (${fill.length})`; $('#fill').disabled = !fill.length;
    $('#pause').textContent = `Shorten pauses (${pauses.length})`; $('#pause').disabled = !pauses.length;
    $('#fill').onclick = () => { change([...S.cuts, ...fill]); U.toast(`${fill.length} filler words cut`); };
    $('#pause').onclick = () => { change([...S.cuts, ...pauses]); U.toast(`${pauses.length} pauses shortened to half a second`); };
    marks();
  }
  function fixWord(i, w) { if (!S.words[i]) return; S.words[i].w = w; const s = spans[i]; if (s && Number(s.dataset.i) === i) s.textContent = w; }
  function marks() {
    for (const s of spans) s.classList.toggle('x', T.isCut(S.cuts, S.words[Number(s.dataset.i)]));
    for (const g of document.querySelectorAll('.tx .gap')) { const a = Number(g.dataset.a), b = Number(g.dataset.b); g.classList.toggle('x', S.cuts.some(([x, y]) => x <= a + 0.01 && y >= b - 0.01)); }
  }
  const wordAt = (t) => { let lo = 0, hi = S.words.length - 1, f = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (S.words[mid].s <= t) { f = mid; lo = mid + 1; } else hi = mid - 1; } return f >= 0 && t <= S.words[f].e + 0.25 ? f : -1; };
  function theirs() {
    for (const s of document.querySelectorAll('.tx .w.them')) { s.classList.remove('them'); s.removeAttribute('title'); }
    for (const [id, tk] of Object.entries(S.at)) {
      const p = S.people.find((x) => x.id === id), i = wordAt(tk); if (!p || i < 0 || !spans[i]) continue;
      spans[i].classList.add('them'); spans[i].title = `${p.name} is here`;
    }
  }

  // ---------- playback: the preview video, jumping over the cuts ----------
  const v = $('#v');
  function fromEdit(ks, t) { let acc = 0; for (const [a, b] of ks) { if (t <= acc + (b - a)) return a + (t - acc); acc += b - a; } return S.end; }
  function seek(t) { v.currentTime = Math.max(0, Math.min(S.end, t)); sayAt(true); }
  function play() { const c = S.cuts.find(([a, b]) => v.currentTime >= a - 0.005 && v.currentTime < b); if (c) v.currentTime = c[1]; v.play().catch(() => {}); }
  function stop() { v.pause(); }
  v.onplay = () => { S.playing = true; $('#play use').setAttribute('href', '#e-pause'); };
  v.onpause = () => { S.playing = false; $('#play use').setAttribute('href', '#e-play'); sayAt(true); };
  $('#play').onclick = () => (S.playing ? stop() : play());
  $('#scrub').oninput = (ev) => { const ks = keeps(), mm = T.mapper(ks); seek(fromEdit(ks, (ev.target.value / 1000) * mm.total)); };
  let lastAt = 0, nowI = -1;
  function sayAt(force) { const n = Date.now(); if (force || n - lastAt > 1000) { lastAt = n; send({ t: 'at', tk: v.currentTime }); } }
  function tick() {
    const t = v.currentTime;
    if (S.playing) {
      const c = S.cuts.find(([a, b]) => t >= a - 0.005 && t < b);
      if (c) { if (c[1] >= S.end - 0.05) stop(); else v.currentTime = c[1]; }
      sayAt(false);
    }
    const i = wordAt(t);
    if (i !== nowI) { if (spans[nowI]) spans[nowI].classList.remove('now'); if (spans[i]) { spans[i].classList.add('now'); if (S.playing) spans[i].scrollIntoView({ block: 'nearest' }); } nowI = i; }
    const ks = keeps(), mm = T.mapper(ks), et = mm.toEdit ? mm.toEdit(t) : editTime(ks, t);
    $('#tc').textContent = tm(et); if (document.activeElement !== $('#scrub')) $('#scrub').value = mm.total ? Math.round((et / mm.total) * 1000) : 0;
    const w = S.who.length ? S.who.filter(([a]) => a <= t).pop() : null, who = $('#who');
    if (w && S.names[w[1]]) { who.hidden = false; who.textContent = S.names[w[1]]; } else who.hidden = true;
    requestAnimationFrame(tick);
  }
  function editTime(ks, t) { let acc = 0; for (const [a, b] of ks) { if (t < a) return acc; if (t <= b) return acc + (t - a); acc += b - a; } return acc; }

  $('#cut').onclick = () => cutSelection(false);
  $('#restore').onclick = () => cutSelection(true);
  $('#undo').onclick = undo; $('#redo').onclick = redo;
  $('#find').oninput = (ev) => {
    const q2 = ev.target.value.trim().toLowerCase(); let first = null;
    for (const s of spans) { const hit = !!q2 && s.textContent.toLowerCase().includes(q2); s.classList.toggle('hit', hit); if (hit && !first) first = s; }
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  addEventListener('keydown', (ev) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return;
    if (ev.key === ' ') { ev.preventDefault(); S.playing ? stop() : play(); }
    else if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected()) { ev.preventDefault(); cutSelection(false); }
    else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
  });
  window.__edit = S;
  start();
})();
