import { useMemo } from 'react'
import { ForecastPanel } from './ForecastPanel'
import { useDisplayScores } from '../hooks/useDisplayScores'
import { useWeather } from '../hooks/useWeather'
import { RISK_COLORS } from '../lib/mapStyle'
import { useMapStore } from '../store/useMapStore'
import {
  NO_REALTIME_SENSOR_RIVERS,
  RIVER_NAMES,
  RIVER_PRIMARY_TRACK,
  TRACK_LABELS,
  type RiskScore,
  type Track,
} from '../types/risk'

const TRACKS: Track[] = ['A', 'B']

export function ControlPanel() {
  const track = useMapStore((s) => s.track)
  const setTrack = useMapStore((s) => s.setTrack)
  const visibleRivers = useMapStore((s) => s.visibleRivers)
  const toggleRiver = useMapStore((s) => s.toggleRiver)
  const show3dBuildings = useMapStore((s) => s.show3dBuildings)
  const toggleShow3dBuildings = useMapStore((s) => s.toggleShow3dBuildings)
  const flyTo = useMapStore((s) => s.flyTo)
  const selectStation = useMapStore((s) => s.selectStation)

  // 시간 슬라이더를 따라간다 — 지도는 예보인데 목록만 실시간이면 값이 어긋난다
  const { displayScores: scores, usingMock, isForecast, forecastHour } = useDisplayScores()
  const { data: weather } = useWeather()

  // station_id 기준으로 A+B 묶기
  const stationsByRiver = useMemo(() => {
    const grouped = new Map<string, Map<string, { A?: RiskScore; B?: RiskScore }>>()
    for (const river of RIVER_NAMES) grouped.set(river, new Map())
    for (const s of scores ?? []) {
      const riverMap = grouped.get(s.river_name)
      if (!riverMap) continue
      const existing = riverMap.get(s.station_id) ?? {}
      existing[s.track as 'A' | 'B'] = s
      riverMap.set(s.station_id, existing)
    }
    return grouped
  }, [scores])

  return (
    <aside className="control-panel">
      <header className="control-panel__header">
        <h1>부산 도심하천 수질예보</h1>
        <span className={`status-pill ${usingMock ? 'status-pill--mock' : 'status-pill--live'}`}>
          {usingMock ? '데모 모드 (Mock)' : '실시간 연동'}
        </span>
      </header>

      {/* 강수량 위젯 */}
      {weather && (
        <section className="control-section">
          <h2>현재 기상</h2>
          <div className="weather-row">
            <div className="weather-item">
              <span className="weather-icon">🌧</span>
              <span className="weather-value">{weather.precipitation_mm.toFixed(1)} mm/h</span>
              <span className="weather-label">강수량</span>
            </div>
            <div className="weather-item">
              <span className="weather-icon">🌡</span>
              <span className="weather-value">{weather.temperature_c.toFixed(1)} °C</span>
              <span className="weather-label">기온</span>
            </div>
            <div className="weather-item">
              <span className={`weather-value ${weather.precipitation_mm > 5 ? 'weather-value--warn' : ''}`}>
                {weather.precipitation_mm > 10
                  ? '⚠ CSO 위험'
                  : weather.precipitation_mm > 5
                    ? '주의 관찰중'
                    : '정상'}
              </span>
              <span className="weather-label">CSO 상태</span>
            </div>
          </div>
          {weather.forecast_3h_mm > 0 && (
            <p className="weather-forecast">
              3시간 후 예보: {weather.forecast_3h_mm.toFixed(1)} mm
            </p>
          )}
        </section>
      )}

      <section className="control-section">
        <h2>예측 트랙 (팝업 기준)</h2>
        <div className="segmented">
          {TRACKS.map((t) => (
            <button
              key={t}
              type="button"
              className={t === track ? 'segmented__item segmented__item--active' : 'segmented__item'}
              onClick={() => setTrack(t)}
            >
              {t} · {TRACK_LABELS[t]}
            </button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <h2>하천 표시</h2>
        <div className="chip-row">
          {RIVER_NAMES.map((river) => (
            <label key={river} className="chip">
              <input
                type="checkbox"
                checked={visibleRivers.has(river)}
                onChange={() => toggleRiver(river)}
              />
              {river}
              <span className="chip-track-badge">
                {TRACK_LABELS[RIVER_PRIMARY_TRACK[river]]}
              </span>
              {NO_REALTIME_SENSOR_RIVERS.has(river) && (
                <span className="chip-badge chip-badge--warn" title="부산 자동측정망 미설치 구간">
                  센서없음
                </span>
              )}
            </label>
          ))}
        </div>
        <label className="chip">
          <input type="checkbox" checked={show3dBuildings} onChange={toggleShow3dBuildings} />
          3D 건물
        </label>
      </section>

      <ForecastPanel />

      <section className="control-section control-section--grow">
        <h2>
          측정소
          {isForecast && (
            <span className="group-badge" style={{ marginLeft: 6 }}>
              +{forecastHour}시간 후 예측
            </span>
          )}
        </h2>
        <div className="station-list">
          {RIVER_NAMES.filter((r) => visibleRivers.has(r)).map((river) => (
            <div key={river} className="station-list__group">
              <h3>
                {river}
                <span className="group-track-label">
                  {TRACK_LABELS[RIVER_PRIMARY_TRACK[river]]}
                </span>
                {NO_REALTIME_SENSOR_RIVERS.has(river) && (
                  <span className="group-badge group-badge--warn">실시간센서없음</span>
                )}
              </h3>
              {[...( stationsByRiver.get(river) ?? new Map<string, { A?: RiskScore; B?: RiskScore }>()).entries()].map(([stationId, both]) => {
                const ref = both.A ?? both.B!
                const colorA = RISK_COLORS[both.A?.risk_level ?? 'unknown']
                const colorB = RISK_COLORS[both.B?.risk_level ?? 'unknown']
                return (
                  <button
                    key={stationId}
                    type="button"
                    className="station-row station-row--dual"
                    onClick={() => {
                      flyTo({ lng: ref.lng, lat: ref.lat, zoom: 15.5 })
                      selectStation({ stationId: ref.station_id, riverName: ref.river_name, lng: ref.lng, lat: ref.lat })
                    }}
                  >
                    <span className="station-row__id">{stationId}</span>
                    <span className="station-row__dual-scores">
                      {both.A && (
                        <span className="dual-badge dual-badge--a" style={{ background: colorA }}>
                          A {Math.round(both.A.risk_score * 100)}%
                        </span>
                      )}
                      {both.B && (
                        <span className="dual-badge dual-badge--b" style={{ borderColor: colorB, color: colorB }}>
                          B {Math.round(both.B.risk_score * 100)}%
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </section>
    </aside>
  )
}
