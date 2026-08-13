export type RiverName = '온천천' | '동천' | '괴정천'

export type Track = 'A' | 'B'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface ShapFactor {
  feature: string
  label: string
  impact: number // positive value means pushing risk up (+%), negative means reducing risk (-%)
  value: string  // e.g. "45 NTU", "28 mm/h", "3.2 mg/L"
}

export interface RiskScore {
  station_id: string
  river_name: RiverName
  track: Track
  lat: number
  lng: number
  risk_score: number
  risk_level: RiskLevel
  updated_at: string
  // 구조화된 SHAP (팀원 파이프라인 산출물)
  shap_factors?: ShapFactor[]
  anomaly_detected?: boolean
  lag_hours?: number
  sensor_missing?: boolean
  e_coli_prob?: number
  notes?: string
  // Supabase risk_scores/risk_forecast의 shap jsonb 원본 (pipeline/ 산출물)
  // 문자열로 올 수도, 객체로 올 수도 있어 팝업에서 양쪽을 처리한다
  shap?: Record<string, number> | string | null
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
  A: '대장균 접촉위험 (Nowcast)',
  B: '폐사위험 (시차-DLM)',
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

