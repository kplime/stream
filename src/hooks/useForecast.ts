import { useQuery } from '@tanstack/react-query'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { RiverName, Track } from '../types/risk'

// ml_pipeline.py LOC_COORDS 기준 하드코딩 폴백 (Supabase risk_forecast에 lat/lng 없음)
export const STATION_COORDS_FALLBACK: Record<string, { lat: number; lng: number }> = {
  '온천천-327': { lat: 35.2613, lng: 129.0920 },
  '온천천-215': { lat: 35.2372, lng: 129.0885 },
  '온천천-328': { lat: 35.2118, lng: 129.0793 },
  '온천천-216': { lat: 35.2003, lng: 129.0825 },
  '온천천-329': { lat: 35.1970, lng: 129.0825 },
  '동천-312':   { lat: 35.1506, lng: 129.0582 },
  '동천-208':   { lat: 35.1460, lng: 129.0620 },
  '동천-207':   { lat: 35.1380, lng: 129.0645 },
  '동천-206':   { lat: 35.1295, lng: 129.0662 },
  '괴정천-301': { lat: 35.1019, lng: 128.9778 },
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
