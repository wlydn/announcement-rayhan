import { put, del } from '@vercel/blob';
import { randomBytes } from 'crypto';

function generateId() {
  return `${Date.now()}-${randomBytes(3).toString('hex')}`;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Generate unique blob filename
    const ext = file.name?.split('.')?.pop() || 'mp3';
    const blobFileName = `audio-${generateId()}.${ext}`;

    // Convert File to Buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to Vercel Blob
    const blob = await put(blobFileName, buffer, {
      access: 'public',
      contentType: file.type || 'audio/mpeg',
    });

    return new Response(
      JSON.stringify({
        success: true,
        blobId: blob.pathname.replace('/', ''),
        url: blob.url,
        size: buffer.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Upload error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function DELETE(request) {
  try {
    const { blobId } = await request.json();

    if (!blobId) {
      return new Response(
        JSON.stringify({ error: 'No blobId provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Delete from Vercel Blob
    await del(`/${blobId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Delete error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
