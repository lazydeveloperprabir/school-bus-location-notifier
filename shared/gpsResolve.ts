export type LatLng = { lat: number; lng: number }

export type ResolveResult =
  | { ok: true; location: LatLng; note?: string; finalUrl?: string }
  | { ok: false; error: string }

const USER_AGENT =
  'Mozilla/5.0 (compatible; SchoolBusNotifier/1.0; +https://school-bus-location-notifier.vercel.app)'

/** First capture group is latitude, second is longitude */
const LAT_LNG_PATTERNS: RegExp[] = [
  /@(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
  /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  /[?&](?:q|query|ll|center|sll)=(-?\d{1,2}\.\d+)[,+\s](-?\d{1,3}\.\d+)/i,
  /destination=(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)/i,
  /destination=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/i,
  /"lat(?:itude)?"\s*[:=]\s*"?(-?\d{1,2}\.\d+)"?\s*[,}][\s\S]{0,80}?"(?:lng|lon|longitude)"\s*[:=]\s*"?(-?\d{1,3}\.\d+)"?/i,
  /lat(?:itude)?["']?\s*[:=]\s*["']?(-?\d{1,2}\.\d+)["']?\s*[,&\s]+(?:lng|lon|longitude)["']?\s*[:=]\s*["']?(-?\d{1,3}\.\d+)/i,
  /new\s+google\.maps\.LatLng\(\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*\)/i,
  /center=(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)/i,
  /markers?=[^&\s]*?(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)/i,
  /"position"\s*:\s*\{\s*"lat"\s*:\s*(-?\d{1,2}\.\d+)\s*,\s*"lng"\s*:\s*(-?\d{1,3}\.\d+)/i,
  /data-lat=["'](-?\d{1,2}\.\d+)["'][^>]*data-(?:lng|lon)=["'](-?\d{1,3}\.\d+)["']/i,
]

/** First capture group is longitude, second is latitude */
const LNG_LAT_PATTERNS: RegExp[] = [
  /"(?:lng|lon|longitude)"\s*[:=]\s*"?(-?\d{1,3}\.\d+)"?\s*[,}][\s\S]{0,80}?"lat(?:itude)?"\s*[:=]\s*"?(-?\d{1,2}\.\d+)"?/i,
  /(?:lng|lon|longitude)["']?\s*[:=]\s*["']?(-?\d{1,3}\.\d+)["']?\s*[,&\s]+lat(?:itude)?["']?\s*[:=]\s*["']?(-?\d{1,2}\.\d+)/i,
  /data-(?:lng|lon)=["'](-?\d{1,3}\.\d+)["'][^>]*data-lat=["'](-?\d{1,2}\.\d+)["']/i,
]

function validate(lat: number, lng: number): LatLng | null {
  if (
    Number.isNaN(lat) ||
    Number.isNaN(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null
  }
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

/** Extract coordinates from a URL string, HTML, or JSON text */
export function extractCoords(text: string): LatLng | null {
  const trimmed = text.trim()

  const raw = trimmed.match(
    /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  )
  if (raw) return validate(Number(raw[1]), Number(raw[2]))

  for (const pattern of LAT_LNG_PATTERNS) {
    const match = trimmed.match(pattern)
    if (!match) continue
    const loc = validate(Number(match[1]), Number(match[2]))
    if (loc) return loc
  }

  for (const pattern of LNG_LAT_PATTERNS) {
    const match = trimmed.match(pattern)
    if (!match) continue
    const loc = validate(Number(match[2]), Number(match[1]))
    if (loc) return loc
  }

  // Geo-ish array often appears as [lat, lng] in JS trackers
  const bracket = trimmed.match(/\[(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})\]/)
  if (bracket) {
    const asLatLng = validate(Number(bracket[1]), Number(bracket[2]))
    if (asLatLng) return asLatLng
  }

  const loose = [
    ...trimmed.matchAll(/(-?\d{1,2}\.\d{5,})\s*[, ]\s*(-?\d{1,3}\.\d{5,})/g),
  ]
  for (const m of loose) {
    const loc = validate(Number(m[1]), Number(m[2]))
    if (loc) return loc
  }

  return null
}

function extractJsonCoords(data: unknown, depth = 0): LatLng | null {
  if (depth > 6 || data == null) return null

  if (typeof data === 'string') {
    try {
      return extractJsonCoords(JSON.parse(data), depth + 1)
    } catch {
      return extractCoords(data)
    }
  }

  if (typeof data !== 'object') return null

  if (Array.isArray(data)) {
    if (
      data.length >= 2 &&
      typeof data[0] === 'number' &&
      typeof data[1] === 'number'
    ) {
      // Prefer GeoJSON [lng, lat] when first value looks like longitude
      const asLngLat = validate(data[1], data[0])
      const asLatLng = validate(data[0], data[1])
      if (Math.abs(data[0]) > 90 && asLngLat) return asLngLat
      if (asLatLng) return asLatLng
      if (asLngLat) return asLngLat
    }
    for (const item of data) {
      const found = extractJsonCoords(item, depth + 1)
      if (found) return found
    }
    return null
  }

  const obj = data as Record<string, unknown>
  const pairs: Array<[unknown, unknown]> = [
    [obj.lat, obj.lng],
    [obj.latitude, obj.longitude],
    [obj.lat, obj.lon],
    [obj.Latitude, obj.Longitude],
    [obj.LAT, obj.LNG],
    [obj.LATITUDE, obj.LONGITUDE],
  ]

  for (const [a, b] of pairs) {
    if (typeof a === 'number' && typeof b === 'number') {
      const loc = validate(a, b)
      if (loc) return loc
    }
    if (typeof a === 'string' && typeof b === 'string') {
      const loc = validate(Number(a), Number(b))
      if (loc) return loc
    }
  }

  for (const value of Object.values(obj)) {
    const found = extractJsonCoords(value, depth + 1)
    if (found) return found
  }
  return null
}

/** Find nested tracker API URLs inside HTML (common in bus GPS portals) */
function findApiCandidates(html: string, baseUrl: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /["']((https?:\/\/[^"']*(?:api|track|location|live|device|vehicle|gps|position)[^"']*))["']/gi,
    /["']((\/[^"']*(?:api|track|location|live|device|vehicle|gps|position)[^"']*))["']/gi,
  ]

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      try {
        const absolute = new URL(match[1], baseUrl).toString()
        if (/^https?:\/\//i.test(absolute)) found.add(absolute)
      } catch {
        // ignore bad URLs
      }
    }
  }

  return [...found].slice(0, 8)
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '::1'
  ) {
    return true
  }
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

async function fetchText(
  url: string,
  timeoutMs = 12000,
): Promise<
  | { ok: true; url: string; body: string; contentType: string }
  | { ok: false; error: string }
> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'Invalid GPS URL.' }
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'GPS URL must be http or https.' }
  }
  if (isPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      error: 'That host cannot be fetched for security reasons.',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/json,application/xhtml+xml,*/*',
      },
    })

    const finalUrl = res.url || parsed.toString()
    if (!res.ok) {
      return { ok: false, error: `Tracker returned HTTP ${res.status}.` }
    }

    const contentType = res.headers.get('content-type') ?? ''
    const body = await res.text()
    return { ok: true, url: finalUrl, body, contentType }
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Tracker request timed out.'
        : 'Could not reach the GPS link.'
    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}


function extractWialonToken(url: string): string | null {
  try {
    const t = new URL(url).searchParams.get('t')?.trim()
    if (t && /^[a-fA-F0-9]{72}$/.test(t)) return t
  } catch {
    // ignore
  }
  return null
}

function extractWialonApiHost(html: string, pageUrl: string): string {
  const fromHtml =
    html.match(/api_url\s*=\s*"((?:\\.|[^"\\])*)"/i) ??
    html.match(/wialon_sdk_url\s*=\s*"((?:\\.|[^"\\])*)"/i)
  if (fromHtml?.[1]) {
    const raw = fromHtml[1].replace(/\\\//g, '/')
    try {
      return new URL(raw).origin
    } catch {
      // fall through
    }
  }

  try {
    const host = new URL(pageUrl).hostname.toLowerCase()
    if (host.includes('wialon') || host.includes('cpark') || host.includes('gps360')) {
      return 'https://hst-api.wialon.eu'
    }
  } catch {
    // ignore
  }

  return 'https://hst-api.wialon.eu'
}

function isWialonLocatorPage(url: string, html = ''): boolean {
  const lower = `${url}\n${html}`.toLowerCase()
  return (
    Boolean(extractWialonToken(url)) &&
    (lower.includes('wialon') ||
      lower.includes('/locator') ||
      lower.includes('cpark') ||
      lower.includes('gps360') ||
      lower.includes('hst-api.wialon'))
  )
}

type WialonUnit = {
  nm?: string
  pos?: { x?: number; y?: number; s?: number; t?: number }
}

function pickWialonLocation(
  units: WialonUnit[],
): { location: LatLng; name?: string; speedKmh?: number } | null {
  for (const unit of units) {
    const x = unit.pos?.x
    const y = unit.pos?.y
    if (typeof x !== 'number' || typeof y !== 'number') continue
    // Wialon uses y=latitude, x=longitude
    const loc = validate(y, x)
    if (!loc) continue
    return {
      location: loc,
      name: typeof unit.nm === 'string' ? unit.nm : undefined,
      speedKmh: typeof unit.pos?.s === 'number' ? unit.pos.s : undefined,
    }
  }
  return null
}

async function wialonAjax(
  apiOrigin: string,
  svc: string,
  params: Record<string, unknown>,
  sid?: string,
): Promise<unknown> {
  const qs = new URLSearchParams({
    svc,
    params: JSON.stringify(params),
  })
  if (sid) qs.set('sid', sid)

  const res = await fetch(`${apiOrigin}/wialon/ajax.html?${qs.toString()}`, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json,text/plain,*/*',
    },
  })

  if (!res.ok) {
    throw new Error(`Wialon ${svc} HTTP ${res.status}`)
  }

  const body = await res.text()
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error(`Wialon ${svc} returned non-JSON`)
  }
}

/**
 * Resolve CPARK GPS360 / Wialon Locator share links (?t=72-char-token).
 * @see https://help.wialon.com/en/api/user-guide/api-reference/token/login
 */
async function resolveWialonLocator(
  pageUrl: string,
  html = '',
): Promise<ResolveResult | null> {
  const token = extractWialonToken(pageUrl)
  if (!token) return null

  const looksFamiliar =
    isWialonLocatorPage(pageUrl, html) ||
    /\/locator/i.test(pageUrl) ||
    /cpark|gps360|wialon/i.test(pageUrl)

  if (!looksFamiliar) return null

  const apiOrigin = extractWialonApiHost(html, pageUrl)

  try {
    const login = (await wialonAjax(apiOrigin, 'token/login', {
      token,
    })) as {
      error?: number
      reason?: string
      eid?: string
      items?: WialonUnit[]
    }

    if (typeof login.error === 'number' && login.error !== 0) {
      return {
        ok: false,
        error: `Wialon login failed (error ${login.error}${login.reason ? `: ${login.reason}` : ''}). The share link may have expired.`,
      }
    }

    const sid = login.eid
    if (!sid) {
      return {
        ok: false,
        error:
          'Wialon login did not return a session. Check that the locator link is still valid.',
      }
    }

    let picked = pickWialonLocation(login.items ?? [])

    if (!picked) {
      const search = (await wialonAjax(
        apiOrigin,
        'core/search_items',
        {
          spec: {
            itemsType: 'avl_unit',
            propName: 'sys_name',
            propValueMask: '*',
            sortType: 'sys_name',
          },
          force: 1,
          flags: 1025,
          from: 0,
          to: 0,
        },
        sid,
      )) as { error?: number; items?: WialonUnit[] }

      if (typeof search.error === 'number' && search.error !== 0) {
        return {
          ok: false,
          error: `Wialon could not list the bus (error ${search.error}).`,
        }
      }

      picked = pickWialonLocation(search.items ?? [])
    }

    void wialonAjax(apiOrigin, 'core/logout', {}, sid).catch(() => undefined)

    if (!picked) {
      return {
        ok: false,
        error:
          'Logged into the locator, but no bus position was available yet. Try again in a few seconds.',
      }
    }

    const label = picked.name ? ` (${picked.name})` : ''
    return {
      ok: true,
      location: picked.location,
      note: `Live from CPARK / Wialon locator${label}.`,
      finalUrl: pageUrl,
    }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Wialon locator error: ${err.message}`
          : 'Wialon locator error.',
    }
  }
}

/**
 * Resolve a GPS share link / tracker URL / raw coordinates into a lat/lng.
 * Runs server-side so CORS does not block reading the tracker page.
 */
export async function resolveGpsLink(input: string): Promise<ResolveResult> {
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false, error: 'Please provide a GPS link or coordinates.' }
  }

  const direct = extractCoords(trimmed)
  if (direct) {
    return {
      ok: true,
      location: direct,
      note: 'Coordinates read from the pasted link.',
    }
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      error:
        'Unrecognized format. Paste a tracker/Maps URL or coordinates like 12.9716, 77.5946',
    }
  }

  // Fast path for Wialon / CPARK GPS360 locator links
  if (
    extractWialonToken(trimmed) &&
    /locator|cpark|gps360|wialon/i.test(trimmed)
  ) {
    const wialon = await resolveWialonLocator(trimmed)
    if (wialon) return wialon
  }

  const page = await fetchText(trimmed)
  if (page.ok === false) {
    return { ok: false, error: page.error }
  }

  if (isWialonLocatorPage(page.url, page.body) || extractWialonToken(page.url)) {
    const wialon = await resolveWialonLocator(page.url, page.body)
    if (wialon) return wialon
  }

  const fromFinalUrl = extractCoords(page.url)
  if (fromFinalUrl) {
    return {
      ok: true,
      location: fromFinalUrl,
      note: 'Coordinates from redirected Maps URL.',
      finalUrl: page.url,
    }
  }

  if (page.contentType.includes('application/json')) {
    try {
      const json = JSON.parse(page.body) as unknown
      const loc = extractJsonCoords(json)
      if (loc) {
        return {
          ok: true,
          location: loc,
          note: 'Live from tracker JSON.',
          finalUrl: page.url,
        }
      }
    } catch {
      // fall through
    }
  }

  const fromBody = extractCoords(page.body)
  if (fromBody) {
    return {
      ok: true,
      location: fromBody,
      note: 'Coordinates parsed from the tracker page.',
      finalUrl: page.url,
    }
  }

  try {
    const json = JSON.parse(page.body) as unknown
    const loc = extractJsonCoords(json)
    if (loc) {
      return {
        ok: true,
        location: loc,
        note: 'Live from tracker JSON.',
        finalUrl: page.url,
      }
    }
  } catch {
    // not JSON
  }

  const apis = findApiCandidates(page.body, page.url)
  for (const apiUrl of apis) {
    const apiPage = await fetchText(apiUrl, 8000)
    if (!apiPage.ok) continue

    const looksJson =
      apiPage.contentType.includes('json') ||
      apiPage.body.trim().startsWith('{') ||
      apiPage.body.trim().startsWith('[')

    if (looksJson) {
      try {
        const json = JSON.parse(apiPage.body) as unknown
        const loc = extractJsonCoords(json)
        if (loc) {
          return {
            ok: true,
            location: loc,
            note: 'Live from nested tracker API.',
            finalUrl: apiPage.url,
          }
        }
      } catch {
        // continue
      }
    }

    const loc = extractCoords(apiPage.body) ?? extractCoords(apiPage.url)
    if (loc) {
      return {
        ok: true,
        location: loc,
        note: 'Coordinates from nested tracker endpoint.',
        finalUrl: apiPage.url,
      }
    }
  }

  return {
    ok: false,
    error:
      'Could not find coordinates in that link. The page may load the bus location only with JavaScript. After opening the link in a browser, copy the address bar URL (it often then contains @lat,lng), or paste lat,lng directly.',
  }
}
