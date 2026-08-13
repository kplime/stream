import { useQuery } from '@tanstack/react-query'
import { fetchRiverGeometry } from '../lib/overpass'

export function useRiverGeometry() {
  return useQuery({
    queryKey: ['river-geometry'],
    queryFn: () => fetchRiverGeometry(),
    staleTime: Infinity, // river courses don't change; cached in localStorage too
    gcTime: Infinity,
  })
}
