'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadAudioFile, deleteAudioFile, getAudioFileUrl } from '../lib/blob';

const DEFAULT_PRAYER_TIMES = {
  subuh: '04:30',
  dzuhur: '12:00',
  ashar: '15:15',
  maghrib: '18:00',
  isya: '19:15',
};

const DEFAULT_PRAYER_OFFSETS = {
  subuh: 0,
  dzuhur: 0,
  ashar: 0,
  maghrib: 0,
  isya: 0,
};

const DEFAULT_PRAYER_CONFIG = {
  mode: 'auto',
  method: 20,
  latitude: '',
  longitude: '',
  locationLabel: '',
  useBrowserLocation: true,
};

const DEFAULT_PRAYER_API_CACHE = {
  dateKey: '',
  fetchedAt: null,
  source: '',
  timezone: '',
  requestKey: '',
  timings: DEFAULT_PRAYER_TIMES,
};

const STORAGE_KEYS = {
  manualPrayerTimes: 'app-prayer-times-v2',
  prayerPauseMinutes: 'app-prayer-pause-minutes-v1',
  prayerOffsets: 'app-prayer-offsets-v2',
  prayerConfig: 'app-prayer-config-v2',
  prayerApiCache: 'app-prayer-api-cache-v2',
  announcements: 'app-announcements-v1',
  backgroundMeta: 'app-background-meta-v1',
  settings: 'app-settings-v1',
  pendingQueue: 'app-pending-queue-v1',
  backgroundSchedule: 'app-background-schedule-v1',
};

const PRAYER_METHOD_OPTIONS = [
  { value: 20, label: 'Kementerian Agama RI (default)' },
  { value: 11, label: 'Singapore / Muis' },
  { value: 17, label: 'JAKIM Malaysia' },
  { value: 3, label: 'Umm Al-Qura Makkah' },
  { value: 4, label: 'Karachi' },
  { value: 8, label: 'Gulf Region' },
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatClock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeToMinutes(time) {
  if (!time || !time.includes(':')) return 0;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function minutesToTime(totalMinutes) {
  const normalized = ((Number(totalMinutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${pad(hour)}:${pad(minute)}`;
}

function normalizeApiTime(value) {
  if (!value) return '00:00';
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return '00:00';
  return `${pad(Number(match[1]))}:${match[2]}`;
}

function applyOffsetsToPrayerTimes(baseTimes, offsets) {
  return Object.keys(DEFAULT_PRAYER_TIMES).reduce((acc, key) => {
    const base = timeToMinutes(baseTimes[key]);
    const offset = Number(offsets[key] || 0);
    acc[key] = minutesToTime(base + offset);
    return acc;
  }, {});
}

function isNowInsidePrayerWindow(prayerTimes, pauseMinutes, now = new Date()) {
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  for (const [name, time] of Object.entries(prayerTimes)) {
    const start = timeToMinutes(time);
    const end = start + Number(pauseMinutes || 0);

    if (minutesNow >= start && minutesNow < end) {
      return {
        active: true,
        prayerName: name,
        start,
        end,
      };
    }
  }

  return {
    active: false,
    prayerName: null,
    start: null,
    end: null,
  };
}

function isNowInsideBackgroundWindow(startTime, endTime, now = new Date()) {
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  if (start <= end) {
    return minutesNow >= start && minutesNow < end;
  } else {
    // Handle wrap-around midnight: e.g., 22:00 to 06:00
    return minutesNow >= start || minutesNow < end;
  }
}

function toPrayerLabel(key) {
  return (
    {
      subuh: 'Subuh',
      dzuhur: 'Dzuhur',
      ashar: 'Ashar',
      maghrib: 'Maghrib',
      isya: 'Isya',
    }[key] || key
  );
}

function createId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDuration(seconds) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  return `${pad(minutes)}:${pad(secs)}`;
}

function formatOffsetLabel(value) {
  const number = Number(value || 0);
  if (number === 0) return '0 menit';
  return `${number > 0 ? '+' : ''}${number} menit`;
}

function getPrayerMethodLabel(method) {
  return PRAYER_METHOD_OPTIONS.find((item) => item.value === Number(method))?.label || `Method ${method}`;
}

function hasValidCoordinates(config) {
  const lat = Number(config.latitude);
  const lng = Number(config.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export default function Page() {
  const [now, setNow] = useState(new Date());
  const [audioReady, setAudioReady] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [status, setStatus] = useState({ type: 'info', message: 'Siap. Klik "Aktifkan Audio" terlebih dahulu.' });

  const [manualPrayerTimes, setManualPrayerTimes] = useState(DEFAULT_PRAYER_TIMES);
  const [prayerPauseMinutes, setPrayerPauseMinutes] = useState(30);
  const [prayerOffsets, setPrayerOffsets] = useState(DEFAULT_PRAYER_OFFSETS);
  const [prayerConfig, setPrayerConfig] = useState(DEFAULT_PRAYER_CONFIG);
  const [prayerApiCache, setPrayerApiCache] = useState(DEFAULT_PRAYER_API_CACHE);
  const [prayerLoading, setPrayerLoading] = useState(false);

  const [backgroundMeta, setBackgroundMeta] = useState(null);
  const [backgroundUrl, setBackgroundUrl] = useState('');
  const [backgroundEnabled, setBackgroundEnabled] = useState(true);
  const [backgroundVolume, setBackgroundVolume] = useState(0.35);
  const [backgroundStartTime, setBackgroundStartTime] = useState('00:00');
  const [backgroundEndTime, setBackgroundEndTime] = useState('23:59');
  const [showBackgroundScheduleModal, setShowBackgroundScheduleModal] = useState(false);

  const [announcements, setAnnouncements] = useState([]);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [activeAnnouncementId, setActiveAnnouncementId] = useState(null);
  const [announcementVolume, setAnnouncementVolume] = useState(1);

  const [newAnnouncementTitle, setNewAnnouncementTitle] = useState('');
  const [newAnnouncementTime, setNewAnnouncementTime] = useState('08:00');
  const [newAnnouncementFileName, setNewAnnouncementFileName] = useState('');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showPrayerModal, setShowPrayerModal] = useState(false);
  const newAnnouncementFileRef = useRef(null);
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);

  const backgroundAudioRef = useRef(null);
  const announcementAudioRef = useRef(null);
  const pendingPlayAfterUnlockRef = useRef(false);
  const lastTickMinuteRef = useRef('');
  const objectUrlsRef = useRef([]);
  const attemptedInitialLocationRef = useRef(false);

  const todayKey = useMemo(() => formatDateKey(now), [now]);

  const basePrayerTimes = prayerConfig.mode === 'auto' ? prayerApiCache.timings : manualPrayerTimes;
  const effectivePrayerTimes = useMemo(
    () => applyOffsetsToPrayerTimes(basePrayerTimes, prayerOffsets),
    [basePrayerTimes, prayerOffsets]
  );

  const prayerState = useMemo(
    () => isNowInsidePrayerWindow(effectivePrayerTimes, prayerPauseMinutes, now),
    [effectivePrayerTimes, prayerPauseMinutes, now]
  );

  const nextAnnouncements = useMemo(() => {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return [...announcements]
      .filter((item) => item.enabled)
      .map((item) => ({ ...item, minutes: timeToMinutes(item.time) }))
      .sort((a, b) => a.minutes - b.minutes)
      .map((item) => ({
        ...item,
        diff: item.minutes >= nowMinutes ? item.minutes - nowMinutes : 1440 - nowMinutes + item.minutes,
      }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 5);
  }, [announcements, now]);

  function pushStatus(message, type = 'info') {
    setStatus({ message, type });
  }

  function createFileUrl(file) {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.push(url);
    return url;
  }

  function revokeAllObjectUrls() {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }

  function persistManualPrayerTimes(value) {
    localStorage.setItem(STORAGE_KEYS.manualPrayerTimes, JSON.stringify(value));
  }

  function persistPrayerPauseMinutes(value) {
    localStorage.setItem(STORAGE_KEYS.prayerPauseMinutes, String(value));
  }

  function persistPrayerOffsets(value) {
    localStorage.setItem(STORAGE_KEYS.prayerOffsets, JSON.stringify(value));
  }

  function persistPrayerConfig(value) {
    localStorage.setItem(STORAGE_KEYS.prayerConfig, JSON.stringify(value));
  }

  function persistPrayerApiCache(value) {
    localStorage.setItem(STORAGE_KEYS.prayerApiCache, JSON.stringify(value));
  }

  function persistAnnouncements(value) {
    localStorage.setItem(STORAGE_KEYS.announcements, JSON.stringify(value));
  }

  function persistBackgroundMeta(value) {
    if (!value) {
      localStorage.removeItem(STORAGE_KEYS.backgroundMeta);
      return;
    }
    localStorage.setItem(STORAGE_KEYS.backgroundMeta, JSON.stringify(value));
  }

  function persistSettings(value) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(value));
  }

  function persistPendingQueue(value) {
    localStorage.setItem(STORAGE_KEYS.pendingQueue, JSON.stringify(value));
  }

  function persistBackgroundSchedule(startTime, endTime) {
    localStorage.setItem(STORAGE_KEYS.backgroundSchedule, JSON.stringify({ startTime, endTime }));
  }

  function loadBackgroundSchedule() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.backgroundSchedule);
      if (stored) {
        const { startTime, endTime } = JSON.parse(stored);
        if (startTime) setBackgroundStartTime(startTime);
        if (endTime) setBackgroundEndTime(endTime);
      }
    } catch (err) {
      console.warn('Failed to load background schedule', err);
    }
  }

  async function safelyPlay(audioEl) {
    if (!audioEl) return false;
    try {
      await audioEl.play();
      return true;
    } catch (error) {
      // Ignore AbortError - this happens when src is changed during playback
      if (error.name === 'AbortError') {
        return false;
      }
      console.error(error);
      pendingPlayAfterUnlockRef.current = true;
      setAudioReady(false);
      pushStatus('Browser menahan autoplay. Klik "Aktifkan Audio" untuk mengizinkan pemutaran.', 'warning');
      return false;
    }
  }

  function pauseBackground() {
    const audio = backgroundAudioRef.current;
    if (!audio) return;
    audio.pause();
  }

  async function resumeBackground(reason = '') {
    const audio = backgroundAudioRef.current;
    if (!audio || !backgroundUrl || !backgroundEnabled) {
      console.debug('resumeBackground blocked', { audio: !!audio, backgroundUrl: !!backgroundUrl, backgroundEnabled });
      return;
    }
    if (activeAnnouncementId) {
      console.debug('resumeBackground blocked: active announcement');
      return;
    }
    if (prayerState.active) {
      console.debug('resumeBackground blocked: prayer active');
      return;
    }
    
    // Check if current time is within background schedule
    const isInSchedule = isNowInsideBackgroundWindow(backgroundStartTime, backgroundEndTime, now);
    console.debug('resumeBackground schedule check', { backgroundStartTime, backgroundEndTime, now: `${pad(now.getHours())}:${pad(now.getMinutes())}`, isInSchedule });
    if (!isInSchedule) {
      console.debug('resumeBackground blocked: outside schedule');
      return;
    }

    audio.loop = true;
    audio.volume = backgroundVolume;

    console.log('Attempting to play background audio');
    const success = await safelyPlay(audio);
    if (success && reason) {
      pushStatus(reason, 'success');
    }
  }

  async function playAnnouncementNow(item, triggerLabel = 'manual') {
    if (!item) return;

    // Get audio URL directly from metadata (no file loading needed)
    const audioUrl = await getAudioFileUrl(item.blobId, item.fileUrl);
    
    console.log('playAnnouncementNow - URL Check:', {
      itemId: item.id,
      itemTitle: item.title,
      blobId: item.blobId,
      inputUrl: item.fileUrl,
      resolvedUrl: audioUrl,
    });
    
    if (!audioUrl) {
      pushStatus(`File untuk announcement "${item.title}" tidak ditemukan. Upload ulang file-nya.`, 'error');
      return;
    }

    const audio = announcementAudioRef.current;
    if (!audio) return;

    pauseBackground();

    audio.pause();
    audio.currentTime = 0;
    audio.volume = announcementVolume;
    
    // Set src with better error handling
    try {
      audio.src = audioUrl;
      audio.crossOrigin = 'anonymous';
    } catch (e) {
      console.error('Failed to set audio src:', e);
      pushStatus(`Gagal memuat audio: ${e.message}`, 'error');
      return;
    }

    setActiveAnnouncementId(item.id);
    const played = await safelyPlay(audio);

    if (!played) {
      setActiveAnnouncementId(null);
      return;
    }

    const label = triggerLabel === 'schedule' ? 'jadwal' : 'manual';
    pushStatus(`Memutar announcement (${label}): ${item.title}`, 'success');
  }

  async function processQueueIfPossible() {
    if (prayerState.active) return;
    if (activeAnnouncementId) return;
    if (!pendingQueue.length) {
      await resumeBackground('Backsound standby aktif.');
      return;
    }

    const nextId = pendingQueue[0];
    const item = announcements.find((entry) => entry.id === nextId);

    if (!item) {
      const updated = pendingQueue.slice(1);
      setPendingQueue(updated);
      persistPendingQueue(updated);
      return;
    }

    await playAnnouncementNow(item, 'schedule');
  }

  async function fetchPrayerTimesFromApi({ quiet = false, customConfig } = {}) {
    const config = customConfig || prayerConfig;
    if (!hasValidCoordinates(config)) {
      if (!quiet) pushStatus('Koordinat belum valid. Isi latitude dan longitude atau ambil dari lokasi browser.', 'error');
      return false;
    }

    const latitude = Number(config.latitude);
    const longitude = Number(config.longitude);
    const requestKey = `${todayKey}|${latitude.toFixed(6)}|${longitude.toFixed(6)}|${config.method}`;

    setPrayerLoading(true);

    try {
      const [year, month, day] = todayKey.split('-');
      const datePath = `${day}-${month}-${year}`;
      const url = `https://api.aladhan.com/v1/timings/${datePath}?latitude=${latitude}&longitude=${longitude}&method=${config.method}`;
      
      const response = await fetch(url, { cache: 'no-store' });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errorText || 'API Error'}`);
      }

      const payload = await response.json();
      const data = payload?.data;
      
      if (!payload.data || !data.timings) {
        throw new Error('Format data API tidak sesuai.');
      }

      const timings = data.timings;

      const nextTimings = {
        subuh: normalizeApiTime(timings.Fajr),
        dzuhur: normalizeApiTime(timings.Dhuhr),
        ashar: normalizeApiTime(timings.Asr),
        maghrib: normalizeApiTime(timings.Maghrib),
        isya: normalizeApiTime(timings.Isha),
      };

      const nextCache = {
        dateKey: todayKey,
        fetchedAt: Date.now(),
        source: config.locationLabel || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        timezone: data?.meta?.timezone || '',
        requestKey,
        timings: nextTimings,
      };

      setPrayerApiCache(nextCache);
      persistPrayerApiCache(nextCache);
      if (!quiet) {
        pushStatus(`Jadwal sholat berhasil diambil dari API untuk ${nextCache.source}.`, 'success');
      }
      return true;
    } catch (error) {
      console.error('Error fetching prayer times:', error);
      if (!quiet) {
        pushStatus(`Gagal mengambil jadwal sholat dari API: ${error.message}. Anda masih bisa pakai mode manual.`, 'error');
      }
      return false;
    } finally {
      setPrayerLoading(false);
    }
  }

  async function requestBrowserLocation({ quiet = false, refreshAfter = true } = {}) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      if (!quiet) pushStatus('Browser ini tidak mendukung geolocation.', 'error');
      return false;
    }

    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 300000,
      });
    }).catch((error) => {
      console.error(error);
      if (!quiet) {
        pushStatus('Izin lokasi ditolak atau lokasi tidak tersedia. Isi koordinat manual jika diperlukan.', 'warning');
      }
      return null;
    });

    if (!position) return false;

    const latitude = Number(position.coords.latitude).toFixed(6);
    const longitude = Number(position.coords.longitude).toFixed(6);
    const accuracy = Math.round(position.coords.accuracy || 0);
    const nextConfig = {
      ...prayerConfig,
      latitude,
      longitude,
      locationLabel: accuracy > 0 ? `Lokasi browser (akurasi ±${accuracy} m)` : 'Lokasi browser',
      useBrowserLocation: true,
    };

    setPrayerConfig(nextConfig);
    persistPrayerConfig(nextConfig);

    if (!quiet) {
      pushStatus(`Lokasi browser berhasil didapat: ${latitude}, ${longitude}.`, 'success');
    }

    if (refreshAfter) {
      return fetchPrayerTimesFromApi({ quiet, customConfig: nextConfig });
    }

    return true;
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const savedManualPrayerTimes = localStorage.getItem(STORAGE_KEYS.manualPrayerTimes);
    const savedPrayerPauseMinutes = localStorage.getItem(STORAGE_KEYS.prayerPauseMinutes);
    const savedPrayerOffsets = localStorage.getItem(STORAGE_KEYS.prayerOffsets);
    const savedPrayerConfig = localStorage.getItem(STORAGE_KEYS.prayerConfig);
    const savedPrayerApiCache = localStorage.getItem(STORAGE_KEYS.prayerApiCache);
    const savedAnnouncements = localStorage.getItem(STORAGE_KEYS.announcements);
    const savedBackgroundMeta = localStorage.getItem(STORAGE_KEYS.backgroundMeta);
    const savedSettings = localStorage.getItem(STORAGE_KEYS.settings);
    const savedPendingQueue = localStorage.getItem(STORAGE_KEYS.pendingQueue);

    if (savedManualPrayerTimes) setManualPrayerTimes(JSON.parse(savedManualPrayerTimes));
    if (savedPrayerPauseMinutes) setPrayerPauseMinutes(Number(savedPrayerPauseMinutes));
    if (savedPrayerOffsets) setPrayerOffsets({ ...DEFAULT_PRAYER_OFFSETS, ...JSON.parse(savedPrayerOffsets) });
    
    if (savedPrayerConfig) {
      const parsed = JSON.parse(savedPrayerConfig);
      // Validasi koordinat dari localStorage
      const lat = Number(parsed.latitude);
      const lng = Number(parsed.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        // Jika koordinat invalid, reset ke default
        parsed.latitude = '';
        parsed.longitude = '';
      }
      setPrayerConfig({ ...DEFAULT_PRAYER_CONFIG, ...parsed });
    }
    
    if (savedPrayerApiCache) setPrayerApiCache({ ...DEFAULT_PRAYER_API_CACHE, ...JSON.parse(savedPrayerApiCache) });
    if (savedAnnouncements) setAnnouncements(JSON.parse(savedAnnouncements));
    if (savedBackgroundMeta) setBackgroundMeta(JSON.parse(savedBackgroundMeta));
    if (savedPendingQueue) setPendingQueue(JSON.parse(savedPendingQueue));

    if (savedSettings) {
      const parsed = JSON.parse(savedSettings);
      if (typeof parsed.backgroundEnabled === 'boolean') setBackgroundEnabled(parsed.backgroundEnabled);
      if (typeof parsed.backgroundVolume === 'number') setBackgroundVolume(parsed.backgroundVolume);
      if (typeof parsed.announcementVolume === 'number') setAnnouncementVolume(parsed.announcementVolume);
    }

    loadBackgroundSchedule();
    setBootstrapped(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBackground() {
      if (!backgroundMeta?.blobId) {
        setBackgroundUrl('');
        return;
      }

      // Use URL directly from metadata (stored in Vercel Blob)
      const url = await getAudioFileUrl(backgroundMeta.blobId, backgroundMeta.fileUrl);
      if (!url || cancelled) {
        setBackgroundUrl('');
        return;
      }

      setBackgroundUrl(url);

      // Pastikan audio element mendapat src yang benar
      const audioEl = backgroundAudioRef.current;
      if (audioEl) {
        audioEl.src = url;
      }
    }

    loadBackground();

    return () => {
      cancelled = true;
    };
  }, [backgroundMeta]);

  useEffect(() => {
    if (!bootstrapped) return;
    persistSettings({ backgroundEnabled, backgroundVolume, announcementVolume });
  }, [backgroundEnabled, backgroundVolume, announcementVolume, bootstrapped]);

  useEffect(() => {
    const bg = backgroundAudioRef.current;
    if (!bg) return;
    bg.volume = backgroundVolume;
  }, [backgroundVolume]);

  useEffect(() => {
    // Sinkronisasi src audio element dengan backgroundUrl
    const audioEl = backgroundAudioRef.current;
    if (audioEl && backgroundUrl) {
      audioEl.src = backgroundUrl;
    }
  }, [backgroundUrl]);

  useEffect(() => {
    const player = announcementAudioRef.current;
    if (!player) return;
    player.volume = announcementVolume;
  }, [announcementVolume]);

  useEffect(() => {
    if (prayerState.active) {
      pauseBackground();
      if (!activeAnnouncementId) {
        pushStatus(`Backsound dijeda karena masuk waktu ${toPrayerLabel(prayerState.prayerName)}.`, 'warning');
      }
      return;
    }

    processQueueIfPossible();
  }, [prayerState.active, prayerState.prayerName]);

  useEffect(() => {
    if (!backgroundEnabled) {
      pauseBackground();
      return;
    }

    if (!audioReady) return;
    if (prayerState.active) return;
    if (activeAnnouncementId) return;
    if (pendingQueue.length > 0) return;
    if (!backgroundUrl) return;
    
    // Check if current time is within background schedule
    if (!isNowInsideBackgroundWindow(backgroundStartTime, backgroundEndTime, now)) {
      pauseBackground();
      return;
    }

    resumeBackground();
  }, [backgroundEnabled, audioReady, prayerState.active, activeAnnouncementId, pendingQueue.length, backgroundUrl, now, backgroundStartTime, backgroundEndTime]);

  useEffect(() => {
    if (!audioReady) return;
    if (prayerState.active) return;
    if (activeAnnouncementId) return;
    if (pendingQueue.length === 0) return;

    processQueueIfPossible();
  }, [pendingQueue.length, activeAnnouncementId, prayerState.active, audioReady]);

  useEffect(() => {
    if (!bootstrapped) return;

    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (lastTickMinuteRef.current === minuteKey) return;
    lastTickMinuteRef.current = minuteKey;

    const currentHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const dueItems = announcements.filter(
      (item) => item.enabled && item.time === currentHHMM && item.lastTriggeredDate !== todayKey
    );

    if (!dueItems.length) return;

    const updatedAnnouncements = announcements.map((item) =>
      dueItems.some((due) => due.id === item.id) ? { ...item, lastTriggeredDate: todayKey } : item
    );

    setAnnouncements(updatedAnnouncements);
    persistAnnouncements(updatedAnnouncements);

    const nextQueue = [...pendingQueue];
    dueItems.forEach((item) => {
      if (!nextQueue.includes(item.id)) nextQueue.push(item.id);
    });
    setPendingQueue(nextQueue);
    persistPendingQueue(nextQueue);

    if (prayerState.active) {
      pushStatus(
        `Ada ${dueItems.length} announcement masuk saat waktu ${toPrayerLabel(prayerState.prayerName)}. Akan diputar setelah jeda selesai.`,
        'warning'
      );
      return;
    }

    processQueueIfPossible();
  }, [now, announcements, pendingQueue, prayerState.active, prayerState.prayerName, todayKey, bootstrapped]);

  useEffect(() => {
    if (!audioReady) return;
    if (pendingPlayAfterUnlockRef.current) {
      pendingPlayAfterUnlockRef.current = false;
      processQueueIfPossible();
    }
  }, [audioReady]);

  useEffect(() => {
    if (!bootstrapped) return;
    if (prayerConfig.mode !== 'auto') return;
    if (!prayerConfig.useBrowserLocation) return;
    if (hasValidCoordinates(prayerConfig)) return;
    if (attemptedInitialLocationRef.current) return;

    attemptedInitialLocationRef.current = true;
    requestBrowserLocation({ quiet: true, refreshAfter: true }).catch((err) => {
      console.error('Unhandled error in request browser location:', err);
    });
  }, [bootstrapped, prayerConfig]);

  useEffect(() => {
    if (!bootstrapped) return;
    if (prayerConfig.mode !== 'auto') return;
    if (!hasValidCoordinates(prayerConfig)) return;

    const latitude = Number(prayerConfig.latitude).toFixed(6);
    const longitude = Number(prayerConfig.longitude).toFixed(6);
    const requestKey = `${todayKey}|${latitude}|${longitude}|${prayerConfig.method}`;

    if (prayerApiCache.requestKey === requestKey && prayerApiCache.dateKey === todayKey) {
      return;
    }

    fetchPrayerTimesFromApi({ quiet: true }).catch((err) => {
      console.error('Unhandled error in auto-fetch prayer times:', err);
    });
  }, [
    bootstrapped,
    prayerConfig.mode,
    prayerConfig.latitude,
    prayerConfig.longitude,
    prayerConfig.method,
    todayKey,
    prayerApiCache.requestKey,
    prayerApiCache.dateKey,
  ]);

  async function handleUnlockAudio() {
    try {
      const wasAlreadyReady = audioReady;
      
      // Cukup set audioReady = true
      // Ini akan trigger effect yang watch audioReady
      // Effect tersebut akan call resumeBackground() jika backsound sudah ter-upload
      setAudioReady(true);
      
      // Jika audio sudah pernah unlock sebelumnya (resume after stop), aktifkan kembali background
      if (wasAlreadyReady && !backgroundEnabled && backgroundMeta) {
        setBackgroundEnabled(true);
        pushStatus('Audio dilanjutkan. Backsound kembali aktif.', 'success');
      } else if (!wasAlreadyReady) {
        pushStatus('Audio berhasil diaktifkan. Sistem siap memutar backsound dan announcement.', 'success');
      }
      
      // Immediate trigger resume background jika conditions met
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const bg = backgroundAudioRef.current;
      const shouldPlay = bg && backgroundUrl && (backgroundEnabled || (wasAlreadyReady && backgroundMeta)) && !prayerState.active && !activeAnnouncementId && !pendingQueue.length;
      
      if (shouldPlay) {
        try {
          bg.volume = backgroundVolume;
          bg.loop = true;
          await bg.play();
          console.log('Background audio playing after unlock');
        } catch (e) {
          console.error('Failed to play background after unlock:', e);
        }
      }
    } catch (error) {
      console.error('Error unlocking audio:', error);
      pushStatus('Gagal mengaktifkan audio. Pastikan browser mengizinkan autoplay.', 'error');
    }
  }

  async function handleBackgroundFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      pushStatus('Mengunggah backsound ke Vercel Blob...', 'info');
      
      // Upload to Vercel Blob
      const blobData = await uploadAudioFile(file);

      // Delete old backsound if exists
      if (backgroundMeta?.blobId || backgroundMeta?.fileUrl) {
        console.log('Deleting old backsound from Vercel Blob:', {
          blobId: backgroundMeta.blobId,
          fileUrl: backgroundMeta.fileUrl,
        });
        deleteAudioFile(backgroundMeta.blobId, backgroundMeta.fileUrl)
          .then(() => {
            console.log('Old backsound successfully deleted:', backgroundMeta.blobId);
          })
          .catch((error) => {
            console.warn('Failed to delete old backsound:', error);
            // Don't fail the operation, just warn
          });
      }

      const meta = {
        blobId: blobData.blobId,
        fileUrl: blobData.url,
        name: file.name,
        uploadedAt: Date.now(),
      };

      setBackgroundMeta(meta);
      persistBackgroundMeta(meta);
      pushStatus(`Backsound standby disimpan di Vercel Blob: ${file.name}`, 'success');
      event.target.value = '';
    } catch (error) {
      console.error('Error uploading background:', error);
      pushStatus(`Gagal mengunggah backsound: ${error.message}`, 'error');
    }
  }

  function handleSaveBackgroundSchedule() {
    persistBackgroundSchedule(backgroundStartTime, backgroundEndTime);
    setShowBackgroundScheduleModal(false);
    pushStatus('Jadwal backsound disimpan.', 'success');
  }

  async function handleSaveAnnouncement() {
    const file = newAnnouncementFileRef.current?.files?.[0];

    if (!newAnnouncementTitle.trim()) {
      pushStatus('Judul announcement belum diisi.', 'error');
      return;
    }

    if (!newAnnouncementTime) {
      pushStatus('Jam announcement belum diisi.', 'error');
      return;
    }

    if (!file) {
      pushStatus('File audio announcement belum dipilih.', 'error');
      return;
    }

    setIsSavingAnnouncement(true);

    try {
      pushStatus('Mengunggah announcement ke Vercel Blob...', 'info');
      
      // Upload to Vercel Blob
      const blobData = await uploadAudioFile(file);

      const item = {
        id: createId('schedule'),
        title: newAnnouncementTitle.trim(),
        time: newAnnouncementTime,
        blobId: blobData.blobId,
        fileUrl: blobData.url,
        fileName: file.name,
        enabled: true,
        createdAt: Date.now(),
        lastTriggeredDate: '',
      };

      const updated = [...announcements, item].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
      setAnnouncements(updated);
      persistAnnouncements(updated);

      setNewAnnouncementTitle('');
      setNewAnnouncementTime('08:00');
      setNewAnnouncementFileName('');
      if (newAnnouncementFileRef.current) {
        newAnnouncementFileRef.current.value = '';
      }

      setIsSavingAnnouncement(false);
      setShowAnnouncementModal(false);
      pushStatus(`Announcement ${item.title} jam ${item.time} berhasil ditambahkan.`, 'success');
    } catch (error) {
      console.error(error);
      pushStatus(`Gagal menyimpan announcement: ${error.message}`, 'error');
    } finally {
      setIsSavingAnnouncement(false);
    }
  }

  async function handleDeleteAnnouncement(item) {
    try {
      const updated = announcements.filter((entry) => entry.id !== item.id);
      setAnnouncements(updated);
      persistAnnouncements(updated);

      const queueUpdated = pendingQueue.filter((id) => id !== item.id);
      setPendingQueue(queueUpdated);
      persistPendingQueue(queueUpdated);

      // Delete from Vercel Blob - async but don't block UI
      if (item.blobId || item.fileUrl) {
        console.log('Deleting announcement from Vercel Blob:', {
          id: item.id,
          title: item.title,
          blobId: item.blobId,
          fileUrl: item.fileUrl,
        });

        deleteAudioFile(item.blobId, item.fileUrl)
          .then(() => {
            console.log('Successfully deleted from Vercel Blob:', item.blobId);
            pushStatus(`File announcement "${item.title}" berhasil dihapus dari cloud storage.`, 'success');
          })
          .catch((error) => {
            console.error('Failed to delete from Vercel Blob:', error);
            pushStatus(`Announcement dihapus dari app, tapi gagal hapus dari cloud: ${error.message}`, 'warning');
          });
      }

      pushStatus(`Announcement "${item.title}" berhasil dihapus.`, 'success');
    } catch (error) {
      console.error('Error deleting announcement:', error);
      pushStatus(`Gagal menghapus announcement: ${error.message}`, 'error');
    }
  }

  function handleToggleAnnouncement(id) {
    const updated = announcements.map((item) =>
      item.id === id ? { ...item, enabled: !item.enabled } : item
    );
    setAnnouncements(updated);
    persistAnnouncements(updated);
  }

  async function handlePlayManual(item) {
    const existsInQueue = pendingQueue.includes(item.id);
    if (!existsInQueue) {
      const updatedQueue = [item.id, ...pendingQueue];
      setPendingQueue(updatedQueue);
      persistPendingQueue(updatedQueue);
    }

    if (prayerState.active) {
      pushStatus(
        `Saat ini waktu ${toPrayerLabel(prayerState.prayerName)}. Announcement dimasukkan ke antrian dan akan diputar setelah jeda selesai.`,
        'warning'
      );
      return;
    }

    await processQueueIfPossible();
  }

  function handleManualPrayerTimeChange(name, value) {
    const updated = { ...manualPrayerTimes, [name]: value };
    setManualPrayerTimes(updated);
    persistManualPrayerTimes(updated);
  }

  function handlePrayerOffsetChange(name, value) {
    const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
    const updated = { ...prayerOffsets, [name]: safe };
    setPrayerOffsets(updated);
    persistPrayerOffsets(updated);
  }

  function handlePrayerPauseChange(value) {
    const minutes = Number(value);
    setPrayerPauseMinutes(minutes);
    persistPrayerPauseMinutes(minutes);
  }

  function handlePrayerModeChange(mode) {
    const updated = { ...prayerConfig, mode };
    setPrayerConfig(updated);
    persistPrayerConfig(updated);
    pushStatus(mode === 'auto' ? 'Mode jadwal sholat diubah ke otomatis API.' : 'Mode jadwal sholat diubah ke manual.', 'info');
  }

  function handlePrayerMethodChange(value) {
    const updated = { ...prayerConfig, method: Number(value) };
    setPrayerConfig(updated);
    persistPrayerConfig(updated);
  }

  function handleCoordinateChange(field, value) {
    const updated = { ...prayerConfig, [field]: value, useBrowserLocation: false };
    setPrayerConfig(updated);
    persistPrayerConfig(updated);
  }

  function handleAnnouncementError(error) {
    console.error('Announcement audio error:', error);
    const audioEl = announcementAudioRef.current;
    if (audioEl) {
      const errorMsg = getAudioErrorMessage(audioEl.error);
      console.error('Audio error details:', errorMsg);
      
      // Auto-skip to next announcement on error
      setActiveAnnouncementId(null);
      const updatedQueue = pendingQueue.slice(1);
      setPendingQueue(updatedQueue);
      persistPendingQueue(updatedQueue);
      
      pushStatus(`Gagal memutar announcement (${errorMsg}). Lanjut ke announcement berikutnya...`, 'error');
      processQueueIfPossible();
    }
  }

  function handleBackgroundError(error) {
    console.error('Background audio error:', error);
    const audioEl = backgroundAudioRef.current;
    if (audioEl && audioEl.error) {
      const errorMsg = getAudioErrorMessage(audioEl.error);
      console.error('Audio error details:', errorMsg);
      pushStatus(`Error backsound: ${errorMsg}. Coba aktifkan kembali audio.`, 'warning');
    }
  }

  function getAudioErrorMessage(error) {
    if (!error) return 'Unknown error';
    switch (error.code) {
      case error.MEDIA_ERR_ABORTED: return 'Playback dibatalkan';
      case error.MEDIA_ERR_NETWORK: return 'Network error - periksa URL atau koneksi internet';
      case error.MEDIA_ERR_DECODE: return 'Audio file corrupt atau format tidak didukung';
      case error.MEDIA_ERR_SRC_NOT_SUPPORTED: return 'Format audio tidak didukung browser';
      default: return `Audio error code ${error.code}`;
    }
  }

  async function handleAnnouncementEnded() {
    setActiveAnnouncementId(null);

    const updatedQueue = pendingQueue.slice(1);
    setPendingQueue(updatedQueue);
    persistPendingQueue(updatedQueue);

    if (prayerState.active) {
      pushStatus(`Announcement selesai. Backsound tetap dijeda karena waktu ${toPrayerLabel(prayerState.prayerName)} masih berjalan.`, 'warning');
      return;
    }

    if (updatedQueue.length) {
      const nextItem = announcements.find((entry) => entry.id === updatedQueue[0]);
      if (nextItem) {
        await playAnnouncementNow(nextItem, 'schedule');
        return;
      }
    }

    await resumeBackground('Announcement selesai. Backsound standby dilanjutkan.');
  }

  async function handleStopAll() {
    const bg = backgroundAudioRef.current;
    const an = announcementAudioRef.current;

    if (bg) {
      bg.pause();
      bg.currentTime = 0;
    }

    if (an) {
      an.pause();
      an.currentTime = 0;
      an.src = '';
    }

    setActiveAnnouncementId(null);
    setBackgroundEnabled(false);
    setPendingQueue([]);
    persistPendingQueue([]);
    pushStatus('Semua audio dihentikan.', 'info');
  }

  const nextPrayerLabel = prayerState.active
    ? `${toPrayerLabel(prayerState.prayerName)} sedang berlangsung`
    : 'Tidak ada jeda sholat saat ini';

  const remainingPrayerSeconds = prayerState.active
    ? Math.max(0, (prayerState.end - (now.getHours() * 60 + now.getMinutes())) * 60 - now.getSeconds())
    : 0;

  const prayerSourceSummary = prayerConfig.mode === 'auto'
    ? prayerApiCache.fetchedAt
      ? `API • ${prayerApiCache.source || 'koordinat manual'} • ${getPrayerMethodLabel(prayerConfig.method)}`
      : 'API belum sinkron'
    : 'Manual';

  if (!bootstrapped) {
    return (
      <main className="page-shell">
        <audio ref={backgroundAudioRef} src={backgroundUrl || undefined} preload="auto" loop crossOrigin="anonymous" onError={handleBackgroundError} />
        <audio ref={announcementAudioRef} preload="auto" onEnded={handleAnnouncementEnded} onError={handleAnnouncementError} crossOrigin="anonymous" />
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>Memuat aplikasi...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <audio ref={backgroundAudioRef} src={backgroundUrl || undefined} preload="auto" loop crossOrigin="anonymous" onError={handleBackgroundError} />
      <audio ref={announcementAudioRef} preload="auto" onEnded={handleAnnouncementEnded} onError={handleAnnouncementError} crossOrigin="anonymous" />

      <section className="hero-card">
        <div>
          <p className="eyebrow">IT Rayhan Hospital</p>
          <h1>Audio Pengumuman Otomatis</h1>
          <p className="hero-text">
            Backsound standby berjalan otomatis. Dijeda saat waktu sholat. Paused saat ada announcement. Jadwal dapat dari API atau manual.
          </p>
        </div>
        <div className="hero-time">
          <p className="date-label">{formatDate(now)}</p>
          <div className="clock-box">{formatClock(now)}</div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel clock-panel">
          <div className="panel-header">
            <h2>Status Monitor</h2>
            <span className={`badge badge-${status.type || 'info'}`}>{status.type || 'info'}</span>
          </div>
          <div className="hero-actions">
          <button className="primary-button" onClick={handleUnlockAudio}>
            Aktifkan Audio
          </button>
          <button className="danger-button" onClick={handleStopAll}>
            Stop Audio
          </button>
        </div>
          <div className="info-list" style={{ marginTop: '14px' }}>
          <div>
            <span>Jadwal aktif</span>
            <strong>{backgroundStartTime} - {backgroundEndTime}</strong>
          </div>
            <div>
              <span>Audio</span>
              <strong>{audioReady ? '✓ Aktif' : 'Belum aktif'}</strong>
            </div>
            <div>
              <span>Backsound</span>
              <strong>
                {backgroundMeta?.name
                  ? prayerState.active
                    ? 'Dijeda (sholat)'
                    : activeAnnouncementId
                    ? 'Dijeda (Informasi)'
                    : backgroundEnabled
                    ? '▶ Bermain'
                    : 'Nonaktif'
                  : 'Tidak ada file'}
              </strong>
            </div>
            <div>
              <span>Announcement</span>
              <strong>
                {activeAnnouncementId
                  ? announcements.find((item) => item.id === activeAnnouncementId)?.title || 'Sedang diputar'
                  : 'Tidak ada'}
              </strong>
            </div>
            <div>
              <span>Antrian</span>
              <strong>{pendingQueue.length} item</strong>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Backsound</h2>
            <button className="secondary-button" onClick={() => setShowBackgroundScheduleModal(true)} style={{ padding: '8px 20px', fontSize: '14px', whiteSpace: 'nowrap' }}>
            ⏰ Jadwal Backsound
          </button>
          </div>

          <label className="field">
            <span>Upload file</span>
            <input type="file" accept="audio/*" onChange={handleBackgroundFileChange} />
          </label>

          <label className="toggle-row" style={{ marginTop: '10px' }}>
            <input
              type="checkbox"
              checked={backgroundEnabled}
              onChange={(event) => setBackgroundEnabled(event.target.checked)}
            />
            <span>Aktifkan backsound</span>
          </label>

          <label className="field" style={{ marginTop: '10px' }}>
            <span>Volume: {Math.round(backgroundVolume * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={backgroundVolume}
              onChange={(event) => setBackgroundVolume(Number(event.target.value))}
            />
          </label>

          <div className="summary-box" style={{ marginTop: '10px' }}>
            <span>File aktif </span>
            <strong style={{ color: backgroundMeta ? 'var(--text)' : 'var(--muted)' }}>
              {backgroundMeta?.name || 'Tidak ada'}
            </strong>
          </div>
        </div>
      </section>

      <section className="two-column-section">
        <div className="panel">
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <h2>Volume & Jadwal</h2>
            <button className="secondary-button" onClick={() => setShowPrayerModal(true)} style={{ padding: '8px 16px', fontSize: '14px', whiteSpace: 'nowrap' }}>
              ⚙ Pengaturan Jadwal
            </button>
          </div>

          <label className="field">
            <span>Volume Announcement: {Math.round(announcementVolume * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={announcementVolume}
              onChange={(event) => setAnnouncementVolume(Number(event.target.value))}
            />
          </label>

          <div className="upcoming-list" style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>Jadwal Sholat Hari Ini:</div>
            {Object.keys(effectivePrayerTimes).map((key) => (
              <div className="upcoming-row" key={key}>
                <strong style={{ fontSize: '12px' }}>{toPrayerLabel(key)}</strong>
                <span style={{ fontSize: '12px' }}>{effectivePrayerTimes[key]}</span>
              </div>
            ))}
          </div>

          {nextAnnouncements.length > 0 && (
            <div className="upcoming-list" style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>Announcement Berikutnya:</div>
              {nextAnnouncements.slice(0, 3).map((item) => (
                <div className="upcoming-row" key={item.id}>
                  <strong style={{ fontSize: '12px' }}>{item.title}</strong>
                  <span style={{ fontSize: '12px' }}>{item.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <h2>Daftar Announcement ({announcements.length})</h2>
            <button className="primary-button" onClick={() => setShowAnnouncementModal(true)} style={{ padding: '8px 20px', fontSize: '14px', whiteSpace: 'nowrap' }}>
             + Tambah Pengumuman
            </button>
          </div>

          {announcements.length === 0 ? (
            <div className="empty-state">Tidak ada announcement</div>
          ) : (
            <div className="announcement-list">
              {announcements.map((item) => {
                const queued = pendingQueue.includes(item.id);
                const active = activeAnnouncementId === item.id;
                return (
                  <article className="announcement-card" key={item.id}>
                    <div style={{ flex: 1 }}>
                      <h3>{item.title}</h3>
                      <p style={{ marginBottom: '6px', marginTop: '4px' }}>
                        {item.time}
                      </p>
                      <div className="card-tags">
                        {queued && <span className="tag tag-queue">Antri</span>}
                        {active && <span className="tag tag-live">Putar</span>}
                        {!item.enabled && <span className="tag tag-off">Off</span>}
                      </div>
                    </div>

                    <div className="card-actions" style={{ alignSelf: 'center', gap: '4px', margin: 0 }}>
                      <button className="secondary-button" onClick={() => handlePlayManual(item)} style={{ padding: '6px 10px', fontSize: '12px' }}>
                        Putar
                      </button>
                      <button className="secondary-button" onClick={() => handleToggleAnnouncement(item.id)} style={{ padding: '6px 10px', fontSize: '12px' }}>
                        {item.enabled ? 'Off' : 'On'}
                      </button>
                      <button className="danger-button" onClick={() => handleDeleteAnnouncement(item)} style={{ padding: '6px 10px', fontSize: '12px' }}>
                        Hapus
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {showAnnouncementModal && (
        <div className="modal-overlay" onClick={() => setShowAnnouncementModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Tambah Announcement</h2>
              <button className="modal-close" onClick={() => setShowAnnouncementModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <label className="field">
                <span>Judul</span>
                <input
                  type="text"
                  placeholder="Pengumuman..."
                  value={newAnnouncementTitle}
                  onChange={(event) => setNewAnnouncementTitle(event.target.value)}
                  autoFocus
                />
              </label>

              <label className="field">
                <span>Jam putar</span>
                <input
                  type="time"
                  value={newAnnouncementTime}
                  onChange={(event) => setNewAnnouncementTime(event.target.value)}
                />
              </label>

              <label className="field">
                <span>File audio</span>
                <input
                  ref={newAnnouncementFileRef}
                  type="file"
                  accept="audio/*"
                  onChange={(event) => setNewAnnouncementFileName(event.target.files?.[0]?.name || '')}
                />
                <small>{newAnnouncementFileName || 'Belum ada file dipilih'}</small>
              </label>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setShowAnnouncementModal(false)}>
                Batal
              </button>
              <button className="primary-button" onClick={handleSaveAnnouncement} disabled={isSavingAnnouncement}>
                {isSavingAnnouncement ? 'Menyimpan...' : 'Simpan Announcement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrayerModal && (
        <div className="modal-overlay" onClick={() => setShowPrayerModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Pengaturan Jadwal Sholat</h2>
              <button className="modal-close" onClick={() => setShowPrayerModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="mode-switch">
                <button
                  className={prayerConfig.mode === 'auto' ? 'primary-button' : 'secondary-button'}
                  onClick={() => handlePrayerModeChange('auto')}
                  type="button"
                >
                  API
                </button>
                <button
                  className={prayerConfig.mode === 'manual' ? 'primary-button' : 'secondary-button'}
                  onClick={() => handlePrayerModeChange('manual')}
                  type="button"
                >
                  Manual
                </button>
              </div>

              {prayerConfig.mode === 'auto' ? (
                <>
                  <label className="field" style={{ marginTop: '12px' }}>
                    <span>Latitude</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={prayerConfig.latitude}
                      onChange={(event) => handleCoordinateChange('latitude', event.target.value)}
                    />
                  </label>

                  <label className="field" style={{ marginTop: '10px' }}>
                    <span>Longitude</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={prayerConfig.longitude}
                      onChange={(event) => handleCoordinateChange('longitude', event.target.value)}
                    />
                  </label>

                  <div className="card-actions" style={{ marginTop: '10px' }}>
                    <button className="secondary-button" type="button" onClick={() => requestBrowserLocation({ quiet: false, refreshAfter: true })}>
                      Ambil dari Browser
                    </button>
                    <button className="secondary-button" type="button" onClick={() => fetchPrayerTimesFromApi({ quiet: false })} disabled={prayerLoading}>
                      {prayerLoading ? 'Mengambil...' : 'Refresh API'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ marginTop: '12px' }}>
                  {Object.entries(manualPrayerTimes).map(([key, value]) => (
                    <label className="field" key={key} style={{ marginBottom: '10px' }}>
                      <span>{toPrayerLabel(key)}</span>
                      <input type="time" value={value} onChange={(event) => handleManualPrayerTimeChange(key, event.target.value)} />
                    </label>
                  ))}
                </div>
              )}

              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '14px', marginBottom: '10px' }}>Offset per waktu sholat (menit)</div>

              <div className="grid-two">
                {Object.entries(prayerOffsets).map(([key, value]) => (
                  <label className="field" key={key}>
                    <span style={{ fontSize: '12px' }}>{toPrayerLabel(key)}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="number"
                        min="-60"
                        max="60"
                        value={value}
                        onChange={(event) => handlePrayerOffsetChange(key, event.target.value)}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatOffsetLabel(value)}</span>
                    </div>
                  </label>
                ))}
              </div>

              <label className="field" style={{ marginTop: '12px' }}>
                <span>Durasi jeda (menit)</span>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={prayerPauseMinutes}
                  onChange={(event) => handlePrayerPauseChange(event.target.value)}
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setShowPrayerModal(false)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {showBackgroundScheduleModal && (
        <div className="modal-overlay" onClick={() => setShowBackgroundScheduleModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Jadwal Backsound</h2>
              <button className="modal-close" onClick={() => setShowBackgroundScheduleModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <label className="field">
                <span>Mulai dari jam</span>
                <input
                  type="time"
                  value={backgroundStartTime}
                  onChange={(event) => setBackgroundStartTime(event.target.value)}
                />
              </label>

              <label className="field">
                <span>Berhenti pada jam</span>
                <input
                  type="time"
                  value={backgroundEndTime}
                  onChange={(event) => setBackgroundEndTime(event.target.value)}
                />
              </label>

              <div className="summary-box">
                <span>Backsound akan aktif:</span>
                <strong style={{ fontSize: '13px' }}>
                  {backgroundStartTime} - {backgroundEndTime}
                </strong>
              </div>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setShowBackgroundScheduleModal(false)}>
                Batal
              </button>
              <button className="primary-button" onClick={handleSaveBackgroundSchedule}>
                Simpan Jadwal
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="page-footer">
        <p>&copy; {new Date().getFullYear()} IT Rayhan. All rights reserved.</p>
      </footer>
    </main>
  );
}

