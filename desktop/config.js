'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {};
  } catch (error) {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

// Hanya https (atau http untuk localhost saat pengembangan). Tanpa kredensial di URL.
function normalizeUrl(input) {
  let text = String(input || '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let parsed;
  try {
    parsed = new URL(text);
  } catch (error) {
    return null;
  }

  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  // Host publik wajib punya titik (nama domain). Ini juga menolak "javascript:1" yang terbaca sebagai host:port.
  if (!isLocal && !parsed.hostname.includes('.')) return null;
  const allowed = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocal);
  if (!allowed || parsed.username || parsed.password) return null;
  return parsed.toString();
}

const DEFAULT_URL = 'https://www.wlydn.web.id/';

// Urutan prioritas: variabel lingkungan (untuk uji coba), config.json di folder data pengguna, lalu alamat bawaan.
function getAppUrl() {
  if (process.env.ANNOUNCEMENT_URL) return normalizeUrl(process.env.ANNOUNCEMENT_URL);
  return normalizeUrl(readConfig().url) || DEFAULT_URL;
}

module.exports = { readConfig, writeConfig, normalizeUrl, getAppUrl, DEFAULT_URL };
