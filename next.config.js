/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// CSP: skrip hanya dari origin sendiri (React/Next membutuhkan 'unsafe-inline' tanpa nonce;
// 'unsafe-eval' hanya untuk mode dev). Audio boleh dari https mana pun karena URL adzan
// diisi pengguna; koneksi data dibatasi ke API sendiri, MyQuran, dan Vercel Blob.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: https:",
  `connect-src 'self' https://api.myquran.com https://*.public.blob.vercel-storage.com https://vercel.com https://blob.vercel-storage.com${isProd ? '' : ' ws: wss:'}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
];

const nextConfig = {
  allowedDevOrigins: ['localhost', '127.0.0.1', '10.8.0.11'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;