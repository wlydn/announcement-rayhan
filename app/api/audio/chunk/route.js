import { randomBytes } from 'crypto';

// Store chunks in memory with expiration (cleaned up after 1 hour)
const chunkStorage = new Map();
const CHUNK_TTL = 60 * 60 * 1000; // 1 hour

// Cleanup function for expired chunks
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of chunkStorage.entries()) {
    if (now - session.createdAt > CHUNK_TTL) {
      console.log(`Cleaning up expired chunks for session: ${sessionId}`);
      chunkStorage.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Run cleanup every 5 minutes

function generateSessionId(fileName, fileSize) {
  return `${fileName}-${fileSize}-${Date.now()}`;
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

    // Create session ID
    const sessionId = generateSessionId(fileName, fileSize);
    
    // Initialize session if not exists
    if (!chunkStorage.has(sessionId)) {
      chunkStorage.set(sessionId, {
        chunks: new Map(),
        fileName,
        fileType,
        fileSize: parseInt(fileSize),
        totalChunks: parseInt(totalChunks),
        createdAt: Date.now(),
      });
    }

    const session = chunkStorage.get(sessionId);
    const buffer = Buffer.from(await chunk.arrayBuffer());
    session.chunks.set(parseInt(chunkIndex), buffer);

    const receivedCount = session.chunks.size;
    console.log(`Chunk ${chunkIndex}/${totalChunks - 1} received for ${fileName} (${receivedCount}/${totalChunks} total)`);

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

// Export for finalize endpoint
export { chunkStorage };
