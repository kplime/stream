import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Siren } from 'lucide-react'
import { ForecastPanel } from './ForecastPanel'
import { useDisplayScores } from '../hooks/useDisplayScores'
import { useWeather } from '../hooks/useWeather'
import { useMapStore } from '../store/useMapStore'
import { RISK_COLORS } from '../lib/mapStyle'
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
  // 패널 열림 상태는 store에 있다 (범례·시간 슬라이더도 같이 반응해야 해서).
  const expanded = useMapStore((s) => s.panelOpen)
  const setExpanded = useMapStore((s) => s.setPanelOpen)
  const togglePanel = useMapStore((s) => s.togglePanel)

  // 좁은 화면인지 — 닫힌 패널에 inert를 걸지 판단하는 데 쓴다.
  // CSS의 768px 분기와 값을 맞춰야 한다.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 좁은 화면으로 처음 들어오면 접어서 지도가 먼저 보이게 한다.
  // 넓어질 때 자동으로 펴지는 않는다 — 사용자가 직접 접은 걸 되돌리면 성가시다.
  const didAutoCollapse = useRef(false)
  useEffect(() => {
    if (isMobile && !didAutoCollapse.current) {
      didAutoCollapse.current = true
      setExpanded(false)
    }
  }, [isMobile, setExpanded])

  // 좁은 화면에서 패널이 지도를 덮고 있을 때만 Esc로 닫는다.
  // 넓은 화면에서는 패널이 지도를 가리지 않으므로 Esc를 가로채지 않는다.
  useEffect(() => {
    if (!expanded || !isMobile) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, isMobile, setExpanded])

  const track = useMapStore((s) => s.track)
  const setTrack = useMapStore((s) => s.setTrack)
  const visibleRivers = useMapStore((s) => s.visibleRivers)
  const toggleRiver = useMapStore((s) => s.toggleRiver)
  const show3dBuildings = useMapStore((s) => s.show3dBuildings)
  const toggleShow3dBuildings = useMapStore((s) => s.toggleShow3dBuildings)
  const flyTo = useMapStore((s) => s.flyTo)
  const selectStation = useMapStore((s) => s.selectStation)

  // 시간 슬라이더를 따라간다 — 지도는 예보인데 목록만 실시간이면 값이 어긋난다
  const { displayScores: scores, isForecast, forecastHour } = useDisplayScores()
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
    <>
      <aside
        id="control-panel"
        // 열림/닫힘 표현은 App이 루트에 거는 .app--panel-closed 하나로 통일한다.
        // (범례·슬라이더도 같은 클래스로 함께 움직여야 해서)
        className="control-panel"
        // 닫힌 드로어 안의 컨트롤이 스크린리더·탭 이동에 잡히지 않도록.
        // 데스크톱에서는 CSS가 항상 펼친 상태로 두므로 inert를 걸지 않는다.
        aria-hidden={isMobile && !expanded}
        inert={isMobile && !expanded}
      >
        <header className="control-panel__header">
          <div>
            <h1>부산 도심하천 수질예보</h1>
            <p className="control-panel__subtitle-text">온천천 · 동천 · 괴정천 실시간 위험도 예측</p>
          </div>
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
          측정소 목록 (클릭시 SHAP 원인분석)
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
              {/* station-list__rows: 팀원 리스타일 CSS가 이 래퍼를 기준으로 잡힌다 */}
              <div className="station-list__rows">
                {[...(stationsByRiver.get(river) ?? new Map<string, { A?: RiskScore; B?: RiskScore }>()).entries()].map(
                  ([stationId, both]) => {
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
                        <span className="station-row__id">
                          {stationId}
                          {ref.sensor_missing && (
                            <span className="badge-missing" title="자동측정망 미설치 (BOD 추정)">
                              <AlertTriangle size={12} strokeWidth={2.25} />
                            </span>
                          )}
                          {ref.anomaly_detected && (
                            <span className="badge-anomaly" title="Isolation Forest 이상 탐지">
                              <Siren size={12} strokeWidth={2.25} />
                            </span>
                          )}
                        </span>
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
                  },
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      </aside>

      {/* 드로어 손잡이 — aside의 overflow-y:auto에 잘리지 않도록 형제로 둔다.
          모바일에서만 보이고, 열림 상태에 따라 드로어 폭만큼 옆으로 밀린다. */}
      <button
        type="button"
        className="control-panel-handle"
        onClick={togglePanel}
        aria-expanded={expanded}
        aria-controls="control-panel"
        aria-label={expanded ? '왼쪽 패널 닫기' : '왼쪽 패널 열기'}
        title={expanded ? '왼쪽 패널 닫기 (지도 넓게 보기)' : '왼쪽 패널 열기'}
      >
        {expanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </>
  )
}

