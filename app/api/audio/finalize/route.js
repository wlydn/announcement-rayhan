import { put } from '@vercel/blob';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

const tempDir = '/tmp/audio-chunks';

function generateId() {
  return `${Date.now()}-${randomBytes(3).toString('hex')}`;
}

function generateSessionId(fileName, fileSize) {
  return `${fileName}-${fileSize}`;
}

export const maxDuration = 120; // Allow 2 minutes for merging and uploading

export async function POST(request) {
  try {
    const { fileName, fileType, totalChunks, fileSize } = await request.json();

    if (!fileName || !totalChunks) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const sessionId = generateSessionId(fileName, fileSize);
    const sessionDir = path.join(tempDir, sessionId);

    console.log(`Finalizing upload for ${fileName}, assembling ${totalChunks} chunks...`);

    // Check if all chunks exist
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(sessionDir, `chunk-${i}`);
      if (!fs.existsSync(chunkPath)) {
        return new Response(
          JSON.stringify({ error: `Missing chunk ${i}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Merge chunks into single buffer
    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(sessionDir, `chunk-${i}`);
      const buffer = fs.readFileSync(chunkPath);
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

    // Clean up temporary files
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`Cleaned up temporary files for ${sessionId}`);
    } catch (cleanupErr) {
      console.warn('Warning: Could not clean up temporary files:', cleanupErr.message);
    }

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
