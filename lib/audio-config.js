async function requestSharedAudioConfig(method = 'GET', body) {
  const response = await fetch('/api/audio/library', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Request failed with status ${response.status}`);
  }

  return response.json();
}

export async function getSharedAudioConfig() {
  return requestSharedAudioConfig('GET');
}

export async function setSharedBackground(background) {
  return requestSharedAudioConfig('POST', {
    action: 'set-background',
    background,
  });
}

export async function addSharedAnnouncement(announcement) {
  return requestSharedAudioConfig('POST', {
    action: 'add-announcement',
    announcement,
  });
}

export async function deleteSharedAnnouncement(id) {
  return requestSharedAudioConfig('POST', {
    action: 'delete-announcement',
    id,
  });
}

export async function toggleSharedAnnouncement(id) {
  return requestSharedAudioConfig('POST', {
    action: 'toggle-announcement',
    id,
  });
}
