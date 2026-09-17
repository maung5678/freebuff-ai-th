const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('manager', {
  overview: () => ipcRenderer.invoke('overview'),
  run: (action, payload) => ipcRenderer.invoke('run', action, payload),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: (kind) => ipcRenderer.invoke('install-update', kind),
  onChanged: (fn) => ipcRenderer.on('changed', () => fn()),
})
