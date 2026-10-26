import { head, put } from '@vercel/blob';
import { forbiddenResponse, isSameOriginRequest } from '../../../../lib/request-guard';
import { isRateLimited, tooManyRequestsResponse } from '../../../../lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONFIG_PATH = 'config/audio-library.json';
const LIBRARY_CACHE_TTL_MS = 30 * 1000;
const DEFAULT_BACKGROUND_SCHEDULE = {
  startTime: '06:00',
  endTime: '17:45',
};

let cachedLibrary = null;
let cachedLibraryExpiresAt = 0;

const DEFAULT_ADZAN_URLS = {
  normal: '',
  subuh: '',
};

function createDefaultLibrary() {
  return {
    background: null,
    announcements: [],
    backgroundSchedule: DEFAULT_BACKGROUND_SCHEDULE,
    adzan: DEFAULT_ADZAN_URLS,
  };
}

function normalizeAdzanUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch (error) {
    return '';
  }
}

function normalizeAdzan(adzan) {
  return {
    normal: normalizeAdzanUrl(adzan?.normal),
    subuh: normalizeAdzanUrl(adzan?.subuh),
  };
}

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TITLE_LENGTH = 120;
const MAX_ANNOUNCEMENTS = 200;

// File audio hanya boleh berasal dari Vercel Blob (https) dan berada di folder audio/
function normalizeBlobFileUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:') return '';
    if (!parsed.hostname.endsWith('.public.blob.vercel-storage.com')) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function isSafeBlobId(value) {
  const id = String(value || '');
  return id.startsWith('audio/') && !id.includes('..') && !id.includes('\\') && id.length <= 300;
}

function normalizeBackground(background) {
  const fileUrl = normalizeBlobFileUrl(background?.fileUrl);

  if (!isSafeBlobId(background?.blobId) || !fileUrl) {
    return null;
  }

  return {
    blobId: String(background.blobId),
    fileUrl,
    name: String(background.name || '').slice(0, 200),
    uploadedAt: Number(background.uploadedAt || Date.now()),
  };
}

function normalizeAnnouncement(announcement) {
  const fileUrl = normalizeBlobFileUrl(announcement?.fileUrl);
  const title = String(announcement?.title || '').trim().slice(0, MAX_TITLE_LENGTH);

  if (
    !announcement?.id ||
    !title ||
    !TIME_PATTERN.test(String(announcement?.time || '')) ||
    !isSafeBlobId(announcement?.blobId) ||
    !fileUrl
  ) {
    return null;
  }

  const repeatCount = Math.min(20, Math.max(1, Number.parseInt(announcement.repeatCount, 10) || 1));

  // Pengulangan berkala: putar tiap N menit dari `time` sampai `endTime` (hari yang sama).
  // intervalMinutes 0 = hanya sekali pada `time`.
  const endTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(announcement.endTime || ''))
    ? String(announcement.endTime)
    : '';
  const requestedInterval = Math.max(0, Number.parseInt(announcement.intervalMinutes, 10) || 0);
  const intervalMinutes = requestedInterval > 0 && endTime && endTime >= String(announcement.time) ? requestedInterval : 0;

  return {
    id: String(announcement.id).slice(0, 100),
    title,
    time: String(announcement.time),
    intervalMinutes,
    endTime: intervalMinutes > 0 ? endTime : '',
    blobId: String(announcement.blobId),
    fileUrl,
    enabled: announcement.enabled !== false,
    repeatCount,
    createdAt: Number(announcement.createdAt || Date.now()),
  };
}

function normalizeBackgroundSchedule(backgroundSchedule) {
  const startTime = String(backgroundSchedule?.startTime || DEFAULT_BACKGROUND_SCHEDULE.startTime);
  const endTime = String(backgroundSchedule?.endTime || DEFAULT_BACKGROUND_SCHEDULE.endTime);

  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
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
      ? data.announcements
          .map(normalizeAnnouncement)
          .filter(Boolean)
          .sort((a, b) => a.time.localeCompare(b.time))
      : base.announcements,
    backgroundSchedule: normalizeBackgroundSchedule(data?.backgroundSchedule),
    adzan: normalizeAdzan(data?.adzan),
  };
}

function getCachedLibrary() {
  if (cachedLibrary && Date.now() < cachedLibraryExpiresAt) {
    return cachedLibrary;
  }

  return null;
}

function setCachedLibrary(library) {
  cachedLibrary = normalizeLibrary(library);
  cachedLibraryExpiresAt = Date.now() + LIBRARY_CACHE_TTL_MS;
  return cachedLibrary;
}

function isBlobNotFoundError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.name === 'BlobNotFoundError' ||
    error?.code === 'not_found' ||
    message.includes('not found') ||
    message.includes('404')
  );
}

async function readLibrary({ bypassCache = false } = {}) {
  if (!bypassCache) {
    const cached = getCachedLibrary();
    if (cached) {
      return cached;
    }
  }

  let blob;
  try {
    blob = await head(CONFIG_PATH);
  } catch (error) {
    if (isBlobNotFoundError(error)) {
      return setCachedLibrary(createDefaultLibrary());
    }

    throw error;
  }

  const response = await fetch(blob.url, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to read audio library: HTTP ${response.status}`);
  }

  const payload = await response.json();
  return setCachedLibrary(payload);
}

async function writeLibrary(library) {
  const normalized = normalizeLibrary(library);

  await put(CONFIG_PATH, JSON.stringify(normalized, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    // @vercel/blob 2.x menolak menimpa file yang ada tanpa opsi ini; config memang selalu ditimpa
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });

  return setCachedLibrary(normalized);
}

export async function GET() {
  try {
    const library = await readLibrary();
    return jsonResponse(library);
  } catch (error) {
    console.error('Failed to load shared audio config:', error);
    // Jangan bocorkan pesan error internal (path, status Blob, dsb.) ke client.
    return jsonResponse({ error: 'Failed to load shared audio config.' }, 500);
  }
}

export async function POST(request) {
  if (!isSameOriginRequest(request)) {
    return forbiddenResponse();
  }

  try {
    if (isRateLimited(request, 'library-write', { limit: 60, windowMs: 60 * 1000 })) {
      return tooManyRequestsResponse();
    }

    const body = await request.json();
    const action = body?.action;
    const currentLibrary = await readLibrary({ bypassCache: true });

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

    if (action === 'set-adzan-urls') {
      const submitted = body.adzan || {};
      const nextAdzan = { ...currentLibrary.adzan };

      // Hanya field yang dikirim yang diubah, supaya update Subuh tidak menimpa URL biasa
      for (const type of ['normal', 'subuh']) {
        if (!(type in submitted)) continue;

        const rawValue = String(submitted[type] || '').trim();
        const normalizedValue = normalizeAdzanUrl(rawValue);

        if (rawValue && !normalizedValue) {
          return jsonResponse({ error: 'URL adzan tidak valid. Gunakan alamat http:// atau https://' }, 400);
        }

        nextAdzan[type] = normalizedValue;
      }

      const updatedLibrary = await writeLibrary({
        ...currentLibrary,
        adzan: nextAdzan,
      });

      return jsonResponse(updatedLibrary);
    }

    if (action === 'add-announcement') {
      const nextAnnouncement = normalizeAnnouncement(body.announcement);

      if (!nextAnnouncement) {
        return jsonResponse({ error: 'Announcement metadata tidak valid.' }, 400);
      }

      if (currentLibrary.announcements.length >= MAX_ANNOUNCEMENTS) {
        return jsonResponse({ error: 'Jumlah announcement sudah mencapai batas.' }, 400);
      }

      const updatedLibrary = await writeLibrary({
        ...currentLibrary,
        announcements: [...currentLibrary.announcements, nextAnnouncement],
      });

      return jsonResponse(updatedLibrary);
    }

    if (action === 'update-announcement') {
      const submitted = body.announcement;
      const previous = currentLibrary.announcements.find((item) => item.id === submitted?.id);
      if (!previous) {
        return jsonResponse({ error: 'Announcement tidak ditemukan.' }, 404);
      }
      const nextAnnouncement = normalizeAnnouncement({
        ...previous,
        ...submitted,
        id: previous.id,
        enabled: previous.enabled,
        createdAt: previous.createdAt,
      });
      if (!nextAnnouncement) {
        return jsonResponse({ error: 'Announcement metadata tidak valid.' }, 400);
      }
      const updatedLibrary = await writeLibrary({
        ...currentLibrary,
        announcements: currentLibrary.announcements.map((item) =>
          item.id === previous.id ? nextAnnouncement : item
        ),
      });
      return jsonResponse(updatedLibrary);
    }

    if (action === 'delete-announcement') {
      const announcementId = String(body.id || '');
      const deletedAnnouncement =
        currentLibrary.announcements.find((item) => item.id === announcementId) || null;

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
    return jsonResponse({ error: 'Failed to update shared audio config.' }, 500);
  }
}
