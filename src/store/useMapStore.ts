import { create } from 'zustand'
import { RIVER_NAMES, type RiverName, type Track } from '../types/risk'

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

  pokemonGoMode: boolean
  togglePokemonGoMode: () => void

  userLocation: { lng: number; lat: number; heading: number } | null
  setUserLocation: (loc: { lng: number; lat: number; heading: number } | null) => void

  isSimulating: boolean
  toggleSimulating: () => void

  collectedItems: number
  collectItem: () => void

  avatarModel: 'human' | 'robot' | 'fox'
  setAvatarModel: (model: 'human' | 'robot' | 'fox') => void

  forecastHour: number
  setForecastHour: (hour: number) => void
  isForecastPlaying: boolean
  toggleForecastPlaying: () => void
}

export const useMapStore = create<MapState>((set) => ({
  track: 'A',
  setTrack: (track) => set({ track }),

  visibleRivers: new Set(RIVER_NAMES),
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

  pokemonGoMode: false,
  togglePokemonGoMode: () => set((state) => ({ pokemonGoMode: !state.pokemonGoMode })),

  userLocation: null,
  setUserLocation: (userLocation) => set({ userLocation }),

  isSimulating: false,
  toggleSimulating: () => set((state) => ({ isSimulating: !state.isSimulating })),

  collectedItems: 0,
  collectItem: () => set((state) => ({ collectedItems: state.collectedItems + 1 })),

  avatarModel: 'human',
  setAvatarModel: (avatarModel) => set({ avatarModel }),

  forecastHour: 0,
  setForecastHour: (forecastHour) => set({ forecastHour }),
  isForecastPlaying: false,
  toggleForecastPlaying: () => set((state) => ({ isForecastPlaying: !state.isForecastPlaying })),
}))

