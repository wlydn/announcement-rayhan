'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// API hanya dibuka untuk halaman lokal (setup/offline). Situs Vercel tidak mendapat akses apa pun.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('desktop', {
    getUrl: () => ipcRenderer.invoke('desktop:get-url'),
    saveUrl: (url) => ipcRenderer.invoke('desktop:save-url', String(url || '')),
    retry: () => ipcRenderer.invoke('desktop:retry'),
    changeUrl: () => ipcRenderer.invoke('desktop:change-url'),
  });
}
