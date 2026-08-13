import { useEffect } from 'react'
import { useMapStore } from '../store/useMapStore'

export function ForecastTimeSlider() {
  const forecastHour = useMapStore((s) => s.forecastHour)
  const setForecastHour = useMapStore((s) => s.setForecastHour)
  const isForecastPlaying = useMapStore((s) => s.isForecastPlaying)
  const toggleForecastPlaying = useMapStore((s) => s.toggleForecastPlaying)

  // 48시간 타임라인 자동 재생 효과 (Play/Pause)
  useEffect(() => {
    if (!isForecastPlaying) return

    const interval = setInterval(() => {
      setForecastHour((useMapStore.getState().forecastHour + 1) % 49)
    }, 700)

    return () => clearInterval(interval)
  }, [isForecastPlaying, setForecastHour])

  // 현재 시각 기준 상대 시간 계산
  const getForecastTimeText = (hours: number) => {
    if (hours === 0) return '현재 실시간 (0시간)'
    const now = new Date()
    const target = new Date(now.getTime() + hours * 3600 * 1000)
    const month = target.getMonth() + 1
    const date = target.getDate()
    const hour = String(target.getHours()).padStart(2, '0')
    return `+${hours}시간 후 (${month}/${date} ${hour}:00 예보)`
  }

  return (
    <div className="forecast-slider-card">
      <div className="forecast-header">
        <div className="forecast-title-group">
          <span className="forecast-icon">🌐</span>
          <div>
            <h3 className="forecast-title">디지털 트윈 48시간 수질 예보</h3>
            <p className="forecast-subtitle">미래 시간대별 하천 위험도 시뮬레이션</p>
          </div>
        </div>

        <div className="forecast-badge-group">
          <span className={`forecast-badge ${forecastHour > 0 ? 'forecast-badge--active' : ''}`}>
            {getForecastTimeText(forecastHour)}
          </span>
          {forecastHour > 0 && (
            <button
              type="button"
              className="forecast-reset-btn"
              onClick={() => {
                setForecastHour(0)
                if (isForecastPlaying) toggleForecastPlaying()
              }}
            >
              🔄 현재로 리셋
            </button>
          )}
        </div>
      </div>

      <div className="forecast-controls">
        <button
          type="button"
          className={`forecast-play-btn ${isForecastPlaying ? 'forecast-play-btn--active' : ''}`}
          onClick={toggleForecastPlaying}
          title={isForecastPlaying ? '시뮬레이션 일시정지' : '48시간 연속 시뮬레이션 재생'}
        >
          {isForecastPlaying ? '⏸️ 정지' : '▶️ 48시간 재생'}
        </button>

        <div className="forecast-track-wrapper">
          <input
            type="range"
            min={0}
            max={48}
            step={1}
            value={forecastHour}
            onChange={(e) => setForecastHour(Number(e.target.value))}
            className="forecast-range-input"
          />
          <div className="forecast-ticks">
            <span onClick={() => setForecastHour(0)} className={forecastHour === 0 ? 'tick--active' : ''}>현재</span>
            <span onClick={() => setForecastHour(12)} className={forecastHour === 12 ? 'tick--active' : ''}>+12시간</span>
            <span onClick={() => setForecastHour(24)} className={forecastHour === 24 ? 'tick--active' : ''}>+24시간(내일)</span>
            <span onClick={() => setForecastHour(36)} className={forecastHour === 36 ? 'tick--active' : ''}>+36시간</span>
            <span onClick={() => setForecastHour(48)} className={forecastHour === 48 ? 'tick--active' : ''}>+48시간(글피)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
