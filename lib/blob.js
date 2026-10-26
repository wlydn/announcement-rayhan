import { upload } from '@vercel/blob/client';
import {
  MAX_AUDIO_SIZE,
  getSafeAudioExtension,
  isSupportedAudioFile,
  resolveAudioContentType,
} from './audio-upload';

/** Operasi file audio di Vercel Blob dari sisi browser. */
const MAX_AUDIO_SIZE_MB = MAX_AUDIO_SIZE / 1024 / 1024;

function buildBlobPath(file) {
  const ext = getSafeAudioExtension(file);
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `audio/audio-${uniqueId}.${ext}`;
}

function toFriendlyUploadError(error) {
  const message = String(error?.message || '');
  if (message.includes('client token')) {
    return new Error('Gagal membuat token upload Blob. Periksa BLOB_READ_WRITE_TOKEN.');
  }
  if (message.includes('size') || message.includes('too large')) {
    return new Error(`File terlalu besar. Maksimal ${MAX_AUDIO_SIZE_MB}MB.`);
  }
  if (message.includes('Failed to fetch') || message.includes('fetch failed')) {
    return new Error('Upload ke Vercel Blob gagal. Coba ulang beberapa saat lagi.');
  }
  return error;
}

export async function uploadAudioFile(file) {
  if (file.size > MAX_AUDIO_SIZE) {
    throw new Error(
      `File terlalu besar. Maksimal ${MAX_AUDIO_SIZE_MB}MB, file Anda: ${(file.size / 1024 / 1024).toFixed(2)}MB`
    );
  }
  if (!isSupportedAudioFile(file)) {
    throw new Error('File harus berupa audio (MP3, WAV, OGG, M4A)');
  }

  const contentType = resolveAudioContentType(file);
  try {
    const blob = await upload(buildBlobPath(file), file, {
      access: 'public',
      contentType,
      handleUploadUrl: '/api/audio/upload',
      clientPayload: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        contentType,
      }),
    });
    return {
      blobId: blob.pathname,
      url: blob.url,
      size: file.size,
      uploadedAt: Date.now(),
    };
  } catch (error) {
    console.error('Error uploading audio file:', error);
    throw toFriendlyUploadError(error);
  }
}

export async function deleteAudioFile(blobId, fileUrl) {
  if (!blobId && !fileUrl) {
    throw new Error('Either blobId or fileUrl is required for deletion');
  }
  const response = await fetch('/api/audio', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: fileUrl, blobId }),
  });
  if (response.ok) return true;

  const error = await response.json().catch(() => ({}));
  // 404 berarti file sudah tidak ada; kesalahan lain harus ditampilkan.
  if (response.status === 404 || error.isNotFound) return true;
  throw new Error(error.error || `Delete failed with status ${response.status}`);
}

export async function getAudioFileUrl(blobId, url) {
  if (!url) {
    console.warn('getAudioFileUrl: URL is empty', { blobId });
    return null;
  }
  try {
    new URL(url);
  } catch {
    console.error('getAudioFileUrl: Invalid URL format', { blobId });
    return null;
  }
  return url;
}

// Cek aksesibilitas tanpa mengunduh seluruh file.
export async function validateBlobUrl(url) {
  if (!url) return { isAccessible: false, error: 'URL is empty' };
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
    });
    return { isAccessible: response.ok, statusCode: response.status };
  } catch (error) {
    return { isAccessible: false, error: error.message };
  }
}
