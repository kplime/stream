import * as turf from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRiskScores } from '../hooks/useRiskScores'
import { useRiverGeometry } from '../hooks/useRiverGeometry'
import {
  BUSAN_MAX_BOUNDS,
  FALLBACK_BUILDINGS_3D_LAYER_ID,
  INITIAL_VIEW,
  MAP_STYLE_URL,
  NATIVE_BUILDINGS_3D_LAYER_ID,
  RISK_COLORS,
  RIVER_GLOW_LAYER_ID,
  RIVER_LINE_LAYER_ID,
  RIVER_SOURCE_ID,
  STATION_LAYER_ID,
  STATION_SOURCE_ID,
} from '../lib/mapStyle'
import { buildRiskSegments } from '../lib/riverSegments'
import { useMapStore } from '../store/useMapStore'
import { RIVER_NAMES, TRACK_LABELS, type RiverName } from '../types/risk'
import { AvatarMarker } from './AvatarMarker'
import { useUserLocation } from '../hooks/useUserLocation'



const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const buildingLayerIdRef = useRef<string>(NATIVE_BUILDINGS_3D_LAYER_ID)
  const [mapReady, setMapReady] = useState(false)
  const [hasFitBounds, setHasFitBounds] = useState(false)

  const track = useMapStore((s) => s.track)
  const visibleRivers = useMapStore((s) => s.visibleRivers)
  const show3dBuildings = useMapStore((s) => s.show3dBuildings)
  const selectStation = useMapStore((s) => s.selectStation)
  const flyToTarget = useMapStore((s) => s.flyTo)
  const flyToRequest = useMapStore((s) => s.flyToTarget)

  const { data: riverGeometry } = useRiverGeometry()
  const { data: scores } = useRiskScores()

  const trackScores = useMemo(() => scores?.filter((s) => s.track === track) ?? [], [scores, track])

  const riverSegments = useMemo(() => {
    if (!riverGeometry) return null
    return buildRiskSegments(riverGeometry, trackScores)
  }, [riverGeometry, trackScores])

  const stationFeatures = useMemo(
    () =>
      turf.featureCollection(
        trackScores.map((s) =>
          turf.point([s.lng, s.lat], {
            station_id: s.station_id,
            river_name: s.river_name,
            risk_score: s.risk_score,
            risk_level: s.risk_level,
            updated_at: s.updated_at,
          }),
        ),
      ),
    [trackScores],
  )

  // --- init map (once) ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
      // 포켓몬고 스타일 뷰 고정: pitch를 INITIAL_VIEW.pitch(45도)로 고정하고,
      // 드래그 회전/피치, 터치 피치/회전 조작을 비활성화한다.
      minPitch: INITIAL_VIEW.pitch,
      maxPitch: INITIAL_VIEW.pitch,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // 🔒 보수적 최소 축소 한계 (부산 도심 3대 하천 권역 밖으로 축소 불가: Zoom 11.8)
      minZoom: 11.8,
      // 🔒 보수적 최대 확대 한계 (과도한 줌 확대 방지: Zoom 16.0)
      maxZoom: 16.0,
      // 🔒 이동 영역 보수적 제한: 온천천·동천·괴정천 도심하천 유역 밖 이동 완전 차단
      maxBounds: BUSAN_MAX_BOUNDS,
    })
    mapRef.current = map
    map.on('error', (e) => console.error('[maplibre error]', e.error?.message ?? e))

    // 터치 회전 조작도 비활성화
    map.touchZoomRotate?.disableRotation()

    // 각도가 고정되어 있으므로 컴퍼스(회전) 버튼을 제외하고 확대/축소 버튼만 표시
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      // "liberty" already ships a 3D-buildings fill-extrusion layer; reuse it
      // instead of stacking a duplicate. Only add a fallback if a future style
      // swap (e.g. back to "dark") doesn't include one.
      if (map.getLayer(NATIVE_BUILDINGS_3D_LAYER_ID)) {
        buildingLayerIdRef.current = NATIVE_BUILDINGS_3D_LAYER_ID
      } else {
        const firstSymbolLayer = map
          .getStyle()
          .layers?.find((l: maplibregl.LayerSpecification) => l.type === 'symbol')?.id
        map.addLayer(
          {
            id: FALLBACK_BUILDINGS_3D_LAYER_ID,
            type: 'fill-extrusion',
            source: 'openmaptiles',
            'source-layer': 'building',
            minzoom: 13,
            paint: {
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
              'fill-extrusion-color': 'hsl(210, 12%, 32%)',
              'fill-extrusion-opacity': 0.75,
            },
          },
          firstSymbolLayer,
        )
        buildingLayerIdRef.current = FALLBACK_BUILDINGS_3D_LAYER_ID
      }

      map.addSource(RIVER_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })
      map.addSource(STATION_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })

      // Soft glow underlay so risk color reads clearly against the basemap
      map.addLayer({
        id: RIVER_GLOW_LAYER_ID,
        type: 'line',
        source: RIVER_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'risk_level'], 'high', RISK_COLORS.high, 'medium', RISK_COLORS.medium, 'low', RISK_COLORS.low, RISK_COLORS.unknown],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 16, 18],
          'line-opacity': 0.3,
          'line-blur': 3,
        },
      })

      map.addLayer({
        id: RIVER_LINE_LAYER_ID,
        type: 'line',
        source: RIVER_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'risk_level'], 'high', RISK_COLORS.high, 'medium', RISK_COLORS.medium, 'low', RISK_COLORS.low, RISK_COLORS.unknown],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 8.5],
          'line-opacity': 0.5,
        },
      })

      map.addLayer({
        id: STATION_LAYER_ID,
        type: 'circle',
        source: STATION_SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 10],
          'circle-color': ['match', ['get', 'risk_level'], 'high', RISK_COLORS.high, 'medium', RISK_COLORS.medium, 'low', RISK_COLORS.low, RISK_COLORS.unknown],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.0,
        },
      })

      map.on('mouseenter', STATION_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', STATION_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('click', STATION_LAYER_ID, (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0]
        if (!feature || feature.geometry.type !== 'Point') return
        const [lng, lat] = feature.geometry.coordinates as [number, number]
        const props = feature.properties as Record<string, unknown>

        selectStation({
          stationId: String(props.station_id),
          riverName: props.river_name as RiverName,
          lng,
          lat,
        })

        popupRef.current?.remove()
        const riskPct = Math.round(Number(props.risk_score) * 100)
        popupRef.current = new maplibregl.Popup({ closeButton: true, offset: 12 })
          .setLngLat([lng, lat])
          .setHTML(
            `<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.5;color:#0b0b0b">
              <strong>${props.station_id}</strong><br/>
              ${props.river_name} · ${TRACK_LABELS[track]}<br/>
              위험도 <strong>${riskPct}%</strong> (${props.risk_level})<br/>
              <span style="color:#666">업데이트: ${new Date(String(props.updated_at)).toLocaleTimeString('ko-KR')}</span>
            </div>`,
          )
          .addTo(map)
      })

      setMapReady(true)
    })

    return () => {
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- push river/station data into the map ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const riverSource = map.getSource(RIVER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const stationSource = map.getSource(STATION_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    riverSource?.setData(riverSegments ?? EMPTY_FC)
    stationSource?.setData(stationFeatures)

    if (!hasFitBounds && riverSegments && riverSegments.features.length > 0) {
      const bbox = turf.bbox(riverSegments)
      map.fitBounds(bbox as [number, number, number, number], { padding: 60, pitch: INITIAL_VIEW.pitch, duration: 0 })
      setHasFitBounds(true)
    }
  }, [mapReady, riverSegments, stationFeatures, hasFitBounds])

  // --- river/station visibility filter ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const rivers = RIVER_NAMES.filter((r) => visibleRivers.has(r))
    const filter = ['in', ['get', 'river_name'], ['literal', rivers]] as maplibregl.FilterSpecification
    map.setFilter(RIVER_LINE_LAYER_ID, filter)
    map.setFilter(RIVER_GLOW_LAYER_ID, filter)
    map.setFilter(STATION_LAYER_ID, filter)
  }, [mapReady, visibleRivers])

  // --- 3D buildings toggle ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setLayoutProperty(buildingLayerIdRef.current, 'visibility', show3dBuildings ? 'visible' : 'none')
  }, [mapReady, show3dBuildings])

  // --- fly-to requests from the control panel ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !flyToRequest) return
    map.flyTo({
      center: [flyToRequest.lng, flyToRequest.lat],
      zoom: flyToRequest.zoom ?? 15,
      pitch: INITIAL_VIEW.pitch,
      duration: 1200,
    })
    flyToTarget(null)
  }, [mapReady, flyToRequest, flyToTarget])

  // --- 3D 캐릭터 표출 시 (Zoom >= 14.5) 캐릭터 정중앙밀착 실시간 추적 ---
  const userLocation = useMapStore((s) => s.userLocation)
  useUserLocation()

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !userLocation) return

    const zoom = map.getZoom()
    // 캐릭터 중심 시점 고정은 오직 최대 확대 한계점(Zoom >= 15.8)에 도달했을 때만 동작
    if (show3dBuildings && zoom >= 15.8) {
      map.easeTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: 16.0,
        pitch: 45,
        bearing: userLocation.heading,
        duration: 150,
        easing: (t) => t,
      })
    }
  }, [mapReady, show3dBuildings, userLocation])

  return (
    <div ref={containerRef} className="map-view">
      <AvatarMarker map={mapRef.current} />
    </div>
  )
}


