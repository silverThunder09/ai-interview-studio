import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type DesktopAPI, type Settings } from '../shared/contracts';

const api: DesktopAPI = Object.freeze({
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.snapshot),
  updateSettings: (settings: Settings) => ipcRenderer.invoke(CHANNELS.settings, settings),
});
contextBridge.exposeInMainWorld('studio', api);
