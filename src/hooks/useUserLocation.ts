import { useEffect, useMemo } from 'react'
import * as turf from '@turf/turf'
import { useMapStore } from '../store/useMapStore'
import { useRiverGeometry } from './useRiverGeometry'
import { mergedRiverFeatureCollection } from '../lib/overpass'

// 온천천 세병교 물놀이장 징검다리 산책 경로 (시뮬레이션용 코스)
const ONCHEON_PATH: [number, number][] = [
  [129.0835, 35.2045], // 세병교 물놀이장 징검다리
  [129.0842, 35.2051],
  [129.0850, 35.2058], // 온천천 산책로
  [129.0862, 35.2065],
  [129.0875, 35.2072],
  [129.0888, 35.2078],
  [129.0875, 35.2072],
  [129.0862, 35.2065],
  [129.0850, 35.2058],
  [129.0842, 35.2051],
]

export function useUserLocation() {
  const pokemonGoMode = useMapStore((s) => s.pokemonGoMode)
  const isSimulating = useMapStore((s) => s.isSimulating)
  const setUserLocation = useMapStore((s) => s.setUserLocation)
  const userLocation = useMapStore((s) => s.userLocation)

  const { data: riverGeometry } = useRiverGeometry()
  const riverFC = useMemo(() => (riverGeometry ? mergedRiverFeatureCollection(riverGeometry) : null), [riverGeometry])

  // 도로/산책로 라인에 가장 가까운 좌표로 스냅(Map Matching) 계산
  const snapToNearestRoad = useMemo(
    () => (lng: number, lat: number) => {
      if (!riverFC || !riverFC.features || riverFC.features.length === 0) {
        return { lng: 129.0835, lat: 35.2045 }
      }
      try {
        const pt = turf.point([lng, lat])
        const fc = turf.featureCollection(riverFC.features)
        const nearest = turf.nearestPointOnLine(fc as any, pt)
        const [snappedLng, snappedLat] = nearest.geometry.coordinates
        const distKm = (nearest.properties as { dist?: number })?.dist ?? 0

        // 3km 이내의 하천 도로/산책로 선상으로 정밀 스냅
        if (distKm < 3.0) {
          return { lng: snappedLng, lat: snappedLat }
        }
      } catch (err) {
        console.warn('[RoadSnap] Snap calculation fallback:', err)
      }
      // PC IP 위치 오차나 타지역 GPS 오차 시, 가장 가까운 온천천 세병교 산책로 선상으로 스냅
      try {
        const ptDef = turf.point([129.0835, 35.2045])
        const fcDef = turf.featureCollection(riverFC.features)
        const nearestDef = turf.nearestPointOnLine(fcDef as any, ptDef)
        const [defLng, defLat] = nearestDef.geometry.coordinates
        return { lng: defLng, lat: defLat }
      } catch {
        return { lng: 129.0835, lat: 35.2045 }
      }
    },
    [riverFC],
  )

  // 1. 실제 디바이스 GPS 위치 상시 추적 & 도로 스냅
  useEffect(() => {
    // 초기 userLocation이 없으면 온천천 세병교 기본 설정
    if (!userLocation) {
      const snapped = snapToNearestRoad(129.0835, 35.2045)
      setUserLocation({ lng: snapped.lng, lat: snapped.lat, heading: 45 })
    }

    if (isSimulating || !('geolocation' in navigator)) return

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude, latitude, heading } = pos.coords
        
        // 부산 하천 유역 권역 체크 (경도 128.8~129.25, 위도 35.0~35.3)
        const isBusanArea = longitude >= 128.8 && longitude <= 129.25 && latitude >= 35.0 && latitude <= 35.3
        
        if (isBusanArea) {
          // GPS 신호를 가장 가까운 도로/산책로 라인으로 보정
          const snapped = snapToNearestRoad(longitude, latitude)
          setUserLocation({
            lng: snapped.lng,
            lat: snapped.lat,
            heading: heading ?? 0,
          })
        } else {
          // 부산 유역 밖인 경우 온천천 세병교 도로 선 위로 보정
          const snapped = snapToNearestRoad(129.0835, 35.2045)
          setUserLocation({ lng: snapped.lng, lat: snapped.lat, heading: heading ?? 45 })
        }
      },
      (err) => {
        console.warn('[GPS Geolocation] Defaulting to Oncheoncheon initial coordinate:', err.message)
        const snapped = snapToNearestRoad(129.0835, 35.2045)
        setUserLocation({ lng: snapped.lng, lat: snapped.lat, heading: 45 })
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [isSimulating, setUserLocation, snapToNearestRoad, userLocation])



  // 2. PC/시연용 자동 산책 시뮬레이션
  useEffect(() => {
    if (!pokemonGoMode || !isSimulating) return

    let step = 0
    const interval = setInterval(() => {
      step = (step + 1) % ONCHEON_PATH.length
      const [lng, lat] = ONCHEON_PATH[step]
      const nextStep = (step + 1) % ONCHEON_PATH.length
      const [nextLng, nextLat] = ONCHEON_PATH[nextStep]

      // 진행 방향 Heading 각도 계산
      const heading = (Math.atan2(nextLng - lng, nextLat - lat) * 180) / Math.PI

      setUserLocation({ lng, lat, heading })
    }, 2500)

    return () => clearInterval(interval)
  }, [pokemonGoMode, isSimulating, setUserLocation])

  // 3. 키보드(WASD / 화살표) 자유 이동 시뮬레이션 컨트롤
  useEffect(() => {
    if (!pokemonGoMode) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key.toLowerCase())) {
        const stepSize = 0.00015
        const cur = userLocation ?? { lng: 129.0835, lat: 35.2045, heading: 0 }
        let { lng, lat, heading } = cur

        switch (e.key.toLowerCase()) {
          case 'arrowup':
          case 'w':
            lat += stepSize
            heading = 0
            break
          case 'arrowdown':
          case 's':
            lat -= stepSize
            heading = 180
            break
          case 'arrowleft':
          case 'a':
            lng -= stepSize
            heading = 270
            break
          case 'arrowright':
          case 'd':
            lng += stepSize
            heading = 90
            break
        }
        setUserLocation({ lng, lat, heading })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pokemonGoMode, userLocation, setUserLocation])
}
