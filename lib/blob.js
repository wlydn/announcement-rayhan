import { upload } from '@vercel/blob/client';
import {
  MAX_AUDIO_SIZE,
  getSafeAudioExtension,
  isSupportedAudioFile,
  resolveAudioContentType,
} from './audio-upload';

/**
 * Vercel Blob Storage wrapper
 * Replaces IndexedDB for audio file storage
 */

function buildBlobPath(file) {
  const ext = getSafeAudioExtension(file);
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `audio/audio-${uniqueId}.${ext}`;
}

export async function uploadAudioFile(file) {
  try {
    // Validate file size (50MB limit total)
    if (file.size > MAX_AUDIO_SIZE) {
      throw new Error(`File terlalu besar. Maksimal ${MAX_AUDIO_SIZE / 1024 / 1024}MB, file Anda: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    }

    // Validate file type
    if (!isSupportedAudioFile(file)) {
      throw new Error('File harus berupa audio (MP3, WAV, OGG, M4A)');
    }

    const contentType = resolveAudioContentType(file);

    console.log('Starting audio upload:', { fileName: file.name, fileSize: file.size, fileType: file.type, normalizedContentType: contentType });

    return await uploadToBlob(file, contentType);
  } catch (error) {
    console.error('Error uploading audio file:', error);
    throw error;
  }
}

async function uploadToBlob(file, contentType) {
  const pathname = buildBlobPath(file);

  console.log('Uploading audio with Vercel Blob client upload:', {
    fileName: file.name,
    pathname,
    fileSize: file.size,
    contentType,
  });

  try {
    const blob = await upload(pathname, file, {
      access: 'public',
      contentType,
      handleUploadUrl: '/api/audio/upload',
      clientPayload: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        contentType,
      }),
    });

    console.log('Upload success:', { blobId: blob.pathname, url: blob.url, size: file.size });

    return {
      blobId: blob.pathname,
      url: blob.url,
      size: file.size,
      uploadedAt: Date.now(),
    };
  } catch (error) {
    const message = String(error?.message || '');

    if (message.includes('client token')) {
      throw new Error('Gagal membuat token upload Blob. Periksa BLOB_READ_WRITE_TOKEN.');
    }

    if (message.includes('size') || message.includes('too large')) {
      throw new Error(`File terlalu besar. Maksimal ${MAX_AUDIO_SIZE / 1024 / 1024}MB.`);
    }

    if (message.includes('Failed to fetch') || message.includes('fetch failed')) {
      throw new Error('Upload ke Vercel Blob gagal. Coba ulang beberapa saat lagi.');
    }

    throw error;
  }
}

export async function deleteAudioFile(blobId, fileUrl) {
  try {
    if (!blobId && !fileUrl) {
      throw new Error('Either blobId or fileUrl is required for deletion');
    }

    console.log('Starting deletion from Vercel Blob:', {
      blobId,
      fileUrl,
      usingUrl: !!fileUrl,
    });

    const response = await fetch('/api/audio', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        url: fileUrl,  // Preferred: full URL with suffix
        blobId: blobId // Fallback: in case URL not available
      }),
    });

    console.log('Delete response status:', response.status);

    if (!response.ok) {
      const error = await response.json();
      console.error('Delete error response:', error);
      
      // Treat 404 as success since file is already deleted
      if (response.status === 404 || error.isNotFound) {
        console.log('File not found in Blob (already deleted or never existed)');
        return true;
      }
      
      throw new Error(error.error || `Delete failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log('Delete success:', { 
      message: data.message,
      deletedTarget: data.deletedTarget 
    });
    return true;
  } catch (error) {
    console.error('Error deleting audio file:', error);
    throw error;
  }
}

export async function getAudioFileUrl(blobId, url) {
  // Return the URL directly from blob metadata
  // In future, can be extended to validate URL still exists
  
  if (!url) {
    console.warn('getAudioFileUrl: URL is empty', { blobId });
    return null;
  }

  console.log('Getting audio file URL:', { blobId, url });
  
  // Optional: Validate URL format
  try {
    new URL(url);
  } catch (e) {
    console.error('getAudioFileUrl: Invalid URL format', { url, error: e.message });
    return null;
  }

  return url;
}

export async function validateBlobUrl(url) {
  /**
   * Test if a Vercel Blob URL is accessible
   * Returns: { isAccessible: boolean, statusCode: number?, error?: string }
   */
  if (!url) {
    return { isAccessible: false, error: 'URL is empty' };
  }

  try {
    console.log('Validating blob URL:', url);
    
    const response = await fetch(url, {
      method: 'HEAD',  // Just check headers, don't download full file
      mode: 'cors',
      credentials: 'omit',
    });

    const isAccessible = response.ok;
    console.log('Blob URL validation:', { url, statusCode: response.status, isAccessible });
    
    return {
      isAccessible,
      statusCode: response.status,
    };
  } catch (error) {
    console.error('Blob URL validation error:', { url, error: error.message });
    return {
      isAccessible: false,
      error: error.message,
    };
  }
}
