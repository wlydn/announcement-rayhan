/**
 * Vercel Blob Storage wrapper
 * Replaces IndexedDB for audio file storage
 */

export async function uploadAudioFile(file) {
  try {
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

export async function deleteAudioFile(blobId) {
  try {
    console.log('Deleting audio file:', blobId);

    const response = await fetch('/api/audio', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blobId }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Delete error response:', error);
      throw new Error(error.error || 'Delete failed');
    }

    console.log('Delete success:', blobId);
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
