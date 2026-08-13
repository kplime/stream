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
}

export const RIVER_NAMES: RiverName[] = ['온천천', '동천', '괴정천']

export const TRACK_LABELS: Record<Track, string> = {
  A: '대장균 접촉위험',
  B: '폐사위험',
}

export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
}
