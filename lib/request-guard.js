/**
 * Perlindungan sederhana untuk route API yang mengubah data.
 * - Menolak request lintas-situs (anti-CSRF) berdasarkan Sec-Fetch-Site / Origin.
 * - Request tanpa Origin (mis. callback server-ke-server Vercel Blob) tetap diizinkan,
 *   karena browser selalu menyertakan Origin pada POST/DELETE lintas-situs.
 */
export function isSameOriginRequest(request) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return false;
  }

  const origin = request.headers.get('origin');
  if (!origin) return true;

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function forbiddenResponse() {
  return Response.json(
    { error: 'Permintaan ditolak.' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Hanya izinkan penghapusan file audio milik aplikasi (prefix `audio/`),
 * dan tidak pernah file konfigurasi. Menerima pathname atau URL Vercel Blob.
 * Mengembalikan pathname yang aman, atau null jika tidak valid.
 */
export function resolveDeletableAudioPath({ url, blobId }) {
  let pathname = '';

  if (url) {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol !== 'https:') return null;
      if (!parsed.hostname.endsWith('.public.blob.vercel-storage.com')) return null;
      pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    } catch {
      return null;
    }
  } else if (blobId) {
    pathname = String(blobId).replace(/^\/+/, '');
  }

  if (!pathname.startsWith('audio/')) return null;
  if (pathname.includes('..') || pathname.includes('\\')) return null;
  return pathname;
}
