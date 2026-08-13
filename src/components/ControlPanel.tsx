import { useMemo } from 'react'
import { useRiskScores } from '../hooks/useRiskScores'
import { useMapStore } from '../store/useMapStore'
import { RIVER_NAMES, RISK_LEVEL_ORDER, TRACK_LABELS, type Track } from '../types/risk'
import { RISK_COLORS } from '../lib/mapStyle'

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

  const { data: scores, usingMock } = useRiskScores()

  const stationsByRiver = useMemo(() => {
    const filtered = (scores ?? []).filter((s) => s.track === track)
    const grouped = new Map<string, typeof filtered>()
    for (const river of RIVER_NAMES) grouped.set(river, [])
    for (const s of filtered) grouped.get(s.river_name)?.push(s)
    for (const list of grouped.values()) {
      list.sort((a, b) => RISK_LEVEL_ORDER[b.risk_level] - RISK_LEVEL_ORDER[a.risk_level])
    }
    return grouped
  }, [scores, track])

  return (
    <aside className="control-panel">
      <header className="control-panel__header">
        <h1>부산 도심하천 수질예보</h1>
        <span className={`status-pill ${usingMock ? 'status-pill--mock' : 'status-pill--live'}`}>
          {usingMock ? '데모 모드 (Mock)' : '실시간 연동'}
        </span>
      </header>

      <section className="control-section">
        <h2>예측 트랙</h2>
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
            </label>
          ))}
        </div>
        <label className="chip">
          <input type="checkbox" checked={show3dBuildings} onChange={toggleShow3dBuildings} />
          3D 건물
        </label>
      </section>

      <section className="control-section control-section--grow">
        <h2>측정소</h2>
        <div className="station-list">
          {RIVER_NAMES.filter((r) => visibleRivers.has(r)).map((river) => (
            <div key={river} className="station-list__group">
              <h3>{river}</h3>
              {stationsByRiver.get(river)?.map((s) => (
                <button
                  key={s.station_id}
                  type="button"
                  className="station-row"
                  onClick={() => {
                    flyTo({ lng: s.lng, lat: s.lat, zoom: 15.5 })
                    selectStation({ stationId: s.station_id, riverName: s.river_name, lng: s.lng, lat: s.lat })
                  }}
                >
                  <span
                    className="station-row__dot"
                    style={{ background: RISK_COLORS[s.risk_level] }}
                  />
                  <span className="station-row__id">{s.station_id}</span>
                  <span className="station-row__score">{Math.round(s.risk_score * 100)}%</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
    </aside>
  )
}
