import type { LatLng } from '../types'
import { AVG_BUS_SPEED_KMH } from '../types'

const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Haversine distance in kilometers */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

export function etaMinutes(
  distance: number,
  speedKmh: number = AVG_BUS_SPEED_KMH,
): number {
  if (speedKmh <= 0) return Infinity
  return (distance / speedKmh) * 60
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(2)} km`
}

export function formatEta(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—'
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${m}m`
}

/** Move a point toward a target by a fraction of the remaining distance */
export function moveToward(
  from: LatLng,
  to: LatLng,
  fraction: number,
): LatLng {
  const f = Math.min(1, Math.max(0, fraction))
  return {
    lat: from.lat + (to.lat - from.lat) * f,
    lng: from.lng + (to.lng - from.lng) * f,
  }
}

/** Offset a home location by approx km north/east for demo start */
export function offsetByKm(
  origin: LatLng,
  northKm: number,
  eastKm: number,
): LatLng {
  const latOffset = northKm / 111.32
  const lngOffset =
    eastKm / (111.32 * Math.cos(toRad(origin.lat)) || 1)
  return {
    lat: origin.lat + latOffset,
    lng: origin.lng + lngOffset,
  }
}
