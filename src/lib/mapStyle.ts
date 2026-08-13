// OpenFreeMap "liberty" style: bright, familiar basemap, no API key required.
// It already ships a 3D-buildings fill-extrusion layer ("building-3d"), which
// MapView reuses instead of adding a duplicate one (see FALLBACK_BUILDINGS_3D_LAYER_ID
// below, only used if a future style swap removes that built-in layer).
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
export const NATIVE_BUILDINGS_3D_LAYER_ID = 'building-3d'
export const FALLBACK_BUILDINGS_3D_LAYER_ID = 'buildings-3d'
export const RIVER_GLOW_LAYER_ID = 'river-risk-glow'
export const RIVER_LINE_LAYER_ID = 'river-risk-line'
export const STATION_LAYER_ID = 'risk-stations'
export const RIVER_SOURCE_ID = 'risk-rivers'
export const STATION_SOURCE_ID = 'risk-station-points'

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
