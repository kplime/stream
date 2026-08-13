/**
 * 역방향 오염원 추적 (Lagrangian 역추적 근사)
 *
 * 원리: 측정소에서 오염이 감지됐을 때, 유속 × 경과시간 = 상류 이동거리
 * 유속은 Manning 방정식 기반 강수량 프록시로 추정
 *
 * 한계: 실제 유속 센서 없음, 확산·분산 무시, 측정소 사이 직선 근사
 * → 해커톤 데모 목적, 과학적 방향성 제시용
 */
import * as turf from '@turf/turf'
import { STATION_COORDS_FALLBACK } from '../hooks/useForecast'
import type { RiverName } from '../types/risk'

// 하천별 측정소 순서: 상류 → 하류
const UPSTREAM_ORDER: Record<RiverName, string[]> = {
  '온천천': ['온천천-327', '온천천-215', '온천천-328', '온천천-216', '온천천-329'],
  '동천':   ['동천-312', '동천-208', '동천-207', '동천-206'],
  '괴정천': ['괴정천-301'], // 단일 측정소 → 상류 방향 근사
}

/**
 * Manning 방정식 기반 유속 추정
 * - 건기 도심 콘크리트 하천: n=0.035, R≈0.4m, S≈0.002 → v_dry ≈ 0.30 m/s
 * - 강수 시 유량 증가: Q ∝ rainfall, v ∝ Q^0.4 (Manning 지수)
 * - 최대값 2.5 m/s (홍수 한계)
 */
export function estimateVelocityMs(rain_mm_per_hr: number): number {
  const v_base = 0.30
  const factor = Math.pow(1 + Math.max(rain_mm_per_hr, 0) / 10, 0.4)
  return Math.min(v_base * factor, 2.5)
}

export interface TrackerZone {
  lookbackHours: number
  distanceKm: number
  sourcePoint: [number, number]     // [lng, lat] — 추정 오염 유입 지점
  segmentCoords: [number, number][] // 강조 표시할 상류 구간 좌표
  label: string
  clamped: boolean                  // true면 최상류에서 막힌 것 (더 upstream 없음)
}

export interface TrackerResult {
  stationId: string
  riverName: string
  stationCoord: [number, number]
  velocityMs: number       // 추정 유속 (m/s)
  rain_mm_per_hr: number   // 입력 강수량
  zones: TrackerZone[]
}

/**
 * 지정 측정소에서 상류로 오염원 역추적
 *
 * @param stationId      감지 측정소 ID (예: '동천-206')
 * @param riverName      하천명
 * @param rain_mm_per_hr 현재 강수량 (mm/h) — 유속 추정에 사용
 * @param lookbackHours  역추적 시간 배열 (기본: 1h, 2h, 3h)
 */
export function traceUpstream(
  stationId: string,
  riverName: RiverName,
  rain_mm_per_hr: number,
  lookbackHours: number[] = [1, 2, 3],
): TrackerResult | null {
  const order = UPSTREAM_ORDER[riverName]
  if (!order) return null

  // 하천 기간선 (상류→하류 순서의 LineString)
  const coords: [number, number][] = []
  for (const sid of order) {
    const c = STATION_COORDS_FALLBACK[sid]
    if (c) coords.push([c.lng, c.lat])
  }

  // 괴정천 단일 측정소: 서쪽으로 1km 상류 지점 추가
  if (coords.length === 1) {
    const upstream: [number, number] = [coords[0][0] + 0.012, coords[0][1]]
    coords.unshift(upstream)
  }
  if (coords.length < 2) return null

  const backbone = turf.lineString(coords)

  const stationC = STATION_COORDS_FALLBACK[stationId]
  if (!stationC) return null

  const stationPt = turf.point([stationC.lng, stationC.lat])
  const snapped = turf.nearestPointOnLine(backbone, stationPt)
  const stationDistKm = snapped.properties.location ?? 0

  const velocity = estimateVelocityMs(rain_mm_per_hr)

  const zones: TrackerZone[] = lookbackHours.map((hours) => {
    const rawDistKm = (velocity * hours * 3600) / 1000
    // 상류 = line 시작(index 0) 방향 → km 빼기
    const upstreamDistKm = Math.max(stationDistKm - rawDistKm, 0)
    const clamped = upstreamDistKm === 0 && stationDistKm < rawDistKm

    let sourcePoint: [number, number]
    try {
      sourcePoint = turf.along(backbone, upstreamDistKm).geometry.coordinates as [number, number]
    } catch {
      sourcePoint = coords[0]
    }

    let segmentCoords: [number, number][]
    try {
      const seg = turf.lineSliceAlong(backbone, upstreamDistKm, stationDistKm)
      segmentCoords = seg.geometry.coordinates as [number, number][]
    } catch {
      segmentCoords = [coords[0], [stationC.lng, stationC.lat]]
    }

    const distM = Math.round(rawDistKm * 1000)
    const distStr = distM >= 1000 ? `${rawDistKm.toFixed(1)}km` : `${distM}m`
    const label = clamped
      ? `${hours}h 역추적 — 최상류 도달 (${distStr} 이상)`
      : `${hours}h 전 — ${distStr} 상류`

    return { lookbackHours: hours, distanceKm: rawDistKm, sourcePoint, segmentCoords, label, clamped }
  })

  return { stationId, riverName, stationCoord: [stationC.lng, stationC.lat], velocityMs: velocity, rain_mm_per_hr, zones }
}
