import { useMemo } from 'react'
import { useMapStore } from '../store/useMapStore'
import { STATION_COORDS_FALLBACK, useForecast } from './useForecast'
import { useRiskScores } from './useRiskScores'
import type { RiskLevel, RiskScore, RiverName, Track } from '../types/risk'

/**
 * 시간 슬라이더를 반영한 "지금 화면에 보여줄 위험도"를 돌려준다.
 *
 * forecastHour가 null이면 실시간 risk_scores, 값이 있으면 해당 시점의
 * risk_forecast를 RiskScore 형태로 변환해 준다.
 *
 * 이 훅을 쓰지 않고 useRiskScores를 직접 쓰면 그 컴포넌트만 실시간 값에
 * 고정되어, 지도는 예보를 보여주는데 사이드바는 실시간을 보여주는 식으로
 * 화면이 서로 어긋난다.
 */
export function useDisplayScores() {
  const forecastHour = useMapStore((s) => s.forecastHour)
  const { data: scores, usingMock } = useRiskScores()
  const { data: forecast } = useForecast()

  // 측정소 lat/lng 조회용 (risk_forecast에는 좌표가 없다)
  const stationCoords = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; river_name: string }>()
    for (const s of scores ?? []) {
      if (!m.has(s.station_id)) {
        m.set(s.station_id, { lat: s.lat, lng: s.lng, river_name: s.river_name })
      }
    }
    return m
  }, [scores])

  const displayScores = useMemo((): RiskScore[] => {
    if (!forecastHour || !forecast?.length) return scores ?? []
    return forecast
      .filter((f) => f.hours_ahead === forecastHour)
      .map((f) => {
        const live = stationCoords.get(f.station_id)
        const fallback = STATION_COORDS_FALLBACK[f.station_id]
        const coords =
          live ??
          (fallback
            ? { ...fallback, river_name: f.river_name }
            : { lat: 0, lng: 0, river_name: f.river_name })
        return {
          station_id: f.station_id,
          river_name: coords.river_name as RiverName,
          track: f.track as Track,
          lat: coords.lat,
          lng: coords.lng,
          risk_score: f.risk_score,
          risk_level: f.risk_level as RiskLevel,
          updated_at: f.forecast_dt,
          // 예보 시점의 SHAP (없으면 팝업이 실시간 SHAP으로 대체)
          shap: f.shap as RiskScore['shap'],
        }
      })
  }, [forecastHour, forecast, scores, stationCoords])

  return {
    displayScores,
    liveScores: scores ?? [],
    isForecast: Boolean(forecastHour) && Boolean(forecast?.length),
    forecastHour,
    usingMock,
  }
}
