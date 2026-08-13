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

  // 왼쪽 패널 열림 여부. ControlPanel 안에 두지 않고 store로 올린 이유는
  // 범례·시간 슬라이더가 패널 폭만큼 밀려 있어서, 패널이 접히면 그 요소들도
  // 같이 중앙으로 돌아와야 하기 때문이다. App이 이 값으로 루트에 클래스를 건다.
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void

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

  // 시간 슬라이더: null = 현재 실시간, 1~48 = 예측 시간
  // TimeSlider(현행)가 쓰는 표현. 0을 실시간으로 쓰던 ForecastTimeSlider는
  // 제거했으므로 null 표현으로 통일한다.
  forecastHour: number | null
  setForecastHour: (hour: number | null) => void
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

  // 넓은 화면에서는 펼친 상태로 시작. 좁은 화면에서는 ControlPanel이 마운트 시
  // 닫아서 지도가 먼저 보이게 한다.
  panelOpen: true,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),

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

  forecastHour: null,
  setForecastHour: (forecastHour) => set({ forecastHour }),
}))

