'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadAudioFile, deleteAudioFile, getAudioFileUrl, validateBlobUrl } from '../lib/blob';
import {
  addSharedAnnouncement,
  deleteSharedAnnouncement,
  getSharedAudioConfig,
  setSharedBackground,
  setSharedAdzanUrls,
  setSharedBackgroundSchedule,
  toggleSharedAnnouncement,
} from '../lib/audio-config';

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
  cityId: '',
  cityName: '',
};

const MYQURAN_API_BASE = 'https://api.myquran.com/v2/sholat';

const DEFAULT_PRAYER_API_CACHE = {
  dateKey: '',
  fetchedAt: null,
  source: '',
  timezone: '',
  requestKey: '',
  timings: DEFAULT_PRAYER_TIMES,
};

// Sumber adzan hanya dari URL (disimpan di penyimpanan bersama/server). Tidak ada file lokal.
// 'normal' = Dzuhur, Ashar, Maghrib, Isya. 'subuh' = Subuh.
const ADZAN_TYPES = ['normal', 'subuh'];

// Adzan hanya diputar jika halaman aktif maksimal N menit setelah jam sholat.
// Mencegah adzan terputar terlambat saat halaman baru dibuka di tengah waktu sholat.
const ADZAN_LATE_TOLERANCE_MINUTES = 2;

const DEFAULT_ADZAN_SETTINGS = {
  enabled: true,
  volume: 1,
  // URL file adzan. Jika kosong, adzan untuk jenis tersebut tidak diputar.
  urls: {
    normal: '',
    subuh: '',
  },
  prayers: {
    subuh: true,
    dzuhur: true,
    ashar: true,
    maghrib: true,
    isya: true,
  },
};

const DEFAULT_BACKGROUND_SCHEDULE = {
  startTime: '00:00',
  endTime: '23:59',
};

const STORAGE_KEYS = {
  manualPrayerTimes: 'app-prayer-times-v2',
  prayerPauseMinutes: 'app-prayer-pause-minutes-v1',
  prayerOffsets: 'app-prayer-offsets-v3',
  prayerConfig: 'app-prayer-config-v3',
  prayerApiCache: 'app-prayer-api-cache-v3',
  adzanSettings: 'app-adzan-settings-v1',
  adzanPlayedLog: 'app-adzan-played-v1',
  settings: 'app-settings-v1',
};

const SHARED_AUDIO_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const SHARED_AUDIO_SYNC_MIN_GAP_MS = 30 * 1000;

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

function isValidAudioUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

function getAdzanSrc(adzanSettings, type) {
  const url = String(adzanSettings?.urls?.[type] || '').trim();
  return url && isValidAudioUrl(url) ? url : undefined;
}

function getAdzanFileType(prayerName) {
  return prayerName === 'subuh' ? 'subuh' : 'normal';
}

function findDueAdzanPrayer(prayerTimes, adzanSettings, playedPrayers, now = new Date()) {
  if (!adzanSettings?.enabled) return null;
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  for (const [name, time] of Object.entries(prayerTimes)) {
    if (!adzanSettings.prayers?.[name]) continue;
    if (playedPrayers.includes(name)) continue;

    const start = timeToMinutes(time);
    if (minutesNow >= start && minutesNow < start + ADZAN_LATE_TOLERANCE_MINUTES) {
      return name;
    }
  }

  return null;
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

function getBackgroundSchedulePhase(startTime, endTime, now = new Date()) {
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  if (start <= end) {
    if (minutesNow < start) return 'before_start';
    if (minutesNow >= end) return 'after_end';
    return 'active';
  }

  if (minutesNow >= start || minutesNow < end) {
    return 'active';
  }

  return 'after_end';
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

function hydrateAnnouncements(items, previousItems = []) {
  const lastTriggeredDateById = new Map(previousItems.map((item) => [item.id, item.lastTriggeredDate || '']));

  return items.map((item) => ({
    ...item,
    repeatCount: getAnnouncementRepeatCount(item),
    lastTriggeredDate: lastTriggeredDateById.get(item.id) || '',
  }));
}

function getAnnouncementRepeatCount(item) {
  return Math.max(1, Number.parseInt(item?.repeatCount, 10) || 1);
}

function getAnnouncementInterval(item) {
  const intervalMinutes = Math.max(0, Number.parseInt(item?.intervalMinutes, 10) || 0);
  const endTime = String(item?.endTime || '');
  if (intervalMinutes <= 0 || !endTime) return null;
  return { intervalMinutes, endTime };
}

// Apakah announcement jatuh tempo pada menit ini (untuk jadwal sekali maupun berkala)
function isAnnouncementDueNow(item, now) {
  const currentHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const interval = getAnnouncementInterval(item);

  if (!interval) return item.time === currentHHMM;

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const start = timeToMinutes(item.time);
  const end = timeToMinutes(interval.endTime);
  if (minutesNow < start || minutesNow > end) return false;
  return (minutesNow - start) % interval.intervalMinutes === 0;
}

// Format selisih menit menjadi teks singkat, mis. "1j 20m" / "45m"
function formatDuration(totalMinutes) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 1) return 'kurang dari 1 menit';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}j ${rest}m` : `${hours}j`;
}

// Berapa menit lagi announcement ini berikutnya diputar (jadwal sekali maupun berkala)
function getMinutesUntilNextRun(item, nowMinutes) {
  const start = timeToMinutes(item.time);
  const interval = getAnnouncementInterval(item);

  if (!interval) {
    return start > nowMinutes ? start - nowMinutes : 1440 - nowMinutes + start;
  }

  if (nowMinutes < start) return start - nowMinutes;

  const end = timeToMinutes(interval.endTime);
  const nextSlot = start + (Math.floor((nowMinutes - start) / interval.intervalMinutes) + 1) * interval.intervalMinutes;
  if (nextSlot <= end) return nextSlot - nowMinutes;
  return 1440 - nowMinutes + start;
}

const STATUS_TYPE_LABELS = {
  info: 'Info',
  success: 'Berhasil',
  warning: 'Peringatan',
  error: 'Gagal',
};

// Buang penanda tes manual untuk ID yang sudah tidak ada di antrian
function pruneManualTestIds(idSet, queue, activeId) {
  Array.from(idSet).forEach((id) => {
    if (id !== activeId && !queue.includes(id)) idSet.delete(id);
  });
}

function createAnnouncementQueueEntries(item, repeatCount = getAnnouncementRepeatCount(item)) {
  return Array.from({ length: repeatCount }, () => item.id);
}

function getSharedAudioConfigSignature(sharedAudioConfig) {
  return JSON.stringify({
    adzan: {
      normal: String(sharedAudioConfig?.adzan?.normal || ''),
      subuh: String(sharedAudioConfig?.adzan?.subuh || ''),
    },
    background: sharedAudioConfig?.background
      ? {
          blobId: String(sharedAudioConfig.background.blobId || ''),
          fileUrl: String(sharedAudioConfig.background.fileUrl || ''),
          name: String(sharedAudioConfig.background.name || ''),
        }
      : null,
    announcements: Array.isArray(sharedAudioConfig?.announcements)
      ? sharedAudioConfig.announcements.map((item) => ({
          id: String(item.id || ''),
          time: String(item.time || ''),
          intervalMinutes: Number(item.intervalMinutes || 0),
          endTime: String(item.endTime || ''),
          blobId: String(item.blobId || ''),
          fileUrl: String(item.fileUrl || ''),
          enabled: item.enabled !== false,
          repeatCount: getAnnouncementRepeatCount(item),
        }))
      : [],
    backgroundSchedule: {
      startTime: String(sharedAudioConfig?.backgroundSchedule?.startTime || DEFAULT_BACKGROUND_SCHEDULE.startTime),
      endTime: String(sharedAudioConfig?.backgroundSchedule?.endTime || DEFAULT_BACKGROUND_SCHEDULE.endTime),
    },
  });
}

function isSameBackgroundMeta(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;

  return (
    String(left.blobId || '') === String(right.blobId || '') &&
    String(left.fileUrl || '') === String(right.fileUrl || '') &&
    String(left.name || '') === String(right.name || '')
  );
}

function formatOffsetLabel(value) {
  const number = Number(value || 0);
  if (number === 0) return '0 menit';
  return `${number > 0 ? '+' : ''}${number} menit`;
}

function hasValidCity(config) {
  return /^\d{3,5}$/.test(String(config?.cityId || '').trim());
}

function toTitleCase(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
  const [citySearchQuery, setCitySearchQuery] = useState('');
  const [citySearchResults, setCitySearchResults] = useState([]);
  const [citySearchLoading, setCitySearchLoading] = useState(false);

  const [adzanSettings, setAdzanSettings] = useState(DEFAULT_ADZAN_SETTINGS);
  const [adzanPlayedLog, setAdzanPlayedLog] = useState({ dateKey: '', prayers: [] });
  const [adzanPlaying, setAdzanPlaying] = useState(null); // { prayerName, type, isTest } | null
  const [adzanFileStatus, setAdzanFileStatus] = useState({ normal: 'loading', subuh: 'loading' });
  const [adzanUrlDrafts, setAdzanUrlDrafts] = useState({ normal: '', subuh: '' });

  const [backgroundMeta, setBackgroundMeta] = useState(null);
  const [backgroundUrl, setBackgroundUrl] = useState('');
  const [backgroundEnabled, setBackgroundEnabled] = useState(true);
  const [backgroundVolume, setBackgroundVolume] = useState(0.35);
  const [backgroundStartTime, setBackgroundStartTime] = useState(DEFAULT_BACKGROUND_SCHEDULE.startTime);
  const [backgroundEndTime, setBackgroundEndTime] = useState(DEFAULT_BACKGROUND_SCHEDULE.endTime);
  const [showBackgroundScheduleModal, setShowBackgroundScheduleModal] = useState(false);

  const [announcements, setAnnouncements] = useState([]);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [activeAnnouncementId, setActiveAnnouncementId] = useState(null);
  const [announcementVolume, setAnnouncementVolume] = useState(1);

  const [newAnnouncementTitle, setNewAnnouncementTitle] = useState('');
  const [newAnnouncementTime, setNewAnnouncementTime] = useState('08:00');
  const [newAnnouncementRepeatCount, setNewAnnouncementRepeatCount] = useState(1);
  const [newAnnouncementPeriodic, setNewAnnouncementPeriodic] = useState(false);
  const [newAnnouncementInterval, setNewAnnouncementInterval] = useState(15);
  const [newAnnouncementEndTime, setNewAnnouncementEndTime] = useState('15:00');
  const [newAnnouncementFileName, setNewAnnouncementFileName] = useState('');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showPrayerModal, setShowPrayerModal] = useState(false);
  const newAnnouncementFileRef = useRef(null);
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);

  const backgroundAudioRef = useRef(null);
  const announcementAudioRef = useRef(null);
  const pendingPlayAfterUnlockRef = useRef(false);
  const isStoppingRef = useRef(false); // Track if we're intentionally stopping audio
  const lastTickMinuteRef = useRef('');
  const citySearchRequestRef = useRef(0);
  const adzanNormalAudioRef = useRef(null);
  const adzanSubuhAudioRef = useRef(null);
  const adzanPlayingRef = useRef(null);
  const adzanAttemptRef = useRef('');
  const adzanWarmupRef = useRef('');
  const activeAnnouncementIdRef = useRef(null);
  const announcementBusyRef = useRef(false);
  // ID announcement yang diputar manual (tombol Putar) walau jadwalnya sedang Off
  const manualTestIdsRef = useRef(new Set());
  const sharedAudioSignatureRef = useRef('');
  const sharedAudioSyncInFlightRef = useRef(false);
  const lastSharedAudioSyncAtRef = useRef(0);

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

  const backgroundSchedulePhase = useMemo(
    () => getBackgroundSchedulePhase(backgroundStartTime, backgroundEndTime, now),
    [backgroundStartTime, backgroundEndTime, now]
  );

  const backgroundStatusLabel = useMemo(() => {
    if (!backgroundMeta?.name) return 'Tidak ada file';
    if (!backgroundEnabled) return 'Dimatikan (switch backsound off)';
    if (backgroundSchedulePhase === 'before_start') return `Menunggu jadwal mulai ${backgroundStartTime}`;
    if (backgroundSchedulePhase === 'after_end') return `Berhenti - jadwal selesai ${backgroundEndTime}`;
    if (adzanPlaying) return 'Dijeda - adzan sedang berkumandang';
    if (prayerState.active) return `Dijeda - waktu sholat ${toPrayerLabel(prayerState.prayerName)}`;
    if (activeAnnouncementId) return 'Dijeda - announcement sedang diputar';
    if (!audioReady) return 'Menunggu audio diaktifkan';
    return '▶ Bermain (standby)';
  }, [backgroundMeta, backgroundEnabled, backgroundSchedulePhase, backgroundStartTime, backgroundEndTime, adzanPlaying, prayerState.active, prayerState.prayerName, activeAnnouncementId, audioReady]);

  const adzanPlayedToday = adzanPlayedLog.dateKey === todayKey ? adzanPlayedLog.prayers : [];
  const adzanNormalSrc = getAdzanSrc(adzanSettings, 'normal');
  const adzanSubuhSrc = getAdzanSrc(adzanSettings, 'subuh');

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

  // Sholat berikutnya (hanya yang adzannya aktif jika adzan otomatis dinyalakan)
  const nextPrayerInfo = useMemo(() => {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const candidates = Object.entries(effectivePrayerTimes)
      .filter(([key]) => !adzanSettings.enabled || adzanSettings.prayers?.[key])
      .map(([key, time]) => {
        const minutes = timeToMinutes(time);
        return { key, time, inMinutes: minutes > nowMinutes ? minutes - nowMinutes : 1440 - nowMinutes + minutes };
      })
      .sort((a, b) => a.inMinutes - b.inMinutes);
    return candidates[0] || null;
  }, [effectivePrayerTimes, adzanSettings, now]);

  // Announcement aktif berikutnya yang akan diputar sesuai jadwal
  const nextAnnouncementInfo = useMemo(() => {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const candidates = announcements
      .filter((item) => item.enabled)
      .map((item) => ({ item, inMinutes: getMinutesUntilNextRun(item, nowMinutes) }))
      .sort((a, b) => a.inMinutes - b.inMinutes);
    return candidates[0] || null;
  }, [announcements, now]);

  // Item pertama antrian adalah announcement yang sedang diputar, jadi tidak dihitung "menunggu"
  const waitingQueueCount = Math.max(0, pendingQueue.length - (activeAnnouncementId ? 1 : 0));

  // Kondisi sistem saat ini, dalam bahasa yang mudah dipahami. Urutan = prioritas.
  const monitorState = useMemo(() => {
    const pauseEnd = prayerState.active ? minutesToTime(prayerState.end) : '';
    const queueNote = waitingQueueCount ? ` ${waitingQueueCount} item antrian menunggu giliran.` : '';

    if (adzanPlaying) {
      if (adzanPlaying.isTest) {
        return {
          tone: 'adzan',
          title: 'TES ADZAN SEDANG DIPUTAR',
          detail: 'Ini hanya tes manual. Backsound dan announcement dijeda sementara, lalu lanjut otomatis setelah tes selesai.',
        };
      }
      return {
        tone: 'adzan',
        title: `ADZAN ${toPrayerLabel(adzanPlaying.prayerName).toUpperCase()} SEDANG BERKUMANDANG`,
        detail: `Backsound dan announcement dijeda otomatis.${pauseEnd ? ` Setelah adzan selesai, jeda sholat tetap berlaku sampai ${pauseEnd}.` : ''}${queueNote}`,
      };
    }

    if (prayerState.active) {
      return {
        tone: 'sholat',
        title: `JEDA WAKTU SHOLAT ${toPrayerLabel(prayerState.prayerName).toUpperCase()}`,
        detail: `Adzan sudah selesai atau tidak diputar. Backsound dan announcement ditahan sampai ${pauseEnd}, lalu otomatis lanjut.${queueNote}`,
      };
    }

    if (activeAnnouncementId) {
      const title = announcements.find((item) => item.id === activeAnnouncementId)?.title || 'Announcement';
      return {
        tone: 'announcement',
        title: 'ANNOUNCEMENT SEDANG DIPUTAR',
        detail: `"${title}" sedang diputar. Backsound dijeda sementara dan lanjut otomatis setelah selesai.${queueNote}`,
      };
    }

    if (!audioReady) {
      return {
        tone: 'idle',
        title: 'AUDIO BELUM AKTIF',
        detail: 'Klik "Aktifkan Audio" agar browser mengizinkan suara. Selama belum aktif, backsound, announcement, dan adzan tidak akan terdengar.',
      };
    }

    const nextAdzanNote = nextPrayerInfo
      ? ` Sholat berikutnya: ${toPrayerLabel(nextPrayerInfo.key)} pukul ${nextPrayerInfo.time} (${formatDuration(nextPrayerInfo.inMinutes)} lagi).`
      : '';

    if (!backgroundMeta?.name) {
      return {
        tone: 'standby',
        title: 'STANDBY - TANPA BACKSOUND',
        detail: `Sistem siaga menunggu jadwal, tetapi belum ada file backsound.${nextAdzanNote}`,
      };
    }
    if (!backgroundEnabled) {
      return {
        tone: 'standby',
        title: 'STANDBY - BACKSOUND DIMATIKAN',
        detail: `Sistem siaga, backsound sedang off. Announcement dan adzan tetap berjalan sesuai jadwal.${nextAdzanNote}`,
      };
    }
    if (backgroundSchedulePhase === 'before_start') {
      return {
        tone: 'standby',
        title: 'STANDBY - MENUNGGU JADWAL BACKSOUND',
        detail: `Backsound mulai pukul ${backgroundStartTime}. Announcement dan adzan tetap berjalan sesuai jadwal.${nextAdzanNote}`,
      };
    }
    if (backgroundSchedulePhase === 'after_end') {
      return {
        tone: 'standby',
        title: 'STANDBY - JADWAL BACKSOUND SELESAI',
        detail: `Backsound berhenti sejak pukul ${backgroundEndTime} dan mulai lagi pukul ${backgroundStartTime}. Announcement dan adzan tetap berjalan.${nextAdzanNote}`,
      };
    }
    return {
      tone: 'standby',
      title: 'STANDBY - BACKSOUND BERMAIN',
      detail: `Sistem siaga: backsound berputar sambil menunggu announcement atau adzan berikutnya.${nextAdzanNote}`,
    };
  }, [
    adzanPlaying,
    prayerState,
    activeAnnouncementId,
    announcements,
    waitingQueueCount,
    audioReady,
    backgroundMeta,
    backgroundEnabled,
    backgroundSchedulePhase,
    backgroundStartTime,
    backgroundEndTime,
    nextPrayerInfo,
  ]);

  function pushStatus(message, type = 'info') {
    setStatus({ message, type });
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

  function persistSettings(value) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(value));
  }

  function persistAdzanSettings(value) {
    localStorage.setItem(STORAGE_KEYS.adzanSettings, JSON.stringify(value));
  }

  function persistAdzanPlayedLog(value) {
    localStorage.setItem(STORAGE_KEYS.adzanPlayedLog, JSON.stringify(value));
  }

  function getAdzanAudio(type) {
    return type === 'subuh' ? adzanSubuhAudioRef.current : adzanNormalAudioRef.current;
  }

  function markAdzanPlayed(prayerName) {
    setAdzanPlayedLog((prev) => {
      const base = prev.dateKey === todayKey ? prev.prayers : [];
      if (base.includes(prayerName)) return prev;
      const next = { dateKey: todayKey, prayers: [...base, prayerName] };
      persistAdzanPlayedLog(next);
      return next;
    });
  }

  async function playAdzan(prayerName, { isTest = false, type: forcedType } = {}) {
    if (adzanPlayingRef.current) return { played: false, reason: 'busy' };

    const type = forcedType || getAdzanFileType(prayerName);
    const audio = getAdzanAudio(type);
    if (!audio) return { played: false, reason: 'missing_element' };

    if (!getAdzanSrc(adzanSettings, type)) {
      pushStatus(
        `URL adzan ${type === 'subuh' ? 'Subuh' : 'biasa'} belum diisi. Isi di panel Adzan agar adzan ${toPrayerLabel(prayerName)} bisa diputar.`,
        'warning'
      );
      return { played: false, reason: 'no_url' };
    }

    if (adzanFileStatus[type] === 'missing') {
      pushStatus(`URL adzan ${getAdzanSrc(adzanSettings, type)} tidak bisa dimuat. Adzan tidak diputar.`, 'error');
      if (!isTest) markAdzanPlayed(prayerName);
      return { played: false, reason: 'file_missing' };
    }

    // Adzan prioritas tertinggi: hentikan sementara backsound & announcement yang sedang jalan
    pauseBackground();
    const announcementAudio = announcementAudioRef.current;
    const interruptedAnnouncement = Boolean(
      announcementAudio && activeAnnouncementIdRef.current && !announcementAudio.paused
    );
    if (interruptedAnnouncement) announcementAudio.pause();

    const playing = { prayerName, type, isTest, interruptedAnnouncement };
    adzanPlayingRef.current = playing;
    setAdzanPlaying(playing);

    audio.loop = false;
    audio.volume = adzanSettings.volume;
    try {
      audio.currentTime = 0;
    } catch (e) {
      // currentTime bisa gagal jika metadata belum termuat; abaikan
    }

    const result = await safelyPlay(audio);

    if (!result.played) {
      adzanPlayingRef.current = null;
      setAdzanPlaying(null);
      if (interruptedAnnouncement) await safelyPlay(announcementAudio);

      if (result.reason === 'blocked') {
        // Belum di-unlock: percobaan ulang dilakukan setelah "Aktifkan Audio" diklik (selama masih dalam toleransi)
        pushStatus(`Adzan ${toPrayerLabel(prayerName)} tertahan autoplay browser. Klik "Aktifkan Audio".`, 'warning');
      } else if (!isTest && result.reason === 'failed') {
        markAdzanPlayed(prayerName);
        pushStatus(`Adzan ${toPrayerLabel(prayerName)} gagal diputar. Periksa URL ${getAdzanSrc(adzanSettings, type)}.`, 'error');
      }
      return result;
    }

    if (!isTest) markAdzanPlayed(prayerName);
    pushStatus(
      isTest
        ? `Tes adzan ${type === 'subuh' ? 'Subuh' : 'biasa'} sedang diputar.`
        : `Adzan ${toPrayerLabel(prayerName)} sedang diputar.`,
      'success'
    );
    return result;
  }

  async function finishAdzan(message) {
    const playing = adzanPlayingRef.current;
    if (!playing) return;

    adzanPlayingRef.current = null;
    setAdzanPlaying(null);

    if (playing.interruptedAnnouncement && activeAnnouncementIdRef.current && announcementAudioRef.current) {
      await safelyPlay(announcementAudioRef.current);
      if (message) pushStatus(`${message} Announcement dilanjutkan.`, 'info');
      return;
    }

    if (prayerState.active) {
      if (message) pushStatus(`${message} Backsound tetap dijeda selama waktu ${toPrayerLabel(prayerState.prayerName)}.`, 'info');
      return;
    }

    if (message) pushStatus(message, 'info');
    await processQueueIfPossible();
  }

  async function handleAdzanEnded() {
    const playing = adzanPlayingRef.current;
    if (!playing) return;
    await finishAdzan(playing.isTest ? 'Tes adzan selesai.' : `Adzan ${toPrayerLabel(playing.prayerName)} selesai.`);
  }

  async function stopAdzan() {
    const playing = adzanPlayingRef.current;
    if (!playing) return;
    const audio = getAdzanAudio(playing.type);
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch (e) {
        // abaikan
      }
    }
    await finishAdzan('Adzan dihentikan.');
  }

  function handleAdzanFileReady(type) {
    setAdzanFileStatus((prev) => (prev[type] === 'ready' ? prev : { ...prev, [type]: 'ready' }));
  }

  function handleAdzanFileError(type) {
    if (isStoppingRef.current) return;
    setAdzanFileStatus((prev) => (prev[type] === 'missing' ? prev : { ...prev, [type]: 'missing' }));

    const playing = adzanPlayingRef.current;
    if (playing && playing.type === type) {
      pushStatus(`Adzan gagal diputar: URL ${getAdzanSrc(adzanSettings, type)} tidak bisa dimuat.`, 'error');
      finishAdzan('').catch((err) => console.error('Failed to finish adzan after error:', err));
    }
  }

  function handleAdzanSettingChange(patch) {
    setAdzanSettings((prev) => {
      const next = { ...prev, ...patch };
      persistAdzanSettings(next);
      return next;
    });
  }

  async function handleSaveAdzanUrl(type) {
    const value = String(adzanUrlDrafts[type] || '').trim();
    if (value && !isValidAudioUrl(value)) {
      pushStatus('URL adzan tidak valid. Gunakan alamat lengkap diawali https://', 'error');
      return;
    }
    if (adzanPlayingRef.current?.type === type) {
      pushStatus('Hentikan adzan yang sedang diputar sebelum mengganti URL.', 'warning');
      return;
    }

    try {
      // Simpan ke penyimpanan bersama (server) supaya berlaku di semua browser/perangkat
      const sharedAudioConfig = await setSharedAdzanUrls({ [type]: value });
      sharedAudioSignatureRef.current = getSharedAudioConfigSignature(sharedAudioConfig);
      lastSharedAudioSyncAtRef.current = Date.now();
      applySharedAudioConfig(sharedAudioConfig);
    } catch (error) {
      pushStatus(`Gagal menyimpan URL adzan: ${error.message}`, 'error');
      return;
    }

    const label = type === 'subuh' ? 'Subuh' : 'biasa';
    pushStatus(
      value
        ? `URL adzan ${label} disimpan. Memuat file...`
        : `URL adzan ${label} dikosongkan. Adzan ${label} tidak akan diputar sampai URL diisi.`,
      value ? 'info' : 'warning'
    );
  }

  function handleAdzanPrayerToggle(prayerName, enabled) {
    setAdzanSettings((prev) => {
      const next = { ...prev, prayers: { ...prev.prayers, [prayerName]: enabled } };
      persistAdzanSettings(next);
      return next;
    });
  }


  function applySharedAudioConfig(sharedAudioConfig) {
    const nextBackground = sharedAudioConfig.background;
    const nextBackgroundStartTime =
      sharedAudioConfig.backgroundSchedule?.startTime || DEFAULT_BACKGROUND_SCHEDULE.startTime;
    const nextBackgroundEndTime =
      sharedAudioConfig.backgroundSchedule?.endTime || DEFAULT_BACKGROUND_SCHEDULE.endTime;

    setBackgroundMeta((prev) => (isSameBackgroundMeta(prev, nextBackground) ? prev : nextBackground));
    setAnnouncements((prev) => hydrateAnnouncements(sharedAudioConfig.announcements, prev));
    setBackgroundStartTime((prev) => (prev === nextBackgroundStartTime ? prev : nextBackgroundStartTime));
    setBackgroundEndTime((prev) => (prev === nextBackgroundEndTime ? prev : nextBackgroundEndTime));

    if (sharedAudioConfig.adzan) {
      const nextAdzanUrls = { ...DEFAULT_ADZAN_SETTINGS.urls, ...sharedAudioConfig.adzan };
      setAdzanSettings((prev) => {
        const prevUrls = { ...DEFAULT_ADZAN_SETTINGS.urls, ...(prev.urls || {}) };
        const unchanged = Object.keys(nextAdzanUrls).every((key) => prevUrls[key] === nextAdzanUrls[key]);
        return unchanged ? prev : { ...prev, urls: nextAdzanUrls };
      });
      setAdzanUrlDrafts(nextAdzanUrls);
    }
  }

  useEffect(() => {
    activeAnnouncementIdRef.current = activeAnnouncementId;
  }, [activeAnnouncementId]);

  async function safelyPlay(audioEl) {
    if (!audioEl) return { played: false, reason: 'missing_element' };
    try {
      await audioEl.play();
      return { played: true, reason: 'started' };
    } catch (error) {
      // Ignore AbortError - this happens when src is changed during playback
      if (error.name === 'AbortError') {
        return { played: false, reason: 'aborted', error };
      }

      if (error.name === 'NotAllowedError') {
        // Kondisi normal sebelum ada klik pengguna, bukan error aplikasi. Pakai warn agar
        // overlay error Next.js tidak muncul; pemutaran diulang otomatis setelah "Aktifkan Audio".
        console.warn('Autoplay ditahan browser, menunggu "Aktifkan Audio".');
        pendingPlayAfterUnlockRef.current = true;
        setAudioReady(false);
        pushStatus('Browser menahan autoplay. Klik "Aktifkan Audio" untuk mengizinkan pemutaran.', 'warning');
        return { played: false, reason: 'blocked', error };
      }

      console.error(error);
      pushStatus('Audio gagal diputar. File audio tidak tersedia atau formatnya tidak didukung browser.', 'error');
      return { played: false, reason: 'failed', error };
    }
  }

  async function skipFailedAnnouncement(reason) {
    announcementBusyRef.current = false;
    const audio = announcementAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    }

    activeAnnouncementIdRef.current = null;
    setActiveAnnouncementId(null);

    const updatedQueue = pendingQueue.slice(1);
    setPendingQueue(updatedQueue);
    pruneManualTestIds(manualTestIdsRef.current, updatedQueue, null);

    pushStatus(reason, 'error');

    if (prayerState.active) {
      return;
    }

    if (updatedQueue.length) {
      await processQueueIfPossible(updatedQueue);
      return;
    }

    await resumeBackground('Announcement gagal diputar. Backsound standby dilanjutkan.');
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
    if (adzanPlayingRef.current) {
      console.debug('resumeBackground blocked: adzan playing');
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
    const playResult = await safelyPlay(audio);
    if (playResult.played && reason) {
      pushStatus(reason, 'success');
    }
  }

  async function playAnnouncementNow(item, triggerLabel = 'manual') {
    if (!item) return;
    if (adzanPlayingRef.current) {
      pushStatus('Adzan sedang diputar. Tunggu hingga selesai atau hentikan adzan terlebih dahulu.', 'warning');
      return;
    }
    if (announcementBusyRef.current) return;
    if (activeAnnouncementIdRef.current) return;

    announcementBusyRef.current = true;

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
      announcementBusyRef.current = false;
      pushStatus(`File untuk announcement "${item.title}" tidak ditemukan. Upload ulang file-nya.`, 'error');
      return;
    }

    const audio = announcementAudioRef.current;
    if (!audio) {
      announcementBusyRef.current = false;
      return;
    }

    pauseBackground();

    audio.pause();
    audio.currentTime = 0;
    audio.volume = announcementVolume;
    
    // Set src with better error handling
    try {
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.removeAttribute('src');
      audio.load();
      audio.src = audioUrl;
      audio.load();
    } catch (e) {
      announcementBusyRef.current = false;
      console.error('Failed to set audio src:', e);
      pushStatus(`Gagal memuat audio: ${e.message}`, 'error');
      return;
    }

    activeAnnouncementIdRef.current = item.id;
    setActiveAnnouncementId(item.id);
    const playResult = await safelyPlay(audio);

    if (!playResult.played) {
      announcementBusyRef.current = false;
      activeAnnouncementIdRef.current = null;
      setActiveAnnouncementId(null);

      if (playResult.reason === 'failed') {
        const errorMsg = audio.error ? getAudioErrorMessage(audio.error) : (playResult.error?.message || 'Gagal memulai playback');
        await skipFailedAnnouncement(`Gagal memutar announcement "${item.title}" (${errorMsg}). Lanjut ke announcement berikutnya...`);
        return;
      }

      return;
    }

    announcementBusyRef.current = false;
    const label = triggerLabel === 'schedule' ? 'jadwal' : 'manual';
    pushStatus(`Memutar announcement (${label}): ${item.title}`, 'success');
  }

  async function processQueueIfPossible(queue = pendingQueue) {
    if (adzanPlayingRef.current) return;
    if (prayerState.active) return;
    if (announcementBusyRef.current) return;
    if (activeAnnouncementIdRef.current) return;
    if (!queue.length) {
      await resumeBackground('Backsound standby aktif.');
      return;
    }

    const nextId = queue[0];
    const item = announcements.find((entry) => entry.id === nextId);

    if (!item || (!item.enabled && !manualTestIdsRef.current.has(nextId))) {
      const updated = queue.slice(1);
      setPendingQueue(updated);
      if (updated.length) {
        await processQueueIfPossible(updated);
      } else {
        await resumeBackground('Backsound standby aktif.');
      }
      return;
    }

    await playAnnouncementNow(item, 'schedule');
  }

  async function fetchPrayerTimesFromApi({ quiet = false, customConfig } = {}) {
    const config = customConfig || prayerConfig;
    if (!hasValidCity(config)) {
      if (!quiet) pushStatus('Kota belum dipilih. Cari dan pilih kota/kabupaten terlebih dahulu.', 'error');
      return false;
    }

    const cityId = String(config.cityId).trim();
    const requestKey = `${todayKey}|myquran|${cityId}`;

    setPrayerLoading(true);

    try {
      const [year, month, day] = todayKey.split('-');
      const url = `${MYQURAN_API_BASE}/jadwal/${cityId}/${year}/${month}/${day}`;

      const response = await fetch(url, { cache: 'no-store' });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errorText || 'API Error'}`);
      }

      const payload = await response.json();
      const data = payload?.data;
      const jadwal = data?.jadwal;

      if (!payload?.status || !jadwal) {
        throw new Error(payload?.message || 'Format data API tidak sesuai.');
      }

      const nextTimings = {
        subuh: normalizeApiTime(jadwal.subuh),
        dzuhur: normalizeApiTime(jadwal.dzuhur),
        ashar: normalizeApiTime(jadwal.ashar),
        maghrib: normalizeApiTime(jadwal.maghrib),
        isya: normalizeApiTime(jadwal.isya),
      };

      const nextCache = {
        dateKey: todayKey,
        fetchedAt: Date.now(),
        source: toTitleCase(data.lokasi || config.cityName || `ID ${cityId}`),
        timezone: data.daerah ? toTitleCase(data.daerah) : '',
        requestKey,
        timings: nextTimings,
      };

      setPrayerApiCache(nextCache);
      persistPrayerApiCache(nextCache);
      if (!quiet) {
        pushStatus(`Jadwal sholat (Kemenag via MyQuran) berhasil diambil untuk ${nextCache.source}.`, 'success');
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

  async function searchPrayerCity(event) {
    if (event) event.preventDefault();

    const keyword = citySearchQuery.trim();
    if (keyword.length < 3) {
      pushStatus('Ketik minimal 3 huruf nama kota/kabupaten.', 'warning');
      return;
    }

    const requestId = citySearchRequestRef.current + 1;
    citySearchRequestRef.current = requestId;
    setCitySearchLoading(true);

    try {
      const url = `${MYQURAN_API_BASE}/kota/cari/${encodeURIComponent(keyword)}`;
      const response = await fetch(url, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (requestId !== citySearchRequestRef.current) return;

      if (!payload?.status || !Array.isArray(payload.data) || payload.data.length === 0) {
        setCitySearchResults([]);
        pushStatus(`Kota/kabupaten "${keyword}" tidak ditemukan.`, 'warning');
        return;
      }

      setCitySearchResults(payload.data);
    } catch (error) {
      console.error('Error searching city:', error);
      if (requestId === citySearchRequestRef.current) {
        pushStatus(`Gagal mencari kota: ${error.message}`, 'error');
      }
    } finally {
      if (requestId === citySearchRequestRef.current) {
        setCitySearchLoading(false);
      }
    }
  }

  async function handleSelectPrayerCity(city) {
    const nextConfig = {
      ...prayerConfig,
      cityId: String(city.id),
      cityName: toTitleCase(city.lokasi),
    };

    setPrayerConfig(nextConfig);
    persistPrayerConfig(nextConfig);
    setCitySearchResults([]);
    setCitySearchQuery('');

    return fetchPrayerTimesFromApi({ quiet: false, customConfig: nextConfig });
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapPage() {
      const savedManualPrayerTimes = localStorage.getItem(STORAGE_KEYS.manualPrayerTimes);
      const savedPrayerPauseMinutes = localStorage.getItem(STORAGE_KEYS.prayerPauseMinutes);
      const savedPrayerOffsets = localStorage.getItem(STORAGE_KEYS.prayerOffsets);
      const savedPrayerConfig = localStorage.getItem(STORAGE_KEYS.prayerConfig);
      const savedPrayerApiCache = localStorage.getItem(STORAGE_KEYS.prayerApiCache);
      const savedSettings = localStorage.getItem(STORAGE_KEYS.settings);
      const legacyBackgroundSchedule = localStorage.getItem('app-background-schedule-v1');

      if (savedManualPrayerTimes) setManualPrayerTimes(JSON.parse(savedManualPrayerTimes));
      if (savedPrayerPauseMinutes) setPrayerPauseMinutes(Number(savedPrayerPauseMinutes));
      if (savedPrayerOffsets) setPrayerOffsets({ ...DEFAULT_PRAYER_OFFSETS, ...JSON.parse(savedPrayerOffsets) });

      if (savedPrayerConfig) {
        const parsed = JSON.parse(savedPrayerConfig);
        const nextConfig = { ...DEFAULT_PRAYER_CONFIG, ...parsed };

        if (!hasValidCity(nextConfig)) {
          nextConfig.cityId = '';
          nextConfig.cityName = '';
        }

        setPrayerConfig(nextConfig);
      }

      if (savedPrayerApiCache) {
        setPrayerApiCache({ ...DEFAULT_PRAYER_API_CACHE, ...JSON.parse(savedPrayerApiCache) });
      }

      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (typeof parsed.backgroundEnabled === 'boolean') setBackgroundEnabled(parsed.backgroundEnabled);
        if (typeof parsed.backgroundVolume === 'number') setBackgroundVolume(parsed.backgroundVolume);
        if (typeof parsed.announcementVolume === 'number') setAnnouncementVolume(parsed.announcementVolume);
      }

      try {
        const savedAdzanSettings = localStorage.getItem(STORAGE_KEYS.adzanSettings);
        if (savedAdzanSettings) {
          const parsed = JSON.parse(savedAdzanSettings);
          setAdzanSettings({
            ...DEFAULT_ADZAN_SETTINGS,
            ...parsed,
            prayers: { ...DEFAULT_ADZAN_SETTINGS.prayers, ...(parsed.prayers || {}) },
            urls: { ...DEFAULT_ADZAN_SETTINGS.urls, ...(parsed.urls || {}) },
          });
          setAdzanUrlDrafts({ ...DEFAULT_ADZAN_SETTINGS.urls, ...(parsed.urls || {}) });
        }
        const savedAdzanPlayedLog = localStorage.getItem(STORAGE_KEYS.adzanPlayedLog);
        if (savedAdzanPlayedLog) {
          const parsed = JSON.parse(savedAdzanPlayedLog);
          if (parsed && Array.isArray(parsed.prayers)) setAdzanPlayedLog(parsed);
        }
      } catch (adzanStorageError) {
        console.warn('Failed to read adzan settings:', adzanStorageError);
      }

      try {
        let sharedAudioConfig = await getSharedAudioConfig();
        if (cancelled) return;

        if (
          legacyBackgroundSchedule &&
          sharedAudioConfig.backgroundSchedule?.startTime === DEFAULT_BACKGROUND_SCHEDULE.startTime &&
          sharedAudioConfig.backgroundSchedule?.endTime === DEFAULT_BACKGROUND_SCHEDULE.endTime
        ) {
          try {
            const parsedLegacySchedule = JSON.parse(legacyBackgroundSchedule);
            sharedAudioConfig = await setSharedBackgroundSchedule({
              startTime: parsedLegacySchedule?.startTime || DEFAULT_BACKGROUND_SCHEDULE.startTime,
              endTime: parsedLegacySchedule?.endTime || DEFAULT_BACKGROUND_SCHEDULE.endTime,
            });
            localStorage.removeItem('app-background-schedule-v1');
          } catch (migrationError) {
            console.warn('Failed to migrate legacy background schedule:', migrationError);
          }
        }
        // Migrasi sekali: URL adzan lama di localStorage dipindah ke penyimpanan bersama (server)
        try {
          const adzanMigrationKey = 'app-adzan-urls-migrated-v1';
          if (!localStorage.getItem(adzanMigrationKey)) {
            const legacyUrls = JSON.parse(localStorage.getItem(STORAGE_KEYS.adzanSettings) || '{}').urls || {};
            const migrationPatch = {};
            for (const type of ADZAN_TYPES) {
              const legacyUrl = String(legacyUrls[type] || '').trim();
              if (legacyUrl && isValidAudioUrl(legacyUrl) && !sharedAudioConfig.adzan?.[type]) {
                migrationPatch[type] = legacyUrl;
              }
            }
            if (Object.keys(migrationPatch).length > 0) {
              sharedAudioConfig = await setSharedAdzanUrls(migrationPatch);
            }
            localStorage.setItem(adzanMigrationKey, '1');
          }
        } catch (adzanMigrationError) {
          console.warn('Failed to migrate adzan URLs:', adzanMigrationError);
        }



        sharedAudioSignatureRef.current = getSharedAudioConfigSignature(sharedAudioConfig);
        lastSharedAudioSyncAtRef.current = Date.now();
        applySharedAudioConfig(sharedAudioConfig);
      } catch (error) {
        console.error('Failed to load shared audio config:', error);
        if (!cancelled) {
          pushStatus(`Gagal memuat data audio bersama: ${error.message}`, 'warning');
        }
      } finally {
        if (!cancelled) {
          setBootstrapped(true);
        }
      }
    }

    bootstrapPage();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bootstrapped) return;

    let cancelled = false;

    async function syncSharedAudioConfig({ force = false } = {}) {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible' && !force) return;
      if (sharedAudioSyncInFlightRef.current) return;

      const nowAt = Date.now();
      if (!force && nowAt - lastSharedAudioSyncAtRef.current < SHARED_AUDIO_SYNC_MIN_GAP_MS) {
        return;
      }

      sharedAudioSyncInFlightRef.current = true;

      try {
        const sharedAudioConfig = await getSharedAudioConfig();
        if (cancelled) return;

        lastSharedAudioSyncAtRef.current = Date.now();

        const nextSignature = getSharedAudioConfigSignature(sharedAudioConfig);
        if (nextSignature === sharedAudioSignatureRef.current) {
          return;
        }

        sharedAudioSignatureRef.current = nextSignature;

        applySharedAudioConfig(sharedAudioConfig);
        setPendingQueue((prev) =>
          prev.filter((queueId) =>
            sharedAudioConfig.announcements?.some(
              (item) => item.id === queueId && (item.enabled !== false || manualTestIdsRef.current.has(queueId))
            )
          )
        );

        const activeId = activeAnnouncementIdRef.current;
        if (
          activeId &&
          !sharedAudioConfig.announcements?.some(
            (item) => item.id === activeId && (item.enabled !== false || manualTestIdsRef.current.has(activeId))
          )
        ) {
          const audio = announcementAudioRef.current;
          if (audio) {
            announcementBusyRef.current = false;
            isStoppingRef.current = true;
            audio.pause();
            audio.currentTime = 0;
            audio.removeAttribute('src');
            audio.load();
            setTimeout(() => {
              isStoppingRef.current = false;
            }, 0);
          }
          activeAnnouncementIdRef.current = null;
          setActiveAnnouncementId(null);
        }
      } finally {
        sharedAudioSyncInFlightRef.current = false;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') {
        return;
      }

      syncSharedAudioConfig().catch((error) => {
        if (!cancelled) {
          console.warn('Failed to sync shared audio config:', error);
        }
      });
    }

    function handleWindowFocus() {
      syncSharedAudioConfig().catch((error) => {
        if (!cancelled) {
          console.warn('Failed to sync shared audio config:', error);
        }
      });
    }

    const intervalId = setInterval(() => {
      syncSharedAudioConfig().catch((error) => {
        if (!cancelled) {
          console.warn('Failed to sync shared audio config:', error);
        }
      });
    }, SHARED_AUDIO_SYNC_INTERVAL_MS);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
    }

    return () => {
      cancelled = true;
      clearInterval(intervalId);

      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }

      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleWindowFocus);
      }
    };
  }, [bootstrapped]);

  useEffect(() => {
    let cancelled = false;

    async function loadBackground() {
      if (!backgroundMeta?.blobId) {
        const audioEl = backgroundAudioRef.current;
        if (audioEl) {
          audioEl.pause();
          audioEl.removeAttribute('src');
          audioEl.load();
        }
        setBackgroundUrl('');
        return;
      }

      // Use URL directly from metadata (stored in Vercel Blob)
      const url = await getAudioFileUrl(backgroundMeta.blobId, backgroundMeta.fileUrl);
      if (!url || cancelled) {
        const audioEl = backgroundAudioRef.current;
        if (audioEl) {
          audioEl.pause();
          audioEl.removeAttribute('src');
          audioEl.load();
        }
        setBackgroundUrl('');
        return;
      }

      const validation = await validateBlobUrl(url);
      if (cancelled) {
        return;
      }

      if (!validation.isAccessible) {
        const audioEl = backgroundAudioRef.current;
        if (audioEl) {
          audioEl.pause();
          audioEl.removeAttribute('src');
          audioEl.load();
        }
        setBackgroundUrl('');
        pushStatus(
          validation.statusCode === 404
            ? 'Backsound di config tidak bisa diakses. Periksa lagi blobId/fileUrl di audio-library.json atau upload ulang file backsound.'
            : 'Backsound gagal diverifikasi. Coba refresh atau upload ulang file backsound.',
          'warning'
        );
        return;
      }

      setBackgroundUrl(url);

      // Pastikan audio element mendapat src yang benar
      const audioEl = backgroundAudioRef.current;
      if (audioEl) {
        audioEl.src = url;
        audioEl.load();
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
    if (!audioEl) return;

    if (backgroundUrl) {
      audioEl.src = backgroundUrl;
      audioEl.load();
      return;
    }

    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
  }, [backgroundUrl]);

  useEffect(() => {
    const player = announcementAudioRef.current;
    if (!player) return;
    player.volume = announcementVolume;
  }, [announcementVolume]);

  useEffect(() => {
    [adzanNormalAudioRef.current, adzanSubuhAudioRef.current].forEach((player) => {
      if (player) player.volume = adzanSettings.volume;
    });
  }, [adzanSettings.volume]);

  // Status file adzan dibaca dari event elemen <audio> (canplaythrough / error).
  // Tidak memakai fetch/HEAD karena server eksternal umumnya tidak mengirim header CORS.
  // Setiap kali sumber berubah, status di-reset ke 'loading' sampai audio siap/gagal.
  useEffect(() => {
    setAdzanFileStatus((prev) => ({ ...prev, normal: 'loading' }));
  }, [adzanNormalSrc]);

  useEffect(() => {
    setAdzanFileStatus((prev) => ({ ...prev, subuh: 'loading' }));
  }, [adzanSubuhSrc]);

  // Setelah audio di-unlock, izinkan percobaan ulang adzan yang tadi tertahan autoplay
  useEffect(() => {
    if (audioReady) adzanAttemptRef.current = '';
  }, [audioReady]);

  // Pemicu adzan + warm-up buffer menjelang waktu sholat
  useEffect(() => {
    if (!bootstrapped) return;

    // Warm-up: 2 menit sebelum waktu sholat, muat ulang buffer audio adzan
    // (tab yang terbuka berjam-jam bisa membuang buffer preload)
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    if (adzanSettings.enabled && !adzanPlayingRef.current) {
      for (const [name, time] of Object.entries(effectivePrayerTimes)) {
        if (!adzanSettings.prayers?.[name]) continue;
        const diff = timeToMinutes(time) - minutesNow;
        const warmupKey = `${todayKey}|${name}`;
        if (diff > 0 && diff <= 2 && adzanWarmupRef.current !== warmupKey) {
          adzanWarmupRef.current = warmupKey;
          const audio = getAdzanAudio(getAdzanFileType(name));
          if (audio && audio.paused && audio.getAttribute('src')) audio.load();
        }
      }
    }

    const duePrayer = findDueAdzanPrayer(effectivePrayerTimes, adzanSettings, adzanPlayedToday, now);
    if (!duePrayer) return;

    const attemptKey = `${todayKey}|${duePrayer}`;
    if (adzanAttemptRef.current === attemptKey) return;
    if (adzanPlayingRef.current) return;

    adzanAttemptRef.current = attemptKey;
    playAdzan(duePrayer).catch((err) => console.error('Failed to play adzan:', err));
  }, [now, bootstrapped, effectivePrayerTimes, adzanSettings, adzanPlayedLog, todayKey]);

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
    if (adzanPlaying) return;
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
  }, [backgroundEnabled, audioReady, adzanPlaying, prayerState.active, activeAnnouncementId, pendingQueue.length, backgroundUrl, now, backgroundStartTime, backgroundEndTime]);

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

    // Announcement sekali: kunci per hari. Announcement berkala: kunci per slot menit.
    const getTriggerKey = (item) => (getAnnouncementInterval(item) ? `${todayKey} ${currentHHMM}` : todayKey);

    const allDueItems = announcements.filter(
      (item) => item.enabled && isAnnouncementDueNow(item, now) && item.lastTriggeredDate !== getTriggerKey(item)
    );

    if (!allDueItems.length) return;

    // Slot berkala yang jatuh saat jeda sholat / adzan dilewati (tidak diganti nanti)
    const blockedNow = prayerState.active || Boolean(adzanPlayingRef.current);
    const skippedItems = blockedNow ? allDueItems.filter((item) => getAnnouncementInterval(item)) : [];
    const dueItems = allDueItems.filter((item) => !skippedItems.includes(item));

    const updatedAnnouncements = announcements.map((item) =>
      allDueItems.some((due) => due.id === item.id) ? { ...item, lastTriggeredDate: getTriggerKey(item) } : item
    );

    setAnnouncements(updatedAnnouncements);

    if (skippedItems.length) {
      pushStatus(
        `Jadwal ${skippedItems.map((item) => item.title).join(', ')} jam ${currentHHMM} dilewati karena sedang waktu sholat/adzan.`,
        'info'
      );
    }

    if (!dueItems.length) return;

    const nextQueue = [...pendingQueue];
    dueItems.forEach((item) => {
      nextQueue.push(...createAnnouncementQueueEntries(item));
    });
    setPendingQueue(nextQueue);

    if (prayerState.active) {
      pushStatus(
        `Ada ${dueItems.length} announcement masuk saat waktu ${toPrayerLabel(prayerState.prayerName)}. Akan diputar setelah jeda selesai.`,
        'warning'
      );
      return;
    }

    processQueueIfPossible(nextQueue);
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
    if (!hasValidCity(prayerConfig)) return;

    const requestKey = `${todayKey}|myquran|${String(prayerConfig.cityId).trim()}`;

    if (prayerApiCache.requestKey === requestKey && prayerApiCache.dateKey === todayKey) {
      return;
    }

    fetchPrayerTimesFromApi({ quiet: true }).catch((err) => {
      console.error('Unhandled error in auto-fetch prayer times:', err);
    });
  }, [
    bootstrapped,
    prayerConfig.mode,
    prayerConfig.cityId,
    todayKey,
    prayerApiCache.requestKey,
    prayerApiCache.dateKey,
  ]);

  async function handleUnlockAudio() {
    try {
      const wasAlreadyReady = audioReady;
      const shouldEnableBackground = Boolean(backgroundMeta);
      
      setAudioReady(true);
      if (shouldEnableBackground) {
        setBackgroundEnabled(true);
      }
      
      if (shouldEnableBackground) {
        pushStatus('Audio diaktifkan. Backsound kembali aktif.', 'success');
      } else if (!wasAlreadyReady) {
        pushStatus('Audio berhasil diaktifkan. Sistem siap memutar backsound dan announcement.', 'success');
      }
      
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const bg = backgroundAudioRef.current;
      const shouldPlay = bg && backgroundUrl && shouldEnableBackground && !prayerState.active && !adzanPlayingRef.current && !activeAnnouncementId && !pendingQueue.length;
      
      if (shouldPlay) {
        try {
          await resumeBackground();
          console.log('Background audio play attempted after unlock');
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

    let blobData = null;

    try {
      pushStatus('Mengunggah backsound ke Vercel Blob...', 'info');
      
      blobData = await uploadAudioFile(file);

      const meta = {
        blobId: blobData.blobId,
        fileUrl: blobData.url,
        name: file.name,
        uploadedAt: Date.now(),
      };

      const sharedAudioConfig = await setSharedBackground(meta);
      setBackgroundMeta(sharedAudioConfig.background);

      if (sharedAudioConfig.previousBackground?.blobId || sharedAudioConfig.previousBackground?.fileUrl) {
        console.log('Deleting old backsound from Vercel Blob:', {
          blobId: sharedAudioConfig.previousBackground.blobId,
          fileUrl: sharedAudioConfig.previousBackground.fileUrl,
        });

        deleteAudioFile(sharedAudioConfig.previousBackground.blobId, sharedAudioConfig.previousBackground.fileUrl)
          .then(() => {
            console.log('Old backsound successfully deleted:', sharedAudioConfig.previousBackground.blobId);
          })
          .catch((deleteError) => {
            console.warn('Failed to delete old backsound:', deleteError);
          });
      }

      pushStatus(`Backsound standby disimpan di Vercel Blob: ${file.name}`, 'success');
      event.target.value = '';
    } catch (error) {
      console.error('Error uploading background:', error);

      if (blobData?.blobId || blobData?.url) {
        deleteAudioFile(blobData.blobId, blobData.url).catch((cleanupError) => {
          console.warn('Failed to clean up uploaded backsound after metadata error:', cleanupError);
        });
      }

      pushStatus(`Gagal mengunggah backsound: ${error.message}`, 'error');
    }
  }

  async function handleSaveBackgroundSchedule() {
    try {
      const sharedAudioConfig = await setSharedBackgroundSchedule({
        startTime: backgroundStartTime,
        endTime: backgroundEndTime,
      });

      setBackgroundStartTime(sharedAudioConfig.backgroundSchedule?.startTime || DEFAULT_BACKGROUND_SCHEDULE.startTime);
      setBackgroundEndTime(sharedAudioConfig.backgroundSchedule?.endTime || DEFAULT_BACKGROUND_SCHEDULE.endTime);
      setShowBackgroundScheduleModal(false);
      pushStatus('Jadwal backsound disimpan untuk semua perangkat.', 'success');
    } catch (error) {
      console.error('Error saving shared background schedule:', error);
      pushStatus(`Gagal menyimpan jadwal backsound: ${error.message}`, 'error');
    }
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

    const repeatCount = Math.max(1, Number.parseInt(newAnnouncementRepeatCount, 10) || 1);

    if (repeatCount < 1) {
      pushStatus('Jumlah putar announcement minimal 1 kali.', 'error');
      return;
    }

    const intervalMinutes = newAnnouncementPeriodic ? Number.parseInt(newAnnouncementInterval, 10) || 0 : 0;
    if (newAnnouncementPeriodic) {
      if (intervalMinutes < 1) {
        pushStatus('Interval pengulangan minimal 1 menit.', 'error');
        return;
      }
      if (!newAnnouncementEndTime || timeToMinutes(newAnnouncementEndTime) < timeToMinutes(newAnnouncementTime)) {
        pushStatus('Jam selesai harus sama dengan atau setelah jam mulai (di hari yang sama).', 'error');
        return;
      }
    }

    if (!file) {
      pushStatus('File audio announcement belum dipilih.', 'error');
      return;
    }

    setIsSavingAnnouncement(true);
    let blobData = null;

    try {
      pushStatus('Mengunggah announcement ke Vercel Blob...', 'info');
      
      blobData = await uploadAudioFile(file);

      const item = {
        id: createId('schedule'),
        title: newAnnouncementTitle.trim(),
        time: newAnnouncementTime,
        intervalMinutes,
        endTime: intervalMinutes > 0 ? newAnnouncementEndTime : '',
        repeatCount,
        blobId: blobData.blobId,
        fileUrl: blobData.url,
        enabled: true,
        createdAt: Date.now(),
      };

      const sharedAudioConfig = await addSharedAnnouncement(item);
      setAnnouncements((prev) => hydrateAnnouncements(sharedAudioConfig.announcements, prev));

      setNewAnnouncementTitle('');
      setNewAnnouncementTime('08:00');
      setNewAnnouncementRepeatCount(1);
      setNewAnnouncementPeriodic(false);
      setNewAnnouncementInterval(15);
      setNewAnnouncementEndTime('15:00');
      setNewAnnouncementFileName('');
      if (newAnnouncementFileRef.current) {
        newAnnouncementFileRef.current.value = '';
      }

      setIsSavingAnnouncement(false);
      setShowAnnouncementModal(false);
      pushStatus(
        item.intervalMinutes > 0
          ? `Announcement ${item.title} disimpan: tiap ${item.intervalMinutes} menit, ${item.time}–${item.endTime}, ${item.repeatCount} kali putar per jadwal.`
          : `Announcement ${item.title} jam ${item.time} disimpan untuk ${item.repeatCount} kali putar.`,
        'success'
      );
    } catch (error) {
      console.error(error);

      if (blobData?.blobId || blobData?.url) {
        deleteAudioFile(blobData.blobId, blobData.url).catch((cleanupError) => {
          console.warn('Failed to clean up uploaded announcement after metadata error:', cleanupError);
        });
      }

      pushStatus(`Gagal menyimpan announcement: ${error.message}`, 'error');
    } finally {
      setIsSavingAnnouncement(false);
    }
  }

  async function handleDeleteAnnouncement(item) {
    try {
      const sharedAudioConfig = await deleteSharedAnnouncement(item.id);
      setAnnouncements((prev) => hydrateAnnouncements(sharedAudioConfig.announcements, prev));

      const queueUpdated = pendingQueue.filter((id) => id !== item.id);
      setPendingQueue(queueUpdated);

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

  async function handleToggleAnnouncement(id) {
    const currentItem = announcements.find((item) => item.id === id);
    if (!currentItem) return;

    const nextEnabled = !currentItem.enabled;

    setAnnouncements((prev) =>
      prev.map((item) => (item.id === id ? { ...item, enabled: nextEnabled } : item))
    );

    if (!nextEnabled) {
      setPendingQueue((prev) => prev.filter((queueId) => queueId !== id));

      if (activeAnnouncementId === id) {
        const audio = announcementAudioRef.current;
        if (audio) {
          announcementBusyRef.current = false;
          audio.pause();
          audio.currentTime = 0;
          audio.src = '';
        }
        activeAnnouncementIdRef.current = null;
        setActiveAnnouncementId(null);
      }
    }

    try {
      const sharedAudioConfig = await toggleSharedAnnouncement(id);
      setAnnouncements((prev) => hydrateAnnouncements(sharedAudioConfig.announcements, prev));

      if (!nextEnabled) {
        pushStatus(`Announcement "${currentItem.title}" dinonaktifkan.`, 'info');
        await processQueueIfPossible();
      } else {
        pushStatus(`Announcement "${currentItem.title}" diaktifkan kembali.`, 'success');
      }
    } catch (error) {
      console.error('Error toggling announcement:', error);

      setAnnouncements((prev) =>
        prev.map((item) => (item.id === id ? { ...item, enabled: currentItem.enabled } : item))
      );

      pushStatus(`Gagal mengubah status announcement: ${error.message}`, 'error');
    }
  }

  async function handlePlayManual(item) {
    // Tombol Putar = tes suara, jadi tetap boleh walau jadwal announcement sedang Off
    if (!item.enabled) {
      manualTestIdsRef.current.add(item.id);
      pushStatus(`Tes suara "${item.title}" (jadwal sedang Off, hanya diputar manual).`, 'info');
    }

    const updatedQueue = [...createAnnouncementQueueEntries(item), ...pendingQueue];
    setPendingQueue(updatedQueue);

    if (prayerState.active) {
      pushStatus(
        `Saat ini waktu ${toPrayerLabel(prayerState.prayerName)}. Announcement dimasukkan ke antrian dan akan diputar setelah jeda selesai.`,
        'warning'
      );
      return;
    }

    await processQueueIfPossible(updatedQueue);
  }

  async function handleStopAnnouncement(item) {
    const id = item.id;
    const wasActive = activeAnnouncementIdRef.current === id;
    const remainingQueue = pendingQueue.filter((queueId) => queueId !== id);

    setPendingQueue(remainingQueue);
    manualTestIdsRef.current.delete(id);

    if (!wasActive) {
      pushStatus(`Antrian announcement "${item.title}" dibatalkan.`, 'info');
      return;
    }

    // Suppress error events yang muncul saat src dikosongkan
    isStoppingRef.current = true;
    announcementBusyRef.current = false;

    const audio = announcementAudioRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch (e) {
        // abaikan
      }
      audio.removeAttribute('src');
      audio.load();
    }

    activeAnnouncementIdRef.current = null;
    setActiveAnnouncementId(null);

    // Jika adzan sempat menjeda announcement ini, jangan dilanjutkan lagi setelah adzan selesai
    if (adzanPlayingRef.current) {
      adzanPlayingRef.current.interruptedAnnouncement = false;
    }

    setTimeout(() => {
      isStoppingRef.current = false;
    }, 100);

    pushStatus(`Announcement "${item.title}" dihentikan.`, 'info');

    if (prayerState.active || adzanPlayingRef.current) {
      return;
    }

    // Lanjut ke announcement berikutnya, atau kembalikan backsound jika antrian kosong
    await processQueueIfPossible(remainingQueue);
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
    pushStatus(mode === 'auto' ? 'Mode jadwal sholat diubah ke otomatis API (Kemenag via MyQuran).' : 'Mode jadwal sholat diubah ke manual.', 'info');
  }

  function handleAnnouncementError(error) {
    // Skip error if we're intentionally stopping
    if (isStoppingRef.current) {
      console.debug('Skipping announcement error - audio is being stopped');
      return;
    }
    
    const audioEl = error?.currentTarget || announcementAudioRef.current;
    
    // Don't show error if src is not set (intentionally cleared)
    if (!audioEl || !audioEl.src) {
      console.debug('Skipping announcement error - src is empty');
      return;
    }
    
    if (audioEl && audioEl.error) {
      const errorMsg = getAudioErrorMessage(audioEl.error);
      // Event DOM tidak bisa di-serialize (tampil sebagai {}), jadi catat field yang berguna saja
      console.warn('Announcement audio error:', {
        code: audioEl.error.code,
        message: audioEl.error.message || '',
        detail: errorMsg,
        src: audioEl.currentSrc || audioEl.src,
        networkState: audioEl.networkState,
        readyState: audioEl.readyState,
      });

      skipFailedAnnouncement(`Gagal memutar announcement (${errorMsg}). Lanjut ke announcement berikutnya...`).catch((queueError) => {
        console.error('Failed to skip broken announcement:', queueError);
      });
    }
  }

  function handleBackgroundError(error) {
    // Skip error if we're intentionally stopping
    if (isStoppingRef.current) {
      console.debug('Skipping background error - audio is being stopped');
      return;
    }
    
    console.error('Background audio error:', error);
    const audioEl = backgroundAudioRef.current;
    
    // Don't show error if src is not set (intentionally cleared)
    if (!audioEl || !audioEl.src) {
      console.debug('Skipping background error - src is empty');
      return;
    }
    
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
    announcementBusyRef.current = false;
    activeAnnouncementIdRef.current = null;
    setActiveAnnouncementId(null);

    const updatedQueue = pendingQueue.slice(1);
    setPendingQueue(updatedQueue);
    pruneManualTestIds(manualTestIdsRef.current, updatedQueue, null);

    if (prayerState.active) {
      pushStatus(`Announcement selesai. Backsound tetap dijeda karena waktu ${toPrayerLabel(prayerState.prayerName)} masih berjalan.`, 'warning');
      return;
    }

    if (updatedQueue.length) {
      await processQueueIfPossible(updatedQueue);
      return;
    }

    await resumeBackground('Announcement selesai. Backsound standby dilanjutkan.');
  }

  async function handleStopAll() {
    try {
      // Set flag to suppress error events during stopping
      isStoppingRef.current = true;
      
      const bg = backgroundAudioRef.current;
      const an = announcementAudioRef.current;

      if (bg) {
        bg.pause();
        bg.currentTime = 0;
      }

      if (an) {
        announcementBusyRef.current = false;
        an.pause();
        an.currentTime = 0;
        an.src = '';
      }

      activeAnnouncementIdRef.current = null;
      setActiveAnnouncementId(null);
      setBackgroundEnabled(false);
      setAudioReady(false);
      [adzanNormalAudioRef.current, adzanSubuhAudioRef.current].forEach((adzanAudio) => {
        if (!adzanAudio) return;
        adzanAudio.pause();
        try {
          adzanAudio.currentTime = 0;
        } catch (e) {
          // abaikan
        }
      });
      // Tandai adzan yang sedang berjalan sebagai sudah diputar agar tidak terulang
      if (adzanPlayingRef.current && !adzanPlayingRef.current.isTest) {
        markAdzanPlayed(adzanPlayingRef.current.prayerName);
      }
      adzanPlayingRef.current = null;
      setAdzanPlaying(null);

      setPendingQueue([]);
      manualTestIdsRef.current.clear();
      pushStatus('Semua audio dihentikan.', 'info');

      // Give error events time to fire and be caught by the suppression flag
      // Then clear the flag
      setTimeout(() => {
        isStoppingRef.current = false;
      }, 100);
    } catch (error) {
      console.error('Error in handleStopAll:', error);
      isStoppingRef.current = false;
    }
  }

  const prayerSourceSummary = prayerConfig.mode === 'auto'
    ? prayerApiCache.fetchedAt
      ? `API MyQuran • ${prayerApiCache.source || prayerConfig.cityName || 'kota belum dipilih'} • Kemenag RI`
      : hasValidCity(prayerConfig) ? 'API belum sinkron' : 'API • pilih kota terlebih dahulu'
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
      <audio
        ref={adzanNormalAudioRef}
        src={adzanNormalSrc}
        preload="auto"
        onCanPlayThrough={() => handleAdzanFileReady('normal')}
        onEnded={handleAdzanEnded}
        onError={() => handleAdzanFileError('normal')}
      />
      <audio
        ref={adzanSubuhAudioRef}
        src={adzanSubuhSrc}
        preload="auto"
        onCanPlayThrough={() => handleAdzanFileReady('subuh')}
        onEnded={handleAdzanEnded}
        onError={() => handleAdzanFileError('subuh')}
      />

      <section className="hero-card">
        <div>
          <p className="eyebrow">IT Rayhan Hospital</p>
          <h1>Audio Pengumuman Otomatis</h1>
          <p className="hero-text">
            Musik latar diputar otomatis selama jam operasional. Saat waktu sholat tiba, adzan berkumandang dan semua suara dijeda. Saat ada pengumuman terjadwal, musik latar berhenti sebentar lalu lanjut sendiri. Jadwal sholat bisa diambil otomatis dari API atau diatur manual.
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
            <span className={`badge badge-${status.type || 'info'}`}>{STATUS_TYPE_LABELS[status.type] || 'Info'}</span>
          </div>
          <div className="hero-actions">
          <button className="primary-button" onClick={handleUnlockAudio}>
            Aktifkan Audio
          </button>
          <button className="danger-button" onClick={handleStopAll}>
            Stop Audio
          </button>
        </div>

          <div className={`monitor-state monitor-state-${monitorState.tone}`} role="status" aria-live="polite">
            <strong>{monitorState.title}</strong>
            <p>{monitorState.detail}</p>
          </div>

          <div className="info-list" style={{ marginTop: '14px' }}>
          <div>
            <span>Jadwal backsound</span>
            <strong>{backgroundStartTime} - {backgroundEndTime}</strong>
          </div>
            <div>
              <span>Audio browser</span>
              <strong>{audioReady ? '✓ Aktif, suara bisa diputar' : 'Belum aktif - klik "Aktifkan Audio"'}</strong>
            </div>
            <div>
              <span>Backsound</span>
              <strong>{backgroundStatusLabel}</strong>
            </div>
            <div>
              <span>Announcement</span>
              <strong>
                {activeAnnouncementId
                  ? `▶ ${announcements.find((item) => item.id === activeAnnouncementId)?.title || 'Sedang diputar'}`
                  : nextAnnouncementInfo
                    ? `Tidak ada yang diputar. Berikutnya: ${nextAnnouncementInfo.item.title} (${formatDuration(nextAnnouncementInfo.inMinutes)} lagi)`
                    : 'Tidak ada yang diputar. Belum ada jadwal aktif'}
              </strong>
            </div>
            <div>
              <span>Antrian</span>
              <strong>{waitingQueueCount ? `${waitingQueueCount} item menunggu giliran` : 'Kosong'}</strong>
            </div>
            <div>
              <span>Adzan</span>
              <strong>
                {adzanPlaying
                  ? `▶ ${adzanPlaying.isTest ? 'Tes adzan' : `Berkumandang - ${toPrayerLabel(adzanPlaying.prayerName)}`}`
                  : !adzanSettings.enabled
                    ? 'Nonaktif - adzan otomatis dimatikan'
                    : nextPrayerInfo
                      ? `Siaga - ${toPrayerLabel(nextPrayerInfo.key)} ${nextPrayerInfo.time} (${formatDuration(nextPrayerInfo.inMinutes)} lagi)`
                      : 'Siaga'}
              </strong>
            </div>
            <div>
              <span>Jeda sholat</span>
              <strong>
                {prayerState.active
                  ? `Aktif - ${toPrayerLabel(prayerState.prayerName)} sampai ${minutesToTime(prayerState.end)}`
                  : 'Tidak sedang jeda'}
              </strong>
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

        <div className="panel">
          <div className="panel-header">
            <h2>Adzan</h2>
            {adzanPlaying && (
              <button className="danger-button" onClick={stopAdzan} style={{ padding: '8px 16px', fontSize: '14px', whiteSpace: 'nowrap' }}>
                ■ Stop Adzan
              </button>
            )}
          </div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={adzanSettings.enabled}
              onChange={(event) => handleAdzanSettingChange({ enabled: event.target.checked })}
            />
            <span>Putar adzan otomatis saat masuk waktu sholat</span>
          </label>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '10px' }}>
            {Object.keys(DEFAULT_ADZAN_SETTINGS.prayers).map((key) => (
              <label className="toggle-row" key={key} style={{ opacity: adzanSettings.enabled ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  disabled={!adzanSettings.enabled}
                  checked={Boolean(adzanSettings.prayers[key])}
                  onChange={(event) => handleAdzanPrayerToggle(key, event.target.checked)}
                />
                <span>
                  {toPrayerLabel(key)}
                  {adzanPlayedToday.includes(key) ? ' ✓' : ''}
                </span>
              </label>
            ))}
          </div>

          <label className="field" style={{ marginTop: '10px' }}>
            <span>Volume Adzan: {Math.round(adzanSettings.volume * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={adzanSettings.volume}
              onChange={(event) => handleAdzanSettingChange({ volume: Number(event.target.value) })}
            />
          </label>

          <div className="hero-actions" style={{ marginTop: '10px' }}>
            <button
              className="secondary-button"
              disabled={Boolean(adzanPlaying)}
              onClick={() => playAdzan('dzuhur', { isTest: true, type: 'normal' })}
              style={{ padding: '8px 14px', fontSize: '13px' }}
            >
              ▶ Tes Adzan
            </button>
            <button
              className="secondary-button"
              disabled={Boolean(adzanPlaying)}
              onClick={() => playAdzan('subuh', { isTest: true, type: 'subuh' })}
              style={{ padding: '8px 14px', fontSize: '13px' }}
            >
              ▶ Tes Adzan Subuh
            </button>
          </div>

          {ADZAN_TYPES.map((type) => {
            const savedUrl = String(adzanSettings.urls?.[type] || '').trim();
            const draftUrl = adzanUrlDrafts[type] || '';
            const isDirty = draftUrl.trim() !== savedUrl;
            const status = savedUrl ? adzanFileStatus[type] : 'empty';

            return (
              <div key={type} className="field" style={{ marginTop: '10px' }}>
                <span>
                  {type === 'subuh' ? 'URL adzan Subuh' : 'URL adzan biasa (Dzuhur, Ashar, Maghrib, Isya)'}{' '}
                  <strong
                    style={{
                      color:
                        status === 'missing' ? 'var(--danger)' : status === 'ready' ? 'var(--success)' : status === 'empty' ? 'var(--amber)' : 'var(--muted)',
                    }}
                  >
                    ({status === 'ready' ? '✓ siap' : status === 'missing' ? '✗ gagal dimuat' : status === 'empty' ? 'belum diisi' : 'memuat...'})
                  </strong>
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="url"
                    placeholder="https://contoh.com/adzan.mp3"
                    value={draftUrl}
                    onChange={(event) => setAdzanUrlDrafts((prev) => ({ ...prev, [type]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleSaveAdzanUrl(type);
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    className="secondary-button"
                    disabled={!isDirty}
                    onClick={() => handleSaveAdzanUrl(type)}
                    style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}
                  >
                    Simpan
                  </button>
                </div>
              </div>
            );
          })}
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
                    <div className="announcement-content">
                      <h3>{item.title}</h3>
                      <div className="announcement-meta">
                        <span className="announcement-time">
                          {item.intervalMinutes > 0 ? `${item.time}–${item.endTime}` : item.time}
                        </span>
                        {item.intervalMinutes > 0 && <span className="tag tag-repeat">tiap {item.intervalMinutes} mnt</span>}
                        <span className="tag tag-repeat">{item.repeatCount || 1}x putar</span>
                      </div>
                      <div className="card-tags">
                        {queued && <span className="tag tag-queue">Antri</span>}
                        {active && <span className="tag tag-live">Putar</span>}
                        {!item.enabled && <span className="tag tag-off">Off</span>}
                      </div>
                    </div>

                    <div className="card-actions" style={{ alignSelf: 'center', gap: '4px', margin: 0 }}>
                      {active || queued ? (
                        <button className="danger-button" onClick={() => handleStopAnnouncement(item)} style={{ padding: '6px 10px', fontSize: '12px' }}>
                          Stop
                        </button>
                      ) : (
                        <button className="secondary-button" onClick={() => handlePlayManual(item)} style={{ padding: '6px 10px', fontSize: '12px' }}>
                          Putar
                        </button>
                      )}
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
                <span>{newAnnouncementPeriodic ? 'Jam mulai' : 'Jam putar'}</span>
                <input
                  type="time"
                  value={newAnnouncementTime}
                  onChange={(event) => setNewAnnouncementTime(event.target.value)}
                />
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={newAnnouncementPeriodic}
                  onChange={(event) => setNewAnnouncementPeriodic(event.target.checked)}
                />
                <span>Ulangi berkala sampai jam tertentu</span>
              </label>

              {newAnnouncementPeriodic && (
                <>
                  <label className="field">
                    <span>Ulangi setiap (menit)</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={newAnnouncementInterval}
                      onChange={(event) => setNewAnnouncementInterval(event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Jam selesai</span>
                    <input
                      type="time"
                      value={newAnnouncementEndTime}
                      onChange={(event) => setNewAnnouncementEndTime(event.target.value)}
                    />
                    <small>
                      Diputar pada jam mulai, lalu tiap {newAnnouncementInterval || '…'} menit sampai jam selesai (termasuk jam selesai jika pas).
                      Jadwal yang jatuh saat waktu sholat/adzan dilewati.
                    </small>
                  </label>
                </>
              )}

              <label className="field">
                <span>Jumlah putar</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={newAnnouncementRepeatCount}
                  onChange={(event) => setNewAnnouncementRepeatCount(event.target.value)}
                />
                <small>Isi berapa kali announcement diputar setiap kali jadwalnya masuk.</small>
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
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '12px' }}>
                    Sumber: API MyQuran (jadwal resmi Kemenag RI)
                  </div>

                  <div className="field" style={{ marginTop: '10px' }}>
                    <span>Kota / Kabupaten terpilih</span>
                    <strong>
                      {hasValidCity(prayerConfig)
                        ? `${prayerConfig.cityName || 'Tanpa nama'} (ID ${prayerConfig.cityId})`
                        : 'Belum dipilih'}
                    </strong>
                  </div>

                  <form onSubmit={searchPrayerCity}>
                    <label className="field" style={{ marginTop: '10px' }}>
                      <span>Cari kota / kabupaten</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input
                          type="text"
                          placeholder="contoh: padang, jakarta, bandung"
                          value={citySearchQuery}
                          onChange={(event) => setCitySearchQuery(event.target.value)}
                          style={{ flex: 1 }}
                        />
                        <button className="secondary-button" type="submit" disabled={citySearchLoading}>
                          {citySearchLoading ? 'Mencari...' : 'Cari'}
                        </button>
                      </div>
                    </label>
                  </form>

                  {citySearchResults.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                      {citySearchResults.map((city) => (
                        <button
                          key={city.id}
                          type="button"
                          className={String(city.id) === String(prayerConfig.cityId) ? 'primary-button' : 'secondary-button'}
                          onClick={() => handleSelectPrayerCity(city)}
                          disabled={prayerLoading}
                          style={{ textAlign: 'left' }}
                        >
                          {toTitleCase(city.lokasi)}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="card-actions" style={{ marginTop: '10px' }}>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => fetchPrayerTimesFromApi({ quiet: false })}
                      disabled={prayerLoading || !hasValidCity(prayerConfig)}
                    >
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
