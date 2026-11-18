// Flagcast Manager: the tournament desk as a Mac and Windows app.
// Keeps the list of tournaments made on this computer (with their private desk keys), makes new ones,
// opens each one's desk, and puts a club screen's page full screen on any monitor plugged into this computer.
const { app, BrowserWindow, ipcMain, screen, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_BASE = 'https://flagcast.app';
const store = () => path.join(app.getPath('userData'), 'manager.json');
function load() { try { return JSON.parse(fs.readFileSync(store(), 'utf8')); } catch { return { base: DEFAULT_BASE, events: [] }; } }
function save(d) { fs.mkdirSync(path.dirname(store()), { recursive: true }); fs.writeFileSync(store(), JSON.stringify(d, null, 2)); }
let data = load();
const base = () => (data.base || DEFAULT_BASE).replace(/\/+$/, '');

let win = null;
const screenWins = new Map();

function goHome() { if (win) win.loadFile(path.join(__dirname, 'home.html')); }

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 900, minWidth: 900, minHeight: 600, title: 'Flagcast Manager', backgroundColor: '#123628',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'home.html'));
  // the desk's own links: Flagcast pages open in an app window (the cart cards print from there); anything else in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(base())) return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 800, autoHideMenuBar: true, webPreferences: { contextIsolation: true } } };
    shell.openExternal(url); return { action: 'deny' };
  });
  // on a desk page, add a way back to the list of tournaments
  win.webContents.on('did-finish-load', () => {
    const u = win.webContents.getURL();
    if (u.startsWith(base()) && /\/desk/.test(u)) {
      win.webContents.executeJavaScript(`(() => { if (document.getElementById('glm-back')) return;
        const b = document.createElement('button'); b.id = 'glm-back'; b.textContent = '‹ All tournaments';
        b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99;padding:8px 14px;border-radius:8px;border:1px solid #d3dacf;background:#fff;color:#14201a;font:600 13px system-ui;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.15)';
        b.onclick = () => window.gl && window.gl.home(); document.body.appendChild(b); })();`).catch(() => {});
    }
  });
  // leaving a desk with unsaved changes: ask, like a browser does
  win.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1, message: 'Leave without saving?', detail: 'This tournament has changes that are not saved yet.' });
    if (r === 0) e.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

function menu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'All tournaments', accelerator: 'CmdOrCtrl+Shift+H', click: goHome }, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { label: 'Screens', submenu: [{ label: 'Close all screens on this computer', accelerator: 'CmdOrCtrl+Shift+W', click: () => { for (const w of screenWins.values()) w.close(); } }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'flagcast.app', click: () => shell.openExternal('https://flagcast.app') }] },
  ]));
}

// ---- what the home page can ask for (only the app's own home page; the desk pages may only go home) ----
const own = (e) => { if (!String(e.senderFrame?.url || '').startsWith('file://')) throw new Error('Not allowed'); };
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { own(e); return fn(e, ...a); });
ipcMain.handle('gl:home', () => goHome());
handle('gl:list', () => ({ base: base(), events: data.events || [] }));
handle('gl:setBase', (_e, b) => { const u = String(b || '').trim().replace(/\/+$/, ''); if (!/^https?:\/\/[^\s/]+$/.test(u)) throw new Error('Use a web address like https://flagcast.app'); data.base = u; save(data); return base(); });
handle('gl:create', async (_e, { name, pass }) => {
  const r = await fetch(`${base()}/golf/api/new`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pass }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}`);
  const ev = { id: j.id, key: j.key, name: name || 'New tournament', added: Date.now() };
  data.events = [ev, ...(data.events || [])]; save(data);
  return ev;
});
handle('gl:add', async (_e, link) => {
  const m = String(link || '').match(/\/g\/([a-z0-9]{8})\/desk#([a-z0-9]{16,40})/i);
  if (!m) throw new Error('Paste the full desk link. It looks like …/g/abcd2345/desk#longkey');
  const id = m[1].toLowerCase(), key = m[2];
  const r = await fetch(`${base()}/golf/api/${id}/desk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, op: 'get' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'That desk link did not work.');
  data.events = [{ id, key, name: j.name || 'Tournament', date: j.date || '', added: Date.now() }, ...(data.events || []).filter((x) => x.id !== id)]; save(data);
  return data.events[0];
});
handle('gl:remove', (_e, id) => { data.events = (data.events || []).filter((x) => x.id !== id); save(data); return true; });
// refresh names, dates and screens from the server
handle('gl:info', async (_e, id) => {
  const ev = (data.events || []).find((x) => x.id === id); if (!ev) throw new Error('Not found');
  const r = await fetch(`${base()}/golf/api/${id}/desk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: ev.key, op: 'get' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}`);
  ev.name = j.name || ev.name; ev.date = j.date || ''; ev.club = j.club || ''; save(data);
  return { id, name: ev.name, date: ev.date, club: ev.club, teams: (j.teams || []).length, displays: (j.displays || []).map((d) => ({ id: d.id, name: d.name })), locked: !!j.locked };
});
handle('gl:openDesk', (_e, id) => {
  const ev = (data.events || []).find((x) => x.id === id); if (!ev) return;
  win.loadURL(`${base()}/g/${id}/desk#${ev.key}`);
});
handle('gl:openLive', (_e, id) => shell.openExternal(`${base()}/g/${id}`));
handle('gl:monitors', () => screen.getAllDisplays().map((d, i) => ({ i, id: d.id, label: d.label || `Display ${i + 1}`, w: d.size.width, h: d.size.height, primary: d.id === screen.getPrimaryDisplay().id })));
// a club screen's page, full screen on one monitor of this computer
handle('gl:openScreen', (_e, { id, screenId, monitor }) => {
  const d = screen.getAllDisplays().find((x) => x.id === monitor) || screen.getPrimaryDisplay();
  const k = `${id}:${screenId || 'all'}:${d.id}`;
  if (screenWins.has(k)) { screenWins.get(k).focus(); return; }
  const w = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, fullscreen: true, frame: false, backgroundColor: '#000', autoHideMenuBar: true, title: 'Flagcast screen', webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  w.loadURL(`${base()}/g/${id}/board${screenId ? `?screen=${encodeURIComponent(screenId)}` : ''}`);
  w.webContents.on('before-input-event', (e, input) => { if (input.key === 'Escape') w.close(); });
  w.on('closed', () => screenWins.delete(k));
  screenWins.set(k, w);
});

app.setName('Flagcast Manager');
app.whenReady().then(() => { menu(); createWindow(); app.on('activate', () => { if (!win) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
