import type { LatLng } from '../types'
import { extractCoords } from '../../shared/gpsResolve'

export type GpsParseResult =
  | { ok: true; location: LatLng; note?: string }
  | { ok: false; error: string }

/** Quick client-side parse for pasted coords / Maps URLs that already embed lat/lng */
export function parseGpsInput(input: string): GpsParseResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false, error: 'Please provide a GPS link or coordinates.' }
  }

  const loc = extractCoords(trimmed)
  if (loc) {
    return {
      ok: true,
      location: loc,
      note: 'Coordinates read from the pasted link.',
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      error: 'Link saved — live tracking will resolve coordinates from the server.',
    }
  }

  return {
    ok: false,
    error:
      'Unrecognized format. Use a Maps/tracker link or coordinates like 12.9716, 77.5946',
  }
}

/**
 * Resolve bus location via the server proxy (avoids browser CORS).
 * HTTP(S) links always go through the API so live tracker pages can update.
 */
export async function fetchBusLocation(
  gpsLink: string,
): Promise<GpsParseResult> {
  const trimmed = gpsLink.trim()

  if (!/^https?:\/\//i.test(trimmed)) {
    return parseGpsInput(trimmed)
  }

  try {
    const endpoint = `/api/gps?url=${encodeURIComponent(trimmed)}`
    const res = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
    })

    const data = (await res.json()) as GpsParseResult
    if (data?.ok && data.location) {
      return {
        ok: true,
        location: data.location,
        note: data.note ?? 'Live GPS update',
      }
    }

    // Fallback: coordinates already in the URL string
    const fromUrl = extractCoords(trimmed)
    if (fromUrl) {
      return {
        ok: true,
        location: fromUrl,
        note: 'Coordinates from the pasted link.',
      }
    }

    return {
      ok: false,
      error:
        (!data.ok && data.error) ||
        'Could not read bus location from that GPS link.',
    }
  } catch {
    const fromUrl = extractCoords(trimmed)
    if (fromUrl) {
      return {
        ok: true,
        location: fromUrl,
        note: 'Coordinates from the pasted link.',
      }
    }

    return {
      ok: false,
      error:
        'Could not reach the GPS resolver. Check your connection, or paste coordinates / a Maps URL with @lat,lng.',
    }
  }
}
