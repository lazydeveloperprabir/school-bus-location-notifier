import { useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type MapViewMode } from './MapView'
import {
  playApproachingUpdate,
  playArrivedAlarm,
  playEnRouteStatusOnce,
  playWaypointAlarm,
  resetAlarms,
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
import type { AlertKind, AppSettings, LatLng, TrackingStats } from '../types'
import {
  DEFAULT_WAYPOINT_RADIUS_M,
  formatAlertDistance,
  getActiveRoute,
  metersToKm,
  POLL_INTERVAL_MS,
} from '../types'

type TrackingScreenProps = {
  settings: AppSettings
  mode: 'live' | 'demo'
  recordRoute?: boolean
  onChangeSettings: () => void
  onSettingsUpdate: (settings: AppSettings) => void
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
}: TrackingScreenProps) {
  const [stats, setStats] = useState<TrackingStats>({
    bus: null,
    distanceKm: null,
    etaMinutes: null,
    speedKmh: null,
    alert: null,
    status: recordRoute
      ? `Recording ${settings.activeTrip} route…`
      : mode === 'demo'
        ? 'Starting demo…'
        : 'Connecting to GPS…',
    source: mode === 'demo' ? 'demo' : 'link',
    routePath: null,
    distanceSource: null,
    activeWaypointLabel: null,
  })
  const [recording, setRecording] = useState(recordRoute)
  const [trailVersion, setTrailVersion] = useState(0)
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>('follow')
  const demoBusRef = useRef<LatLng | null>(null)
  const lastBusRef = useRef<LatLng | null>(null)
  const lastTimeRef = useRef<number>(Date.now())
  const alertRef = useRef<AlertKind>(null)
  const approachDistanceRef = useRef<number | null>(null)
  const trailRef = useRef<LatLng[]>(
    recording ? [...getActiveRoute(settings)] : [],
  )
  const triggeredWaypoints = useRef<Set<string>>(new Set())
  const settingsRef = useRef(settings)
  settingsRef.current = settings

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
    resetAlarms()
    alertRef.current = null
    approachDistanceRef.current = null
    triggeredWaypoints.current = new Set()
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
          recording
            ? `Recording ${settings.activeTrip} route…`
            : 'Demo bus approaching home',
        )
      } else {
        const result = await fetchBusLocation(settings.gpsLink)
        if (cancelled) return
        if (result.ok) {
          await applyBusPosition(
            result.location,
            'link',
            recording
              ? `Recording ${settings.activeTrip} route…`
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

      if (recording) {
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
          waypointLabel = point.label ?? `Alarm ${i + 1}`
          playWaypointAlarm({
            label: String(i + 1),
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

      const routeNote =
        route.source === 'road'
          ? ' · road distance'
          : ' · straight-line fallback'
      const recordNote = recording
        ? ` · ${trailRef.current.length} route points`
        : ''

      setStats({
        bus,
        distanceKm: route.distanceKm,
        etaMinutes: route.etaMinutes,
        speedKmh: speed,
        alert: waypointLabel ? 'waypoint' : alert,
        status: `${status}${routeNote}${recordNote}`,
        source,
        routePath: route.path,
        distanceSource: route.source,
        activeWaypointLabel: waypointLabel,
      })

      if (alert === 'arrived') {
        stopApproachAnnouncements()
        playArrivedAlarm()
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
  }, [settings, mode, recording])

  function stopAndSaveRoute() {
    const simplified = simplifyRoute(trailRef.current)
    if (simplified.length < 2) {
      setStats((prev) => ({
        ...prev,
        status: 'Need more movement before saving the route.',
      }))
      return
    }
    const next: AppSettings = {
      ...settingsRef.current,
      lastUpdated: Date.now(),
      pickupRoute:
        settings.activeTrip === 'pickup'
          ? simplified
          : settings.pickupRoute,
      dropRoute:
        settings.activeTrip === 'drop' ? simplified : settings.dropRoute,
    }
    saveSettings(next)
    void saveSettingsAsync(next)
    onSettingsUpdate(next)
    setRecording(false)
    trailRef.current = simplified
    setStats((prev) => ({
      ...prev,
      status: `Saved ${settings.activeTrip} route (${simplified.length} points). Place alarm points in Settings.`,
    }))
  }

  const alertClass =
    stats.alert === 'arrived'
      ? 'alert-arrived'
      : stats.alert === 'approaching' || stats.alert === 'waypoint'
        ? 'alert-approach'
        : ''

  return (
    <div className={`screen tracking-screen ${alertClass}`}>
      <header className="track-bar">
        <div>
          <p className="brand-sm">School Bus Notifier</p>
          <h1>
            {stats.alert === 'arrived'
              ? 'Bus has arrived'
              : stats.alert === 'approaching'
                ? 'Bus approaching'
                : stats.alert === 'waypoint'
                  ? `Alarm point ${stats.activeWaypointLabel ?? ''}`
                  : recording
                    ? `Recording ${settings.activeTrip}`
                    : 'Tracking bus'}
          </h1>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onChangeSettings}
        >
          Settings
        </button>
      </header>

      {recording && (
        <button
          type="button"
          className="banner banner-action"
          onClick={stopAndSaveRoute}
        >
          Stop &amp; save {settings.activeTrip} route (
          {trailRef.current.length} points)
        </button>
      )}

      {stats.alert === 'arrived' && (
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
          Passed alarm point on the {settings.activeTrip} route.
        </div>
      )}
      {stats.alert === null && stats.bus && !recording && (
        <div className="banner banner-info" role="status">
          Tracking {settings.activeTrip}. Continuous alerts start within{' '}
          {formatAlertDistance(settings.approachDistanceM)}.
          {tripAlarms.length
            ? ` ${tripAlarms.length} route alarm point(s) armed.`
            : ''}
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
          <span className="stat-value">
            {settings.activeTrip === 'drop' ? 'Drop' : 'Pickup'}
          </span>
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
