/**
 * Pembatas laju sederhana (per IP, di memori) untuk route API yang mengubah data.
 * Catatan: di Vercel (serverless) memori tidak dibagi antar-instance, jadi ini hanya
 * lapisan pengaman dasar terhadap spam/penyalahgunaan, bukan pengganti autentikasi.
 */
const buckets = new Map();
const MAX_BUCKETS = 5000;

export function getClientKey(request) {
  const realIp = request.headers.get('x-real-ip');
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = realIp || (forwarded ? forwarded.split(',')[0] : '') || 'unknown';
  return ip.trim().slice(0, 64);
}

function pruneBuckets(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Jika masih terlalu besar (banjir IP berbeda), kosongkan agar memori tidak membengkak.
  if (buckets.size > MAX_BUCKETS) buckets.clear();
}

export function isRateLimited(request, scope, { limit, windowMs }) {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) pruneBuckets(now);

  const key = `${scope}:${getClientKey(request)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

export function tooManyRequestsResponse() {
  return Response.json(
    { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' },
    { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } }
  );
}
