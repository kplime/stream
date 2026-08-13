import { useState } from 'react'
import { useMapStore } from '../store/useMapStore'

export function CandidatePledgeBanner() {
  const [open, setOpen] = useState(false)
  const flyTo = useMapStore((s) => s.flyTo)
  const setTrack = useMapStore((s) => s.setTrack)

  const handleFocusGoejeong = () => {
    setTrack('B')
    flyTo({ lng: 128.966, lat: 35.094, zoom: 14.5 })
  }

  return (
    <>
      <button
        type="button"
        className="pledge-trigger-btn"
        onClick={() => setOpen(true)}
      >
        🗳️ [NPC 연계] 이태엽 공약 2 & 수질 현황 검증
      </button>

      {open && (
        <div className="pledge-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="pledge-modal" onClick={(e) => e.stopPropagation()}>
            <header className="pledge-modal__header">
              <div>
                <span className="pledge-badge">이머시브 시어터 서사 검증</span>
                <h2>기호 1번 이태엽 후보 공약 vs 하천 행정 현실</h2>
              </div>
              <button
                type="button"
                className="pledge-close-btn"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </header>

            <div className="pledge-grid">
              <div className="pledge-card">
                <span className="pledge-card__num">공약 1</span>
                <h3>하천 수질 매우좋음(Ia, BOD 1mg/L 이하) 달성</h3>
                <div className="pledge-card__versus">
                  <div className="versus-box versus-box--reality">
                    <strong>행정 현실 (담당 공무원 통화 인터뷰)</strong>
                    <p>
                      &quot;낙동강 하류 수계라 취수원이 아니므로 1급수로 관리할 의무가 없으며, 악취 안 나는 수준(친수 기준)이 실제 관리 목표입니다.&quot;
                    </p>
                  </div>
                </div>
              </div>

              <div className="pledge-card pledge-card--highlight">
                <span className="pledge-card__num">공약 2</span>
                <h3>스마트 수질 자동측정 시스템 전면 도입</h3>
                <div className="pledge-card__versus">
                  <div className="versus-box versus-box--data">
                    <strong>데이터 검증 (부산 공공데이터포털)</strong>
                    <p>
                      온천천(3개소)·동천(2개소)만 자동측정망이 설치되어 있으며, <strong>괴정천은 13개소 측정망에서 완전히 빠져있음</strong>을 증명.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="pledge-action-btn"
                  onClick={() => {
                    handleFocusGoejeong()
                    setOpen(false)
                  }}
                >
                  📍 센서 공백 지역 (괴정천) 지도로 이동
                </button>
              </div>

              <div className="pledge-card">
                <span className="pledge-card__num">공약 3</span>
                <h3>시민 친화형 &apos;블루 워킹 로드&apos; 조성</h3>
                <div className="pledge-card__versus">
                  <div className="versus-box versus-box--impact">
                    <strong>예보제 필요성 증대</strong>
                    <p>
                      복원사업(괴정천 499억) 및 친수공간 확대 시 물 접촉 인구가 급증하여, 배양검사(24h 지연)가 아닌 <strong>실시간 Nowcast 예보 체계</strong>가 필수가 됨.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <footer className="pledge-modal__footer">
              <p>※ 현장답사 및 구청 담당자 통화 인터뷰 데이터 바탕 실증 결과</p>
              <button
                type="button"
                className="pledge-close-main-btn"
                onClick={() => setOpen(false)}
              >
                닫기
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
