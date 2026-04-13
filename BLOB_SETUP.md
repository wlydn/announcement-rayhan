# Setup Vercel Blob Storage

## Langkah-langkah Setup

### 1. Deploy ke Vercel
```bash
npm install -g vercel
vercel
```

### 2. Setup Vercel Blob Token
1. Login ke [Vercel Dashboard](https://vercel.com/dashboard)
2. Pilih project ini
3. Pergi ke **Settings** → **Environment Variables**
4. Tambahkan variable baru:
   - Name: `BLOB_READ_WRITE_TOKEN`
   - Value: Generate dari Vercel Storage tab

### 3. Environment Variables di Local
Buat file `.env.local` di root project:
```
BLOB_READ_WRITE_TOKEN=your-token-here
```

## Fitur Perubahan

✅ **Audio storage berpindah dari IndexedDB ke Vercel Blob**
- Background sounds (backsound) disimpan di Vercel Blob
- Announcement audio files disimpan di Vercel Blob
- Metadata disimpan di localStorage (untuk offline-first)

## API Routes

### POST `/api/audio`
Upload file audio ke Vercel Blob
```javascript
const formData = new FormData();
formData.append('file', file);
const response = await fetch('/api/audio', {
  method: 'POST',
  body: formData
});
```
Response:
```json
{
  "success": true,
  "blobId": "audio-1234567890-abc123",
  "url": "https://blob.vercel-storage.com/...",
  "size": 123456
}
```

### DELETE `/api/audio`
Delete audio dari Vercel Blob
```javascript
const response = await fetch('/api/audio', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ blobId: 'audio-1234567890-abc123' })
});
```

## Data Storage Structure

### Background Meta (localStorage)
```javascript
{
  blobId: "audio-1234567890-abc123",
  fileUrl: "https://blob.vercel-storage.com/...",
  name: "backsound.mp3",
  uploadedAt: 1708123456789
}
```

### Announcement Item (localStorage)
```javascript
{
  id: "schedule-1234567890-abc",
  title: "Announcement Title",
  time: "08:00",
  blobId: "audio-1234567890-def456",
  fileUrl: "https://blob.vercel-storage.com/...",
  fileName: "announcement.mp3",
  enabled: true,
  createdAt: 1708123456789,
  lastTriggeredDate: ""
}
```

## Keuntungan Vercel Blob vs IndexedDB

| Aspek | IndexedDB | Vercel Blob |
|-------|-----------|-----------|
| Storage | Browser local (terbatas) | Cloud (unlimited) |
| Sharing | Per-device | Bisa di-share via URL |
| Backup | Hilang saat clear cache | Aman di cloud |
| Link | Object URL (temporary) | Permanent URL |

## Troubleshoot

### Error: "No BLOB_READ_WRITE_TOKEN"
- Setup environment variable di Vercel dashboard
- Pastikan `.env.local` ada di local development

### Upload Failed
- Pastikan file < 250MB (limit Vercel Blob)
- Check network connection
- Lihat browser console untuk error details

### URL not working
- Pastikan Vercel project deployed
- Check CORS settings di Vercel
