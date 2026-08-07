import type { LatLng } from '../types'
import { distanceKm, etaMinutes } from './geo'
import { AVG_BUS_SPEED_KMH } from '../types'

export type RoadRoute = {
  /** Road distance in kilometers */
  distanceKm: number
  /** Driving ETA in minutes from the router */
  etaMinutes: number
  /** Route polyline as [lat, lng] pairs for the map */
  path: Array<[number, number]>
  source: 'road' | 'straight'
}

type CacheEntry = {
  key: string
  route: RoadRoute
  at: number
}

let cache: CacheEntry | null = null
const CACHE_TTL_MS = 12_000
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving'

function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5
}

function cacheKey(from: LatLng, to: LatLng): string {
  return `${roundCoord(from.lat)},${roundCoord(from.lng)}>${roundCoord(to.lat)},${roundCoord(to.lng)}`
}

function straightFallback(from: LatLng, to: LatLng): RoadRoute {
  const km = distanceKm(from, to)
  return {
    distanceKm: km,
    etaMinutes: etaMinutes(km, AVG_BUS_SPEED_KMH),
    path: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    source: 'straight',
  }
}

/**
 * Road-network distance + ETA via OSRM (OpenStreetMap).
 * Falls back to straight-line if routing is unavailable.
 */
export async function fetchRoadRoute(
  from: LatLng,
  to: LatLng,
): Promise<RoadRoute> {
  const key = cacheKey(from, to)
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.route
  }

  // Very close: skip network call
  if (distanceKm(from, to) < 0.03) {
    const route = straightFallback(from, to)
    cache = { key, route, at: Date.now() }
    return route
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const url =
      `${OSRM_URL}/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=full&geometries=geojson&steps=false`

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      return straightFallback(from, to)
    }

    const data = (await res.json()) as {
      code?: string
      routes?: Array<{
        distance: number
        duration: number
        geometry?: { coordinates?: Array<[number, number]> }
      }>
    }

    const route = data.routes?.[0]
    if (data.code !== 'Ok' || !route) {
      return straightFallback(from, to)
    }

    const coords = route.geometry?.coordinates ?? []
    const path: Array<[number, number]> =
      coords.length > 1
        ? coords.map(([lng, lat]) => [lat, lng])
        : [
            [from.lat, from.lng],
            [to.lat, to.lng],
          ]

    const result: RoadRoute = {
      distanceKm: route.distance / 1000,
      etaMinutes: route.duration / 60,
      path,
      source: 'road',
    }

    cache = { key, route: result, at: Date.now() }
    return result
  } catch {
    return straightFallback(from, to)
  } finally {
    clearTimeout(timer)
  }
}
