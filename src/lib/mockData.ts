import riverFallback from '../data/riverFallback.json'
import realWaterQualityData from '../data/realWaterQuality.json'
import { RIVER_NAMES, type RiskLevel, type RiskScore, type RiverName, type Track } from '../types/risk'

function levelFromScore(score: number): RiskLevel {
  if (score >= 0.66) return 'high'
  if (score >= 0.33) return 'medium'
  return 'low'
}

interface RealStationReading {
  station_name: string
  address: string
  measured_at: string // YYYYMM
  bod: number | null
  cod: number | null
  do: number | null
  total_coliform: number | null
  water_temp: number | null
  data_missing: boolean
  risk_score: number | null
  risk_level: RiskLevel | null
}

// 실측 수질측정망 데이터 (scripts/compute_risk_scores.py 산출물).
// BOD/COD/DO/총대장균군 기반 규칙 점수 — 아직 실데이터로 재학습된 모델은 아니지만,
// 최소한 화면의 위험도가 순수 난수가 아니라 실제 측정값에 근거하도록 한다.
const realWaterQuality = realWaterQualityData as unknown as {
  generated_at: string
  rivers: Record<RiverName, RealStationReading[]>
}

function usableReadings(river: RiverName): RealStationReading[] {
  return (realWaterQuality.rivers[river] ?? []).filter((s) => !s.data_missing)
}

function formatMeasuredAt(yyyymm: string): string {
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`
}

// Deterministic pseudo-random so refreshes don't jitter station positions relative to each other.
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

/**
 * Generates plausible-looking stations spaced along each river's OSM geometry,
 * so the demo runs even before the teammate's Supabase `risk_scores` table is live.
 */
export function generateMockRiskScores(): RiskScore[] {
  const fallback = riverFallback as unknown as Record<
    RiverName,
    { features: { geometry: { coordinates: [number, number][] } }[] }
  >
  const scores: RiskScore[] = []
  const rand = seededRandom(42)

  for (const river of RIVER_NAMES) {
    const coords = fallback[river]?.features.flatMap((f) => f.geometry.coordinates) ?? []
    if (coords.length === 0) continue

    // Define Station Names per River
    const stationNames = river === '온천천'
      ? ['부곡교 (상류)', '세병교 (물놀이장)', '이섭교 (징검다리)', '온천천하류A', '온천천하류B', '수영강합류점']
      : river === '동천'
      ? ['범4호교', '무지개다리', '동천중류', '동천하류A', '동천하류B', '북항합류점']
      : ['괴정천상류 (센서미설치)', '괴정천중류 (복개철거예정)', '괴정천하류 (유지용수착공)', '신평역인근', '장림교', '낙동강합류점']

    const stationCount = stationNames.length
    const realReadings = usableReadings(river)

    for (let i = 0; i < stationCount; i++) {
      const idx = Math.floor((i / (stationCount - 1)) * (coords.length - 1))
      const [lng, lat] = coords[idx]

      // 실측 데이터가 있으면 순환 배정, 없으면 그대로 난수 fallback (예: 리버가 전혀 매칭되지 않은 경우)
      const real = realReadings.length > 0 ? realReadings[i % realReadings.length] : null

      for (const track of ['A', 'B'] as Track[]) {
        const base = real?.risk_score ?? rand()
        // 실측값도 재측정 주기가 길어(월 단위) 데모용으로 약간의 움직임을 더한다.
        const drift = (rand() - 0.5) * (real ? 0.06 : 0.15)
        const risk_score = Math.min(1, Math.max(0, base + drift))
        const level = levelFromScore(risk_score)
        const isMissing = river === '괴정천' // 괴정천은 8개 하천 13개소 자동측정망 미설치 구간 (기획서 4절)

        // SHAP Factors for Model Interpretability.
        // DO/수온/BOD는 실측값이 있으면 그 값을, 없으면 risk_score 기반 근사치를 쓴다.
        // 강수량/탁도는 아직 실데이터 소스가 없어 계속 risk_score 기반 근사치.
        const precip = Math.round(15 + rand() * 45) // mm/h
        const turbidity = Math.round(10 + risk_score * 85) // NTU
        const doVal = (real?.do ?? 8.5 - risk_score * 5.2).toFixed(1) // mg/L
        const tempVal = (real?.water_temp ?? 24 + rand() * 4).toFixed(1) // °C
        const bodVal = (real?.bod ?? 2.1 + risk_score * 4.5).toFixed(1) // mg/L

        const shap_factors = track === 'A'
          ? [
              { feature: 'precip', label: '초단기 강수량 (CSO 유입)', impact: Math.round(risk_score * 45), value: `${precip} mm/h` },
              { feature: 'turbidity', label: '실시간 탁도 (퇴적물 부상)', impact: Math.round(risk_score * 32), value: `${turbidity} NTU` },
              { feature: 'do', label: '용존산소량 (DO 저하)', impact: Math.round((1 - risk_score) * -20), value: `${doVal} mg/L` },
              { feature: 'temp', label: '수온 (대장균 증식속도)', impact: Math.round(risk_score * 12), value: `${tempVal} °C` },
            ]
          : [
              { feature: 'lag_effect', label: '우천 후 지연시간 (Streeter-Phelps)', impact: Math.round(risk_score * 50), value: `유입 후 ${river === '괴정천' ? 3.5 : 2.5}시간 지연` },
              { feature: 'do_drop', label: 'DO 임계점 하강 (폐사 유발)', impact: Math.round(risk_score * 35), value: `${doVal} mg/L` },
              { feature: 'bod_est', label: '과거 BOD 페어링 추정치', impact: Math.round(risk_score * 15), value: `${bodVal} mg/L` },
            ]

        scores.push({
          station_id: stationNames[i],
          river_name: river,
          track,
          lat,
          lng,
          risk_score,
          risk_level: level,
          updated_at: new Date(Date.now() - rand() * 3600_000).toISOString(),
          shap_factors,
          anomaly_detected: risk_score > 0.72, // Isolation Forest Anomaly
          lag_hours: river === '괴정천' ? 3.5 : 2.5,
          sensor_missing: isMissing,
          e_coli_prob: Math.round(risk_score * 92),
          notes: real
            ? `※ 실측 데이터 기반 — ${real.station_name} 측정소 ${formatMeasuredAt(real.measured_at)} 수질측정망 결과 ` +
              `(BOD ${real.bod ?? '-'}, COD ${real.cod ?? '-'}, DO ${real.do ?? '-'}, 총대장균군 ${real.total_coliform ?? '-'}). ` +
              `모델 재학습 전까지는 환경기준 경계값 기반 규칙 점수이며 실시간 값이 아님 (수질측정망 갱신주기: 일 1회).`
            : isMissing
            ? '※ 공공데이터 자동측정망 센서 미설치 지점 — 과거 BOD 수질측정망 및 인접 강우 데이터 기반 모델 추정'
            : undefined,
        })
      }
    }
  }
  return scores
}

