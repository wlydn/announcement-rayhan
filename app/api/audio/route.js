import { del } from '@vercel/blob';
import { forbiddenResponse, isSameOriginRequest, resolveDeletableAudioPath } from '../../../lib/request-guard';

export const dynamic = 'force-dynamic';

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(request) {
  if (!isSameOriginRequest(request)) {
    return forbiddenResponse();
  }

  try {
    const { url, blobId } = await request.json();

    if (!url && !blobId) {
      return json({ error: 'Either url or blobId is required' }, 400);
    }

    // Hanya file di prefix audio/ yang boleh dihapus (bukan config/ atau lainnya)
    const safePath = resolveDeletableAudioPath({ url, blobId });
    if (!safePath) {
      return json({ error: 'Target file tidak valid.' }, 400);
    }

    await del(url ? String(url) : safePath);

    return json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete error:', {
      message: error.message,
      code: error.code,
    });

    const message = String(error?.message || '').toLowerCase();

    if (message.includes('not found') || error.code === 'ENOENT' || message.includes('404')) {
      // File sudah terhapus atau tidak pernah ada - dianggap sukses
      return json({ success: true, message: 'File not found (already deleted or never existed)', isNotFound: true });
    }

    return json({ error: 'Failed to delete file from Vercel Blob' }, 500);
  }
}