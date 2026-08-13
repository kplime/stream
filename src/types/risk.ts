export type RiverName = '온천천' | '동천' | '괴정천'

export type Track = 'A' | 'B'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface RiskScore {
  station_id: string
  river_name: RiverName
  track: Track
  lat: number
  lng: number
  risk_score: number
  risk_level: RiskLevel
  updated_at: string
  shap?: Record<string, number> | null
}

export const RIVER_NAMES: RiverName[] = ['온천천', '동천', '괴정천']

// Track A: 대장균 Nowcast — 물리적으로 접촉 가능한 하천 (물놀이장·징검다리)
// Track B: 폐사위험 분포시차모형 — 접촉 불가 하천 (하천이 깊이 위치)
export const TRACK_RIVERS: Record<Track, RiverName[]> = {
  A: ['온천천'],
  B: ['동천', '괴정천'],
}

// 하천별 주 트랙 — 지도 색상 및 측정소 목록 기준
export const RIVER_PRIMARY_TRACK: Record<RiverName, Track> = {
  '온천천': 'A',
  '동천':   'B',
  '괴정천': 'B',
}

export const TRACK_LABELS: Record<Track, string> = {
  A: '대장균 접촉위험',
  B: '폐사위험',
}

export const TRACK_DESCRIPTIONS: Record<Track, string> = {
  A: 'EPA Nowcast 방법론 적용 · 온천천 (물놀이장·징검다리)',
  B: '분포시차모형 · 동천·괴정천 (접촉불가 구간)',
}

// 괴정천은 부산 자동측정망 13개소에 미포함 — 실시간 센서 없음
export const NO_REALTIME_SENSOR_RIVERS = new Set<RiverName>(['괴정천'])

export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
}
