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

function getFileExtension(file) {
  const fileName = String(file?.name || '');
  const segments = fileName.split('.');
  const ext = segments.length > 1 ? segments.pop() : '';
  return String(ext || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
}

export function getSafeAudioExtension(file) {
  return getFileExtension(file);
}

export function resolveAudioContentType(file) {
  const browserType = String(file?.type || '').toLowerCase().trim();

  if (AUDIO_CONTENT_TYPES.includes(browserType)) {
    return browserType;
  }

  const extension = getFileExtension(file);
  return AUDIO_CONTENT_TYPE_BY_EXTENSION[extension] || 'audio/mpeg';
}

export function isSupportedAudioFile(file) {
  const browserType = String(file?.type || '').toLowerCase().trim();

  if (!browserType) {
    return Boolean(resolveAudioContentType(file));
  }

  if (browserType.startsWith('audio/')) {
    return true;
  }

  const extension = getFileExtension(file);
  return extension in AUDIO_CONTENT_TYPE_BY_EXTENSION;
}

export { AUDIO_CONTENT_TYPES, MAX_AUDIO_SIZE };
