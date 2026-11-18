const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gl', {
  home: () => ipcRenderer.invoke('gl:home'),
  list: () => ipcRenderer.invoke('gl:list'),
  setBase: (b) => ipcRenderer.invoke('gl:setBase', b),
  create: (o) => ipcRenderer.invoke('gl:create', o),
  add: (link) => ipcRenderer.invoke('gl:add', link),
  remove: (id) => ipcRenderer.invoke('gl:remove', id),
  info: (id) => ipcRenderer.invoke('gl:info', id),
  openDesk: (id) => ipcRenderer.invoke('gl:openDesk', id),
  openLive: (id) => ipcRenderer.invoke('gl:openLive', id),
  monitors: () => ipcRenderer.invoke('gl:monitors'),
  openScreen: (o) => ipcRenderer.invoke('gl:openScreen', o),
});
