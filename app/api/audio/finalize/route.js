import { put } from '@vercel/blob';
import { randomBytes } from 'crypto';

// Import chunkStorage from chunk endpoint
let chunkStorage;

// Dynamic import to get chunkStorage
async function getChunkStorage() {
  if (!chunkStorage) {
    const chunkModule = await import('../chunk/route.js');
    chunkStorage = chunkModule.chunkStorage;
  }
  return chunkStorage;
}

function generateId() {
  return `${Date.now()}-${randomBytes(3).toString('hex')}`;
}

export const maxDuration = 120; // Allow 2 minutes for merging and uploading

export async function POST(request) {
  try {
    const { fileName, fileType, totalChunks, fileSize, sessionId } = await request.json();

    if (!fileName || !totalChunks || !sessionId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: fileName, totalChunks, sessionId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const storage = await getChunkStorage();
    const session = storage.get(sessionId);

    if (!session) {
      return new Response(
        JSON.stringify({ error: `Session not found: ${sessionId}. Chunks may have expired.` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Finalizing upload for ${fileName}, assembling ${totalChunks} chunks...`);

    // Check if all chunks exist
    for (let i = 0; i < totalChunks; i++) {
      if (!session.chunks.has(i)) {
        return new Response(
          JSON.stringify({ error: `Missing chunk ${i} (received ${session.chunks.size}/${totalChunks})` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Merge chunks into single buffer
    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const buffer = session.chunks.get(i);
      chunks.push(buffer);
    }

    const mergedBuffer = Buffer.concat(chunks);
    console.log(`Merged ${totalChunks} chunks, total size: ${(mergedBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    // Upload merged file to Vercel Blob
    const ext = fileName.split('.').pop() || 'mp3';
    const blobFileName = `audio-${generateId()}.${ext}`;

    console.log(`Uploading to Vercel Blob as ${blobFileName}...`);

    const blob = await put(blobFileName, mergedBuffer, {
      access: 'public',
      contentType: fileType || 'audio/mpeg',
    });

    console.log('Upload to Vercel Blob successful:', {
      blobId: blob.pathname,
      url: blob.url,
      size: mergedBuffer.length,
    });

    // Clean up session from memory
    storage.delete(sessionId);
    console.log(`Cleaned up session: ${sessionId}`);

    return new Response(
      JSON.stringify({
        success: true,
        blobId: blob.pathname,
        url: blob.url,
        size: mergedBuffer.length,
      }),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        } 
      }
    );
  } catch (error) {
    console.error('Finalization error:', error);

    let errorMessage = 'Failed to finalize upload: ' + error.message;
    
    if (error.message.includes('token')) {
      errorMessage = 'Vercel Blob authentication failed. Check BLOB_READ_WRITE_TOKEN.';
    } else if (error.message.includes('network')) {
      errorMessage = 'Network error during upload. Please try again.';
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        } 
      }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
