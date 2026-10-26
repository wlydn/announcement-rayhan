# Announcement Prayer Player

Website Next.js untuk:
- input jadwal announcement berdasarkan jam (`HH:mm`)
- upload file audio announcement ke Vercel Blob Storage
- upload backsound standby ke Vercel Blob Storage
- pause backsound otomatis saat announcement diputar
- pause backsound otomatis saat masuk waktu sholat
- auto ambil jadwal sholat resmi Kemenag RI dari API MyQuran berdasarkan kota/kabupaten
- koreksi manual jadwal sholat dengan offset menit per waktu (`-60` sampai `+60`)
- menahan announcement yang jatuh di waktu sholat lalu memutarnya setelah jeda selesai
- siap deploy ke Vercel

## Stack
- Next.js 15
- React 18
- **Penyimpanan file audio di Vercel Blob Storage** (cloud-based)
- Metadata audio bersama disimpan di Vercel Blob agar bisa dibuka dari browser/perangkat lain
- Konfigurasi jadwal sholat dan preferensi lokal disimpan di localStorage
- Pengambilan jadwal sholat melalui API MyQuran (`api.myquran.com/v2/sholat`, data Kemenag RI) dari sisi client
- API Routes untuk token upload Blob dan delete audio files

## Perubahan Utama (v2)
**Migrasi dari IndexedDB ke Vercel Blob Storage:**
- ✅ Audio files sekarang disimpan di cloud (Vercel Blob), bukan di browser
- ✅ URL file bersifat permanent dan bisa di-share
- ✅ Storage unlimited (tidak terbatas kapasitas browser)
- ✅ Backup otomatis di cloud Vercel
- ⚠️ Memerlukan token Vercel Blob (setup di .env.local)

## Setup Environment Variables
Buat file `.env.local` di root project:
```
BLOB_READ_WRITE_TOKEN=your-vercel-blob-token
```

Lihat [BLOB_SETUP.md](./BLOB_SETUP.md) untuk instruksi detail setup Vercel Blob.

## Menjalankan lokal
```bash
npm install
npm run dev
```

Buka `http://localhost:3000`

## Deploy ke Vercel
1. Upload folder proyek ini ke GitHub.
2. Import repository ke Vercel.
3. Framework preset: **Next.js**.
4. **Set environment variable** `BLOB_READ_WRITE_TOKEN` di Vercel dashboard.
5. Deploy.

## Cara pakai
1. Buka website.
2. Klik **Aktifkan Audio** satu kali agar browser mengizinkan autoplay audio.
3. Upload file backsound standby (akan di-upload ke Vercel Blob).
4. Buka panel **Jadwal Sholat**.
5. Pilih mode **Otomatis dari API**.
6. Ketik nama kota/kabupaten (min. 3 huruf), klik **Cari**, lalu pilih kota dari hasil pencarian.
7. Klik **Refresh API** jika ingin sinkron ulang (jadwal otomatis diperbarui setiap ganti hari).
8. Koreksi jam sholat bila perlu menggunakan offset menit per Subuh / Dzuhur / Ashar / Maghrib / Isya.
9. Tambahkan announcement: judul, jam, dan file audio (akan di-upload ke Vercel Blob).

## Catatan penting
- Jadwal MyQuran sudah termasuk ihtiyath Kemenag, jadi offset menit biasanya cukup `0`.
- Jika ingin sepenuhnya manual, ubah mode ke **Manual** lalu isi jam sholat langsung.
- File audio disimpan di Vercel Blob. Metadata audio utama dibaca dari shared storage, sedangkan jadwal sholat dan preferensi lokal tetap ada di `localStorage` browser.
- Jika dibuka di perangkat lain, backsound aktif, daftar announcement, dan jadwal backsound tetap ikut termuat, tetapi pengaturan lokal seperti volume, unlock audio, dan jadwal sholat lokal tetap mengikuti browser tersebut.
- Browser modern membatasi autoplay. Tombol **Aktifkan Audio** memang wajib diklik sekali setelah halaman dibuka.

## Adzan otomatis
- Adzan hanya diputar dari **URL** (tidak ada file lokal). Isi di panel **Adzan**, lalu klik **Simpan**:
  - **URL adzan biasa** untuk Dzuhur, Ashar, Maghrib, dan Isya
  - **URL adzan Subuh** untuk Subuh
  - Contoh Subuh: `https://islamdownload.net/r/123801/fajr_128_44.mp3`
- URL disimpan di shared storage (Vercel Blob, `config/audio-library.json`), jadi cukup diisi sekali dan berlaku di semua browser/perangkat. Jika URL kosong, adzan untuk jenis itu tidak diputar dan muncul peringatan di status.
- File di-preload saat halaman dibuka dan dimuat ulang 2 menit sebelum waktu sholat (warm-up). Aplikasi bergantung pada internet dan server pemilik URL; jika URL mati atau dipindah, adzan gagal dan status akan menampilkan "gagal dimuat".
- Saat masuk waktu sholat, backsound/announcement dijeda, adzan diputar, lalu jeda sholat berjalan seperti biasa. Announcement yang terpotong akan dilanjutkan setelah adzan selesai.
- Setiap sholat hanya diputar sekali per hari, tercatat di `localStorage`. Jika halaman baru dibuka lebih dari 2 menit setelah jam sholat, adzan tidak diputar.
- Di panel **Adzan** ada toggle per sholat, pengaturan volume, tombol **Tes Adzan** / **Tes Adzan Subuh**, dan **Stop Adzan**. **Stop Audio** juga menghentikan adzan.

## Aplikasi desktop (Electron)
Aplikasi desktop Windows adalah pembungkus tipis yang memuat situs yang sudah di-deploy (bawaan: `https://www.wlydn.web.id/`). Data tetap di server dan `BLOB_READ_WRITE_TOKEN` tidak ikut masuk ke aplikasi, sehingga versi web dan desktop selalu sinkron. Butuh koneksi internet.

- **Kompatibilitas Windows 7:** aplikasi memakai Electron 22.3.27 (Chromium 108), versi terakhir yang masih mendukung Windows 7/8/8.1. Jangan naikkan Electron ke versi 23 ke atas jika masih ada PC Windows 7. Windows 7 sebaiknya sudah terpasang Service Pack 1.
- Jalankan untuk pengembangan: `npm run desktop`. Alamat bisa diganti lewat menu **Aplikasi > Ubah alamat server...** dan disimpan di folder data pengguna.
- Untuk uji lokal, set variabel `ANNOUNCEMENT_URL` (contoh `http://localhost:3000`). Alamat `http` hanya diterima untuk `localhost`/`127.0.0.1`.
- Buat installer: `node node_modules\electron-builder\cli.js --win nsis --x64 --ia32 --publish never` (atau `npm run desktop:dist`). Hasilnya satu installer bernama `release/Announcement IT Rayhan v3.0.exe` (shortcut dan nama aplikasi: "Announcement IT Rayhan") yang berisi versi 64-bit dan 32-bit; installer memilih yang cocok otomatis. Build pertama mengunduh Electron dan NSIS sehingga bisa memakan beberapa menit.
- Perilaku: audio terjadwal boleh diputar tanpa klik, sistem dicegah tidur, dan menutup jendela hanya menyembunyikannya ke tray agar adzan tidak terlewat. Gunakan **Keluar** di menu tray untuk menutup sepenuhnya. Menu **Jalankan saat Windows menyala** tersedia pada versi terpasang.
- Keamanan: situs hanya bisa dibuka dari alamat yang tersimpan; tautan ke domain lain dibuka di browser bawaan, izin kamera/lokasi/mikrofon ditolak, dan API desktop tidak terekspos ke situs.
- Installer belum ditandatangani, jadi Windows SmartScreen bisa menampilkan peringatan saat pertama dipasang.

## Struktur singkat
```text
app/
  layout.js
  page.js
  globals.css
desktop/
  main.js        (proses utama Electron)
  config.js      (simpan dan validasi alamat server)
  preload.js     (API terbatas untuk halaman setup/offline)
  setup.html     (form alamat server)
  offline.html   (halaman saat tidak ada koneksi)
  build/icon.ico
lib/
  blob.js
package.json
README.md
```
