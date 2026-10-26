const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB total

const AUDIO_CONTENT_TYPE_BY_EXTENSION = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

const AUDIO_CONTENT_TYPES = Object.values(AUDIO_CONTENT_TYPE_BY_EXTENSION);

// Ekstensi file yang aman dipakai di pathname Blob (hanya huruf kecil/angka, default mp3).
export function getSafeAudioExtension(file) {
  const fileName = String(file?.name || '');
  const segments = fileName.split('.');
  const ext = segments.length > 1 ? segments.pop() : '';
  return String(ext || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
}

function getBrowserType(file) {
  return String(file?.type || '').toLowerCase().trim();
}

export function resolveAudioContentType(file) {
  const browserType = getBrowserType(file);
  if (AUDIO_CONTENT_TYPES.includes(browserType)) {
    return browserType;
  }

  return AUDIO_CONTENT_TYPE_BY_EXTENSION[getSafeAudioExtension(file)] || 'audio/mpeg';
}

// Diterima jika browser tidak melaporkan tipe (dianggap audio/mpeg), tipenya audio/*,
// atau ekstensinya dikenal sebagai audio.
export function isSupportedAudioFile(file) {
  const browserType = getBrowserType(file);
  return (
    !browserType ||
    browserType.startsWith('audio/') ||
    getSafeAudioExtension(file) in AUDIO_CONTENT_TYPE_BY_EXTENSION
  );
}

export { AUDIO_CONTENT_TYPES, MAX_AUDIO_SIZE };
