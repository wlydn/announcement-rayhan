import { handleUpload } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { AUDIO_CONTENT_TYPES, MAX_AUDIO_SIZE } from '../../../../lib/audio-upload';
import { forbiddenResponse, isSameOriginRequest } from '../../../../lib/request-guard';
import { isRateLimited } from '../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;
const CLIENT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
// Pathname upload: hanya audio/<nama-file> dengan karakter aman (tanpa "..", slash tambahan, dsb.).
const SAFE_AUDIO_PATH = /^audio\/[A-Za-z0-9._-]{1,200}$/;

// Hanya pesan dari error jenis ini yang boleh dikirim ke client; error lain dibuat generik.
class UploadValidationError extends Error {}

function parseClientPayload(clientPayload) {
  if (!clientPayload) return null;

  try {
    return JSON.parse(clientPayload);
  } catch {
    throw new UploadValidationError('Invalid upload payload.');
  }
}

function isSafeAudioPath(pathname) {
  return typeof pathname === 'string' && SAFE_AUDIO_PATH.test(pathname);
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Pembuatan token upload hanya boleh dari halaman ini sendiri. Callback
    // 'blob.upload-completed' datang dari server Vercel Blob dan tanda tangannya
    // diverifikasi oleh handleUpload, jadi tidak diblokir oleh pemeriksaan asal.
    if (body?.type !== 'blob.upload-completed' && !isSameOriginRequest(request)) {
      return forbiddenResponse();
    }

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        // Callback 'upload-completed' dari Vercel tidak melewati bagian ini, jadi tidak ikut dibatasi.
        if (isRateLimited(request, 'upload-token', { limit: 20, windowMs: 60 * 1000 })) {
          throw new UploadValidationError('Terlalu banyak permintaan upload. Coba lagi sebentar.');
        }

        if (!isSafeAudioPath(pathname)) {
          throw new UploadValidationError('Invalid upload path.');
        }

        const payload = parseClientPayload(clientPayload);
        const contentType = payload?.contentType;
        const fileSize = Number(payload?.fileSize || 0);

        if (!contentType || !AUDIO_CONTENT_TYPES.includes(contentType)) {
          throw new UploadValidationError('File harus berupa audio.');
        }

        if (!Number.isFinite(fileSize) || fileSize <= 0) {
          throw new UploadValidationError('Ukuran file tidak valid.');
        }

        if (fileSize > MAX_AUDIO_SIZE) {
          throw new UploadValidationError(`File terlalu besar. Maksimal ${MAX_AUDIO_SIZE / 1024 / 1024}MB.`);
        }

        console.log('Generating Blob client token:', {
          pathname,
          contentType,
          fileSize,
          multipart,
        });

        return {
          maximumSizeInBytes: MAX_AUDIO_SIZE,
          allowedContentTypes: AUDIO_CONTENT_TYPES,
          addRandomSuffix: false,
          validUntil: Date.now() + CLIENT_TOKEN_TTL_MS,
          tokenPayload: clientPayload,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseClientPayload(tokenPayload);

        console.log('Blob upload completed:', {
          pathname: blob.pathname,
          url: blob.url,
          fileName: payload?.fileName,
          fileSize: payload?.fileSize,
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error('Blob client upload route error:', error);

    return NextResponse.json(
      {
        error: error instanceof UploadValidationError ? error.message : 'Upload token generation failed.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
