export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
export const NATIVE_BUILDINGS_3D_LAYER_ID = 'building-3d'
export const FALLBACK_BUILDINGS_3D_LAYER_ID = 'buildings-3d'
export const RIVER_GLOW_LAYER_ID = 'river-risk-glow'
export const RIVER_LINE_LAYER_ID = 'river-risk-line'
export const STATION_LAYER_A_ID = 'risk-stations-a'   // 대장균 레이어
export const STATION_LAYER_B_ID = 'risk-stations-b'   // 폐사위험 레이어
// 하위호환
export const STATION_LAYER_ID = STATION_LAYER_A_ID
export const RIVER_SOURCE_ID = 'risk-rivers'
export const STATION_SOURCE_A_ID = 'risk-station-points-a'
export const STATION_SOURCE_B_ID = 'risk-station-points-b'
export const STATION_SOURCE_ID = STATION_SOURCE_A_ID

// 오염원 역추적 레이어
export const TRACKER_SOURCE_ID = 'tracker-upstream'
export const TRACKER_LINE_LAYER_ID = 'tracker-upstream-line'
export const TRACKER_POINT_SOURCE_ID = 'tracker-source-point'
export const TRACKER_POINT_LAYER_ID = 'tracker-source-point-layer'

// Busan, centered at Oncheoncheon water park where the 3D avatar & stations are located.
export const INITIAL_VIEW = {
  center: [129.0835, 35.2045] as [number, number],
  zoom: 13.5,
  pitch: 45,
  bearing: -12,
}

// 부산 3대 도심하천(온천천·동천·괴정천) 밀집 권역 보수적 Bounding Box (SW, NE)
export const BUSAN_MAX_BOUNDS: [[number, number], [number, number]] = [
  [128.92, 35.04],
  [129.16, 35.26],
]

// Status palette (dataviz skill): good/warning/critical steps, validated for
// >=3:1 contrast on a dark surface.
export const RISK_COLORS: Record<'low' | 'medium' | 'high' | 'unknown', string> = {
  low: '#0ca30c',
  medium: '#3b82f6',
  high: '#d03b3b',
  unknown: '#5b5a55',
}

// SHAP feature 한글 라벨
export const SHAP_LABELS: Record<string, string> = {
  pH: 'pH',
  DO: '용존산소(DO)',
  SS: '부유물질(SS)',
  TP: '총인(TP)',
  EC: '전기전도도',
  TN: '총질소(TN)',
  수온: '수온',
  rain_total_mm: '당월 강수량',
  rain_lag1_mm: '전월 강수량',
  rain_lag1_max: '전월 최대일강수',
  temp_avg_c: '기온',
  tide_mean_cm: '평균 조위',
  tide_range_cm: '조차',
  tide_spring_proxy: '삭망조 강도',
  tide_high_count: '만조 시간수',
  month: '월(계절성)',
}
