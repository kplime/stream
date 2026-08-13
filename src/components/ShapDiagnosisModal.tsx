import { AlertTriangle, Bot, Clock, Siren, X } from 'lucide-react'
import { useMapStore } from '../store/useMapStore'
import { useRiskScores } from '../hooks/useRiskScores'
import { TRACK_LABELS, type RiskScore } from '../types/risk'
import { RISK_COLORS } from '../lib/mapStyle'


export function ShapDiagnosisModal() {
  const selectedStation = useMapStore((s) => s.selectedStation)
  const selectStation = useMapStore((s) => s.selectStation)
  const track = useMapStore((s) => s.track)

  const { data: scores } = useRiskScores()

  if (!selectedStation) return null

  const stationData: RiskScore | undefined = scores?.find(
    (s) => s.station_id === selectedStation.stationId && s.track === track
  )

  if (!stationData) return null

  const riskPct = Math.round(stationData.risk_score * 100)

  return (
    <div className="shap-modal-backdrop" onClick={() => selectStation(null)}>
      <div className="shap-modal" onClick={(e) => e.stopPropagation()}>
        <header className="shap-modal__header">
          <div className="shap-modal__title-group">
            <span
              className="shap-modal__risk-badge"
              style={{ backgroundColor: RISK_COLORS[stationData.risk_level] }}
            >
              {stationData.risk_level.toUpperCase()} ({riskPct}%)
            </span>
            <div>
              <h2 className="shap-modal__title">{stationData.station_id}</h2>
              <p className="shap-modal__subtitle">
                {stationData.river_name} · {TRACK_LABELS[track]}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="shap-modal__close-btn"
            onClick={() => selectStation(null)}
          >
            <X size={18} />
          </button>
        </header>

        {stationData.sensor_missing && (
          <div className="shap-alert shap-alert--warning">
            <strong>
              <AlertTriangle size={14} strokeWidth={2.25} />
              센서 공백 지역 (공공데이터 자동측정망 미설치)
            </strong>
            <p>
              괴정천 상류/중류 지점은 실시간 자동측정망 13개소에 포함되지 않습니다.
              과거 수질측정망(BOD)과 인접 기상청 강우 관측소 데이터로 Nowcast/DLM 추론을 실행합니다.
            </p>
          </div>
        )}

        {stationData.anomaly_detected && (
          <div className="shap-alert shap-alert--danger">
            <strong>
              <Siren size={14} strokeWidth={2.25} />
              Isolation Forest 비지도 이상치 탐지 발령
            </strong>
            <p>
              강수량 대비 탁도 및 DO 저하 비율이 정상 범주를 벗어났습니다.
              우천시 월류(CSO 오수유입) 또는 미측정 요인에 의한 급성 위험 신호입니다.
            </p>
          </div>
        )}

        <section className="shap-modal__section">
          <h3>
            <Bot size={16} strokeWidth={2.25} />
            AI 위험도 원인 분해 (XGBoost + SHAP)
          </h3>
          <p className="shap-modal__desc">
            복합 원인 입증 불가능 문제를 해결하기 위해 SHAP(Explainable AI)으로 각 환경 변수의 기여도를 도출했습니다.
          </p>

          <div className="shap-factors-list">
            {stationData.shap_factors?.map((factor, idx) => (
              <div key={idx} className="shap-factor-row">
                <div className="shap-factor-info">
                  <span className="shap-factor-label">{factor.label}</span>
                  <span className="shap-factor-val">{factor.value}</span>
                </div>
                <div className="shap-factor-bar-bg">
                  <div
                    className={`shap-factor-bar ${
                      factor.impact >= 0 ? 'shap-factor-bar--pos' : 'shap-factor-bar--neg'
                    }`}
                    style={{ width: `${Math.min(100, Math.abs(factor.impact) * 2)}%` }}
                  />
                </div>
                <span className="shap-factor-impact">
                  {factor.impact >= 0 ? `+${factor.impact}%` : `${factor.impact}%`}
                </span>
              </div>
            ))}
          </div>
        </section>

        {track === 'B' && (
          <section className="shap-modal__section shap-modal__section--highlight">
            <h3>
              <Clock size={16} strokeWidth={2.25} />
              강수 연동 지연 효과 (Distributed Lag Model)
            </h3>
            <div className="shap-lag-card">
              <div className="shap-lag-metric">
                <span className="shap-lag-number">{stationData.lag_hours ?? 3.0}시간</span>
                <span className="shap-lag-label">최저 용존산소 임계 지연 시차</span>
              </div>
              <p className="shap-lag-text">
                Streeter-Phelps 자정작용 수식에 따라, 우천 직후가 아닌 
                <strong> 강우 유입 후 {stationData.lag_hours ?? 3.0}시간 뒤</strong> 용존산소가 최저점으로 떨어집니다.
                기존 외주업체 모델이 놓치는 수질 급변 타이밍을 사전 경보합니다.
              </p>
            </div>
          </section>
        )}

        <footer className="shap-modal__footer">
          <span className="shap-modal__time">
            최신 추론 시각: {new Date(stationData.updated_at).toLocaleTimeString('ko-KR')}
          </span>
          <button
            type="button"
            className="shap-modal__btn-primary"
            onClick={() => selectStation(null)}
          >
            확인
          </button>
        </footer>
      </div>
    </div>
  )
}
