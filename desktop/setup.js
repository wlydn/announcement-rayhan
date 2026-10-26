'use strict';

const form = document.getElementById('form');
const input = document.getElementById('url');
const errorBox = document.getElementById('error');
const saveButton = document.getElementById('save');
const cancelButton = document.getElementById('cancel');

window.desktop.getUrl().then((url) => {
  if (!url) return;
  input.value = url;
  cancelButton.hidden = false;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  saveButton.disabled = true;

  const result = await window.desktop.saveUrl(input.value);
  if (!result || !result.ok) {
    errorBox.textContent = (result && result.error) || 'Gagal menyimpan alamat.';
    saveButton.disabled = false;
  }
});

cancelButton.addEventListener('click', () => window.desktop.retry());

input.focus();
