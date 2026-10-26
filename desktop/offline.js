'use strict';

const RETRY_INTERVAL_MS = 10000;

const targetBox = document.getElementById('target');
const reasonBox = document.getElementById('reason');

const reason = new URLSearchParams(location.search).get('reason');
if (reason) reasonBox.textContent = `Detail: ${reason}`;

let targetUrl = null;

window.desktop.getUrl().then((url) => {
  targetUrl = url;
  targetBox.textContent = url || 'Alamat server belum diisi';
});

document.getElementById('retry').addEventListener('click', () => window.desktop.retry());
document.getElementById('change').addEventListener('click', () => window.desktop.changeUrl());

// Cek diam-diam; halaman baru dimuat ulang begitu server terjangkau (tanpa berkedip tiap percobaan).
setInterval(() => {
  if (!targetUrl) return;
  fetch(targetUrl, { mode: 'no-cors', cache: 'no-store' })
    .then(() => window.desktop.retry())
    .catch(() => {});
}, RETRY_INTERVAL_MS);
