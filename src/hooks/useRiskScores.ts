import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { generateMockRiskScores } from '../lib/mockData'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
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

    // 채널명에 고유 ID 추가 — React StrictMode 이중 실행 시 이름 충돌 방지
    const channelName = `risk_scores-changes-${Math.random().toString(36).slice(2)}`
    const channel = client
      .channel(channelName)
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

  return { ...query, usingMock }
}
