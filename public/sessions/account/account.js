// Showcaller Sessions: your account. Sign in with an emailed link, then see every session the studio app added to your
// account: its guest and producer links, the plan (when, rundown, guests and their tech checks) and the takes, each with
// "Edit in browser" once the app has shared it, and "Invite an editor" to email someone that take's edit link.
(function () {
  'use strict';
  const U = window.SessionsUI, $ = (s) => document.querySelector(s), esc = (t) => U.esc(String(t ?? ''));
  U.theme($('#themeb'));
  U.injectIcons && U.injectIcons();
  const q = new URLSearchParams(location.search);
  const S = { me: null, rooms: [], sel: q.get('s') || '', view: null };

  async function call(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const o = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(o.error || `That didn’t work (${r.status})`), { status: r.status, signin: o.signin });
    return o;
  }
  const show = (id) => { for (const x of ['#signin', '#dash']) $(x).hidden = x !== id; };
  const when = (ms, tz) => { try { return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz, timeZoneName: 'short' } : {}) }); } catch { return new Date(ms).toLocaleString(); } };
  const len = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`; };
  const copyBtn = (text, label = 'Copy link') => `<button class="btn soft sm" data-copy="${esc(text)}">${esc(label)}</button>`;

  // signed out
  function signedOut() {
    show('#signin'); $('#me').hidden = $('#out').hidden = true;
    $('#form').hidden = false; $('#sent').hidden = true; $('#err').hidden = true;
  }
  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim(); $('#err').hidden = true; $('#send').disabled = true;
    try {
      const o = await call('/sessions/auth/start', { email });
      $('#form').hidden = true; $('#sent').hidden = false; $('#sentto').textContent = email;
      if (o.link) { window.__acctLink = o.link; } // tests only: the site isn't sending email
    } catch (er) { $('#err').textContent = er.message; $('#err').hidden = false; }
    $('#send').disabled = false;
  });
  $('#again').addEventListener('click', () => { $('#form').hidden = false; $('#sent').hidden = true; $('#email').focus(); });
  $('#out').addEventListener('click', async () => { try { await call('/sessions/auth/logout', {}); } catch {} location.href = '/sessions/account/'; });

  // signed in
  async function load() {
    try { S.me = await call('/sessions/acct/me'); }
    catch (er) { if (er.status === 401) return signedOut(); return fail('Your sessions didn’t load', er.message); }
    show('#dash'); $('#me').hidden = $('#out').hidden = false; $('#me').textContent = S.me.email;
    $('#appok').hidden = q.get('app') !== '1';
    S.rooms = [...S.me.rooms, ...(S.me.shared || [])].sort((a, b) => (b.created || 0) - (a.created || 0));
    if (!S.rooms.some((r) => r.id === S.sel)) S.sel = S.rooms[0]?.id || '';
    list();
    if (S.sel) open(S.sel); else $('#room').innerHTML = `<div class="card"><h2>No sessions yet</h2><p class="mute">Open the Showcaller Sessions app, go to Settings and sign in with ${esc(S.me.email)}. Your sessions move into your account and show up here.</p></div>`;
  }
  function list() {
    $('#list').innerHTML = S.rooms.length ? S.rooms.map((r) => `<button class="it${r.id === S.sel ? ' on' : ''}" data-room="${esc(r.id)}"><b>${esc(r.name)}</b><small>${r.shared ? `Shared by ${esc(r.by)}` : r.created ? `Made ${new Date(r.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</small></button>`).join('') : '<div class="none">No sessions yet</div>';
  }
  async function open(id) {
    S.sel = id; list();
    history.replaceState(null, '', `/sessions/account/?s=${id}`);
    $('#room').innerHTML = '<p class="mute">Loading…</p>';
    let v; try { v = await call(`/sessions/acct/room?id=${encodeURIComponent(id)}`); } catch (er) { $('#room').innerHTML = `<div class="card"><p class="acc-err">${esc(er.message)}</p></div>`; return; }
    if (S.sel !== id) return;
    S.view = v; room(v);
  }
  function room(v) {
    if (v.error) { $('#room').innerHTML = `<h1>${esc(v.name)}</h1><div class="card"><p class="acc-err">${esc(v.error)}</p></div>`; return; }
    const p = v.plan, ed = (() => { try { return localStorage.getItem('sess-ename') || ''; } catch { return ''; } })() || S.me.email.split('@')[0];
    const guests = p.guests.map((g) => {
      const c = g.check, tag = c ? (c.ok === false ? '<span class="tag warn">Tech check: problems</span>' : '<span class="tag ok">Tech check done</span>') : '<span class="tag">No tech check yet</span>';
      return `<div><div class="grow"><b>${esc(g.name || 'Guest')}</b>${g.role === 'producer' ? ' <span class="tag">Producer</span>' : ''}<small>${esc(g.email || 'No email')}${g.sent ? ` · invited ${new Date(g.sent).toLocaleDateString()}` : ''}</small></div>${tag}${copyBtn(g.link, 'Copy their link')}</div>`;
    }).join('');
    const takes = v.takes.map((t) => {
      const dur = !t.at ? '' : t.end ? len((t.end - t.at) / 1000) : 'Recording now';
      const who = t.people.length ? t.people.join(', ') : '';
      const edit = t.edit
        ? `<a class="btn sm" href="${esc(t.edit)}&name=${encodeURIComponent(ed)}" target="_blank" rel="noopener">Edit in browser</a>${copyBtn(t.edit, 'Copy edit link')}${v.shared ? '' : `<button class="btn soft sm" data-invite="${esc(t.id)}">Invite an editor</button>`}`
        : '<span class="tag" title="In the app: open this take in Edit and press Edit together">Share it from the app to edit here</span>';
      return `<div data-take="${esc(t.id)}"><div class="grow"><b>Take ${t.n || esc(t.id.slice(1))}${t.solo ? ' · solo' : ''}</b><small>${esc([t.at ? when(t.at) : '', dur, who, t.marks ? `${t.marks} mark${t.marks > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '))}</small></div>${edit}</div>`;
    }).join('');
    $('#room').innerHTML = `
      <h1>${esc(v.name)}</h1>${v.shared ? `<p class="mute">Shared with you by ${esc(v.by)}</p>` : ''}
      <div class="card"><h2 class="lbl">Links</h2>
        <div class="acc-row"><div class="grow"><b>Guest link</b><span class="acc-link">${esc(v.link)}</span></div>${copyBtn(v.link)}</div>
        <div class="acc-row"><div class="grow"><b>Producer link</b><span class="acc-link">Runs the room without being recorded</span></div>${copyBtn(v.producer)}</div></div>
      <div class="card"><h2 class="lbl">Plan</h2>
        <p class="mute">${p.at ? `${esc(when(p.at, p.tz))}${p.mins ? ` · ${p.mins} min` : ''}` : 'No time set yet. Plan the show in the app.'}</p>
        ${p.rundown.length ? `<ol class="acc-run">${p.rundown.map((x) => `<li>${esc(x.t)}${x.min ? ` (${x.min} min)` : ''}</li>`).join('')}</ol>` : ''}
        ${guests ? `<div class="acc-tbl" style="margin-top:12px">${guests}</div>` : ''}</div>
      <div class="card"><h2 class="lbl">Takes</h2>${takes ? `<div class="acc-tbl">${takes}</div>` : '<p class="mute">Nothing recorded yet.</p>'}</div>
      ${v.shared ? '' : `<div class="card" id="members"><h2 class="lbl">Shared with</h2>
        <p class="mute">A producer or client you add here signs in with their email and sees this session only: the plan, links and takes. Not your other sessions.</p>
        ${v.members.length ? `<div class="acc-tbl" style="margin-top:10px">${v.members.map((m) => `<div><div class="grow"><b>${esc(m.email)}</b></div><button class="btn soft sm" data-unshare="${esc(m.email)}">Remove</button></div>`).join('')}</div>` : ''}
        <form class="acc-inv" id="share" style="margin-top:10px"><input type="text" inputmode="email" placeholder="Their email" aria-label="Email of the person to share with" required><button class="btn sm">Share</button></form></div>`}`;
    const f = $('#share');
    if (f) f.onsubmit = async (ev) => {
      ev.preventDefault(); const email = f.querySelector('input').value.trim(), b = f.querySelector('button'); b.disabled = true;
      try { const o = await call('/sessions/acct/members', { room: v.id, email }); if (o.link) window.__shareLink = o.link; U.toast(`Shared with ${email}. They’ll get an email.`, 3000); open(v.id); }
      catch (er) { U.toast(er.message, 3500); b.disabled = false; }
    };
  }
  function fail(h, p) { show(''); const b = $('#msg'); b.hidden = false; b.innerHTML = `<h2>${esc(h)}</h2><p>${esc(p)}</p>`; }

  document.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-room]'); if (r) return open(r.dataset.room);
    const c = e.target.closest('[data-copy]');
    if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); U.toast('Copied'); } catch { prompt('Copy this link:', c.dataset.copy); } return; }
    const un = e.target.closest('[data-unshare]');
    if (un) { try { await call('/sessions/acct/members', { room: S.sel, email: un.dataset.unshare, remove: true }); U.toast('Removed'); open(S.sel); } catch (er) { U.toast(er.message, 3500); } return; }
    const iv = e.target.closest('[data-invite]');
    if (iv) {
      const row = iv.closest('[data-take]'); if (row.querySelector('.acc-inv')) return;
      const f = document.createElement('form'); f.className = 'acc-inv';
      f.innerHTML = '<input type="text" inputmode="email" placeholder="Editor’s email" aria-label="Editor’s email" required><button class="btn sm">Send</button><button type="button" class="btn soft sm">Cancel</button>';
      row.appendChild(f); f.querySelector('input').focus();
      f.querySelector('[type=button]').onclick = () => f.remove();
      f.onsubmit = async (ev) => {
        ev.preventDefault(); const email = f.querySelector('input').value.trim(), b = f.querySelector('button'); b.disabled = true;
        try { const o = await call('/sessions/acct/invite', { room: S.sel, take: row.dataset.take, email }); if (o.link) window.__inviteLink = o.link; f.remove(); U.toast(`Sent to ${email}`); }
        catch (er) { U.toast(er.message, 3500); b.disabled = false; }
      };
    }
  });

  load();
})();
