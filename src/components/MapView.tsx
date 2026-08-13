import * as turf from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATION_COORDS_FALLBACK, useForecast } from '../hooks/useForecast'
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
  SHAP_LABELS,
  STATION_LAYER_A_ID,
  STATION_LAYER_B_ID,
  STATION_SOURCE_A_ID,
  STATION_SOURCE_B_ID,
} from '../lib/mapStyle'
import { buildRiskSegments } from '../lib/riverSegments'
import { useMapStore } from '../store/useMapStore'
import { RIVER_NAMES, RIVER_PRIMARY_TRACK, TRACK_LABELS, type RiverName, type RiskLevel, type RiskScore, type Track } from '../types/risk'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

// SHAP 팝업 HTML 생성
function buildShapHtml(shapRaw: string | null | undefined, track: 'A' | 'B'): string {
  if (!shapRaw) return ''
  let shap: Record<string, number>
  try { shap = JSON.parse(shapRaw) } catch { return '' }

  const sorted = Object.entries(shap)
    .map(([k, v]) => ({ key: k, val: Number(v), abs: Math.abs(Number(v)) }))
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 5)

  const maxAbs = sorted[0]?.abs ?? 1
  const label = TRACK_LABELS[track]
  const rows = sorted.map(({ key, val, abs }) => {
    const pct = Math.round((abs / maxAbs) * 100)
    const color = val > 0 ? '#d03b3b' : '#0ca30c'
    const sign = val > 0 ? '▲' : '▼'
    const name = SHAP_LABELS[key] ?? key
    return `<div style="display:flex;align-items:center;gap:6px;margin:3px 0">
      <span style="font-size:10px;color:${color};width:12px">${sign}</span>
      <span style="font-size:11px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>
      <div style="width:${pct}px;max-width:80px;height:6px;background:${color};border-radius:3px;opacity:0.75"></div>
      <span style="font-size:10px;color:#888;width:36px;text-align:right">${val > 0 ? '+' : ''}${val.toFixed(3)}</span>
    </div>`
  }).join('')

  return `<div style="margin-top:8px;border-top:1px solid #eee;padding-top:6px">
    <div style="font-size:11px;font-weight:700;color:#555;margin-bottom:4px">${label} 판단 요소</div>
    ${rows}
  </div>`
}

// 팝업 HTML 전체 생성
// liveScores: 실시간 scores — 예보 모드에서 SHAP 값 보완용 (forecast엔 SHAP 없음)
function buildPopupHtml(
  props: Record<string, unknown>,
  allScores: RiskScore[],
  liveScores?: RiskScore[],
): string {
  const stationId = String(props.station_id ?? '')
  const riverName = String(props.river_name ?? '')
  const updatedAt = String(props.updated_at ?? '')

  // 현재 표시 중인 위험도 (forecast or live)
  const stationScores = allScores.filter((s) => s.station_id === stationId)
  const scoreA = stationScores.find((s) => s.track === 'A')
  const scoreB = stationScores.find((s) => s.track === 'B')

  // SHAP은 실시간 scores에서 조회 (forecast에 없는 경우 fallback)
  const shapSource = (liveScores ?? allScores).filter((s) => s.station_id === stationId)
  const liveA = shapSource.find((s) => s.track === 'A')
  const liveB = shapSource.find((s) => s.track === 'B')

  const riskBadge = (level: string, pct: number) => {
    const colors: Record<string, string> = { high: '#d03b3b', medium: '#fab219', low: '#0ca30c' }
    const c = colors[level] ?? '#888'
    return `<span style="background:${c};color:#fff;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700">${pct}%</span>`
  }

  const timeStr = (() => {
    try {
      const dt = new Date(updatedAt)
      if (isNaN(dt.getTime())) return ''
      const diffMin = Math.round((Date.now() - dt.getTime()) / 60000)
      if (diffMin < -1) {
        // 미래 시간 → 예보
        const h = Math.round(-diffMin / 60)
        return h >= 1 ? `+${h}시간 후 예보` : `약 ${-diffMin}분 후 예보`
      }
      return diffMin < 60 ? `${diffMin}분 전` : `${Math.round(diffMin / 60)}시간 전`
    } catch { return '' }
  })()

  // Supabase JSONB → string 또는 object 어느 쪽으로도 올 수 있어 양쪽 처리
  const toShapStr = (s: RiskScore | undefined) => {
    if (!s?.shap) return null
    if (typeof s.shap === 'string') return s.shap   // 이미 JSON 문자열
    return JSON.stringify(s.shap)                   // 객체면 직렬화
  }
  // SHAP: 실시간 scores 우선, 없으면 forecast scores에서 시도
  const shapA = toShapStr(liveA) ?? toShapStr(scoreA)
  const shapB = toShapStr(liveB) ?? toShapStr(scoreB)

  return `<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.5;color:#1a1a1a;min-width:220px;max-width:280px">
    <div style="font-weight:700;font-size:14px;margin-bottom:6px">${stationId}</div>
    <div style="color:#666;font-size:11px;margin-bottom:8px">${riverName} · ${timeStr}</div>

    <div style="display:flex;flex-direction:column;gap:6px">
      ${scoreA ? `<div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:#555;width:80px">🦠 대장균위험</span>
        ${riskBadge(scoreA.risk_level, Math.round(scoreA.risk_score * 100))}
      </div>` : ''}
      ${scoreB ? `<div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:#555;width:80px">🐟 폐사위험</span>
        ${riskBadge(scoreB.risk_level, Math.round(scoreB.risk_score * 100))}
      </div>` : ''}
    </div>

    ${buildShapHtml(shapA, 'A')}
    ${buildShapHtml(shapB, 'B')}
  </div>`
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const buildingLayerIdRef = useRef<string>(NATIVE_BUILDINGS_3D_LAYER_ID)
  const scoresRef = useRef<RiskScore[]>([])      // 표시 scores (forecast or live)
  const liveScoresRef = useRef<RiskScore[]>([])  // 항상 실시간 scores (SHAP 조회용)
  const [mapReady, setMapReady] = useState(false)
  const [hasFitBounds, setHasFitBounds] = useState(false)

  const visibleRivers = useMapStore((s) => s.visibleRivers)
  const show3dBuildings = useMapStore((s) => s.show3dBuildings)
  const selectStation = useMapStore((s) => s.selectStation)
  const flyToTarget = useMapStore((s) => s.flyTo)
  const flyToRequest = useMapStore((s) => s.flyToTarget)
  const forecastHour = useMapStore((s) => s.forecastHour)

  const { data: riverGeometry } = useRiverGeometry()
  const { data: scores } = useRiskScores()
  const { data: forecast } = useForecast()

  // 측정소 lat/lng 조회용 맵 (forecast에는 좌표 없음)
  const stationCoords = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; river_name: string }>()
    for (const s of scores ?? []) {
      if (!m.has(s.station_id)) m.set(s.station_id, { lat: s.lat, lng: s.lng, river_name: s.river_name })
    }
    return m
  }, [scores])

  // 예측 모드면 해당 시간 forecast 데이터, 아니면 실시간 scores
  const displayScores = useMemo((): RiskScore[] => {
    if (!forecastHour || !forecast?.length) return scores ?? []
    return forecast
      .filter((f) => f.hours_ahead === forecastHour)
      .map((f) => {
        const live = stationCoords.get(f.station_id)
        const fallback = STATION_COORDS_FALLBACK[f.station_id]
        const coords = live ?? (fallback ? { ...fallback, river_name: f.river_name } : { lat: 0, lng: 0, river_name: f.river_name })
        return {
          station_id: f.station_id,
          river_name: coords.river_name as RiverName,
          track: f.track as Track,
          lat: coords.lat,
          lng: coords.lng,
          risk_score: f.risk_score,
          risk_level: f.risk_level as RiskLevel,
          updated_at: f.forecast_dt,
        }
      })
  }, [forecastHour, forecast, scores, stationCoords])

  // scoresRef: 클릭 핸들러에서 항상 최신 데이터 참조
  useEffect(() => { scoresRef.current = displayScores }, [displayScores])
  // liveScoresRef: 예보 모드에서도 SHAP 조회를 위해 실시간 scores 유지
  useEffect(() => { liveScoresRef.current = scores ?? [] }, [scores])

  const lineScores = useMemo(
    () => displayScores.filter((s) => RIVER_PRIMARY_TRACK[s.river_name as RiverName] === s.track),
    [displayScores],
  )

  // Track A 스테이션 (대장균) — 작은 원
  const stationFeaturesA = useMemo(
    () =>
      turf.featureCollection(
        displayScores
          .filter((s) => s.track === 'A' && s.lat !== 0 && s.lng !== 0)
          .map((s) =>
            turf.point([s.lng, s.lat], {
              station_id: s.station_id,
              river_name: s.river_name,
              track: 'A',
              risk_score: s.risk_score,
              risk_level: s.risk_level,
              updated_at: s.updated_at,
            }),
          ),
      ),
    [displayScores],
  )

  // Track B 스테이션 (폐사위험) — 큰 원
  const stationFeaturesB = useMemo(
    () =>
      turf.featureCollection(
        displayScores
          .filter((s) => s.track === 'B' && s.lat !== 0 && s.lng !== 0)
          .map((s) =>
            turf.point([s.lng, s.lat], {
              station_id: s.station_id,
              river_name: s.river_name,
              track: 'B',
              risk_score: s.risk_score,
              risk_level: s.risk_level,
              updated_at: s.updated_at,
            }),
          ),
      ),
    [displayScores],
  )

  const riverSegments = useMemo(() => {
    if (!riverGeometry) return null
    return buildRiskSegments(riverGeometry, lineScores)
  }, [riverGeometry, lineScores])

  // --- init map (once) ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!gl) {
      console.warn('[MapView] WebGL not supported — map disabled')
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
    })
    mapRef.current = map
    ;(window as unknown as Record<string, unknown>)['__map'] = map
    map.on('error', (e) => console.error('[maplibre error]', e.error?.message ?? e))

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
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
      map.addSource(STATION_SOURCE_A_ID, { type: 'geojson', data: EMPTY_FC })
      map.addSource(STATION_SOURCE_B_ID, { type: 'geojson', data: EMPTY_FC })

      // 하천선
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

      // Track B (폐사) — 큰 원, 흰 테두리 2px
      map.addLayer({
        id: STATION_LAYER_B_ID,
        type: 'circle',
        source: STATION_SOURCE_B_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 13],
          'circle-color': ['match', ['get', 'risk_level'], 'high', RISK_COLORS.high, 'medium', RISK_COLORS.medium, 'low', RISK_COLORS.low, RISK_COLORS.unknown],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.85,
        },
      })

      // Track A (대장균) — 작은 원, 노란 테두리
      map.addLayer({
        id: STATION_LAYER_A_ID,
        type: 'circle',
        source: STATION_SOURCE_A_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 9],
          'circle-color': ['match', ['get', 'risk_level'], 'high', RISK_COLORS.high, 'medium', RISK_COLORS.medium, 'low', RISK_COLORS.low, RISK_COLORS.unknown],
          'circle-stroke-color': '#ffe87c',
          'circle-stroke-width': 1.5,
        },
      })

      // 커서 변경 (MapLibre 이벤트)
      const clickableLayers = [STATION_LAYER_A_ID, STATION_LAYER_B_ID] as const
      for (const layerId of clickableLayers) {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
      }
      // 클릭은 React div onClick으로 처리 (아래 handleMapClick)

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


  // --- 데이터 업데이트 ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const riverSource = map.getSource(RIVER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const srcA = map.getSource(STATION_SOURCE_A_ID) as maplibregl.GeoJSONSource | undefined
    const srcB = map.getSource(STATION_SOURCE_B_ID) as maplibregl.GeoJSONSource | undefined

    riverSource?.setData(riverSegments ?? EMPTY_FC)
    srcA?.setData(stationFeaturesA)
    srcB?.setData(stationFeaturesB)

    if (!hasFitBounds && riverSegments && riverSegments.features.length > 0) {
      const bbox = turf.bbox(riverSegments)
      map.fitBounds(bbox as [number, number, number, number], { padding: 60, pitch: INITIAL_VIEW.pitch, duration: 0 })
      setHasFitBounds(true)
    }
  }, [mapReady, riverSegments, stationFeaturesA, stationFeaturesB, hasFitBounds])

  // --- 하천 가시성 필터 ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const rivers = RIVER_NAMES.filter((r) => visibleRivers.has(r))
    const filter = ['in', ['get', 'river_name'], ['literal', rivers]] as maplibregl.FilterSpecification
    map.setFilter(RIVER_LINE_LAYER_ID, filter)
    map.setFilter(RIVER_GLOW_LAYER_ID, filter)
    map.setFilter(STATION_LAYER_A_ID, filter)
    map.setFilter(STATION_LAYER_B_ID, filter)
  }, [mapReady, visibleRivers])

  // --- 3D 건물 토글 ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setLayoutProperty(buildingLayerIdRef.current, 'visibility', show3dBuildings ? 'visible' : 'none')
  }, [mapReady, show3dBuildings])

  // --- fly-to ---
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

  // --- React 클릭 핸들러 (MapLibre 이벤트 대신 사용 — 3D pitch 환경에서 신뢰성 높음) ---
  const handleMapClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const map = mapRef.current
    if (!map || !mapReady) return

    // 캔버스 내 픽셀 좌표 → 지리 좌표
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const lngLat = map.unproject([x, y])

    const allScores = scoresRef.current
    if (!allScores.length) return

    // 가장 가까운 측정소 탐색 (station_id 기준 유니크)
    const seen = new Set<string>()
    const locs: { s: RiskScore; dist: number }[] = []
    for (const s of allScores) {
      if (seen.has(s.station_id)) continue
      seen.add(s.station_id)
      const dist = Math.sqrt((s.lng - lngLat.lng) ** 2 + (s.lat - lngLat.lat) ** 2)
      locs.push({ s, dist })
    }
    locs.sort((a, b) => a.dist - b.dist)

    // 줌에 따른 임계값 (~20 픽셀 거리)
    const mpp = 156543.03392 * Math.cos((lngLat.lat * Math.PI) / 180) / (2 ** map.getZoom())
    const threshold = (mpp * 20) / 111320
    const nearest = locs[0]
    if (!nearest || nearest.dist > threshold) return

    const { s } = nearest
    selectStation({ stationId: s.station_id, riverName: s.river_name as RiverName, lng: s.lng, lat: s.lat })

    const props: Record<string, unknown> = {
      station_id: s.station_id,
      river_name: s.river_name,
      track: s.track,
      risk_score: s.risk_score,
      risk_level: s.risk_level,
      updated_at: s.updated_at,
    }

    popupRef.current?.remove()
    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      anchor: 'bottom',
      offset: [0, -14],
      maxWidth: '300px',
    })
      .setLngLat([s.lng, s.lat])
      .setHTML(buildPopupHtml(props, allScores, liveScoresRef.current))
      .addTo(map)
  }, [mapReady, selectStation])

  return <div ref={containerRef} className="map-view" onClick={handleMapClick} />
}
