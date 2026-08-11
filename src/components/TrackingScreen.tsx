import { useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type MapViewMode } from './MapView'
import {
  playApproachingUpdate,
  playArrivedAlarm,
  playEnRouteStatusOnce,
  playWaypointAlarm,
  startTrackingAudio,
  stopTrackingAudio,
  subscribeMute,
  toggleMute,
  isTrackingAudioActive,
} from '../lib/alarms'
import { distanceKm, formatDistance, moveToward, offsetByKm } from '../lib/geo'
import { fetchBusLocation } from '../lib/gpsLink'
import { fetchRoadRoute } from '../lib/routing'
import {
  appendRoutePoint,
  nearestRouteIndex,
  routeToLatLngTuples,
  simplifyRoute,
} from '../lib/route'
import { saveSettings, saveSettingsAsync } from '../lib/storage'
import type {
  AlertKind,
  AppSettings,
  LatLng,
  TrackingStats,
  TripKind,
} from '../types'
import {
  DEFAULT_WAYPOINT_RADIUS_M,
  formatAlertDistance,
  getActiveRoute,
  getAlarmPointName,
  metersToKm,
  POLL_INTERVAL_MS,
} from '../types'

type TrackingScreenProps = {
  settings: AppSettings
  mode: 'live' | 'demo'
  recordRoute?: boolean
  onChangeSettings: (options?: { placeAlarms?: boolean }) => void
  onSettingsUpdate: (settings: AppSettings) => void
  onRecordComplete?: () => void
}

function evaluateAlert(
  roadDistanceKm: number,
  straightDistanceKm: number,
  approachDistanceM: number,
  arrivalDistanceM: number,
): AlertKind {
  const arrivalKm = metersToKm(arrivalDistanceM)
  if (roadDistanceKm <= arrivalKm || straightDistanceKm <= arrivalKm) {
    return 'arrived'
  }
  if (roadDistanceKm <= metersToKm(approachDistanceM)) {
    return 'approaching'
  }
  return null
}

export function TrackingScreen({
  settings,
  mode,
  recordRoute = false,
  onChangeSettings,
  onSettingsUpdate,
  onRecordComplete,
}: TrackingScreenProps) {
  const [stats, setStats] = useState<TrackingStats>({
    bus: null,
    distanceKm: null,
    etaMinutes: null,
    speedKmh: null,
    alert: null,
    status: recordRoute
      ? `Recording ${settings.activeTrip} route — stops automatically on arrival…`
      : mode === 'demo'
        ? 'Starting demo…'
        : 'Connecting to GPS…',
    source: mode === 'demo' ? 'demo' : 'link',
    routePath: null,
    distanceSource: null,
    activeWaypointLabel: null,
  })
  const [recording, setRecording] = useState(recordRoute)
  const [recordingJustFinished, setRecordingJustFinished] = useState(false)
  const [trailVersion, setTrailVersion] = useState(0)
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>('follow')
  const [muted, setMutedUi] = useState(false)
  const [alertsArmed, setAlertsArmed] = useState(isTrackingAudioActive())
  const demoBusRef = useRef<LatLng | null>(null)
  const lastBusRef = useRef<LatLng | null>(null)
  const lastTimeRef = useRef<number>(Date.now())
  const alertRef = useRef<AlertKind>(null)
  const approachDistanceRef = useRef<number | null>(null)
  const trailRef = useRef<LatLng[]>(
    recording ? [...getActiveRoute(settings)] : [],
  )
  const recordingRef = useRef(recording)
  recordingRef.current = recording
  const recordingSavedRef = useRef(false)
  const triggeredWaypoints = useRef<Set<string>>(new Set())
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const onRecordCompleteRef = useRef(onRecordComplete)
  onRecordCompleteRef.current = onRecordComplete
  const onSettingsUpdateRef = useRef(onSettingsUpdate)
  onSettingsUpdateRef.current = onSettingsUpdate

  const activeRoute = getActiveRoute(settings)
  const tripAlarms = useMemo(
    () =>
      settings.alarmPoints
        .filter((p) => p.trip === settings.activeTrip)
        .sort((a, b) => a.routeIndex - b.routeIndex),
    [settings.alarmPoints, settings.activeTrip],
  )
  const savedRoutePath = useMemo(() => {
    const route =
      recording && trailRef.current.length
        ? trailRef.current
        : activeRoute
    return routeToLatLngTuples(route)
    // trailVersion forces refresh while recording
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoute, recording, trailVersion])
  const homeIndex = nearestRouteIndex(
    recording && trailRef.current.length
      ? trailRef.current
      : activeRoute,
    settings.home,
  )

  useEffect(() => {
    alertRef.current = null
    approachDistanceRef.current = null
    triggeredWaypoints.current = new Set()
    void startTrackingAudio().then(() => {
      setAlertsArmed(true)
      setMutedUi(false)
    })
    const unsub = subscribeMute((next) => setMutedUi(next))
    return () => {
      unsub()
      stopTrackingAudio({ reason: 'user' })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    let announceTimer: number | undefined

    function stopApproachAnnouncements() {
      if (announceTimer) {
        window.clearInterval(announceTimer)
        announceTimer = undefined
      }
    }

    function startApproachAnnouncements() {
      if (announceTimer) return
      const intervalMs = Math.max(1, settings.announceIntervalSec) * 1000
      announceTimer = window.setInterval(() => {
        if (
          alertRef.current !== 'approaching' ||
          approachDistanceRef.current == null
        ) {
          return
        }
        playApproachingUpdate({
          remainingDistanceM: approachDistanceRef.current * 1000,
          announceIntervalSec: settings.announceIntervalSec,
        })
      }, intervalMs)
    }

    function finishRecordingOnArrival(trip: TripKind): {
      saved: boolean
      pointCount: number
    } {
      if (recordingSavedRef.current) {
        return { saved: false, pointCount: trailRef.current.length }
      }
      recordingSavedRef.current = true

      const simplified = simplifyRoute(trailRef.current)
      if (simplified.length < 2) {
        setRecording(false)
        onRecordCompleteRef.current?.()
        setStats((prev) => ({
          ...prev,
          status:
            'Recording stopped on arrival, but more movement is needed to save a route. Try recording again.',
        }))
        return { saved: false, pointCount: simplified.length }
      }

      const current = settingsRef.current
      const next: AppSettings = {
        ...current,
        lastUpdated: Date.now(),
        pickupRoute:
          trip === 'pickup' ? simplified : current.pickupRoute,
        dropRoute: trip === 'drop' ? simplified : current.dropRoute,
      }
      saveSettings(next)
      void saveSettingsAsync(next)
      onSettingsUpdateRef.current(next)
      setRecording(false)
      setRecordingJustFinished(true)
      trailRef.current = simplified
      setTrailVersion((v) => v + 1)
      onRecordCompleteRef.current?.()
      return { saved: true, pointCount: simplified.length }
    }

    async function tick() {
      if (cancelled) return

      if (mode === 'demo') {
        if (!demoBusRef.current) {
          const startKm = Math.max(
            metersToKm(settings.approachDistanceM) * 2.5,
            1.5,
          )
          demoBusRef.current = offsetByKm(
            settings.home,
            startKm * 0.7,
            startKm * 0.55,
          )
        }
        const remaining = distanceKm(demoBusRef.current, settings.home)
        const step = remaining < 0.15 ? 0.45 : remaining < 0.5 ? 0.2 : 0.1
        demoBusRef.current = moveToward(
          demoBusRef.current,
          settings.home,
          step,
        )
        await applyBusPosition(
          demoBusRef.current,
          'demo',
          recordingRef.current
            ? `Recording ${settings.activeTrip} route — auto-saves on arrival…`
            : 'Demo bus approaching home',
        )
      } else {
        const result = await fetchBusLocation(settings.gpsLink)
        if (cancelled) return
        if (result.ok) {
          await applyBusPosition(
            result.location,
            'link',
            recordingRef.current
              ? `Recording ${settings.activeTrip} route — auto-saves on arrival…`
              : (result.note ?? 'Live GPS update'),
          )
        } else {
          setStats((prev) => ({
            ...prev,
            status: result.error,
          }))
        }
      }

      if (cancelled) return
      timer = window.setTimeout(
        () => void tick(),
        mode === 'demo' ? 2000 : POLL_INTERVAL_MS,
      )
    }

    async function applyBusPosition(
      bus: LatLng,
      source: TrackingStats['source'],
      status: string,
    ) {
      const now = Date.now()
      let speed: number | null = null
      if (lastBusRef.current) {
        const dtHours = (now - lastTimeRef.current) / 3_600_000
        if (dtHours > 0) {
          speed = distanceKm(lastBusRef.current, bus) / dtHours
        }
      }
      lastBusRef.current = bus
      lastTimeRef.current = now

      if (recordingRef.current) {
        const next = appendRoutePoint(trailRef.current, bus)
        if (next !== trailRef.current) {
          trailRef.current = next
          setTrailVersion((v) => v + 1)
        }
      }

      const straight = distanceKm(bus, settings.home)
      const route = await fetchRoadRoute(bus, settings.home)
      if (cancelled) return

      // Waypoint alarms (once each) before continuous approach loop
      let waypointLabel: string | null = null
      const currentSettings = settingsRef.current
      const points = currentSettings.alarmPoints
        .filter((p) => p.trip === currentSettings.activeTrip)
        .sort((a, b) => a.routeIndex - b.routeIndex)

      for (let i = 0; i < points.length; i++) {
        const point = points[i]
        if (triggeredWaypoints.current.has(point.id)) continue
        const distM = distanceKm(bus, point) * 1000
        if (distM <= DEFAULT_WAYPOINT_RADIUS_M) {
          triggeredWaypoints.current.add(point.id)
          waypointLabel = getAlarmPointName(point, i)
          playWaypointAlarm({
            name: waypointLabel,
            remainingDistanceM: distM,
          })
          break
        }
      }

      const alert = evaluateAlert(
        route.distanceKm,
        straight,
        settings.approachDistanceM,
        settings.arrivalDistanceM,
      )

      const prevAlert = alertRef.current
      alertRef.current = alert

      if (alert === 'approaching') {
        approachDistanceRef.current = route.distanceKm
      } else {
        approachDistanceRef.current = null
      }

      const wasRecording = recordingRef.current
      let recordingResult: { saved: boolean; pointCount: number } | null =
        null
      if (alert === 'arrived' && wasRecording) {
        recordingResult = finishRecordingOnArrival(settings.activeTrip)
      }

      const routeNote =
        route.source === 'road'
          ? ' · road distance'
          : ' · straight-line fallback'
      const recordNote = recordingRef.current
        ? ` · ${trailRef.current.length} route points`
        : recordingResult?.saved
          ? ` · ${settings.activeTrip} route saved (${recordingResult.pointCount} pts)`
          : ''

      const completionStatus =
        recordingResult?.saved
          ? `Recording complete — ${settings.activeTrip} route saved (${recordingResult.pointCount} points). Available next time; select alarm points in Settings.`
          : `${status}${routeNote}${recordNote}`

      setStats({
        bus,
        distanceKm: route.distanceKm,
        etaMinutes: route.etaMinutes,
        speedKmh: speed,
        alert: waypointLabel ? 'waypoint' : alert,
        status: completionStatus,
        source,
        routePath: route.path,
        distanceSource: route.source,
        activeWaypointLabel: waypointLabel,
      })

      if (alert === 'arrived') {
        stopApproachAnnouncements()
        playArrivedAlarm(
          recordingResult?.saved
            ? { recordingTrip: settings.activeTrip }
            : undefined,
        )
        return
      }

      if (alert === 'approaching') {
        playApproachingUpdate({
          remainingDistanceM: route.distanceKm * 1000,
          announceIntervalSec: settings.announceIntervalSec,
          force: prevAlert !== 'approaching',
        })
        startApproachAnnouncements()
      } else {
        stopApproachAnnouncements()
        if (!waypointLabel) {
          playEnRouteStatusOnce({
            remainingDistanceM: route.distanceKm * 1000,
            approachDistanceM: settings.approachDistanceM,
          })
        }
      }
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      stopApproachAnnouncements()
    }
  }, [settings, mode])

  function selectTrip(trip: TripKind) {
    if (recording || trip === settings.activeTrip) return
    const next: AppSettings = {
      ...settingsRef.current,
      activeTrip: trip,
      lastUpdated: Date.now(),
    }
    saveSettings(next)
    void saveSettingsAsync(next)
    onSettingsUpdate(next)
    triggeredWaypoints.current = new Set()
    setRecordingJustFinished(false)
  }

  async function armAlerts() {
    await startTrackingAudio()
    setAlertsArmed(true)
    setMutedUi(false)
  }

  function handleMuteToggle() {
    const next = toggleMute()
    setMutedUi(next)
  }

  const alertClass =
    stats.alert === 'arrived'
      ? 'alert-arrived'
      : stats.alert === 'approaching' || stats.alert === 'waypoint'
        ? 'alert-approach'
        : ''

  const tripLabel = settings.activeTrip === 'drop' ? 'Drop' : 'Pickup'

  return (
    <div className={`screen tracking-screen ${alertClass}`}>
      <header className="track-bar">
        <div>
          <p className="brand-sm">School Bus Notifier</p>
          <h1>
            {stats.alert === 'arrived'
              ? recordingJustFinished
                ? 'Recording complete'
                : 'Bus has arrived'
              : stats.alert === 'approaching'
                ? 'Bus approaching'
                : stats.alert === 'waypoint'
                  ? stats.activeWaypointLabel ?? 'Alarm point'
                  : recording
                    ? `Recording ${settings.activeTrip}`
                    : 'Tracking bus'}
          </h1>
        </div>
        <div className="track-bar-actions">
          <button
            type="button"
            className={`btn btn-ghost btn-mute ${muted ? 'is-muted' : ''}`}
            onClick={handleMuteToggle}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute voice alerts' : 'Mute voice alerts'}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? 'Muted' : 'Sound'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onChangeSettings()}
          >
            Settings
          </button>
        </div>
      </header>

      {!alertsArmed && (
        <button
          type="button"
          className="banner banner-action"
          onClick={() => void armAlerts()}
        >
          Tap to enable voice alerts (needed for lock-screen notifications)
        </button>
      )}

      {muted && (
        <div className="banner banner-warn" role="status">
          Voice alerts are muted. Tap Sound to turn them back on.
        </div>
      )}

      {recording && (
        <div className="banner banner-info" role="status">
          Recording {tripLabel.toLowerCase()} route… Stops automatically when
          the bus arrives at home.
        </div>
      )}

      {recordingJustFinished && (
        <div className="banner banner-success" role="status">
          <p>
            Recording complete. Your {tripLabel.toLowerCase()} route is saved
            and available next time.
          </p>
          <button
            type="button"
            className="btn btn-primary banner-cta"
            onClick={() => onChangeSettings({ placeAlarms: true })}
          >
            Select alarm points on route
          </button>
        </div>
      )}

      {stats.alert === 'arrived' && !recordingJustFinished && (
        <div className="banner banner-success" role="status">
          The school bus has arrived at your location.
        </div>
      )}
      {stats.alert === 'approaching' && (
        <div className="banner banner-warn" role="status">
          Bus is within {formatAlertDistance(settings.approachDistanceM)} by
          road — announcing every {settings.announceIntervalSec}s.
        </div>
      )}
      {stats.alert === 'waypoint' && (
        <div className="banner banner-warn" role="status">
          Passed {stats.activeWaypointLabel ?? 'alarm point'} on the{' '}
          {settings.activeTrip} route.
        </div>
      )}
      {stats.alert === null && stats.bus && !recording && !recordingJustFinished && !muted && (
        <div className="banner banner-info" role="status">
          Tracking {settings.activeTrip}. Alerts continue if the screen locks;
          stop on arrival, Mute, or closing the app.
          {tripAlarms.length
            ? ` ${tripAlarms.length} route alarm point(s) armed.`
            : ''}
        </div>
      )}

      {!recording && (
        <div className="trip-toggle track-trip-toggle" role="group" aria-label="Trip">
          <button
            type="button"
            className={`chip ${settings.activeTrip === 'pickup' ? 'chip-active' : ''}`}
            onClick={() => selectTrip('pickup')}
          >
            Pickup
            {settings.pickupRoute.length
              ? ` (${settings.pickupRoute.length})`
              : ''}
          </button>
          <button
            type="button"
            className={`chip ${settings.activeTrip === 'drop' ? 'chip-active' : ''}`}
            onClick={() => selectTrip('drop')}
          >
            Drop
            {settings.dropRoute.length
              ? ` (${settings.dropRoute.length})`
              : ''}
          </button>
        </div>
      )}

      <div className="map-with-controls">
        <MapView
          home={settings.home}
          bus={stats.bus}
          routePath={stats.routePath}
          savedRoutePath={
            savedRoutePath.length > 1
              ? savedRoutePath
              : activeRoute.length > 1
                ? routeToLatLngTuples(activeRoute)
                : null
          }
          alarmPoints={tripAlarms}
          homeIndex={homeIndex}
          showZones
          approachDistanceM={settings.approachDistanceM}
          arrivalDistanceM={settings.arrivalDistanceM}
          viewMode={mapViewMode}
          className="map-tracking"
        />
        <div className="map-view-toggle" role="group" aria-label="Map view">
          <button
            type="button"
            className={`map-toggle-btn ${mapViewMode === 'follow' ? 'active' : ''}`}
            onClick={() => setMapViewMode('follow')}
          >
            Follow bus
          </button>
          <button
            type="button"
            className={`map-toggle-btn ${mapViewMode === 'complete' ? 'active' : ''}`}
            onClick={() => setMapViewMode('complete')}
          >
            Complete view
          </button>
        </div>
      </div>

      <section className="stats-panel">
        <div className="stat">
          <span className="stat-label">
            {stats.distanceSource === 'road' ? 'Road dist.' : 'Distance'}
          </span>
          <span className="stat-value">
            {stats.distanceKm != null
              ? formatDistance(stats.distanceKm)
              : '—'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Trip</span>
          <span className="stat-value">{tripLabel}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Mode</span>
          <span className="stat-value">
            {recording ? 'Record' : stats.source === 'demo' ? 'Demo' : 'Live'}
          </span>
        </div>
      </section>

      <p
        className={`status-line ${stats.bus ? '' : 'status-line-error'}`.trim()}
      >
        {stats.status}
      </p>
    </div>
  )
}
