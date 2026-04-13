/**
 * Vercel Blob Storage wrapper
 * Replaces IndexedDB for audio file storage
 */

const CHUNK_SIZE = 3 * 1024 * 1024; // 3MB chunks (safe margin for most hosting providers)

export async function uploadAudioFile(file) {
  try {
    // Validate file size (50MB limit total)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      throw new Error(`File terlalu besar. Maksimal ${maxSize / 1024 / 1024}MB, file Anda: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    }

    // Validate file type
    if (!file.type.startsWith('audio/')) {
      throw new Error('File harus berupa audio (MP3, WAV, OGG, M4A)');
    }

    console.log('Starting audio upload:', { fileName: file.name, fileSize: file.size, fileType: file.type });

    // For files smaller than 5MB, upload directly
    if (file.size < CHUNK_SIZE) {
      return await uploadDirectly(file);
    }

    // For larger files, use chunked upload
    return await uploadChunked(file);
  } catch (error) {
    console.error('Error uploading audio file:', error);
    throw error;
  }
}

async function uploadDirectly(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/audio', {
    method: 'POST',
    body: formData,
  });

  console.log('Upload response status:', response.status, {
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
  });

  if (!response.ok) {
    let errorMessage = `Upload failed with status ${response.status}`;
    try {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const error = await response.json();
        errorMessage = error.error || errorMessage;
      } else {
        // If not JSON, try text
        const errorText = await response.text();
        errorMessage = errorText.substring(0, 200) || errorMessage; // Limit length
        console.error('Upload error (non-JSON):', errorText);
      }
    } catch (parseErr) {
      console.error('Could not parse error response:', parseErr);
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  console.log('Upload success:', { blobId: data.blobId, url: data.url, size: data.size });
  
  return {
    blobId: data.blobId,
    url: data.url,
    size: data.size,
    uploadedAt: Date.now(),
  };
}

async function uploadChunked(file) {
  console.log(`File ${(file.size / 1024 / 1024).toFixed(2)}MB is large, using chunked upload`);
  
  const chunks = [];
  let offset = 0;

  // Split file into chunks
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    chunks.push(chunk);
    offset += CHUNK_SIZE;
  }

  console.log(`Uploading ${chunks.length} chunks for ${file.name}`);

  // Upload each chunk
  const uploadedChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('chunkIndex', i.toString());
    formData.append('totalChunks', chunks.length.toString());
    formData.append('fileName', file.name);
    formData.append('fileType', file.type);
    formData.append('fileSize', file.size.toString());

    console.log(`Uploading chunk ${i + 1}/${chunks.length}...`);

    const response = await fetch('/api/audio/chunk', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = 'Unknown error';
      
      // Handle specific HTTP status codes
      if (response.status === 413) {
        errorMessage = 'Chunk terlalu besar. Hosting/proxy Anda membatasi ukuran upload. Coba gunakan Vercel atau ubah settingan server.';
      } else if (response.status === 414) {
        errorMessage = 'URI terlalu panjang. Coba gunakan nama file yang lebih pendek.';
      } else if (response.status === 500 || response.status === 502 || response.status === 503) {
        errorMessage = 'Server error. Coba lagi dalam beberapa saat.';
      } else {
        // Try parsing error response
        try {
          const error = await response.json();
          errorMessage = error.error || `HTTP ${response.status}`;
        } catch (e) {
          errorMessage = `HTTP ${response.status}`;
        }
      }
      
      throw new Error(`Chunk ${i + 1} failed: ${errorMessage}`);
    }

    const data = await response.json();
    uploadedChunks.push(data);
  }

  console.log('All chunks uploaded, finalizing...');

  // Finalize upload - merge chunks
  const response = await fetch('/api/audio/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type,
      totalChunks: chunks.length,
      fileSize: file.size,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Finalization failed: ${error.error}`);
  }

  const data = await response.json();
  console.log('Upload success (chunked):', { blobId: data.blobId, url: data.url, size: data.size });
  
  return {
    blobId: data.blobId,
    url: data.url,
    size: data.size,
    uploadedAt: Date.now(),
  };
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
