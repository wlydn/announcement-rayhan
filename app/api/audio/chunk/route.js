import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const tempDir = '/tmp/audio-chunks';

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

function generateSessionId(fileName, fileSize) {
  return `${fileName}-${fileSize}`;
}

export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const chunk = formData.get('file');
    const chunkIndex = formData.get('chunkIndex');
    const totalChunks = formData.get('totalChunks');
    const fileName = formData.get('fileName');
    const fileType = formData.get('fileType');
    const fileSize = formData.get('fileSize');

    if (!chunk || chunkIndex === null || totalChunks === null) {
      return new Response(
        JSON.stringify({ error: 'Missing chunk data' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create session ID and directory
    const sessionId = generateSessionId(fileName, fileSize);
    const sessionDir = path.join(tempDir, sessionId);
    
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Save chunk to disk
    const chunkPath = path.join(sessionDir, `chunk-${chunkIndex}`);
    const buffer = Buffer.from(await chunk.arrayBuffer());
    fs.writeFileSync(chunkPath, buffer);

    console.log(`Chunk ${chunkIndex}/${totalChunks} saved for ${fileName}`);

    // Save metadata
    const metaPath = path.join(sessionDir, 'meta.json');
    const meta = {
      fileName,
      fileType,
      fileSize: parseInt(fileSize),
      totalChunks: parseInt(totalChunks),
      createdAt: Date.now(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    // Check if all chunks received
    let receivedCount = 0;
    for (let i = 0; i < parseInt(totalChunks); i++) {
      if (fs.existsSync(path.join(sessionDir, `chunk-${i}`))) {
        receivedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        chunkIndex: parseInt(chunkIndex),
        totalChunks: parseInt(totalChunks),
        receivedCount,
        sessionId,
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
    console.error('Chunk upload error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to upload chunk: ' + error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
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
