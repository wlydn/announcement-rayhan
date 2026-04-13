# Troubleshooting: File Tidak Tersimpan & Audio Tidak Bisa Diputar

## 🔍 Root Cause Analysis

### 1. **Upload Gagal ke Vercel Blob Storage**
- **Penyebab**: `BLOB_READ_WRITE_TOKEN` tidak dikonfigurasi atau invalid
- **Gejala**: Error `500` saat upload, pesan "Gagal mengunggah..."
- **Error API Response**: `"error": "BLOB_READ_WRITE_TOKEN is not set"`

### 2. **Audio Tidak Bisa Diputar**
- **Penyebab A**: URL dari Vercel Blob tidak valid (token expired atau file dihapus)
- **Penyebab B**: CORS issue - browser memblokir request ke domain Vercel Blob
- **Penyebab C**: Format audio tidak didukung
- **Gejala**: Audio element error, konsol menunjukkan `MEDIA_ERR_NETWORK` atau `MEDIA_ERR_SRC_NOT_SUPPORTED`

---

## ✅ SOLUSI LENGKAP

### TAHAP 1: Setup Vercel Account & Blob Storage

#### 1.1 Deploy Project ke Vercel (WAJIB)
```bash
# Install Vercel CLI
npm install -g vercel

# Login dengan akun Vercel
vercel login

# Deploy project
cd d:\Project\announcement-rayhan
vercel
```

**CATATAN**: Pilih untuk link ke project baru atau existing. Set project name: `announcement-rayhan`

#### 1.2 Konfigurasi Vercel Blob Storage
1. Login ke [https://vercel.com/dashboard](https://vercel.com/dashboard)
2. Pilih project **announcement-rayhan**
3. Pergi ke tab **Storage**
4. Klik **Create** → **Blob**
5. Buat database baru untuk project ini
6. Tunggu setup selesai (±2 menit)
7. Klik pada database yang dibuat
8. Copy **Token** dari bagian "API Tokens"

#### 1.3 Setup Local Environment
1. Buka file [.env.local](.env.local) di project root
2. Paste token yang sudah di-copy ke dalam field `BLOB_READ_WRITE_TOKEN`:
   ```
   BLOB_READ_WRITE_TOKEN=your_token_here_jangan_dibagikan
   ```
3. **SAVE** file
4. Restart dev server:
   ```bash
   npm run dev
   ```

---

### TAHAP 2: Test Upload Backsound

1. Buka aplikasi: `http://localhost:3000`
2. Klik tombol **"Aktifkan Audio"** terlebih dahulu
3. Cari fitur **"Upload Backsound"** atau **"Pilih File Backsound"**
4. Pilih file audio (format: MP3, WAV, OGG)
5. **Tunggu** upload selesai
6. **Check:**
   - Jika sukses: Muncul pesan hijau "Backsound standby disimpan di Vercel Blob..."
   - Jika gagal: Muncul pesan merah "Gagal mengunggah backsound: ..."

#### Jika upload gagal:
```
ERROR: "Gagal mengunggah backsound: BLOB_READ_WRITE_TOKEN is not set"
→ Solusi: Token di .env.local masih kosong atau belum restart server

ERROR: "Gagal mengunggah backsound: User not authenticated"  
→ Solusi: Token sudah expired, generate ulang di Vercel Dashboard

ERROR: "Gagal mengunggah backsound: Network error"
→ Solusi: Periksa koneksi internet atau firewall
```

---

### TAHAP 3: Test Upload & Playback Announcement

1. Klik **"Tambah Announcement Baru"**
2. Isi form:
   - **Judul**: Contoh "Adzan Dzuhur"
   - **Jam**: Contoh "12:00"
   - **File**: Pilih audio file
3. Klik **"Simpan & Upload"**
4. **Tunggu** hingga selesai
5. **Check audio playback:**
   - Klik **"Putar Sekarang"** atau tunggu waktu yang dijadwalkan
   - Audio harus bisa didengar

#### Jika audio tidak bisa diputar:
```
ERROR: "MEDIA_ERR_NETWORK - Network error"
→ Solusi: URL Vercel Blob tidak bisa diakses
  • Periksa koneksi internet
  • Cek apakah token masih valid (token mungkin sudah expired)
  • Generate ulang token di Vercel Dashboard

ERROR: "MEDIA_ERR_SRC_NOT_SUPPORTED - Format audio tidak didukung browser"
→ Solusi: Format audio tidak kompatibel
  • Gunakan format: MP3, WAV, atau OGG
  • Hindari format FLAC atau M4A  
  • Coba konversi file: ffmpeg -i input.m4a -codec:a libmp3lame -q:a 4 output.mp3

ERROR: "Playback dibatalkan atau ditolak"
→ Solusi: Autoplay policy browser
  • Klik tombol "Aktifkan Audio" untuk unlock browser
  • Setelah itu audio harus bisa diputar otomatis
```

---

### TAHAP 4: Verifikasi Storage Vercel

#### Lihat file yang tersimpan:
1. Login ke [Vercel Dashboard](https://vercel.com/dashboard)
2. Pilih project **announcement-rayhan**
3. Tab **Storage** → **Blob**
4. Klik database yang aktif
5. Lihat list file yang sudah ter-upload

#### Jika file tidak muncul:
- Solusi: Token tidak valid → generate ulang
- Atau file gagal di-upload → cek error message di console browser

---

### TAHAP 5: Debug Console Browser

Buka **Console** di browser (F12 → Console) dan cari:

#### Upload Success:
```javascript
// Muncul di console:
"Upload error: success" atau "Upload completed"
Response: {
  "success": true,
  "blobId": "audio-1708123456789-abc123",
  "url": "https://blob.vercelcdn.com/...",
  "size": 123456
}
```

#### Upload Error:
```javascript
// Muncul di console:
"Upload error: error message here"
Test dengan command:
fetch('/api/audio', {
  method: 'POST',
  body: formData // FormData dengan file audio
}).then(r => r.json()).then(console.log).catch(console.error)
```

#### Audio Playback Error:
```javascript
// Buka Console, jalankan:
const audio = new Audio('URL_AUDIO_DARI_BLOB');
audio.onplay = () => console.log('Playing!');
audio.onerror = () => console.error('Error:', audio.error);
audio.play().catch(e => console.error('Play error:', e));
```

---

## 🚀 Verifikasi Akhir (Checklist)

- [ ] **Vercel CLI terinstall & project sudah di-deploy**
  ```bash
  vercel --version
  ```

- [ ] **Vercel Blob Storage sudah dibuat di dashboard**

- [ ] **Token di-copy ke `.env.local`**
  ```bash
  echo $env:BLOB_READ_WRITE_TOKEN  # PowerShell
  echo $BLOB_READ_WRITE_TOKEN      # Linux/MacOS (jika pake WSL)
  ```

- [ ] **Dev server sudah di-restart setelah update `.env.local`**
  ```bash
  npm run dev  # Atau tekan Ctrl+C dan jalankan ulang
  ```

- [ ] **Backsound berhasil di-upload & muncul di Vercel Dashboard**

- [ ] **Announcement bisa di-upload tanpa error**

- [ ] **Audio bisa diputar (manual play atau jadwal trigger)**

- [ ] **Test di beberapa browser** (Chrome, Firefox, Edge, Safari)

---

## 📝 Log yang Perlu Dikumpulkan (jika masih error)

Jika masih error setelah semua langkah, kumpulkan:

1. **Network Tab** (F12 → Network):
   - Lakukan upload
   - Cari request ke `/api/audio` → lihat Response
   - Copy **full error response**

2. **Console Errors** (F12 → Console):
   - Copy **semua error message yang merah**

3. **Storage Tab** (F12 → Storage → Local Storage):
   - Lihat isi localStorage key: `app-background-meta-v1`
   - Copy URL yang tersimpan

4. **Environment Check**:
   ```bash
   # Pastikan token ada:
   cat .env.local | grep BLOB_READ_WRITE_TOKEN
   
   # Pastikan dependencies terinstall:
   npm list @vercel/blob
   ```

---

## 🆘 Quick Reference

| Masalah | Penyebab | Solusi |
|---------|----------|--------|
| 500 Error saat upload | Token kosong/invalid | Generate baru dari Vercel Dashboard |
| "Format tidak didukung" | File bukan MP3/WAV/OGG | Konversi ke MP3 |
| Audio tidak bisa diputar | CORS issue atau URL expired | Periksa token, mungkin sudah expired |
| "Autoplay blocked" | Browser security policy | Klik "Aktifkan Audio" terlebih dahulu |
| URL invalid / 404 | File dihapus dari Vercel Blob | Upload ulang |

---

## 📚 Dokumentasi Terkait

- [BLOB_SETUP.md](BLOB_SETUP.md) - Setup awal Vercel Blob
- [Vercel Blob Docs](https://vercel.com/docs/storage/vercel-blob) - Official documentation
- [Browser Audio API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement) - Audio element reference

---

Generated: 2026-04-13 | Untuk environment: Local Development + Vercel Production
