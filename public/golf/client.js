// Flagcast pages: which tournament this page is for, and its live state from the server.
export const eventId = () => (location.pathname.match(/^\/g\/([a-z0-9]{8})/) || [])[1] || new URLSearchParams(location.search).get('e') || '';
export const api = (op) => `/golf/api/${eventId()}/${op}`;

export async function post(op, body) {
  const r = await fetch(api(op), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || `The server answered ${r.status}`); e.status = r.status; throw e; }
  return j;
}

// calls onState(state) now and after every change; onLink(true/false) when the live link comes and goes
export function live(onState, onLink = () => {}, opts = {}) {
  let ws, tries = 0, ping, stopped = false;
  const open = () => {
    if (stopped) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${api('ws')}${opts.screen ? `?screen=${encodeURIComponent(opts.screen)}` : ''}`);
    ws.onopen = () => { tries = 0; onLink(true); clearInterval(ping); ping = setInterval(() => { try { ws.send('ping'); } catch {} }, 25000); };
    ws.onmessage = (e) => { if (e.data === 'pong') return; try { const m = JSON.parse(e.data); if (m.t === 'state') onState(m.s); } catch {} };
    ws.onclose = () => { onLink(false); clearInterval(ping); setTimeout(open, Math.min(15000, 1000 * 2 ** tries++)); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };
  // a first copy straight away, in case the live link is slow to start
  fetch(api('state'), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(r))).then(onState).catch(() => {});
  open();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ws && ws.readyState > 1) { tries = 0; open(); } });
  return () => { stopped = true; try { ws.close(); } catch {} };
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
