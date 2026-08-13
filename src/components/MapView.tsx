import * as turf from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRiskScores } from '../hooks/useRiskScores'
import { useRiverGeometry } from '../hooks/useRiverGeometry'
import {
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
    })
    mapRef.current = map
    map.on('error', (e) => console.error('[maplibre error]', e.error?.message ?? e))

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
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

      // Soft glow underlay so risk color reads clearly against the dark basemap.
      map.addLayer({
        id: RIVER_GLOW_LAYER_ID,
        type: 'line',
        source: RIVER_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'risk_level'], 'high', RISK_COLORS.high, 'medium', RISK_COLORS.medium, 'low', RISK_COLORS.low, RISK_COLORS.unknown],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 16],
          'line-opacity': 0.35,
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 6],
        },
      })

      map.addLayer({
        id: STATION_LAYER_ID,
        type: 'circle',
        source: STATION_SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 9],
          'circle-color': ['match', ['get', 'risk_level'], 'high', RISK_COLORS.high, 'medium', RISK_COLORS.medium, 'low', RISK_COLORS.low, RISK_COLORS.unknown],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
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

  return <div ref={containerRef} className="map-view" />
}
