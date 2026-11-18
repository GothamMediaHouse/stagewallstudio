// Flagcast phone app: when a page runs inside the app (its user agent says FlagcastApp), add a small bar
// to get home and switch between the scorecard and the leaderboard. Every page also remembers the tournament
// so the app's home screen can list it.
import { eventId, esc } from '/golf/client.js';

export const inApp = /FlagcastApp/.test(navigator.userAgent);
const RKEY = 'flagcast:recent';

export function remember(name, code = '') {
  const id = eventId(); if (!id) return;
  try {
    const all = JSON.parse(localStorage.getItem(RKEY) || '[]');
    const prev = all.find((r) => r.id === id);
    const list = [{ id, name, code: code || prev?.code || '', at: Date.now() }, ...all.filter((r) => r.id !== id)];
    localStorage.setItem(RKEY, JSON.stringify(list.slice(0, 10)));
  } catch {}
}

export function appBar(here) {
  if (!inApp) return;
  document.documentElement.classList.add('in-app');
  const id = eventId();
  let code = '';
  try { code = (JSON.parse(localStorage.getItem(RKEY) || '[]').find((r) => r.id === id) || {}).code || ''; } catch {}
  const top = document.querySelector('.topbar'); if (!top) return;
  const nav = document.createElement('nav');
  nav.className = 'appnav'; nav.setAttribute('aria-label', 'App');
  const link = (href, text, on) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${esc(text)}</a>`;
  nav.innerHTML = link('/golf/app/', '‹ Home') + '<span>' + (code ? link(`/g/${id}/s/${code}`, 'Scorecard', here === 'score') : '') + link(`/g/${id}`, 'Leaderboard', here === 'live') + '</span>';
  top.prepend(nav);
  const st = document.createElement('style');
  st.textContent = `.in-app .topbar{padding-top:calc(10px + env(safe-area-inset-top,0px))}
.appnav{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 10px;font-size:.85rem}
.appnav span{display:flex;gap:6px}
.appnav a{color:var(--on-green-muted);text-decoration:none;padding:4px 10px;border-radius:999px;border:1px solid transparent}
.appnav span a{border-color:rgba(238,243,236,.25)}
.appnav a[aria-current="page"]{background:var(--flag);color:var(--on-flag);border-color:var(--flag)}`;
  document.head.appendChild(st);
}
