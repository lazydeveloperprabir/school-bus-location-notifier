import { useEffect, useState } from 'react'
import { SetupScreen } from './components/SetupScreen'
import { TrackingScreen } from './components/TrackingScreen'
import { unlockAudio } from './lib/alarms'
import {
  clearSettingsAsync,
  describeStoredData,
  loadSettings,
  loadSettingsAsync,
  requestDevicePersistence,
  saveSettings,
  saveSettingsAsync,
} from './lib/storage'
import type { AppSettings } from './types'

type View = 'setup' | 'tracking'

export default function App() {
  const [booting, setBooting] = useState(true)
  const [view, setView] = useState<View>('setup')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [mode, setMode] = useState<'live' | 'demo'>('live')
  const [recordRoute, setRecordRoute] = useState(false)
  const [settingsMode, setSettingsMode] = useState(false)
  const [placeAlarmsOnOpen, setPlaceAlarmsOnOpen] = useState(false)
  const [storageNote, setStorageNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Instant paint from local backup, then hydrate full phone DB
      const quick = loadSettings()
      if (!cancelled && quick) {
        setSettings(quick)
        setView('tracking')
        setStorageNote(describeStoredData(quick))
      }

      await requestDevicePersistence()
      const saved = await loadSettingsAsync()
      if (cancelled) return

      if (saved) {
        setSettings(saved)
        setStorageNote(describeStoredData(saved))
        setView((current) => (current === 'setup' ? 'tracking' : current))
      } else if (!quick) {
        setSettings(null)
        setStorageNote('Nothing saved on this phone yet.')
      }
      setBooting(false)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function persist(next: AppSettings) {
    setSettings(next)
    setStorageNote(describeStoredData(next))
    saveSettings(next)
    await saveSettingsAsync(next)
  }

  async function handleStart(
    next: AppSettings,
    nextMode: 'live' | 'demo',
    options?: { recordRoute?: boolean },
  ) {
    await unlockAudio()
    await persist(next)
    setMode(nextMode)
    setRecordRoute(Boolean(options?.recordRoute))
    setSettingsMode(false)
    setPlaceAlarmsOnOpen(false)
    setView('tracking')
  }

  function handleOpenSettings(options?: { placeAlarms?: boolean }) {
    setRecordRoute(false)
    setPlaceAlarmsOnOpen(Boolean(options?.placeAlarms))
    setSettingsMode(true)
    setView('setup')
  }

  async function handleGoHome(next: AppSettings) {
    await persist(next)
    setSettingsMode(false)
    setRecordRoute(false)
    setPlaceAlarmsOnOpen(false)
    setView('tracking')
  }

  async function handleSettingsUpdate(next: AppSettings) {
    await persist(next)
  }

  function handleRecordComplete() {
    setRecordRoute(false)
  }

  async function handleReset() {
    await clearSettingsAsync()
    setSettings(null)
    setRecordRoute(false)
    setSettingsMode(false)
    setPlaceAlarmsOnOpen(false)
    setStorageNote('Nothing saved on this phone yet.')
    setView('setup')
  }

  if (booting && !settings) {
    return (
      <div className="app">
        <div className="screen setup-screen">
          <header className="setup-hero">
            <p className="brand">School Bus Notifier</p>
            <h1>Loading phone data…</h1>
            <p className="lede">
              Reading saved routes and settings from this device.
            </p>
          </header>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {view === 'setup' ? (
        <SetupScreen
          initial={settings}
          settingsMode={settingsMode}
          placeAlarmsOnOpen={placeAlarmsOnOpen}
          storageNote={storageNote}
          onStart={handleStart}
          onGoHome={settingsMode ? handleGoHome : undefined}
        />
      ) : settings ? (
        <TrackingScreen
          settings={settings}
          mode={mode}
          recordRoute={recordRoute}
          onChangeSettings={handleOpenSettings}
          onSettingsUpdate={handleSettingsUpdate}
          onRecordComplete={handleRecordComplete}
        />
      ) : (
        <SetupScreen
          initial={null}
          storageNote={storageNote}
          onStart={handleStart}
        />
      )}
      {view === 'setup' && settings && !settingsMode && (
        <button type="button" className="reset-link" onClick={() => void handleReset()}>
          Clear phone data
        </button>
      )}
    </div>
  )
}
