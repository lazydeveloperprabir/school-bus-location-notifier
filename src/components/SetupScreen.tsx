import { useEffect, useMemo, useState } from 'react'
import { MapView } from './MapView'
import { loadLastGpsLink, emptyRouteSettings } from '../lib/storage'
import { parseGpsInput } from '../lib/gpsLink'
import { nearestRouteIndex, routeToLatLngTuples, snapToRoute } from '../lib/route'
import {
  createAlarmPointId,
  DEFAULT_ANNOUNCE_INTERVAL_SEC,
  DEFAULT_APPROACH_DISTANCE_M,
  DEFAULT_ARRIVAL_DISTANCE_M,
  formatAlertDistance,
  normalizeAlertSettings,
  type AlarmPoint,
  type AppSettings,
  type LatLng,
  type TripKind,
} from '../types'

type SetupScreenProps = {
  initial?: AppSettings | null
  /** Opened from tracking → Settings (edit params, then Home) */
  settingsMode?: boolean
  /** Open directly into alarm-point selection on the active route */
  placeAlarmsOnOpen?: boolean
  /** Status line about on-device saved data */
  storageNote?: string
  onStart: (
    settings: AppSettings,
    mode: 'live' | 'demo',
    options?: { recordRoute?: boolean },
  ) => void | Promise<void>
  /** Save current parameters and return to tracking */
  onGoHome?: (settings: AppSettings) => void
}

const DEFAULT_CENTER: LatLng = { lat: 12.9716, lng: 77.5946 }

export function SetupScreen({
  initial,
  settingsMode = false,
  placeAlarmsOnOpen = false,
  storageNote,
  onStart,
  onGoHome,
}: SetupScreenProps) {
  const lastLink = loadLastGpsLink()
  const defaults = normalizeAlertSettings(initial)
  const routes = emptyRouteSettings()
  const [home, setHome] = useState<LatLng>(
    initial?.home ?? DEFAULT_CENTER,
  )
  const [homeSet, setHomeSet] = useState(Boolean(initial?.home))
  const [gpsLink, setGpsLink] = useState(
    initial?.gpsLink || lastLink || '',
  )
  const [approachDistanceM, setApproachDistanceM] = useState(
    String(defaults.approachDistanceM),
  )
  const [arrivalDistanceM, setArrivalDistanceM] = useState(
    String(defaults.arrivalDistanceM),
  )
  const [announceIntervalSec, setAnnounceIntervalSec] = useState(
    String(defaults.announceIntervalSec),
  )
  const [activeTrip, setActiveTrip] = useState<TripKind>(
    initial?.activeTrip ?? 'pickup',
  )
  const [pickupRoute, setPickupRoute] = useState<LatLng[]>(
    initial?.pickupRoute ?? routes.pickupRoute,
  )
  const [dropRoute, setDropRoute] = useState<LatLng[]>(
    initial?.dropRoute ?? routes.dropRoute,
  )
  const [alarmPoints, setAlarmPoints] = useState<AlarmPoint[]>(
    initial?.alarmPoints ?? routes.alarmPoints,
  )
  const [placingAlarms, setPlacingAlarms] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const activeRoute =
    activeTrip === 'drop' ? dropRoute : pickupRoute
  const tripAlarms = useMemo(
    () =>
      alarmPoints
        .filter((p) => p.trip === activeTrip)
        .sort((a, b) => a.routeIndex - b.routeIndex),
    [alarmPoints, activeTrip],
  )
  const homeIndex = useMemo(
    () => nearestRouteIndex(activeRoute, home),
    [activeRoute, home],
  )
  const savedRoutePath = useMemo(
    () => routeToLatLngTuples(activeRoute),
    [activeRoute],
  )

  useEffect(() => {
    if (initial?.home) return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!homeSet) {
          setHome({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
        }
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!placeAlarmsOnOpen) return
    const route =
      (initial?.activeTrip === 'drop'
        ? initial?.dropRoute
        : initial?.pickupRoute) ?? []
    if (route.length < 2) {
      setHint(
        'Record a pickup or drop route first, then select alarm points on it.',
      )
      return
    }
    setPlacingAlarms(true)
    setHint(
      `Tap the ${(initial?.activeTrip ?? activeTrip) === 'drop' ? 'drop' : 'pickup'} route to select alarm points. They will alert you next time.`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeAlarmsOnOpen])

  function useCurrentLocation() {
    setError(null)
    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this device.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHome({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
        setHomeSet(true)
        setLocating(false)
        setHint('Home set to your current location.')
      },
      () => {
        setLocating(false)
        setError(
          'Could not read your location. Allow location access or tap the map to set home.',
        )
      },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }

  function useLastLink() {
    const saved = loadLastGpsLink()
    if (!saved) {
      setError('No previous GPS link saved yet.')
      return
    }
    setGpsLink(saved)
    setHint('Loaded your last GPS link.')
    setError(null)
  }

  function buildSettings(): AppSettings | null {
    if (!homeSet) {
      setError('Set your home location first (use GPS or tap the map).')
      return null
    }

    if (!Number.isFinite(Number(approachDistanceM)) || Number(approachDistanceM) <= 0) {
      setError('Enter a valid approach distance in meters.')
      return null
    }
    if (
      !Number.isFinite(Number(announceIntervalSec)) ||
      Number(announceIntervalSec) <= 0
    ) {
      setError('Enter a valid announcement interval in seconds.')
      return null
    }

    const alerts = normalizeAlertSettings({
      approachDistanceM: Number(approachDistanceM),
      arrivalDistanceM: Number(arrivalDistanceM),
      announceIntervalSec: Number(announceIntervalSec),
    })

    return {
      home,
      gpsLink: gpsLink.trim(),
      lastUpdated: Date.now(),
      activeTrip,
      pickupRoute,
      dropRoute,
      alarmPoints,
      ...alerts,
    }
  }

  async function startLive(recordRoute = false) {
    setError(null)
    const settings = buildSettings()
    if (!settings) return
    if (!settings.gpsLink) {
      setError(
        'Paste a GPS / Maps link (or lat,lng). Or start Demo mode to try alerts.',
      )
      return
    }
    const parsed = parseGpsInput(settings.gpsLink)
    if (!parsed.ok && !/^https?:\/\//i.test(settings.gpsLink)) {
      setError(parsed.error)
      return
    }
    await onStart(settings, 'live', { recordRoute })
  }

  async function startDemo() {
    setError(null)
    const settings = buildSettings()
    if (!settings) return
    await onStart(
      {
        ...settings,
        gpsLink: settings.gpsLink || 'demo://approaching-bus',
      },
      'demo',
    )
  }

  function resetAlertDefaults() {
    setApproachDistanceM(String(DEFAULT_APPROACH_DISTANCE_M))
    setArrivalDistanceM(String(DEFAULT_ARRIVAL_DISTANCE_M))
    setAnnounceIntervalSec(String(DEFAULT_ANNOUNCE_INTERVAL_SEC))
    setHint(
      `Defaults restored: ${formatAlertDistance(DEFAULT_APPROACH_DISTANCE_M)}, announce every ${DEFAULT_ANNOUNCE_INTERVAL_SEC}s.`,
    )
  }

  function handleMapPick(pos: LatLng) {
    if (placingAlarms) {
      if (activeRoute.length < 2) {
        setError('Record a route first, then tap along it to place alarms.')
        return
      }
      const snap = snapToRoute(activeRoute, pos)
      if (!snap) {
        setError('Tap closer to the orange/blue route line to place an alarm.')
        return
      }
      const point: AlarmPoint = {
        id: createAlarmPointId(),
        trip: activeTrip,
        lat: snap.point.lat,
        lng: snap.point.lng,
        routeIndex: snap.routeIndex,
        label: `Stop ${tripAlarms.length + 1}`,
      }
      setAlarmPoints((prev) => [...prev, point])
      setHint(`Alarm point selected on ${activeTrip} route.`)
      setError(null)
      return
    }

    setHome(pos)
    setHomeSet(true)
    setHint('Home pin updated.')
    setError(null)
  }

  function clearActiveRoute() {
    if (activeTrip === 'drop') setDropRoute([])
    else setPickupRoute([])
    setAlarmPoints((prev) => prev.filter((p) => p.trip !== activeTrip))
    setHint(`${activeTrip === 'drop' ? 'Drop' : 'Pickup'} route cleared.`)
  }

  function removeAlarm(id: string) {
    setAlarmPoints((prev) => prev.filter((p) => p.id !== id))
  }

  function goHome() {
    setError(null)
    const settings = buildSettings()
    if (!settings) return
    if (!settings.gpsLink.trim()) {
      setError('A GPS link is required before returning to tracking.')
      return
    }
    onGoHome?.(settings)
  }

  return (
    <div className="screen setup-screen">
      <header className="setup-hero">
        <div className="setup-hero-row">
          <p className="brand">School Bus Notifier</p>
          {settingsMode && onGoHome ? (
            <button
              type="button"
              className="btn btn-home"
              onClick={goHome}
            >
              Home
            </button>
          ) : null}
        </div>
        <h1>{settingsMode ? 'Settings' : 'Set home & track the bus'}</h1>
        <p className="lede">
          {settingsMode
            ? 'Change home, GPS link, routes, alarm points, and alert distances. Tap Home to return to tracking.'
            : 'Save your stop, remember the pickup/drop route, and place alarm points along that path.'}
        </p>
        <p className="storage-note">
          {storageNote ??
            'Home, GPS link, pickup/drop routes, and alarm points are stored on this phone.'}
        </p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>1. Home location</h2>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={useCurrentLocation}
            disabled={locating}
          >
            {locating ? 'Locating…' : 'Use my GPS'}
          </button>
        </div>
        <p className="panel-hint">
          {placingAlarms
            ? `Select mode: tap the ${activeTrip} route line to choose alarm points.`
            : 'Tap the map to drop your home pin'}
          {homeSet
            ? ` · ${home.lat.toFixed(5)}, ${home.lng.toFixed(5)}`
            : ''}
        </p>
        <MapView
          home={home}
          pickable
          onPick={handleMapPick}
          savedRoutePath={savedRoutePath.length > 1 ? savedRoutePath : null}
          alarmPoints={tripAlarms}
          homeIndex={homeIndex}
          showZones={!placingAlarms}
          approachDistanceM={Number(approachDistanceM) || DEFAULT_APPROACH_DISTANCE_M}
          arrivalDistanceM={Number(arrivalDistanceM) || DEFAULT_ARRIVAL_DISTANCE_M}
          className="map-compact"
        />
        <div className="route-legend">
          <span className="legend-before">Before home (inbound)</span>
          <span className="legend-after">After home (outbound)</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>2. Bus GPS link</h2>
          {lastLink ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={useLastLink}
            >
              Use last link
            </button>
          ) : null}
        </div>
        <p className="panel-hint">
          Paste the same tracker or Maps link you open in the browser.
        </p>
        <textarea
          className="gps-input"
          rows={3}
          placeholder="https://gps360.cpark.in/locator/… or lat,lng"
          value={gpsLink}
          onChange={(e) => setGpsLink(e.target.value)}
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>3. Pickup / drop route</h2>
        </div>
        <p className="panel-hint">
          Choose Pickup or Drop, then start recording. Recording stops
          automatically when the bus arrives. After that, select alarm points
          on the saved route for next time.
        </p>
        <div className="trip-toggle">
          <button
            type="button"
            className={`chip ${activeTrip === 'pickup' ? 'chip-active' : ''}`}
            onClick={() => {
              setActiveTrip('pickup')
              setPlacingAlarms(false)
            }}
          >
            Pickup ({pickupRoute.length} pts)
          </button>
          <button
            type="button"
            className={`chip ${activeTrip === 'drop' ? 'chip-active' : ''}`}
            onClick={() => {
              setActiveTrip('drop')
              setPlacingAlarms(false)
            }}
          >
            Drop ({dropRoute.length} pts)
          </button>
        </div>
        <div className="actions-row">
          <button
            type="button"
            className="btn btn-secondary-dark"
            onClick={() => void startLive(true)}
          >
            Record {activeTrip} route
          </button>
          <button
            type="button"
            className={`btn btn-ghost ${placingAlarms ? 'chip-active' : ''}`}
            onClick={() => setPlacingAlarms((v) => !v)}
            disabled={activeRoute.length < 2}
          >
            {placingAlarms ? 'Done selecting' : 'Select alarm points'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={clearActiveRoute}
            disabled={activeRoute.length === 0}
          >
            Clear route
          </button>
        </div>
        {activeRoute.length < 2 && (
          <p className="panel-hint">
            No {activeTrip} route yet. Record one ride — it auto-saves on
            arrival, then you can select points on that path.
          </p>
        )}
        {tripAlarms.length > 0 && (
          <ul className="alarm-list">
            {tripAlarms.map((point, index) => (
              <li key={point.id}>
                <span>
                  #{index + 1} · {point.label ?? 'Alarm'} · route #
                  {point.routeIndex}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => removeAlarm(point.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>4. Alerts</h2>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={resetAlertDefaults}
          >
            Reset defaults
          </button>
        </div>
        <p className="panel-hint">
          Home approach distance still applies. Route alarm points trigger once
          each when the bus reaches them. Continuous voice only inside the
          approach distance.
        </p>
        <div className="alert-fields">
          <label className="field">
            <span>Approach distance (m)</span>
            <input
              type="number"
              min={50}
              max={20000}
              step={50}
              value={approachDistanceM}
              onChange={(e) => setApproachDistanceM(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Announce every (sec)</span>
            <input
              type="number"
              min={1}
              max={120}
              step={1}
              value={announceIntervalSec}
              onChange={(e) => setAnnounceIntervalSec(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Arrived within (m)</span>
            <input
              type="number"
              min={20}
              max={500}
              step={10}
              value={arrivalDistanceM}
              onChange={(e) => setArrivalDistanceM(e.target.value)}
            />
          </label>
        </div>
      </section>

      {(error || hint) && (
        <div className={`banner ${error ? 'banner-error' : 'banner-info'}`}>
          {error ?? hint}
        </div>
      )}

      <div className="actions">
        {settingsMode && onGoHome ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={goHome}
            >
              Save &amp; go Home
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void startLive(false)}
            >
              Restart tracking
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void startDemo()}
            >
              Try demo
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void startLive(false)}
            >
              Start tracking
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void startDemo()}
            >
              Try demo (simulated bus)
            </button>
          </>
        )}
      </div>
    </div>
  )
}
