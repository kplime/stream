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
  shap_factors?: ShapFactor[]
  anomaly_detected?: boolean
  lag_hours?: number
  sensor_missing?: boolean
  e_coli_prob?: number
  notes?: string
}

export const RIVER_NAMES: RiverName[] = ['온천천', '동천', '괴정천']

export const TRACK_LABELS: Record<Track, string> = {
  A: '대장균 접촉위험 (Nowcast)',
  B: '폐사위험 (시차-DLM)',
}

export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

