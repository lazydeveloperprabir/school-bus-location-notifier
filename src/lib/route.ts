import { distanceKm } from './geo'
import type { LatLng } from '../types'

/** Drop points closer than this when simplifying / recording */
const MIN_POINT_SPACING_M = 25

export function appendRoutePoint(
  route: LatLng[],
  point: LatLng,
  minSpacingM = MIN_POINT_SPACING_M,
): LatLng[] {
  const last = route[route.length - 1]
  if (last && distanceKm(last, point) * 1000 < minSpacingM) {
    return route
  }
  return [...route, point].slice(-2000)
}

export function simplifyRoute(points: LatLng[], minSpacingM = 40): LatLng[] {
  if (points.length <= 2) return points
  const out: LatLng[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]
    if (distanceKm(prev, points[i]) * 1000 >= minSpacingM) {
      out.push(points[i])
    }
  }
  const last = points[points.length - 1]
  if (distanceKm(out[out.length - 1], last) * 1000 > 5) {
    out.push(last)
  }
  return out
}

/** Index of the route vertex nearest to home */
export function nearestRouteIndex(route: LatLng[], home: LatLng): number {
  if (route.length === 0) return -1
  let best = 0
  let bestDist = Infinity
  route.forEach((p, i) => {
    const d = distanceKm(p, home)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
}

export type SnapResult = {
  point: LatLng
  routeIndex: number
  distanceM: number
}

/** Snap a map click to the nearest point on the route polyline */
export function snapToRoute(
  route: LatLng[],
  click: LatLng,
  maxDistanceM = 250,
): SnapResult | null {
  if (route.length === 0) return null

  let best: SnapResult | null = null

  for (let i = 0; i < route.length; i++) {
    const vertex = route[i]
    const d = distanceKm(vertex, click) * 1000
    if (!best || d < best.distanceM) {
      best = { point: vertex, routeIndex: i, distanceM: d }
    }
  }

  // Also check segment projections for better snaps
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]
    const b = route[i + 1]
    const projected = projectOnSegment(click, a, b)
    const d = distanceKm(projected.point, click) * 1000
    if (!best || d < best.distanceM) {
      best = {
        point: projected.point,
        routeIndex: projected.t < 0.5 ? i : i + 1,
        distanceM: d,
      }
    }
  }

  if (!best || best.distanceM > maxDistanceM) return null
  return best
}

function projectOnSegment(
  p: LatLng,
  a: LatLng,
  b: LatLng,
): { point: LatLng; t: number } {
  const ax = a.lng
  const ay = a.lat
  const bx = b.lng
  const by = b.lat
  const px = p.lng
  const py = p.lat
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { point: a, t: 0 }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return {
    t,
    point: { lat: ay + t * dy, lng: ax + t * dx },
  }
}

export function routeToLatLngTuples(
  route: LatLng[],
): Array<[number, number]> {
  return route.map((p) => [p.lat, p.lng])
}

export function findNearbyAlarmIndex(
  bus: LatLng,
  points: Array<{ lat: number; lng: number }>,
  radiusM: number,
  alreadyTriggered: Set<string>,
  ids: string[],
): number {
  let best = -1
  let bestDist = Infinity
  points.forEach((p, i) => {
    if (alreadyTriggered.has(ids[i])) return
    const d = distanceKm(bus, p) * 1000
    if (d <= radiusM && d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
}
