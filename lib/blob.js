/**
 * Vercel Blob Storage wrapper
 * Replaces IndexedDB for audio file storage
 */

export async function uploadAudioFile(file) {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/audio', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    const data = await response.json();
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
    const response = await fetch('/api/audio', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blobId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Delete failed');
    }

    return true;
  } catch (error) {
    console.error('Error deleting audio file:', error);
    throw error;
  }
}

export async function getAudioFileUrl(blobId, url) {
  // Return the URL directly from blob metadata
  // If needed, can be extended to validate URL still exists
  return url;
}
