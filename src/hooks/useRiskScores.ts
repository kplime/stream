import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { generateMockRiskScores } from '../lib/mockData'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useMapStore } from '../store/useMapStore'
import type { RiskScore } from '../types/risk'

export const RISK_SCORES_QUERY_KEY = ['risk_scores'] as const

async function fetchRiskScores(): Promise<RiskScore[]> {
  if (!isSupabaseConfigured || !supabase) {
    return generateMockRiskScores()
  }

  const { data, error } = await supabase.from('risk_scores').select('*')
  if (error) {
    console.warn('[risk_scores] Supabase query failed, using mock data:', error.message)
    return generateMockRiskScores()
  }
  if (!data || data.length === 0) {
    console.info('[risk_scores] table is empty, using mock data for the demo')
    return generateMockRiskScores()
  }
  return data as RiskScore[]
}

/**
 * Fetches risk_scores via TanStack Query and keeps the cache live via Supabase
 * Realtime. Falls back to generated mock data (with a light simulated tick)
 * whenever Supabase isn't configured or the table is empty, so the map still
 * "moves" during the demo even before the real pipeline is wired up.
 */
export function useRiskScores() {
  const queryClient = useQueryClient()
  const usingMock = !isSupabaseConfigured
  const mockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const query = useQuery({
    queryKey: RISK_SCORES_QUERY_KEY,
    queryFn: fetchRiskScores,
    staleTime: 30_000,
    refetchInterval: usingMock ? false : 60_000,
  })

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    const client = supabase

    // Unique topic name per mount: StrictMode double-invokes this effect in
    // dev (mount -> cleanup -> mount), and supabase-js's `.channel(name)`
    // returns the *same* channel object for a repeated name — the second
    // mount would call `.on()` on a channel that's already `.subscribe()`d
    // and throw. A fresh name per mount sidesteps the reuse entirely.
    const channel = client
      .channel(`risk_scores-changes-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'risk_scores' },
        () => {
          queryClient.invalidateQueries({ queryKey: RISK_SCORES_QUERY_KEY })
        },
      )
      .subscribe()

    return () => {
      client.removeChannel(channel)
    }
  }, [queryClient])

  // Demo-mode heartbeat: nudge a few scores each tick so the dashboard looks
  // live even when running purely off mock data.
  useEffect(() => {
    if (!usingMock) return

    mockIntervalRef.current = setInterval(() => {
      queryClient.setQueryData<RiskScore[]>(RISK_SCORES_QUERY_KEY, (prev) => {
        if (!prev) return prev
        const next = [...prev]
        const jitterCount = Math.max(1, Math.floor(next.length * 0.15))
        for (let i = 0; i < jitterCount; i++) {
          const idx = Math.floor(Math.random() * next.length)
          const drift = (Math.random() - 0.5) * 0.2
          const score = Math.min(1, Math.max(0, next[idx].risk_score + drift))
          next[idx] = {
            ...next[idx],
            risk_score: score,
            risk_level: score >= 0.66 ? 'high' : score >= 0.33 ? 'medium' : 'low',
            updated_at: new Date().toISOString(),
          }
        }
        return next
      })
    }, 8_000)

    return () => {
      if (mockIntervalRef.current) clearInterval(mockIntervalRef.current)
    }
  }, [usingMock, queryClient])

  const forecastHour = useMapStore((s) => s.forecastHour)
  const baseData = query.data ?? []

  const data = useMemo(() => {
    if (forecastHour === 0) return baseData
    const now = new Date()
    const forecastTime = new Date(now.getTime() + forecastHour * 3600 * 1000)
    const formattedTime = forecastTime.toISOString()

    return baseData.map((s, idx) => {
      const phaseOffset = idx * 1.35
      const delta =
        0.38 * Math.sin((forecastHour + phaseOffset) * 0.28) +
        0.18 * Math.cos(forecastHour * 0.15 + phaseOffset)

      const newScore = Math.min(1, Math.max(0, s.risk_score + delta))
      const newLevel: 'high' | 'medium' | 'low' =
        newScore >= 0.66 ? 'high' : newScore >= 0.33 ? 'medium' : 'low'

      return {
        ...s,
        risk_score: Number(newScore.toFixed(3)),
        risk_level: newLevel,
        updated_at: formattedTime,
      }
    })
  }, [baseData, forecastHour])

  return { ...query, data, usingMock }
}
