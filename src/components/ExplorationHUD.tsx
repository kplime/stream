import { useState, useEffect } from 'react'
import { useMapStore } from '../store/useMapStore'
import { useRiskScores } from '../hooks/useRiskScores'
import turfDistance from '@turf/distance'
import { point } from '@turf/helpers'

export function ExplorationHUD() {
  const pokemonGoMode = useMapStore((s) => s.pokemonGoMode)
  const togglePokemonGoMode = useMapStore((s) => s.togglePokemonGoMode)
  const isSimulating = useMapStore((s) => s.isSimulating)
  const toggleSimulating = useMapStore((s) => s.toggleSimulating)
  const userLocation = useMapStore((s) => s.userLocation)
  const collectedItems = useMapStore((s) => s.collectedItems)
  const collectItem = useMapStore((s) => s.collectItem)
  const avatarModel = useMapStore((s) => s.avatarModel)
  const setAvatarModel = useMapStore((s) => s.setAvatarModel)
  const track = useMapStore((s) => s.track)

  const { data: scores } = useRiskScores()

  const [nearbyStation, setNearbyStation] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportSubmitted, setReportSubmitted] = useState(false)

  // 아바타와 측정소 간 50m(0.05km) 근접 여부 체크
  useEffect(() => {
    if (!pokemonGoMode || !userLocation || !scores) return

    const userPt = point([userLocation.lng, userLocation.lat])
    let closestId: string | null = null
    let minDist = Infinity

    for (const s of scores) {
      if (s.track !== track) continue
      const stPt = point([s.lng, s.lat])
      const dist = turfDistance(userPt, stPt, { units: 'kilometers' })
      if (dist < 0.08 && dist < minDist) { // 80m 이내
        minDist = dist
        closestId = s.station_id
      }
    }

    setNearbyStation(closestId)
  }, [pokemonGoMode, userLocation, scores, track])

  if (!pokemonGoMode) return null

  return (
    <aside className="exploration-hud">
      <header className="hud-header">
        <div className="hud-title-group">
          <span className="hud-badge">🎮 POKÉMON GO MODE</span>
          <h2>부산 하천 환경 탐사대</h2>
        </div>
        <button
          type="button"
          className="hud-close-btn"
          onClick={togglePokemonGoMode}
        >
          탐사 모드 종료
        </button>
      </header>

      <div className="hud-stats-grid">
        <div className="hud-stat-box">
          <span className="hud-stat-label">📍 내 위치 (GPS)</span>
          <span className="hud-stat-val">
            {userLocation
              ? `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`
              : 'GPS 수신 중...'}
          </span>
        </div>

        <div className="hud-stat-box">
          <span className="hud-stat-label">🧪 수질 샘플 획득</span>
          <span className="hud-stat-val hud-stat-val--highlight">{collectedItems}개</span>
        </div>
      </div>

      <div className="hud-controls">
        <div className="avatar-picker">
          <span className="avatar-picker-label">🧸 3D 탐사 캐릭터:</span>
          <div className="avatar-picker-buttons">
            <button
              type="button"
              className={`avatar-picker-btn ${avatarModel === 'human' ? 'avatar-picker-btn--active' : ''}`}
              onClick={() => setAvatarModel('human')}
            >
              🧍 귀여운 사람
            </button>
            <button
              type="button"
              className={`avatar-picker-btn ${avatarModel === 'robot' ? 'avatar-picker-btn--active' : ''}`}
              onClick={() => setAvatarModel('robot')}
            >
              🤖 귀여운 로봇
            </button>
            <button
              type="button"
              className={`avatar-picker-btn ${avatarModel === 'fox' ? 'avatar-picker-btn--active' : ''}`}
              onClick={() => setAvatarModel('fox')}
            >
              🦊 귀여운 여우
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`hud-btn ${isSimulating ? 'hud-btn--active' : ''}`}
          onClick={toggleSimulating}
        >
          {isSimulating ? '⏸️ 온천천 산책 일시정지' : '🚶 온천천 징검다리 산책 시뮬레이션'}
        </button>
        <p className="hud-help-text">💡 팁: PC에서는 키보드 방향키(W/A/S/D)로 아바타를 이끌 수 있습니다.</p>
      </div>

      {nearbyStation && (
        <div className="hud-alert-card">
          <div className="hud-alert-icon">🚨</div>
          <div className="hud-alert-body">
            <strong>하천 위험 구역 감지!</strong>
            <p><strong>{nearbyStation}</strong> 지점 80m 이내에 근접했습니다.</p>
            <div className="hud-alert-actions">
              <button
                type="button"
                className="hud-action-btn"
                onClick={() => {
                  collectItem()
                  setReportOpen(true)
                }}
              >
                📸 수질 샘플 획득 & 시민 제보하기
              </button>
            </div>
          </div>
        </div>
      )}

      {reportOpen && (
        <div className="report-modal-backdrop" onClick={() => setReportOpen(false)}>
          <div className="report-modal" onClick={(e) => e.stopPropagation()}>
            <h3>📸 실시간 시민 수질 제보 ({nearbyStation})</h3>
            <p className="report-desc">
              포켓몬GO 탐사대원으로 수질 이상 현상(탁도, 악취, 물고기 상태)을 사진과 함께 지자체에 제보합니다.
            </p>

            {reportSubmitted ? (
              <div className="report-success">
                <span className="report-success-icon">✅</span>
                <h4>제보 접수 완료!</h4>
                <p>시민 제보 데이터가 Nowcast 실측 보정 수치로 등록되었습니다 (+50 XP)</p>
                <button
                  type="button"
                  className="report-submit-btn"
                  onClick={() => {
                    setReportSubmitted(false)
                    setReportOpen(false)
                  }}
                >
                  확인
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setReportSubmitted(true)
                }}
              >
                <div className="form-group">
                  <label>관측 항목</label>
                  <select className="form-input">
                    <option>우천시 탁도 급증 (흙탕물 유입)</option>
                    <option>하천 악취 유발</option>
                    <option>물고기 이상 행동 / 폐사 징후</option>
                    <option>어린이 물놀이장 수질 우려</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>현장 상세 제보 내용</label>
                  <textarea className="form-input" rows={3} placeholder="징검다리 주변 하천 상황을 입력해 주세요..." />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn-cancel" onClick={() => setReportOpen(false)}>
                    취소
                  </button>
                  <button type="submit" className="report-submit-btn">
                    제보하기 (+50 XP)
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
