import { useMemo } from 'react'
import { useForecast } from '../hooks/useForecast'
import { RISK_COLORS } from '../lib/mapStyle'
import { useMapStore } from '../store/useMapStore'

const MAX_HOURS = 48
const TICK_HOURS = [0, 6, 12, 18, 24, 30, 36, 42, 48]

export function TimeSlider() {
  const forecastHour = useMapStore((s) => s.forecastHour)
  const setForecastHour = useMapStore((s) => s.setForecastHour)
  const { data: forecast } = useForecast()

  // 선택된 시간의 최고 위험도 색상
  const sliderColor = useMemo(() => {
    if (!forecastHour || !forecast?.length) return RISK_COLORS.unknown
    const pts = forecast.filter((f) => f.hours_ahead === forecastHour)
    const maxScore = Math.max(...pts.map((f) => f.risk_score), 0)
    if (maxScore >= 0.66) return RISK_COLORS.high
    if (maxScore >= 0.33) return RISK_COLORS.medium
    return RISK_COLORS.low
  }, [forecastHour, forecast])

  // 현재 시간 선택 시 기상 조건 표시
  const conditions = useMemo(() => {
    if (!forecastHour || !forecast?.length) return null
    const pts = forecast.filter((f) => f.hours_ahead === forecastHour)
    if (!pts.length) return null
    return {
      rain: pts[0].rain_mm,
      tide: pts[0].tide_cm,
      temp: pts[0].temp_c,
    }
  }, [forecastHour, forecast])

  const isLive = !forecastHour

  return (
    <div className="time-slider-wrap">
      {/* 상태 배지 */}
      <div className="time-slider-header">
        <div className={`time-slider-badge ${isLive ? 'time-slider-badge--live' : 'time-slider-badge--forecast'}`}>
          {isLive ? '● 실시간' : `⏱ +${forecastHour}시간 후 예측`}
        </div>
        {conditions && (
          <div className="time-slider-conditions">
            <span>🌧 {conditions.rain != null ? conditions.rain.toFixed(1) : '--'}mm</span>
            <span>🌊 {conditions.tide != null ? conditions.tide.toFixed(0) : '--'}cm</span>
            <span>🌡 {conditions.temp != null ? conditions.temp.toFixed(1) : '--'}°C</span>
          </div>
        )}
        {!isLive && (
          <button
            type="button"
            className="time-slider-reset"
            onClick={() => setForecastHour(null)}
          >
            실시간으로
          </button>
        )}
      </div>

      {/* 슬라이더 */}
      <div className="time-slider-track-wrap">
        <input
          type="range"
          className="time-slider-input"
          min={0}
          max={MAX_HOURS}
          step={1}
          value={forecastHour ?? 0}
          style={{
            '--slider-color': sliderColor,
            '--pct': `${((forecastHour ?? 0) / MAX_HOURS) * 100}%`,
          } as React.CSSProperties}
          onChange={(e) => {
            const val = Number(e.target.value)
            setForecastHour(val === 0 ? null : val)
          }}
        />
        {/* 눈금 */}
        <div className="time-slider-ticks">
          {TICK_HOURS.map((h) => (
            <button
              key={h}
              type="button"
              className={`time-slider-tick ${(forecastHour ?? 0) === h ? 'time-slider-tick--active' : ''}`}
              onClick={() => setForecastHour(h === 0 ? null : h)}
              style={{ left: `${(h / MAX_HOURS) * 100}%` }}
            >
              {h === 0 ? '현재' : `+${h}h`}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
