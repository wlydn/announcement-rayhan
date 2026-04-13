# Announcement Prayer Player

Website Next.js untuk:
- input jadwal announcement berdasarkan jam (`HH:mm`)
- upload file audio announcement ke Vercel Blob Storage
- upload backsound standby ke Vercel Blob Storage
- pause backsound otomatis saat announcement diputar
- pause backsound otomatis saat masuk waktu sholat
- auto ambil jadwal sholat dari API berdasarkan koordinat browser
- koreksi manual jadwal sholat dengan offset menit per waktu (`-60` sampai `+60`)
- menahan announcement yang jatuh di waktu sholat lalu memutarnya setelah jeda selesai
- siap deploy ke Vercel

## Stack
- Next.js 15
- React 18
- **Penyimpanan file audio di Vercel Blob Storage** (cloud-based)
- Metadata audio bersama disimpan di Vercel Blob agar bisa dibuka dari browser/perangkat lain
- Konfigurasi jadwal sholat dan preferensi lokal disimpan di localStorage
- Pengambilan jadwal sholat melalui API AlAdhan dari sisi client
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
6. Klik **Ambil Lokasi Browser** atau isi koordinat manual.
7. Klik **Refresh dari API** jika ingin sinkron ulang.
8. Koreksi jam sholat bila perlu menggunakan offset menit per Subuh / Dzuhur / Ashar / Maghrib / Isya.
9. Tambahkan announcement: judul, jam, dan file audio (akan di-upload ke Vercel Blob).

## Catatan penting
- Jika izin lokasi browser ditolak, Anda tetap bisa isi `latitude` dan `longitude` manual.
- Jika ingin sepenuhnya manual, ubah mode ke **Manual** lalu isi jam sholat langsung.
- File audio disimpan di Vercel Blob. Metadata audio utama dibaca dari shared storage, sedangkan jadwal sholat dan preferensi lokal tetap ada di `localStorage` browser.
- Jika dibuka di perangkat lain, backsound aktif dan daftar announcement tetap ikut termuat, tetapi pengaturan lokal seperti volume, unlock audio, dan jadwal sholat lokal tetap mengikuti browser tersebut.
- Browser modern membatasi autoplay. Tombol **Aktifkan Audio** memang wajib diklik sekali setelah halaman dibuka.

## Struktur singkat
```text
app/
  layout.js
  page.js
  globals.css
lib/
  blob.js
package.json
README.md
```
