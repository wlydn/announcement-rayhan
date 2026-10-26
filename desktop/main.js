'use strict';

const { app, BrowserWindow, Menu, Tray, ipcMain, shell, session, powerSaveBlocker, nativeImage } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const { readConfig, writeConfig, normalizeUrl, getAppUrl } = require('./config');

const APP_TITLE = 'Announcement IT Rayhan';
const ICON_PATH = path.join(__dirname, 'build', 'icon.ico');

// True hanya untuk file di dalam folder desktop/ (setup.html, offline.html).
// Dibandingkan sebagai path, bukan string URL: Electron bisa melaporkan "D:" sedangkan kita menyusun "d:".
function isOwnPageUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const normalize = (p) => {
      const resolved = path.resolve(p);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const root = normalize(__dirname) + path.sep;
    return normalize(fileURLToPath(parsed)).startsWith(root);
  } catch (error) {
    return false;
  }
}

// Pemutaran jadwal harus jalan tanpa menunggu klik pengguna.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let powerBlockerId = null;
let appOrigin = null;
let awaitingInitialLoad = false;
let trayHintShown = false;

// ---------- Memuat halaman ----------

function loadApp() {
  if (!mainWindow) return;
  const url = getAppUrl();
  if (!url) {
    mainWindow.loadFile(path.join(__dirname, 'setup.html'));
    return;
  }
  awaitingInitialLoad = true;
  mainWindow.loadURL(url).catch(() => {
    // Kegagalan ditangani oleh event did-fail-load.
  });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showSetup() {
  if (!mainWindow) return;
  mainWindow.loadFile(path.join(__dirname, 'setup.html'));
  showWindow();
}

function guardNavigation(event, targetUrl) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch (error) {
    event.preventDefault();
    return;
  }

  if (target.protocol === 'file:') {
    if (!isOwnPageUrl(targetUrl)) event.preventDefault();
    return;
  }

  if (appOrigin && target.origin === appOrigin) return;

  event.preventDefault();
  if (target.protocol === 'https:' || target.protocol === 'http:') shell.openExternal(targetUrl);
}

// ---------- Jendela ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: APP_TITLE,
    icon: ICON_PATH,
    backgroundColor: '#e8f2f4',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Penjadwal adzan/announcement berjalan di halaman; jangan diperlambat saat jendela tersembunyi.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  const contents = mainWindow.webContents;

  mainWindow.once('ready-to-show', () => mainWindow.show());

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', guardNavigation);

  contents.on('did-navigate', (_event, url) => {
    if (!awaitingInitialLoad || !/^https?:/i.test(url)) return;
    awaitingInitialLoad = false;
    try {
      appOrigin = new URL(url).origin;
    } catch (error) {
      appOrigin = null;
    }
  });

  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    // -3 = dibatalkan (mis. pindah halaman); bukan kegagalan jaringan.
    if (!isMainFrame || errorCode === -3) return;
    awaitingInitialLoad = false;
    mainWindow.loadFile(path.join(__dirname, 'offline.html'), { query: { reason: errorDescription || '' } });
  });

  contents.on('render-process-gone', () => {
    setTimeout(loadApp, 1000);
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (tray && !trayHintShown && typeof tray.displayBalloon === 'function') {
      trayHintShown = true;
      tray.displayBalloon({
        title: APP_TITLE,
        content: 'Aplikasi tetap berjalan di latar belakang agar jadwal adzan dan pengumuman tidak terlewat.',
      });
    }
  });
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

// ---------- Menu dan tray ----------

function buildMenu() {
  const template = [
    {
      label: 'Aplikasi',
      submenu: [
        { label: 'Muat ulang', accelerator: 'CmdOrCtrl+R', click: () => loadApp() },
        {
          label: 'Layar penuh',
          accelerator: 'F11',
          click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()),
        },
        { type: 'separator' },
        { label: 'Ubah alamat server...', click: () => showSetup() },
        {
          label: 'Jalankan saat Windows menyala',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          enabled: app.isPackaged,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        { type: 'separator' },
        { label: 'Keluar', accelerator: 'CmdOrCtrl+Q', click: () => quitApp() },
      ],
    },
  ];
  if (!app.isPackaged) template.push({ label: 'Dev', submenu: [{ role: 'toggleDevTools' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Buka', click: () => showWindow() },
      { label: 'Muat ulang', click: () => loadApp() },
      { type: 'separator' },
      { label: 'Keluar', click: () => quitApp() },
    ]),
  );
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
    else showWindow();
  });
}

// ---------- IPC (hanya dari halaman lokal setup/offline) ----------

function fromOwnPage(event) {
  return isOwnPageUrl((event.senderFrame && event.senderFrame.url) || '');
}

function registerIpc() {
  ipcMain.handle('desktop:get-url', (event) => (fromOwnPage(event) ? getAppUrl() : null));

  ipcMain.handle('desktop:save-url', (event, input) => {
    if (!fromOwnPage(event)) return { ok: false, error: 'Tidak diizinkan.' };
    const url = normalizeUrl(input);
    if (!url) return { ok: false, error: 'Alamat tidak valid. Gunakan alamat https, contoh: https://nama-proyek.vercel.app' };
    writeConfig({ ...readConfig(), url });
    loadApp();
    return { ok: true };
  });

  ipcMain.handle('desktop:retry', (event) => {
    if (fromOwnPage(event)) loadApp();
  });

  ipcMain.handle('desktop:change-url', (event) => {
    if (fromOwnPage(event)) showSetup();
  });
}

// ---------- Siklus hidup ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('id.rayhan.announcement');

    // Aplikasi tidak butuh kamera, mikrofon, lokasi, dsb.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    // Cegah sistem tidur supaya audio terjadwal tetap berjalan (layar boleh mati).
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');

    registerIpc();
    buildMenu();
    createWindow();
    createTray();
    loadApp();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
  });

  // Tetap hidup di tray walau jendela disembunyikan.
  app.on('window-all-closed', () => {});
}

