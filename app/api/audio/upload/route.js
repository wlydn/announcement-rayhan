import { handleUpload } from '@vercel/blob/client';

export const maxDuration = 60;

const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB total

function parseClientPayload(clientPayload) {
  if (!clientPayload) return null;

  try {
    return JSON.parse(clientPayload);
  } catch {
    throw new Error('Invalid upload payload.');
  }
}

function isSafeAudioPath(pathname) {
  return typeof pathname === 'string' && pathname.startsWith('audio/');
}

export async function POST(request) {
  try {
    const body = await request.json();

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        if (!isSafeAudioPath(pathname)) {
          throw new Error('Invalid upload path.');
        }

        const payload = parseClientPayload(clientPayload);
        const contentType = payload?.contentType;
        const fileSize = Number(payload?.fileSize || 0);

        if (!contentType || !contentType.startsWith('audio/')) {
          throw new Error('File harus berupa audio.');
        }

        if (!Number.isFinite(fileSize) || fileSize <= 0) {
          throw new Error('Ukuran file tidak valid.');
        }

        if (fileSize > MAX_AUDIO_SIZE) {
          throw new Error(`File terlalu besar. Maksimal ${MAX_AUDIO_SIZE / 1024 / 1024}MB.`);
        }

        console.log('Generating Blob client token:', {
          pathname,
          contentType,
          fileSize,
          multipart,
        });

        return {
          maximumSizeInBytes: MAX_AUDIO_SIZE,
          allowedContentTypes: [contentType],
          addRandomSuffix: false,
          tokenPayload: clientPayload,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseClientPayload(tokenPayload);

        console.log('Blob upload completed:', {
          pathname: blob.pathname,
          url: blob.url,
          fileName: payload?.fileName,
          fileSize: payload?.fileSize,
        });
      },
    });

    return Response.json(jsonResponse, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Blob client upload route error:', error);

    return Response.json(
      {
        error: error.message || 'Upload token generation failed.',
      },
      {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
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
