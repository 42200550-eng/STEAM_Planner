const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopRuntime', {
  platform: process.platform,
  isDesktop: true,
  listComPorts: () => ipcRenderer.invoke('desktop:list-com-ports'),
  connectComPort: (options) => ipcRenderer.invoke('desktop:connect-com-port', options),
  disconnectComPort: () => ipcRenderer.invoke('desktop:disconnect-com-port'),
  sendComCommand: (command) => ipcRenderer.invoke('desktop:send-com-command', command),
  getComStatus: () => ipcRenderer.invoke('desktop:get-com-status'),
  debugIngestSignal: (line) => ipcRenderer.invoke('desktop:debug-ingest-signal', line),
});
