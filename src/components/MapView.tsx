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
} from '../types'
import 'leaflet/dist/leaflet.css'

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

function alarmIcon(label: string) {
  return L.divIcon({
    className: 'map-pin map-pin-alarm',
    html: `<span aria-hidden="true">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

function FitBounds({
  home,
  bus,
  routePath,
  savedRoutePath,
}: {
  home: LatLng
  bus: LatLng | null
  routePath: Array<[number, number]> | null
  savedRoutePath: Array<[number, number]> | null
}) {
  const map = useMap()
  const primary = savedRoutePath?.length
    ? savedRoutePath
    : routePath?.length
      ? routePath
      : null
  const pathKey = primary?.length
    ? `${primary[0]?.join(',')}-${primary[primary.length - 1]?.join(',')}-${primary.length}`
    : ''
  const key = `${home.lat},${home.lng},${bus?.lat ?? ''},${bus?.lng ?? ''},${pathKey}`

  useEffect(() => {
    if (primary && primary.length > 1) {
      const bounds = L.latLngBounds(primary.map(([lat, lng]) => [lat, lng]))
      bounds.extend([home.lat, home.lng])
      if (bus) bounds.extend([bus.lat, bus.lng])
      map.fitBounds(bounds.pad(0.2), { animate: true })
    } else if (bus) {
      const bounds = L.latLngBounds(
        [home.lat, home.lng],
        [bus.lat, bus.lng],
      )
      map.fitBounds(bounds.pad(0.35), { animate: true })
    } else {
      map.setView([home.lat, home.lng], 14, { animate: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])

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
            icon={alarmIcon(String(index + 1))}
          />
        ))}
      </MapContainer>
    </div>
  )
}
