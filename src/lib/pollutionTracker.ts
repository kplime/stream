/**
 * 역방향 오염원 추적 (Lagrangian 역추적 근사)
 *
 * 원리: 측정소에서 오염이 감지됐을 때, 유속 × 경과시간 = 상류 이동거리
 * 유속은 Manning 방정식 기반 강수량 프록시로 추정
 *
 * 추적 경로는 OSM 실제 하천 유로(riverGeometry)를 사용한다.
 * 측정소를 직선으로 이은 근사는 온천천 기준 사행도 1.65배 오차가 발생하고
 * 추정 지점이 하천 밖에 찍히므로 사용하지 않는다.
 *
 * 한계: 실제 유속 센서 없음, 확산·분산 무시, 지류 유입 미고려
 * → 해커톤 데모 목적, 과학적 방향성 제시용
 */
import * as turf from '@turf/turf'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import { STATION_COORDS_FALLBACK } from '../hooks/useForecast'
import type { RiverName } from '../types/risk'

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

const distM = (a: number[], b: number[]) =>
  turf.distance(turf.point(a), turf.point(b)) * 1000

/**
 * OSM way 세그먼트들을 하나의 연속 유로로 이어붙인다.
 * 끝점이 tolM 이내면 연결된 것으로 보고, 방향이 반대인 세그먼트는 뒤집어 붙인다.
 * 본류에 연결되지 않는 지류는 버린다 (가장 긴 체인만 사용).
 */
function stitchSegments(features: FeatureCollection<LineString>['features'], tolM = 30): number[][] | null {
  const segs = features
    .map((f) => f.geometry.coordinates.slice() as number[][])
    .filter((c) => c.length >= 2)
  if (!segs.length) return null

  let chain = segs.shift() as number[][]
  let progress = true
  while (segs.length && progress) {
    progress = false
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      const head = chain[0]
      const tail = chain[chain.length - 1]
      const sH = s[0]
      const sT = s[s.length - 1]
      if (distM(tail, sH) < tolM) {
        chain = chain.concat(s.slice(1))
      } else if (distM(tail, sT) < tolM) {
        chain = chain.concat(s.slice().reverse().slice(1))
      } else if (distM(head, sT) < tolM) {
        chain = s.slice(0, -1).concat(chain)
      } else if (distM(head, sH) < tolM) {
        chain = s.slice().reverse().slice(0, -1).concat(chain)
      } else {
        continue
      }
      segs.splice(i, 1)
      progress = true
      break
    }
  }
  return chain.length >= 2 ? chain : null
}

/**
 * 하천별 하구(합류·유입 지점) 좌표.
 *
 * 방향 판정을 "가장 상류 측정소에 가까운 끝"으로 하면 안 된다.
 * 괴정천은 측정소가 1개뿐이고 그마저 유로 중간(3.4km 지점)에 있어
 * 판정이 뒤집히고 하류 방향으로 역추적되는 버그가 발생한다.
 * 하구는 항상 유로의 끝이므로 이 기준이 측정소 배치와 무관하게 안전하다.
 */
const RIVER_MOUTH: Record<RiverName, [number, number]> = {
  '온천천': [129.0825, 35.1970], // 수영강 합류부 (남단)
  '동천':   [129.0662, 35.1291], // 부산북항 유입부 (남단)
  '괴정천': [128.9633, 35.1049], // 낙동강 하구 방면 (서단)
}

/**
 * 유로를 상류→하류 방향으로 정렬한다.
 * 하구에 가까운 쪽 끝이 유로의 끝(하류)이 되도록 한다.
 */
function orientUpstreamFirst(chain: number[][], riverName: RiverName): number[][] {
  const mouth = RIVER_MOUTH[riverName]
  if (!mouth) return chain
  const dStart = distM(chain[0], mouth)
  const dEnd = distM(chain[chain.length - 1], mouth)
  // 시작점이 하구에 더 가까우면 방향이 반대 → 뒤집는다
  return dStart < dEnd ? chain.slice().reverse() : chain
}

// 유로는 변하지 않으므로 하천별로 캐시
const backboneCache = new Map<RiverName, Feature<LineString> | null>()

export function getRiverBackbone(
  riverName: RiverName,
  riverGeometry: Record<RiverName, FeatureCollection<LineString>> | undefined,
): Feature<LineString> | null {
  if (backboneCache.has(riverName)) return backboneCache.get(riverName) ?? null
  const fc = riverGeometry?.[riverName]
  if (!fc?.features?.length) return null
  const stitched = stitchSegments(fc.features)
  if (!stitched) {
    backboneCache.set(riverName, null)
    return null
  }
  const line = turf.lineString(orientUpstreamFirst(stitched, riverName))
  backboneCache.set(riverName, line)
  return line
}

export interface TrackerZone {
  lookbackHours: number
  distanceKm: number
  sourcePoint: [number, number]     // [lng, lat] — 추정 오염 유입 지점
  segmentCoords: [number, number][] // 강조 표시할 상류 구간 좌표
  label: string
  clamped: boolean                  // true면 유로 최상단 도달 (더 상류 추적 불가)
}

export interface TrackerResult {
  stationId: string
  riverName: string
  stationCoord: [number, number]
  velocityMs: number         // 추정 유속 (m/s)
  rain_mm_per_hr: number     // 유속 계산에 쓴 강수량
  upstreamAvailableKm: number // 측정소 기준 추적 가능한 상류 유로 길이
  zones: TrackerZone[]
}

/**
 * 지정 측정소에서 상류로 오염원 역추적
 *
 * @param stationId      감지 측정소 ID (예: '동천-206')
 * @param riverName      하천명
 * @param riverGeometry  OSM 하천 유로 (useRiverGeometry)
 * @param rain_mm_per_hr 강수량 (mm/h) — 유속 추정에 사용
 * @param lookbackHours  역추적 시간 배열
 */
export function traceUpstream(
  stationId: string,
  riverName: RiverName,
  riverGeometry: Record<RiverName, FeatureCollection<LineString>> | undefined,
  rain_mm_per_hr: number,
  lookbackHours: number[] = [1, 2, 3],
): TrackerResult | null {
  const backbone = getRiverBackbone(riverName, riverGeometry)
  if (!backbone) return null

  const stationC = STATION_COORDS_FALLBACK[stationId]
  if (!stationC) return null

  const snapped = turf.nearestPointOnLine(backbone, turf.point([stationC.lng, stationC.lat]))
  const stationDistKm = snapped.properties.location ?? 0
  const velocity = estimateVelocityMs(rain_mm_per_hr)

  const zones: TrackerZone[] = lookbackHours.map((hours) => {
    const rawDistKm = (velocity * hours * 3600) / 1000
    // 상류 = 유로 시작(index 0) 방향 → 거리 빼기
    const upstreamDistKm = Math.max(stationDistKm - rawDistKm, 0)
    const clamped = rawDistKm > stationDistKm

    let sourcePoint: [number, number]
    try {
      sourcePoint = turf.along(backbone, upstreamDistKm).geometry.coordinates as [number, number]
    } catch {
      sourcePoint = backbone.geometry.coordinates[0] as [number, number]
    }

    // 측정소가 유로 최상단이면 구간 길이가 0 → 퇴화 방지
    let segmentCoords: [number, number][]
    if (stationDistKm - upstreamDistKm < 0.001) {
      segmentCoords = [sourcePoint, [stationC.lng, stationC.lat]]
    } else {
      try {
        const seg = turf.lineSliceAlong(backbone, upstreamDistKm, stationDistKm)
        const cs = seg.geometry.coordinates as [number, number][]
        segmentCoords = cs.length >= 2 ? cs : [sourcePoint, [stationC.lng, stationC.lat]]
      } catch {
        segmentCoords = [sourcePoint, [stationC.lng, stationC.lat]]
      }
    }

    const m = Math.round(rawDistKm * 1000)
    const distStr = m >= 1000 ? `${rawDistKm.toFixed(1)}km` : `${m}m`
    const label = clamped
      ? `${hours}h 역추적 — 유로 최상단 도달 (${distStr} 이상)`
      : `${hours}h 전 — ${distStr} 상류`

    return { lookbackHours: hours, distanceKm: rawDistKm, sourcePoint, segmentCoords, label, clamped }
  })

  return {
    stationId,
    riverName,
    stationCoord: [stationC.lng, stationC.lat],
    velocityMs: velocity,
    rain_mm_per_hr,
    upstreamAvailableKm: stationDistKm,
    zones,
  }
}
