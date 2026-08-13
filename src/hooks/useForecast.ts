import { useQuery } from '@tanstack/react-query'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { RiverName, Track } from '../types/risk'

// ml_pipeline.py LOC_COORDS 기준 하드코딩 폴백 (Supabase risk_forecast에 lat/lng 없음)
export const STATION_COORDS_FALLBACK: Record<string, { lat: number; lng: number }> = {
  '온천천-327':     { lat: 35.26129, lng: 129.092037 },
  '온천천-215':     { lat: 35.237201, lng: 129.088503 },
  '온천천-328':     { lat: 35.211814, lng: 129.079269 },
  '온천천-216':     { lat: 35.198833, lng: 129.080761 },
  '온천천-329':     { lat: 35.197014, lng: 129.082523 },
  '동천-312':      { lat: 35.150557, lng: 129.058198 },
  '동천-208':      { lat: 35.146027, lng: 129.063182 },
  '동천-207':      { lat: 35.138097, lng: 129.066292 },
  '동천-206':      { lat: 35.129511, lng: 129.066296 },
  '괴정천-301':     { lat: 35.101494, lng: 128.976632 },
}

export interface ForecastPoint {
  station_id: string
  river_name: RiverName
  track: Track
  forecast_dt: string
  hours_ahead: number
  risk_score: number
  risk_level: 'low' | 'medium' | 'high'
  rain_mm: number
  tide_cm: number
  temp_c: number
  // 예보 시점별 SHAP. risk_forecast에 shap 컬럼이 없으면 undefined이고,
  // 이때 팝업은 실시간 SHAP으로 대체한다 (그 값은 시간에 따라 변하지 않음).
  shap?: Record<string, number> | string | null
}

async function fetchForecast(): Promise<ForecastPoint[]> {
  if (!isSupabaseConfigured || !supabase) return []

  const { data, error } = await supabase
    .from('risk_forecast')
    .select('*')
    .order('hours_ahead', { ascending: true })
    .order('station_id')

  if (error || !data) return []
  return data as ForecastPoint[]
}

export function useForecast() {
  return useQuery({
    queryKey: ['risk_forecast'],
    queryFn: fetchForecast,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  })
}
