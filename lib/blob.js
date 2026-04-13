/**
 * Vercel Blob Storage wrapper
 * Replaces IndexedDB for audio file storage
 */

export async function uploadAudioFile(file) {
  try {
    // Validate file size (50MB limit)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      throw new Error(`File terlalu besar. Maksimal ${maxSize / 1024 / 1024}MB, file Anda: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    }

    // Validate file type
    if (!file.type.startsWith('audio/')) {
      throw new Error('File harus berupa audio (MP3, WAV, OGG, M4A)');
    }

    console.log('Starting audio upload:', { fileName: file.name, fileSize: file.size, fileType: file.type });

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/audio', {
      method: 'POST',
      body: formData,
    });

    console.log('Upload response status:', response.status);

    if (!response.ok) {
      const error = await response.json();
      console.error('Upload error response:', error);
      throw new Error(error.error || `Upload failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log('Upload success:', { blobId: data.blobId, url: data.url, size: data.size });
    
    return {
      blobId: data.blobId,
      url: data.url,
      size: data.size,
      uploadedAt: Date.now(),
    };
  } catch (error) {
    console.error('Error uploading audio file:', error);
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
