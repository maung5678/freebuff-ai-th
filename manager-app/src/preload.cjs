const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('manager', {
  overview: () => ipcRenderer.invoke('overview'),
  activityLog: () => ipcRenderer.invoke('activity-log'),
  recordError: (message) => ipcRenderer.invoke('record-error', message),
  run: (action, payload) => ipcRenderer.invoke('run', action, payload),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  updateAll: () => ipcRenderer.invoke('update-all'),
  onChanged: (fn) => ipcRenderer.on('changed', () => fn()),
  onActivityLog: (fn) => ipcRenderer.on('activity-log', (_event, entry) => fn(entry)),
})
