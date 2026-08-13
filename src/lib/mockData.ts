import riverFallback from '../data/riverFallback.json'
import { TRACK_RIVERS, type RiskLevel, type RiskScore, type RiverName, type Track } from '../types/risk'

function levelFromScore(score: number): RiskLevel {
  if (score >= 0.66) return 'high'
  if (score >= 0.33) return 'medium'
  return 'low'
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

  // Track A: 온천천만 (대장균 Nowcast — 접촉 가능 하천)
  // Track B: 동천 + 괴정천 (폐사위험 분포시차모형 — 접촉 불가 하천)
  for (const [track, rivers] of Object.entries(TRACK_RIVERS) as [Track, RiverName[]][]) {
    for (const river of rivers) {
      const coords = fallback[river]?.features.flatMap((f) => f.geometry.coordinates) ?? []
      if (coords.length === 0) continue

      const stationCount = river === '온천천' ? 3 : 2
      for (let i = 0; i < stationCount; i++) {
        const idx = Math.floor((i / Math.max(stationCount - 1, 1)) * (coords.length - 1))
        const [lng, lat] = coords[idx]

        const base = rand()
        const drift = (rand() - 0.5) * 0.15
        const risk_score = Math.min(1, Math.max(0, base + drift))
        scores.push({
          station_id: `${river}-${i + 1}`,
          river_name: river,
          track,
          lat,
          lng,
          risk_score,
          risk_level: levelFromScore(risk_score),
          updated_at: new Date(Date.now() - rand() * 3600_000).toISOString(),
        })
      }
    }
  }
  return scores
}
