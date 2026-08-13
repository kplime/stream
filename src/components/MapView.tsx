import * as turf from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDisplayScores } from '../hooks/useDisplayScores'
import { useForecast } from '../hooks/useForecast'
import { useRiverGeometry } from '../hooks/useRiverGeometry'
import { useWeather } from '../hooks/useWeather'
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
  SHAP_LABELS,
  STATION_LAYER_A_ID,
  STATION_LAYER_B_ID,
  STATION_SOURCE_A_ID,
  STATION_SOURCE_B_ID,
  TRACKER_LINE_LAYER_ID,
  TRACKER_POINT_LAYER_ID,
  TRACKER_POINT_SOURCE_ID,
  TRACKER_SOURCE_ID,
} from '../lib/mapStyle'
import { traceUpstream, type TrackerResult } from '../lib/pollutionTracker'
import { buildRiskSegments } from '../lib/riverSegments'
import { useMapStore } from '../store/useMapStore'
import { RIVER_NAMES, RIVER_PRIMARY_TRACK, TRACK_LABELS, type RiverName, type RiskScore } from '../types/risk'

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
    // 막대 길이만 데이터에 따라 달라지므로 그것만 인라인으로 둔다
    const pct = Math.round((abs / maxAbs) * 100)
    const dir = val > 0 ? 'up' : 'down'
    const sign = val > 0 ? '▲' : '▼'
    const name = SHAP_LABELS[key] ?? key
    return `<div class="wq-shap__row">
      <span class="wq-shap__sign wq-shap__sign--${dir}">${sign}</span>
      <span class="wq-shap__name">${name}</span>
      <span class="wq-shap__track">
        <span class="wq-shap__bar wq-shap__bar--${dir}" style="width:${pct}%"></span>
      </span>
      <span class="wq-shap__val">${val > 0 ? '+' : ''}${val.toFixed(3)}</span>
    </div>`
  }).join('')

  return `<div class="wq-shap">
    <div class="wq-shap__title">${label} 판단 요소</div>
    ${rows}
  </div>`
}

// 팝업 HTML 전체 생성
// stationId만 받아 allScores에서 조회한다 — 슬라이더로 시점이 바뀌면
// 같은 stationId로 다시 호출해 팝업 내용을 갱신할 수 있어야 하기 때문.
// liveScores: 실시간 scores — 예보 행에 SHAP이 없을 때의 대체용
function buildPopupHtml(
  stationId: string,
  allScores: RiskScore[],
  liveScores?: RiskScore[],
): string {
  // 현재 표시 중인 위험도 (forecast or live)
  const stationScores = allScores.filter((s) => s.station_id === stationId)
  const scoreA = stationScores.find((s) => s.track === 'A')
  const scoreB = stationScores.find((s) => s.track === 'B')

  const ref = scoreA ?? scoreB
  const riverName = ref?.river_name ?? ''
  const updatedAt = ref?.updated_at ?? ''

  // SHAP은 실시간 scores에서 조회 (forecast에 없는 경우 fallback)
  const shapSource = (liveScores ?? allScores).filter((s) => s.station_id === stationId)
  const liveA = shapSource.find((s) => s.track === 'A')
  const liveB = shapSource.find((s) => s.track === 'B')

  // 위험도 배지는 상태 표시라 유리 톤에 묻히지 않도록 채도를 유지한다
  const riskBadge = (level: string, pct: number) =>
    `<span class="wq-badge wq-badge--${level}">${pct}%</span>`

  // updated_at이 미래면 예보 시점을 보고 있는 것
  const isForecast = (() => {
    const dt = new Date(updatedAt)
    return !isNaN(dt.getTime()) && dt.getTime() - Date.now() > 60_000
  })()

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
  // SHAP: 현재 표시 중인 시점의 SHAP을 우선한다.
  // 예보 모드에서 실시간 SHAP을 먼저 쓰면 시간이 바뀌어도 판단 요소가
  // 고정되어 보이므로, 예보 행에 shap이 있으면 그것을 쓰고 없을 때만 대체한다.
  const shapA = toShapStr(scoreA) ?? toShapStr(liveA)
  const shapB = toShapStr(scoreB) ?? toShapStr(liveB)
  // 예보 시점인데 예보 SHAP이 없어 실시간 값으로 대체한 경우 표시용 플래그
  const shapIsFallback =
    !toShapStr(scoreA) && !toShapStr(scoreB) && Boolean(toShapStr(liveA) || toShapStr(liveB))

  // 오염원 역추적 버튼 (medium 이상 위험도일 때 표시)
  const maxRiskLevel = scoreA?.risk_level === 'high' || scoreB?.risk_level === 'high'
    ? 'high'
    : scoreA?.risk_level === 'medium' || scoreB?.risk_level === 'medium'
      ? 'medium'
      : 'low'
  const showTrackerBtn = maxRiskLevel !== 'low'
  // event.stopPropagation(): 클릭이 지도 컨테이너로 전파되면 handleMapClick이
  // 팝업을 지우고 다시 만들어버리므로 반드시 막아야 한다.
  const trackerBtn = showTrackerBtn
    ? `<button class="wq-trace-btn"
        onclick="event.stopPropagation();window.__tracePollution('${stationId}', '${riverName}')">
        🔍 오염원 역추적
      </button>`
    : ''

  return `<div class="wq-popup">
    <div class="wq-popup__station">${stationId}</div>
    <div class="wq-popup__meta">${riverName} · ${timeStr}</div>

    <div class="wq-popup__risks">
      ${scoreA ? `<div class="wq-popup__risk-row">
        <span class="wq-popup__risk-label">🦠 대장균위험</span>
        ${riskBadge(scoreA.risk_level, Math.round(scoreA.risk_score * 100))}
      </div>` : ''}
      ${scoreB ? `<div class="wq-popup__risk-row">
        <span class="wq-popup__risk-label">🐟 폐사위험</span>
        ${riskBadge(scoreB.risk_level, Math.round(scoreB.risk_score * 100))}
      </div>` : ''}
    </div>

    ${buildShapHtml(shapA, 'A')}
    ${buildShapHtml(shapB, 'B')}
    ${isForecast && shapIsFallback
      ? `<div class="wq-popup__note">※ 판단 요소는 현재 실측 기준입니다 (예보 시점별 SHAP 미저장)</div>`
      : ''}
    ${trackerBtn}
  </div>`
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const openStationRef = useRef<string | null>(null)  // 열린 팝업의 측정소 (시점 변경 시 갱신용)
  const buildingLayerIdRef = useRef<string>(NATIVE_BUILDINGS_3D_LAYER_ID)
  const scoresRef = useRef<RiskScore[]>([])      // 표시 scores (forecast or live)
  const liveScoresRef = useRef<RiskScore[]>([])  // 항상 실시간 scores (SHAP 조회용)
  const weatherRef = useRef<number>(0)           // 현재 강수량 (역추적 유속 계산용)
  const [mapReady, setMapReady] = useState(false)
  const [hasFitBounds, setHasFitBounds] = useState(false)
  const [trackerResult, setTrackerResult] = useState<TrackerResult | null>(null)
  const [activeTrackerZone, setActiveTrackerZone] = useState<number>(1) // 선택된 역추적 시간(h)

  const visibleRivers = useMapStore((s) => s.visibleRivers)
  const show3dBuildings = useMapStore((s) => s.show3dBuildings)
  const selectStation = useMapStore((s) => s.selectStation)
  const flyToTarget = useMapStore((s) => s.flyTo)
  const flyToRequest = useMapStore((s) => s.flyToTarget)
  const forecastHour = useMapStore((s) => s.forecastHour)

  const { data: riverGeometry } = useRiverGeometry()
  const { data: forecast } = useForecast()
  const { data: weather } = useWeather()
  // 시간 슬라이더가 반영된 표시용 위험도 (ControlPanel과 동일한 소스)
  const { displayScores, liveScores } = useDisplayScores()

  // scoresRef: 클릭 핸들러에서 항상 최신 데이터 참조
  useEffect(() => { scoresRef.current = displayScores }, [displayScores])
  // liveScoresRef: 예보 행에 SHAP이 없을 때의 대체용
  useEffect(() => { liveScoresRef.current = liveScores }, [liveScores])
  // 역추적 유속 계산에 쓸 강수량
  // 예보 모드에서는 해당 시점의 예보 강수량을, 실시간 모드에서는 현재 관측값을 쓴다
  const effectiveRainMm = useMemo(() => {
    if (forecastHour && forecast?.length) {
      const pt = forecast.find((f) => f.hours_ahead === forecastHour && f.rain_mm != null)
      if (pt) return pt.rain_mm
    }
    return weather?.precipitation_mm ?? 0
  }, [forecastHour, forecast, weather])

  useEffect(() => { weatherRef.current = effectiveRainMm }, [effectiveRainMm])

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
    ;(window as unknown as Record<string, unknown>)['__map'] = map
    map.on('error', (e) => console.error('[maplibre error]', e.error?.message ?? e))

    // 터치 회전 조작도 비활성화
    map.touchZoomRotate?.disableRotation()

    // 각도가 고정되어 있으므로 컴퍼스(회전) 버튼을 제외하고 확대/축소 버튼만 표시
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
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

      // 오염원 역추적 레이어
      map.addSource(TRACKER_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })
      map.addSource(TRACKER_POINT_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: TRACKER_LINE_LAYER_ID,
        type: 'line',
        source: TRACKER_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#f97316',
          'line-width': 5,
          'line-opacity': 0.85,
          'line-dasharray': [2, 2],
        },
      })
      map.addLayer({
        id: TRACKER_POINT_LAYER_ID,
        type: 'circle',
        source: TRACKER_POINT_SOURCE_ID,
        paint: {
          'circle-radius': 10,
          'circle-color': '#f97316',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2.5,
          'circle-opacity': 0.9,
        },
      })

      // 하천선 — Soft glow underlay so risk color reads clearly against the basemap
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 10],
          'circle-color': ['match', ['get', 'risk_level'], 'high', RISK_COLORS.high, 'medium', RISK_COLORS.medium, 'low', RISK_COLORS.low, RISK_COLORS.unknown],
          // Track B는 흰 테두리 — A만 노란 테두리로 두 트랙을 구분한다
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

  // --- 팝업 버튼 → 역추적 핸들러 등록 ---
  // 팝업은 HTML 문자열이라 React 핸들러를 붙일 수 없어 전역 함수로 연결한다.
  // riverGeometry가 로드된 뒤 최신 값을 참조하도록 별도 effect로 분리.
  useEffect(() => {
    if (!mapReady) return
    const w = window as unknown as Record<string, unknown>
    w['__tracePollution'] = (stationId: string, riverName: string) => {
      const result = traceUpstream(
        stationId,
        riverName as RiverName,
        riverGeometry,
        weatherRef.current,
      )
      if (!result) {
        console.warn('[tracker] 역추적 실패 — 유로 데이터 없음:', riverName)
        return
      }
      setTrackerResult(result)
      setActiveTrackerZone(result.zones[0]?.lookbackHours ?? 1)
    }
    return () => { delete w['__tracePollution'] }
  }, [mapReady, riverGeometry])

  // --- 오염원 역추적 존 전환 시 지도 업데이트 ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !trackerResult) return
    const zone = trackerResult.zones.find((z) => z.lookbackHours === activeTrackerZone) ?? trackerResult.zones[0]
    if (!zone) return
    const trackerSrc = map.getSource(TRACKER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const trackerPtSrc = map.getSource(TRACKER_POINT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    trackerSrc?.setData(turf.featureCollection([turf.lineString(zone.segmentCoords)]))
    trackerPtSrc?.setData(turf.featureCollection([turf.point(zone.sourcePoint, { label: zone.label })]))
  }, [mapReady, trackerResult, activeTrackerZone])

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

  // 위치 정보 기능 제거: GPS 추적(useUserLocation)과 사용자 위치 기반 카메라
  // 자동 추종을 걷어냈다. 브라우저 위치 권한 요청도 더 이상 발생하지 않는다.

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

    // 열린 팝업의 대상을 기억해 둔다.
    // 시간 슬라이더로 displayScores가 바뀌면 아래 effect가 이 값으로 팝업을 다시 그린다.
    openStationRef.current = s.station_id

    popupRef.current?.remove()
    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      anchor: 'bottom',
      offset: [0, -14],
      maxWidth: '300px',
      // 전용 클래스로 특이도를 확보한다. maplibre-gl.css가 번들에서 App.css보다
      // 뒤에 실려서, 같은 특이도로는 배경(#fff)·모서리·패딩이 기본값으로 덮인다.
      className: 'wq-map-popup',
    })
      .setLngLat([s.lng, s.lat])
      .setHTML(buildPopupHtml(s.station_id, allScores, liveScoresRef.current))
      .addTo(map)

    // 닫으면 추적 대상 해제 — 닫힌 팝업을 갱신하려 들지 않도록
    popupRef.current.on('close', () => { openStationRef.current = null })
  }, [mapReady, selectStation])

  // --- 시간 슬라이더 변경 시 열린 팝업 갱신 ---
  // 팝업은 HTML 문자열이라 클릭 시점 내용으로 동결된다.
  // 갱신하지 않으면 슬라이더를 움직여도 위험도와 판단 요소가 그대로 남는다.
  useEffect(() => {
    const popup = popupRef.current
    const stationId = openStationRef.current
    if (!popup || !stationId || !popup.isOpen()) return
    popup.setHTML(buildPopupHtml(stationId, displayScores, liveScoresRef.current))
  }, [displayScores])

  const clearTracker = () => {
    setTrackerResult(null)
    const map = mapRef.current
    if (!map) return
    const trackerSrc = map.getSource(TRACKER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const trackerPtSrc = map.getSource(TRACKER_POINT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    trackerSrc?.setData(EMPTY_FC)
    trackerPtSrc?.setData(EMPTY_FC)
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} className="map-view" onClick={handleMapClick} />

      {/* AvatarMarker는 렌더하지 않는다 — 사용자 GPS 위치에 붙어 있던
          컴포넌트라 위치 기능을 뺀 지금은 표시할 좌표 자체가 없다.
          고정 지점에 세우고 싶으면 좌표를 넘겨 되살릴 수 있다. */}

      {/* 역추적 결과 오버레이 패널 */}
      {trackerResult && (
        // 위치·크기는 CSS로 뺐다. 인라인 스타일은 미디어쿼리로 덮을 수 없어
        // 좁은 화면에서 시간 슬라이더와 겹쳐도 손댈 방법이 없었다.
        <div className="tracker-panel">
          {/* 헤더 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: '#f97316' }}>
              🔍 오염원 역추적
            </span>
            <button
              type="button"
              onClick={clearTracker}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px', padding: 0 }}
            >
              ✕
            </button>
          </div>

          {/* 측정소·유속 정보 */}
          <div style={{ marginBottom: '10px', color: '#94a3b8', fontSize: '12px' }}>
            <div><span style={{ color: '#cbd5e1' }}>측정소:</span> {trackerResult.stationId}</div>
            <div style={{ marginTop: '3px' }}>
              <span style={{ color: '#cbd5e1' }}>추정 유속:</span>{' '}
              <span style={{ color: '#f97316', fontWeight: 600 }}>
                {trackerResult.velocityMs.toFixed(2)} m/s
              </span>
              <span style={{ marginLeft: '6px', color: '#64748b' }}>
                (강수 {trackerResult.rain_mm_per_hr.toFixed(1)} mm/h · Manning 추정)
              </span>
            </div>
            <div style={{ marginTop: '3px' }}>
              <span style={{ color: '#cbd5e1' }}>추적 가능 상류:</span>{' '}
              {trackerResult.upstreamAvailableKm.toFixed(2)} km
            </div>
          </div>

          {/* 역추적 시간 선택 */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            {trackerResult.zones.map((z) => (
              <button
                key={z.lookbackHours}
                type="button"
                onClick={() => setActiveTrackerZone(z.lookbackHours)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  borderRadius: '6px',
                  border: `1.5px solid ${activeTrackerZone === z.lookbackHours ? '#f97316' : '#334155'}`,
                  background: activeTrackerZone === z.lookbackHours ? 'rgba(249,115,22,0.18)' : 'transparent',
                  color: activeTrackerZone === z.lookbackHours ? '#f97316' : '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: activeTrackerZone === z.lookbackHours ? 700 : 400,
                }}
              >
                -{z.lookbackHours}h
              </button>
            ))}
          </div>

          {/* 선택된 존 정보 */}
          {(() => {
            const zone = trackerResult.zones.find((z) => z.lookbackHours === activeTrackerZone) ?? trackerResult.zones[0]
            if (!zone) return null
            const distM = Math.round(zone.distanceKm * 1000)
            const distStr = distM >= 1000 ? `${zone.distanceKm.toFixed(1)}km` : `${distM}m`
            const [lng, lat] = zone.sourcePoint
            return (
              <div style={{ background: 'rgba(249,115,22,0.1)', borderRadius: '8px', padding: '10px', border: '1px solid rgba(249,115,22,0.25)' }}>
                <div style={{ fontWeight: 700, marginBottom: '6px', color: '#fed7aa' }}>
                  {activeTrackerZone}시간 전 추정 유입 지점
                </div>
                <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.7 }}>
                  <div>이동거리: <span style={{ color: '#f1f5f9' }}>{distStr} 상류</span></div>
                  <div>좌표: <span style={{ color: '#f1f5f9' }}>{lat.toFixed(4)}°N, {lng.toFixed(4)}°E</span></div>
                  {zone.clamped && (
                    <div style={{ marginTop: '4px', color: '#fbbf24', fontSize: '11px' }}>
                      ⚠ 측정망 상류 한계 — 실제 오염원은 더 상류일 수 있음
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* 면책 고지 */}
          <div style={{ marginTop: '10px', fontSize: '10px', color: '#475569', lineHeight: 1.5 }}>
            ※ Manning 방정식 기반 유속 추정, 실제 유속 센서 미설치<br/>
            오염원 위치 ±20~40% 오차 예상 (참고용)
          </div>
        </div>
      )}
    </div>
  )
}


