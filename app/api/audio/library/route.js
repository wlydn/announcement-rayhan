import { list, put } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONFIG_PATH = 'config/audio-library.json';
const DEFAULT_BACKGROUND_SCHEDULE = {
  startTime: '06:00',
  endTime: '17:45',
};

function createDefaultLibrary() {
  return {
    background: null,
    announcements: [],
    backgroundSchedule: DEFAULT_BACKGROUND_SCHEDULE,
  };
}

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

function normalizeBackground(background) {
  if (!background?.blobId || !background?.fileUrl) {
    return null;
  }

  return {
    blobId: String(background.blobId),
    fileUrl: String(background.fileUrl),
    name: String(background.name || ''),
    uploadedAt: Number(background.uploadedAt || Date.now()),
  };
}

function normalizeAnnouncement(announcement) {
  if (!announcement?.id || !announcement?.title || !announcement?.time || !announcement?.blobId || !announcement?.fileUrl) {
    return null;
  }

  const repeatCount = Math.max(1, Number.parseInt(announcement.repeatCount, 10) || 1);

  return {
    id: String(announcement.id),
    title: String(announcement.title).trim(),
    time: String(announcement.time),
    blobId: String(announcement.blobId),
    fileUrl: String(announcement.fileUrl),
    enabled: announcement.enabled !== false,
    repeatCount,
    createdAt: Number(announcement.createdAt || Date.now()),
  };
}

function normalizeBackgroundSchedule(backgroundSchedule) {
  const startTime = String(backgroundSchedule?.startTime || DEFAULT_BACKGROUND_SCHEDULE.startTime);
  const endTime = String(backgroundSchedule?.endTime || DEFAULT_BACKGROUND_SCHEDULE.endTime);

  if (!startTime.includes(':') || !endTime.includes(':')) {
    return DEFAULT_BACKGROUND_SCHEDULE;
  }

  return {
    startTime,
    endTime,
  };
}

function normalizeLibrary(data) {
  const base = createDefaultLibrary();

  return {
    ...base,
    background: normalizeBackground(data?.background),
    announcements: Array.isArray(data?.announcements)
      ? data.announcements.map(normalizeAnnouncement).filter(Boolean).sort((a, b) => a.time.localeCompare(b.time))
      : base.announcements,
    backgroundSchedule: normalizeBackgroundSchedule(data?.backgroundSchedule),
  };
}

async function getConfigBlob() {
  const response = await list({
    prefix: CONFIG_PATH,
    limit: 100,
  });

  const matches = response.blobs
    .filter((blob) => blob.pathname === CONFIG_PATH)
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

  return matches[0] || null;
}

async function readLibrary() {
  const blob = await getConfigBlob();
  if (!blob) {
    return createDefaultLibrary();
  }

  const response = await fetch(blob.url, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to read audio library: HTTP ${response.status}`);
  }

  const payload = await response.json();
  return normalizeLibrary(payload);
}

async function writeLibrary(library) {
  const normalized = normalizeLibrary(library);

  await put(CONFIG_PATH, JSON.stringify(normalized, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });

  return normalized;
}

export async function GET() {
  try {
    const library = await readLibrary();
    return jsonResponse(library);
  } catch (error) {
    console.error('Failed to load shared audio config:', error);
    return jsonResponse({ error: error.message || 'Failed to load shared audio config.' }, 500);
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = body?.action;
    const currentLibrary = await readLibrary();

    if (action === 'set-background') {
      const nextBackground = normalizeBackground(body.background);

      if (!nextBackground) {
        return jsonResponse({ error: 'Background metadata tidak valid.' }, 400);
      }

      const updatedLibrary = await writeLibrary({
        ...currentLibrary,
        background: nextBackground,
      });

      return jsonResponse({
        background: updatedLibrary.background,
        previousBackground: currentLibrary.background,
        announcements: updatedLibrary.announcements,
        backgroundSchedule: updatedLibrary.backgroundSchedule,
      });
    }

    if (action === 'set-background-schedule') {
      const nextBackgroundSchedule = normalizeBackgroundSchedule(body.backgroundSchedule);

      const updatedLibrary = await writeLibrary({
        ...currentLibrary,
        backgroundSchedule: nextBackgroundSchedule,
      });

      return jsonResponse(updatedLibrary);
    }

    if (action === 'add-announcement') {
      const nextAnnouncement = normalizeAnnouncement(body.announcement);

      if (!nextAnnouncement) {
        return jsonResponse({ error: 'Announcement metadata tidak valid.' }, 400);
      }

      const updatedLibrary = await writeLibrary({
        ...currentLibrary,
        announcements: [...currentLibrary.announcements, nextAnnouncement],
      });

      return jsonResponse(updatedLibrary);
    }

    if (action === 'delete-announcement') {
      const announcementId = String(body.id || '');
      const deletedAnnouncement = currentLibrary.announcements.find((item) => item.id === announcementId) || null;

      const updatedLibrary = await writeLibrary({
        ...currentLibrary,
        announcements: currentLibrary.announcements.filter((item) => item.id !== announcementId),
      });

      return jsonResponse({
        ...updatedLibrary,
        deletedAnnouncement,
      });
    }

    if (action === 'toggle-announcement') {
      const announcementId = String(body.id || '');
      const hasAnnouncement = currentLibrary.announcements.some((item) => item.id === announcementId);

      if (!hasAnnouncement) {
        return jsonResponse({ error: 'Announcement tidak ditemukan.' }, 404);
      }

      const updatedLibrary = await writeLibrary({
        ...currentLibrary,
        announcements: currentLibrary.announcements.map((item) =>
          item.id === announcementId ? { ...item, enabled: !item.enabled } : item
        ),
      });

      return jsonResponse(updatedLibrary);
    }

    return jsonResponse({ error: 'Action tidak valid.' }, 400);
  } catch (error) {
    console.error('Failed to update shared audio config:', error);
    return jsonResponse({ error: error.message || 'Failed to update shared audio config.' }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
  });
}
