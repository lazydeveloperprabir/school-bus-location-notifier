import { useEffect, useMemo, useRef } from 'react'
import {
  MapContainer,
  Marker,
  Polyline,
  Circle,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import type { AlarmPoint, LatLng } from '../types'
import {
  DEFAULT_APPROACH_DISTANCE_M,
  DEFAULT_ARRIVAL_DISTANCE_M,
  getAlarmPointName,
} from '../types'
import 'leaflet/dist/leaflet.css'

export type MapViewMode = 'follow' | 'complete'

const homeIcon = L.divIcon({
  className: 'map-pin map-pin-home',
  html: `<span aria-hidden="true"></span>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
})

const busIcon = L.divIcon({
  className: 'map-pin map-pin-bus',
  html: `<span aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#0b3d2e" stroke-width="1.8"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M8 17v2M16 17v2M7 7h3M14 7h3"/></svg></span>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
})

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function alarmIcon(label: string) {
  const short =
    label.length > 8 ? `${label.slice(0, 7)}…` : label
  return L.divIcon({
    className: 'map-pin map-pin-alarm',
    html: `<span aria-hidden="true">${escapeHtml(short)}</span>`,
    iconSize: [Math.min(28 + short.length * 4, 72), 28],
    iconAnchor: [14, 14],
  })
}

function nearestIndex(
  path: Array<[number, number]>,
  point: LatLng,
): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < path.length; i++) {
    const [lat, lng] = path[i]
    const d = (lat - point.lat) ** 2 + (lng - point.lng) ** 2
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/** Slice of saved route around the bus for follow zoom */
function localRouteWindow(
  path: Array<[number, number]>,
  bus: LatLng,
  windowSize = 24,
): Array<[number, number]> {
  if (path.length <= 2) return path
  const idx = nearestIndex(path, bus)
  const start = Math.max(0, idx - Math.floor(windowSize / 3))
  const end = Math.min(path.length, idx + Math.ceil((windowSize * 2) / 3))
  return path.slice(start, end)
}

function FitBounds({
  home,
  bus,
  routePath,
  savedRoutePath,
  viewMode,
}: {
  home: LatLng
  bus: LatLng | null
  routePath: Array<[number, number]> | null
  savedRoutePath: Array<[number, number]> | null
  viewMode: MapViewMode
}) {
  const map = useMap()
  const fullPath = savedRoutePath?.length
    ? savedRoutePath
    : routePath?.length
      ? routePath
      : null

  const busKey = bus
    ? `${bus.lat.toFixed(4)},${bus.lng.toFixed(4)}`
    : ''
  const pathKey = fullPath?.length
    ? `${fullPath[0]?.join(',')}-${fullPath[fullPath.length - 1]?.join(',')}-${fullPath.length}`
    : ''
  const key = `${viewMode}|${home.lat},${home.lng}|${busKey}|${pathKey}|${routePath?.length ?? 0}`

  useEffect(() => {
    if (viewMode === 'complete') {
      if (fullPath && fullPath.length > 1) {
        const bounds = L.latLngBounds(fullPath.map(([lat, lng]) => [lat, lng]))
        bounds.extend([home.lat, home.lng])
        if (bus) bounds.extend([bus.lat, bus.lng])
        map.fitBounds(bounds.pad(0.18), { animate: true, maxZoom: 16 })
      } else if (bus) {
        const bounds = L.latLngBounds(
          [home.lat, home.lng],
          [bus.lat, bus.lng],
        )
        map.fitBounds(bounds.pad(0.3), { animate: true, maxZoom: 16 })
      } else {
        map.setView([home.lat, home.lng], 14, { animate: true })
      }
      return
    }

    // Follow / auto-zoom: focus on bus + the road ahead toward home
    if (bus && routePath && routePath.length > 1) {
      const bounds = L.latLngBounds(routePath.map(([lat, lng]) => [lat, lng]))
      bounds.extend([bus.lat, bus.lng])
      map.fitBounds(bounds.pad(0.28), { animate: true, maxZoom: 17 })
      return
    }

    if (bus && fullPath && fullPath.length > 1) {
      const windowPts = localRouteWindow(fullPath, bus)
      const bounds = L.latLngBounds(windowPts.map(([lat, lng]) => [lat, lng]))
      bounds.extend([bus.lat, bus.lng])
      // Include home only when already nearby on the map
      const homeDist =
        map.distance([bus.lat, bus.lng], [home.lat, home.lng])
      if (homeDist < 2000) {
        bounds.extend([home.lat, home.lng])
      }
      map.fitBounds(bounds.pad(0.35), { animate: true, maxZoom: 17 })
      return
    }

    if (bus) {
      const bounds = L.latLngBounds(
        [home.lat, home.lng],
        [bus.lat, bus.lng],
      )
      map.fitBounds(bounds.pad(0.4), { animate: true, maxZoom: 16 })
      return
    }

    map.setView([home.lat, home.lng], 14, { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map, viewMode])

  return null
}

function ClickPicker({
  enabled,
  onPick,
}: {
  enabled: boolean
  onPick: (pos: LatLng) => void
}) {
  useMapEvents({
    click(e) {
      if (!enabled) return
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return null
}

type MapViewProps = {
  home: LatLng
  bus?: LatLng | null
  /** Live OSRM path bus→home */
  routePath?: Array<[number, number]> | null
  /** Remembered pickup/drop path */
  savedRoutePath?: Array<[number, number]> | null
  alarmPoints?: AlarmPoint[]
  pickable?: boolean
  onPick?: (pos: LatLng) => void
  showZones?: boolean
  approachDistanceM?: number
  arrivalDistanceM?: number
  homeIndex?: number
  /** follow = auto-zoom to bus travel; complete = full route overview */
  viewMode?: MapViewMode
  className?: string
}

export function MapView({
  home,
  bus = null,
  routePath = null,
  savedRoutePath = null,
  alarmPoints = [],
  pickable = false,
  onPick,
  showZones = false,
  approachDistanceM = DEFAULT_APPROACH_DISTANCE_M,
  arrivalDistanceM = DEFAULT_ARRIVAL_DISTANCE_M,
  homeIndex = -1,
  viewMode = 'follow',
  className = '',
}: MapViewProps) {
  const liveLine = useMemo(() => {
    if (routePath && routePath.length > 1) return routePath
    if (!bus) return null
    return [
      [home.lat, home.lng] as [number, number],
      [bus.lat, bus.lng] as [number, number],
    ]
  }, [home, bus, routePath])

  const beforeHome = useMemo(() => {
    if (!savedRoutePath || savedRoutePath.length < 2 || homeIndex < 0) {
      return savedRoutePath
    }
    return savedRoutePath.slice(0, homeIndex + 1)
  }, [savedRoutePath, homeIndex])

  const afterHome = useMemo(() => {
    if (!savedRoutePath || savedRoutePath.length < 2 || homeIndex < 0) {
      return null
    }
    return savedRoutePath.slice(homeIndex)
  }, [savedRoutePath, homeIndex])

  const centerRef = useRef<[number, number]>([home.lat, home.lng])

  return (
    <div className={`map-shell ${className}`}>
      <MapContainer
        center={centerRef.current}
        zoom={14}
        className="map-canvas"
        zoomControl={!pickable}
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds
          home={home}
          bus={bus}
          routePath={routePath}
          savedRoutePath={savedRoutePath}
          viewMode={viewMode}
        />
        <ClickPicker enabled={pickable} onPick={(pos) => onPick?.(pos)} />
        {showZones && (
          <>
            <Circle
              center={[home.lat, home.lng]}
              radius={approachDistanceM}
              pathOptions={{
                color: '#c45c26',
                fillColor: '#c45c26',
                fillOpacity: 0.06,
                weight: 1.5,
                dashArray: '6 8',
              }}
            />
            <Circle
              center={[home.lat, home.lng]}
              radius={arrivalDistanceM}
              pathOptions={{
                color: '#1a7a4c',
                fillColor: '#1a7a4c',
                fillOpacity: 0.12,
                weight: 2,
              }}
            />
          </>
        )}
        {beforeHome && beforeHome.length > 1 && (
          <Polyline
            positions={beforeHome}
            pathOptions={{
              color: '#c45c26',
              weight: 5,
              opacity: 0.85,
            }}
          />
        )}
        {afterHome && afterHome.length > 1 && (
          <Polyline
            positions={afterHome}
            pathOptions={{
              color: '#2f6fed',
              weight: 5,
              opacity: 0.75,
            }}
          />
        )}
        {liveLine && (
          <Polyline
            positions={liveLine}
            pathOptions={{
              color: '#0b3d2e',
              weight: 3,
              opacity: 0.45,
              dashArray: '6 8',
            }}
          />
        )}
        <Marker position={[home.lat, home.lng]} icon={homeIcon} />
        {bus && <Marker position={[bus.lat, bus.lng]} icon={busIcon} />}
        {alarmPoints.map((point, index) => (
          <Marker
            key={point.id}
            position={[point.lat, point.lng]}
            icon={alarmIcon(getAlarmPointName(point, index))}
          />
        ))}
      </MapContainer>
    </div>
  )
}
