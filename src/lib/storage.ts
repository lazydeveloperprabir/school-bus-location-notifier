import {
  normalizeAlarmPoints,
  normalizeAlertSettings,
  normalizeRoute,
  normalizeTrip,
  type AppSettings,
  type LatLng,
} from '../types'

const SETTINGS_KEY = 'sbln-settings'
const LAST_GPS_LINK_KEY = 'sbln-last-gps-link'
const DB_NAME = 'school-bus-notifier'
const DB_VERSION = 1
const STORE = 'kv'

type StoredBundle = {
  settings: AppSettings
  lastGpsLink: string
  savedAt: number
}

function parseSettings(raw: unknown): AppSettings | null {
  try {
    const parsed =
      typeof raw === 'string'
        ? (JSON.parse(raw) as Partial<AppSettings>)
        : (raw as Partial<AppSettings>)
    if (
      typeof parsed?.home?.lat !== 'number' ||
      typeof parsed?.home?.lng !== 'number' ||
      typeof parsed?.gpsLink !== 'string'
    ) {
      return null
    }

    return {
      home: parsed.home,
      homeLabel: parsed.homeLabel,
      gpsLink: parsed.gpsLink,
      lastUpdated: parsed.lastUpdated,
      activeTrip: normalizeTrip(parsed.activeTrip),
      pickupRoute: normalizeRoute(parsed.pickupRoute),
      dropRoute: normalizeRoute(parsed.dropRoute),
      alarmPoints: normalizeAlarmPoints(parsed.alarmPoints),
      ...normalizeAlertSettings(parsed),
    }
  } catch {
    return null
  }
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    activeTrip: normalizeTrip(settings.activeTrip),
    pickupRoute: normalizeRoute(settings.pickupRoute),
    dropRoute: normalizeRoute(settings.dropRoute),
    alarmPoints: normalizeAlarmPoints(settings.alarmPoints),
    lastUpdated: settings.lastUpdated ?? Date.now(),
    ...normalizeAlertSettings(settings),
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open IndexedDB'))
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const req = store.get(key)
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // ignore
  }
}

function writeLocalBackup(settings: AppSettings, lastGpsLink: string): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    if (lastGpsLink.trim()) {
      localStorage.setItem(LAST_GPS_LINK_KEY, lastGpsLink.trim())
    }
  } catch {
    // Quota or private mode — IndexedDB may still succeed
  }
}

function readLocalBackup(): AppSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return null
    return parseSettings(raw)
  } catch {
    return null
  }
}

/** Ask the browser/OS to keep this app's data on the phone when possible */
export async function requestDevicePersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist()
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * Synchronous read from local backup (fast first paint).
 * Prefer `loadSettingsAsync` after boot for full IndexedDB data.
 */
export function loadSettings(): AppSettings | null {
  return readLocalBackup()
}

/** Load settings from phone storage (IndexedDB, with localStorage fallback) */
export async function loadSettingsAsync(): Promise<AppSettings | null> {
  const fromIdb = await idbGet<StoredBundle>('app')
  if (fromIdb?.settings) {
    const settings = parseSettings(fromIdb.settings)
    if (settings) {
      writeLocalBackup(settings, fromIdb.lastGpsLink || settings.gpsLink)
      return settings
    }
  }

  // Migrate older localStorage-only installs into IndexedDB
  const legacy = readLocalBackup()
  if (legacy) {
    await saveSettingsAsync(legacy)
    return legacy
  }
  return null
}

/** Persist all routes, alarms, home, and alert settings on this device */
export function saveSettings(settings: AppSettings): void {
  const normalized = normalizeSettings(settings)
  const lastGpsLink = normalized.gpsLink.trim() || loadLastGpsLink()
  writeLocalBackup(normalized, lastGpsLink)
  void saveSettingsAsync(normalized)
}

export async function saveSettingsAsync(settings: AppSettings): Promise<void> {
  const normalized = normalizeSettings(settings)
  const lastGpsLink = normalized.gpsLink.trim() || loadLastGpsLink()
  const bundle: StoredBundle = {
    settings: normalized,
    lastGpsLink,
    savedAt: Date.now(),
  }
  writeLocalBackup(normalized, lastGpsLink)
  try {
    await idbSet('app', bundle)
  } catch {
    // Still kept in localStorage backup when possible
  }
  void requestDevicePersistence()
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY)
    localStorage.removeItem(LAST_GPS_LINK_KEY)
  } catch {
    // ignore
  }
  void idbDelete('app')
}

export async function clearSettingsAsync(): Promise<void> {
  clearSettings()
  await idbDelete('app')
}

export function loadLastGpsLink(): string {
  try {
    return localStorage.getItem(LAST_GPS_LINK_KEY) ?? ''
  } catch {
    return ''
  }
}

export function emptyRouteSettings(): Pick<
  AppSettings,
  'activeTrip' | 'pickupRoute' | 'dropRoute' | 'alarmPoints'
> {
  return {
    activeTrip: 'pickup',
    pickupRoute: [],
    dropRoute: [],
    alarmPoints: [],
  }
}

export function saveHomeOnly(home: LatLng, homeLabel?: string): void {
  const existing = loadSettings()
  saveSettings({
    home,
    homeLabel,
    gpsLink: existing?.gpsLink ?? loadLastGpsLink(),
    lastUpdated: Date.now(),
    ...normalizeAlertSettings(existing),
    activeTrip: existing?.activeTrip ?? 'pickup',
    pickupRoute: existing?.pickupRoute ?? [],
    dropRoute: existing?.dropRoute ?? [],
    alarmPoints: existing?.alarmPoints ?? [],
  })
}

export function describeStoredData(settings: AppSettings | null): string {
  if (!settings) return 'Nothing saved on this phone yet.'
  const pickup = settings.pickupRoute.length
  const drop = settings.dropRoute.length
  const alarms = settings.alarmPoints.length
  return `Saved on this phone · pickup ${pickup} pts · drop ${drop} pts · ${alarms} alarm(s)`
}
