import { useMemo, useState } from 'react'
import { RISK_COLORS } from '../lib/mapStyle'
import { useForecast } from '../hooks/useForecast'
import { RIVER_NAMES, TRACK_LABELS } from '../types/risk'

const HOURS = [6, 12, 24, 48] as const
const HOUR_LABELS: Record<number, string> = { 6: '6시간 후', 12: '12시간 후', 24: '24시간 후', 48: '48시간 후' }

export function ForecastPanel() {
  const { data: forecast } = useForecast()
  const [selectedHour, setSelectedHour] = useState<number | null>(null)

  // 훅은 early return 전에 항상 호출해야 함
  const byRiverHour = useMemo(() => {
    if (!forecast) return {} as Record<string, Record<number, { score: number; level: string; rain: number; tide: number; temp: number }>>
    const result: Record<string, Record<number, { score: number; level: string; rain: number; tide: number; temp: number }>> = {}
    for (const river of RIVER_NAMES) {
      result[river] = {}
      for (const h of HOURS) {
        const pts = forecast.filter((f) => f.river_name === river && f.hours_ahead === h)
        if (!pts.length) continue
        const maxPt = pts.reduce((a, b) => (a.risk_score > b.risk_score ? a : b))
        result[river][h] = { score: maxPt.risk_score, level: maxPt.risk_level, rain: maxPt.rain_mm, tide: maxPt.tide_cm, temp: maxPt.temp_c }
      }
    }
    return result
  }, [forecast])

  const hourDetail = useMemo(() => {
    if (!forecast || !selectedHour) return null
    const pts = forecast.filter((f) => f.hours_ahead === selectedHour)
    const byRiver: Record<string, { A?: typeof pts[0]; B?: typeof pts[0] }> = {}
    for (const pt of pts) {
      if (!byRiver[pt.river_name]) byRiver[pt.river_name] = {}
      byRiver[pt.river_name][pt.track] = pt
    }
    const sample = pts[0]
    return { rivers: byRiver, rain: sample?.rain_mm ?? 0, tide: sample?.tide_cm ?? 0, temp: sample?.temp_c ?? 0 }
  }, [forecast, selectedHour])

  if (!forecast || forecast.length === 0) return null

  return (
    <section className="control-section">
      <h2>시간별 위험도 예측</h2>

      {/* 표 헤더 */}
      <div className="forecast-table">
        <div className="forecast-header">
          <span className="forecast-river-col" />
          {HOURS.map((h) => (
            <button
              key={h}
              type="button"
              className={`forecast-hour-col forecast-hour-btn ${selectedHour === h ? 'forecast-hour-btn--active' : ''}`}
              onClick={() => setSelectedHour(selectedHour === h ? null : h)}
              title={`${HOUR_LABELS[h]} 상세 보기`}
            >
              +{h}h
            </button>
          ))}
        </div>

        {RIVER_NAMES.map((river) => (
          <div key={river} className="forecast-row">
            <span className="forecast-river-col">{river}</span>
            {HOURS.map((h) => {
              const pt = byRiverHour[river]?.[h]
              if (!pt) return <span key={h} className="forecast-hour-col forecast-cell--empty">-</span>
              return (
                <button
                  key={h}
                  type="button"
                  className={`forecast-hour-col forecast-cell ${selectedHour === h ? 'forecast-cell--selected' : ''}`}
                  style={{ borderColor: RISK_COLORS[pt.level as 'low' | 'medium' | 'high'] }}
                  onClick={() => setSelectedHour(selectedHour === h ? null : h)}
                >
                  <span className="forecast-dot" style={{ background: RISK_COLORS[pt.level as 'low' | 'medium' | 'high'] }} />
                  {Math.round(pt.score * 100)}%
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* 선택된 시간 상세 */}
      {selectedHour && hourDetail && (
        <div className="forecast-detail">
          <div className="forecast-detail__header">
            <span className="forecast-detail__title">{HOUR_LABELS[selectedHour]} 예측 상세</span>
            <button
              type="button"
              className="forecast-detail__close"
              onClick={() => setSelectedHour(null)}
            >
              ✕
            </button>
          </div>

          {/* 기상·조위 조건 */}
          <div className="forecast-conditions">
            <div className="forecast-cond-item">
              <span className="forecast-cond-icon">🌧</span>
              <span className="forecast-cond-val">{hourDetail.rain.toFixed(1)} mm</span>
              <span className="forecast-cond-label">강수</span>
            </div>
            <div className="forecast-cond-item">
              <span className="forecast-cond-icon">🌊</span>
              <span className="forecast-cond-val">{hourDetail.tide.toFixed(0)} cm</span>
              <span className="forecast-cond-label">조위</span>
            </div>
            <div className="forecast-cond-item">
              <span className="forecast-cond-icon">🌡</span>
              <span className="forecast-cond-val">{hourDetail.temp.toFixed(1)} °C</span>
              <span className="forecast-cond-label">기온</span>
            </div>
          </div>

          {/* 하천별 A/B 위험도 */}
          <div className="forecast-detail__rivers">
            {RIVER_NAMES.map((river) => {
              const both = hourDetail.rivers[river]
              if (!both) return null
              return (
                <div key={river} className="forecast-detail__river-row">
                  <span className="forecast-detail__river-name">{river}</span>
                  <div className="forecast-detail__badges">
                    {both.A && (
                      <span
                        className="forecast-detail__badge forecast-detail__badge--a"
                        style={{ background: RISK_COLORS[both.A.risk_level as 'low' | 'medium' | 'high'] }}
                      >
                        🦠 {TRACK_LABELS.A} {Math.round(both.A.risk_score * 100)}%
                      </span>
                    )}
                    {both.B && (
                      <span
                        className="forecast-detail__badge forecast-detail__badge--b"
                        style={{
                          borderColor: RISK_COLORS[both.B.risk_level as 'low' | 'medium' | 'high'],
                          color: RISK_COLORS[both.B.risk_level as 'low' | 'medium' | 'high'],
                        }}
                      >
                        🐟 {TRACK_LABELS.B} {Math.round(both.B.risk_score * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 경고 */}
          {(() => {
            const warnings: string[] = []
            if (hourDetail.rain > 10) warnings.push(`강수 ${hourDetail.rain.toFixed(1)}mm — CSO 위험`)
            if (hourDetail.tide > 110) warnings.push(`조위 ${hourDetail.tide.toFixed(0)}cm — 만조 역류`)
            const highRivers = Object.entries(hourDetail.rivers)
              .filter(([, b]) => (b.A?.risk_level === 'high') || (b.B?.risk_level === 'high'))
              .map(([r]) => r)
            if (highRivers.length) warnings.push(`${highRivers.join('·')} HIGH 예상`)
            if (!warnings.length) return <p className="forecast-ok">⚑ 현재 예보 기준 이상 없음</p>
            return (
              <div className="forecast-warnings">
                {warnings.map((w, i) => (
                  <div key={i} className="forecast-warning-item">
                    <span className="forecast-warning-icon">⚠</span>{w}
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {/* 경고 배너 (선택 없을 때만) */}
      {!selectedHour && <ForecastWarningBanner forecast={forecast} />}
    </section>
  )
}

function ForecastWarningBanner({ forecast }: { forecast: ReturnType<typeof useForecast>['data'] }) {
  if (!forecast) return null
  const upcoming = forecast.filter((f) => f.hours_ahead <= 6)
  const maxRain = Math.max(...upcoming.map((f) => f.rain_mm ?? 0), 0)
  const maxTide = Math.max(...upcoming.map((f) => f.tide_cm ?? 0), 0)
  const highPts = forecast.filter((f) => f.risk_level === 'high' && f.hours_ahead <= 24)

  const warnings: string[] = []
  if (maxRain > 10) warnings.push(`6시간 내 강수 ${maxRain.toFixed(1)}mm — CSO 위험`)
  if (maxTide > 110) warnings.push(`조위 ${maxTide.toFixed(0)}cm — 만조 구간`)
  if (highPts.length) {
    const earliest = Math.min(...highPts.map((f) => f.hours_ahead))
    warnings.push(`${earliest}시간 후 HIGH 위험 예상`)
  }
  if (!warnings.length) return null

  return (
    <div className="forecast-warnings">
      {warnings.map((w, i) => (
        <div key={i} className="forecast-warning-item">
          <span className="forecast-warning-icon">⚠</span>{w}
        </div>
      ))}
    </div>
  )
}
