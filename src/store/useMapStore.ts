import { create } from 'zustand'
import { TRACK_RIVERS, type RiverName, type Track } from '../types/risk'

interface SelectedStation {
  stationId: string
  riverName: RiverName
  lng: number
  lat: number
}

interface MapState {
  track: Track
  setTrack: (track: Track) => void

  visibleRivers: Set<RiverName>
  toggleRiver: (river: RiverName) => void

  show3dBuildings: boolean
  toggleShow3dBuildings: () => void

  selectedStation: SelectedStation | null
  selectStation: (station: SelectedStation | null) => void

  flyToTarget: { lng: number; lat: number; zoom?: number } | null
  flyTo: (target: { lng: number; lat: number; zoom?: number } | null) => void
}

export const useMapStore = create<MapState>((set) => ({
  track: 'A',
  // Track 변경 시 해당 트랙의 기본 하천으로 visibleRivers 자동 갱신
  setTrack: (track) => set({ track, visibleRivers: new Set(TRACK_RIVERS[track]) }),

  visibleRivers: new Set(TRACK_RIVERS['A']),
  toggleRiver: (river) =>
    set((state) => {
      const next = new Set(state.visibleRivers)
      if (next.has(river)) next.delete(river)
      else next.add(river)
      return { visibleRivers: next }
    }),

  show3dBuildings: true,
  toggleShow3dBuildings: () => set((state) => ({ show3dBuildings: !state.show3dBuildings })),

  selectedStation: null,
  selectStation: (selectedStation) => set({ selectedStation }),

  flyToTarget: null,
  flyTo: (flyToTarget) => set({ flyToTarget }),
}))
