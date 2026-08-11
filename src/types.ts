export type LatLng = {
  lat: number
  lng: number
}

export type TripKind = 'pickup' | 'drop'

export type AlarmPoint = {
  id: string
  trip: TripKind
  lat: number
  lng: number
  /** Index along the saved route polyline */
  routeIndex: number
  label?: string
}

export type AppSettings = {
  home: LatLng
  homeLabel?: string
  gpsLink: string
  /** Approach alert distance in meters (road distance) */
  approachDistanceM: number
  /** Arrival alert distance in meters */
  arrivalDistanceM: number
  /** How often to repeat approach voice alerts (seconds) */
  announceIntervalSec: number
  /** Which route profile is active */
  activeTrip: TripKind
  /** Remembered bus path before/after home — pickup */
  pickupRoute: LatLng[]
  /** Remembered bus path before/after home — drop */
  dropRoute: LatLng[]
  /** User-selected alarm spots snapped onto a route */
  alarmPoints: AlarmPoint[]
  lastUpdated?: number
}

export type AlertKind = 'approaching' | 'arrived' | 'waypoint' | null

export type TrackingStats = {
  bus: LatLng | null
  distanceKm: number | null
  etaMinutes: number | null
  speedKmh: number | null
  alert: AlertKind
  status: string
  source: 'link' | 'demo' | 'manual'
  /** Road path for map polyline ([lat, lng][]) */
  routePath: Array<[number, number]> | null
  distanceSource: 'road' | 'straight' | null
  activeWaypointLabel?: string | null
}

/** Defaults: 700 m approach, announce every 5 seconds */
export const DEFAULT_APPROACH_DISTANCE_M = 700
export const DEFAULT_ARRIVAL_DISTANCE_M = 80
export const DEFAULT_ANNOUNCE_INTERVAL_SEC = 5
/** How close the bus must be to an alarm point to trigger it */
export const DEFAULT_WAYPOINT_RADIUS_M = 120

export const AVG_BUS_SPEED_KMH = 25
export const POLL_INTERVAL_MS = 8000

export function metersToKm(meters: number): number {
  return meters / 1000
}

export function formatAlertDistance(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000
    return Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`
  }
  return `${Math.round(meters)} m`
}

export function normalizeAlertSettings(
  partial?: Partial<AppSettings> | null,
): Pick<
  AppSettings,
  'approachDistanceM' | 'arrivalDistanceM' | 'announceIntervalSec'
> {
  const approachDistanceM = Number(partial?.approachDistanceM)
  const arrivalDistanceM = Number(partial?.arrivalDistanceM)
  const announceIntervalSec = Number(partial?.announceIntervalSec)

  return {
    approachDistanceM:
      Number.isFinite(approachDistanceM) && approachDistanceM > 0
        ? Math.min(Math.max(approachDistanceM, 50), 20000)
        : DEFAULT_APPROACH_DISTANCE_M,
    arrivalDistanceM:
      Number.isFinite(arrivalDistanceM) && arrivalDistanceM > 0
        ? Math.min(Math.max(arrivalDistanceM, 20), 500)
        : DEFAULT_ARRIVAL_DISTANCE_M,
    announceIntervalSec:
      Number.isFinite(announceIntervalSec) && announceIntervalSec > 0
        ? Math.min(Math.max(Math.round(announceIntervalSec), 1), 120)
        : DEFAULT_ANNOUNCE_INTERVAL_SEC,
  }
}

function isLatLng(value: unknown): value is LatLng {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LatLng).lat === 'number' &&
    typeof (value as LatLng).lng === 'number'
  )
}

export function normalizeRoute(points: unknown): LatLng[] {
  if (!Array.isArray(points)) return []
  return points.filter(isLatLng).slice(0, 2000)
}

export function normalizeAlarmPoints(points: unknown): AlarmPoint[] {
  if (!Array.isArray(points)) return []
  return points
    .filter((p): p is AlarmPoint => {
      if (!p || typeof p !== 'object') return false
      const point = p as AlarmPoint
      return (
        typeof point.id === 'string' &&
        (point.trip === 'pickup' || point.trip === 'drop') &&
        typeof point.lat === 'number' &&
        typeof point.lng === 'number' &&
        typeof point.routeIndex === 'number'
      )
    })
    .map((point) => {
      const label =
        typeof point.label === 'string' ? point.label.trim().slice(0, 40) : ''
      return label ? { ...point, label } : { ...point, label: undefined }
    })
    .slice(0, 50)
}

export function normalizeTrip(value: unknown): TripKind {
  return value === 'drop' ? 'drop' : 'pickup'
}

export function getActiveRoute(settings: AppSettings): LatLng[] {
  return settings.activeTrip === 'drop'
    ? settings.dropRoute
    : settings.pickupRoute
}

export function createAlarmPointId(): string {
  return `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Custom tag if set; otherwise "Alarm point 1", "Alarm point 2", … */
export function getAlarmPointName(
  point: Pick<AlarmPoint, 'label'>,
  index: number,
): string {
  const custom = point.label?.trim()
  if (custom) return custom
  return `Alarm point ${index + 1}`
}
