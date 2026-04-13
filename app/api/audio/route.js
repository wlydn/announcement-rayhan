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
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }

    // Generate unique blob filename
    const ext = file.name?.split('.')?.pop() || 'mp3';
    const blobFileName = `audio-${generateId()}.${ext}`;

    // Convert File to Buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    console.log('Uploading file to Vercel Blob:', {
      fileName: file.name,
      fileSize: buffer.length,
      fileType: file.type,
    });

    // Upload to Vercel Blob
    const blob = await put(blobFileName, buffer, {
      access: 'public',
      contentType: file.type || 'audio/mpeg',
    });

    console.log('Upload success to Vercel Blob:', {
      blobId: blob.pathname,
      url: blob.url,
      size: buffer.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        blobId: blob.pathname,
        url: blob.url,
        size: buffer.length,
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
    console.error('Upload error:', error);

    let errorMessage = 'Upload failed';
    if (error.message.includes('token')) {
      errorMessage = 'Vercel Blob authentication failed. Check BLOB_READ_WRITE_TOKEN.';
    } else if (error.message.includes('size')) {
      errorMessage = 'File size exceeds limit.';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorMessage = 'Network error during upload. Please try again.';
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        details: error.message,
      }),
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

export async function DELETE(request) {
  try {
    const { url, blobId } = await request.json();

    // Accept either URL or blobId - URL is preferred since it includes the full path with suffix
    const deleteTarget = url || blobId;

    if (!deleteTarget) {
      return new Response(
        JSON.stringify({ error: 'Either url or blobId is required' }),
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }

    console.log('Deleting from Vercel Blob:', {
      target: deleteTarget,
      isUrl: !!url,
      isBlobId: !!blobId,
    });

    // Delete from Vercel Blob using URL (contains full path with suffix)
    // If using blobId, add leading slash if needed
    const finalTarget = url || (blobId.startsWith('/') ? blobId : `/${blobId}`);
    await del(finalTarget);

    console.log('Successfully deleted from Vercel Blob:', finalTarget);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'File deleted successfully',
        deletedTarget: finalTarget 
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
    console.error('Delete error:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    let errorMessage = 'Failed to delete file from Vercel Blob';
    
    if (error.message.includes('token') || error.message.includes('authentication')) {
      errorMessage = 'Vercel Blob authentication failed. Check BLOB_READ_WRITE_TOKEN.';
    } else if (error.message.includes('not found') || error.code === 'ENOENT' || error.message.includes('404')) {
      // File already deleted or never existed - still consider as success
      console.log('File not found in Blob (may have been deleted already)');
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'File not found (already deleted or never existed)',
          isNotFound: true 
        }),
        { 
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    } else if (error.message.includes('network')) {
      errorMessage = 'Network error during deletion. Please try again.';
    }

    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: error.message 
      }),
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
