# 🚀 QUICK START - Setup Vercel Blob Storage

## ⚡ 3 Langkah Utama

### 1️⃣ Setup Vercel & Generate Token (5 menit)

```bash
# 1. Install Vercel CLI (jika belum)
npm install -g vercel

# 2. Login ke Vercel
vercel login

# 3. Deploy project ini
cd d:\Project\announcement-rayhan
vercel

# Saat diminta:
# Project name: announcement-rayhan
# Framework: Next.js
# Root directory: ./
```

**✅ SELESAI deploy? Lanjut ke step 2**

---

### 2️⃣ Buat Vercel Blob Database

1. Buka https://vercel.com/dashboard
2. Pilih project: **announcement-rayhan**
3. Klik tab **Storage**
4. Klik **Create** → **Blob**
5. Pilih **production** environment
6. Click tombol database yang sudah dibuat
7. **Copy Token** dari bagian "Tokens"

⚠️ **PENTING**: Jangan bagikan token ke siapa-siapa!

---

### 3️⃣ Configurable Token ke `.env.local`

```bash
# 1. Buka file: d:\Project\announcement-rayhan\.env.local

# 2. Ganti baris ini:
BLOB_READ_WRITE_TOKEN=

# Jadi (contoh):
BLOB_READ_WRITE_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# 3. SAVE file (Ctrl+S)

# 4. Restart dev server:
npm run dev
```

---

## ✅ Test Sekarang!

Buka browser: **http://localhost:3000**

1. Klik **"Aktifkan Audio"** (unlock autoplay)
2. Upload file backsound:
   - Cari tombol "Upload Backsound" atau file input
   - Pilih file MP3/WAV
   - Tunggu selesai
3. **Melihat pesan hijau?** ✅ BERHASIL!
4. **Melihat error merah?** ❌ Lihat tabel debug di bawah

---

## 🔴 Jika Ada Error

| Error | Solusi |
|-------|--------|
| `BLOB_READ_WRITE_TOKEN is not set` | Token di .env.local masih kosong atau dev server belum di-restart |
| `User not authenticated` | Token sudah expired → generate ulang di Vercel Dashboard |
| `Network error` | Periksa koneksi internet atau firewall |
| Audio tidak bisa diputar | Klik "Aktifkan Audio" dulu, kalau masih error lihat TROUBLESHOOT.md |

---

## 📚 Dokumentasi Lengkap

- Masalah detail? Baca [TROUBLESHOOT.md](TROUBLESHOOT.md)
- Setup awal Blob? Baca [BLOB_SETUP.md](BLOB_SETUP.md)
- Code reference? Lihat [lib/blob.js](lib/blob.js)

---

## 🎯 Jika Masih Tidak Bisa

Jalankan diagnostic:

```bash
# 1. Check token di file:
cat .env.local | findstr BLOB_READ_WRITE_TOKEN

# 2. Check @vercel/blob installed:
npm list @vercel/blob

# 3. Open Console di browser (F12):
# Upload file, cek network tab → /api/audio/upload request
# Lihat response: {"error": "..."}
```

Screencap error message & bagikan untuk debugging lebih lanjut!

---

**Status**: ✅ Ready to test | Generated: 2026-04-13
