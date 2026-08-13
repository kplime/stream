import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { useMapStore } from '../store/useMapStore'
import { zoomToMarkerScale } from '../lib/markerScale'

interface AvatarMarkerProps {
  map: maplibregl.Map | null
}

const AVATAR_MODELS = {
  human: { url: '/models/CesiumMan.glb', walkClip: '', name: '🧍 사람 탐사원' },
  robot: { url: '/models/RobotExpressive.glb', walkClip: 'Walking', name: '🤖 귀여운 로봇' },
  fox: { url: '/models/Fox.glb', walkClip: 'Walk', name: '🦊 귀여운 여우' },
} as const

// 3D 캐릭터 월드 높이 정규화 상수 (기존 1.8 -> 2.6으로 증대하여 캐릭터 시시성 및 볼륨감 강화)
const TARGET_HEIGHT = 2.6

export function AvatarMarker({ map }: AvatarMarkerProps) {
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const circleMarkerRef = useRef<maplibregl.Marker | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const circleContainerRef = useRef<HTMLDivElement | null>(null)
  const scaleWrapperRef = useRef<HTMLDivElement | null>(null)
  const animFrameRef = useRef<number | null>(null)

  // Three.js 3D 오브젝트 참조
  const threeRefs = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    characterGroup: THREE.Group
    mixer: THREE.AnimationMixer | null
  } | null>(null)

  const userLocation = useMapStore((s) => s.userLocation)
  const avatarModel = useMapStore((s) => s.avatarModel)
  const show3dBuildings = useMapStore((s) => s.show3dBuildings)

  const [currentZoom, setCurrentZoom] = useState<number>(map?.getZoom() ?? 13.5)

  // 지도 줌 레벨 추적 (3D 건물 레이어 minzoom: 13과 연동)
  useEffect(() => {
    if (!map) return
    const updateZoom = () => setCurrentZoom(map.getZoom())
    updateZoom()
    map.on('zoom', updateZoom)
    return () => {
      map.off('zoom', updateZoom)
    }
  }, [map])

  // 3D 건물이 실제 3D 입체로 충분히 근접하여 표출되는 보수적인 기준 (3D 건물 토글 ON & 줌 레벨 >= 14.5)
  const is3dBuildingsVisible = show3dBuildings && currentZoom >= 14.5

  // 1. 2D GPS 원형 펄스 마커 컨테이너 초기화
  useEffect(() => {
    const circleContainer = document.createElement('div')
    circleContainer.className = 'user-location-pulse-marker'

    const pulseRing = document.createElement('div')
    pulseRing.className = 'user-location-pulse-ring'
    circleContainer.appendChild(pulseRing)

    const dot = document.createElement('div')
    dot.className = 'user-location-dot'
    circleContainer.appendChild(dot)

    circleContainerRef.current = circleContainer
  }, [])

  // 1-2. Three.js 3D 캔버스 씬 초기화 (1회)
  useEffect(() => {
    const container = document.createElement('div')
    container.className = 'avatar-3d-canvas-container'
    container.style.width = '130px'
    container.style.height = '130px'
    containerRef.current = container

    const scaleWrapper = document.createElement('div')
    scaleWrapper.style.position = 'relative'
    scaleWrapper.style.width = '100%'
    scaleWrapper.style.height = '100%'
    scaleWrapper.style.transformOrigin = 'bottom center'
    scaleWrapperRef.current = scaleWrapper
    container.appendChild(scaleWrapper)

    // 자연스러운 바닥 그림자 타원만 남김 (하늘색 파동/비콘 효과 제거)
    const shadowEl = document.createElement('div')
    shadowEl.className = 'avatar-ground-shadow'
    scaleWrapper.appendChild(shadowEl)

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(130, 130)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.position = 'relative'
    renderer.domElement.style.zIndex = '1'
    scaleWrapper.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 2.8, 4.5)
    camera.lookAt(0, 0.8, 0)
    camera.updateMatrixWorld()

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2)
    scene.add(ambientLight)

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6)
    dirLight.position.set(3, 8, 5)
    scene.add(dirLight)

    const characterGroup = new THREE.Group()
    scene.add(characterGroup)

    threeRefs.current = {
      scene,
      camera,
      renderer,
      characterGroup,
      mixer: null,
    }

    const clock = new THREE.Clock()
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate)
      threeRefs.current?.mixer?.update(clock.getDelta())
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      renderer.dispose()
      threeRefs.current = null
    }
  }, [])

  // 1-2. 선택된 귀여운 캐릭터 모델 동적 로드
  useEffect(() => {
    if (!threeRefs.current) return
    const { characterGroup, camera, renderer } = threeRefs.current

    // 이전 모델 제거 및 애니메이션 정지
    while (characterGroup.children.length > 0) {
      characterGroup.remove(characterGroup.children[0])
    }
    if (threeRefs.current.mixer) {
      threeRefs.current.mixer.stopAllAction()
      threeRefs.current.mixer = null
    }

    const config = AVATAR_MODELS[avatarModel] || AVATAR_MODELS.human
    let cancelled = false

    new GLTFLoader().load(config.url, (gltf) => {
      if (cancelled || !threeRefs.current) return
      const model = gltf.scene

      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const scale = TARGET_HEIGHT / (size.y || 1)
      model.scale.setScalar(scale)
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
      characterGroup.add(model)

      const footNdcY = new THREE.Vector3(0, 0, 0).project(camera).y
      const footCanvasY = ((1 - footNdcY) / 2) * 130
      renderer.domElement.style.transform = `translateY(${130 - footCanvasY}px)`

      const mixer = new THREE.AnimationMixer(model)
      const walkClip =
        THREE.AnimationClip.findByName(gltf.animations, config.walkClip) ||
        gltf.animations.find((a) => a.name.toLowerCase().includes('walk')) ||
        gltf.animations[0]

      if (walkClip) mixer.clipAction(walkClip).play()
      threeRefs.current.mixer = mixer
    })

    return () => {
      cancelled = true
    }
  }, [avatarModel])

  // 2. MapLibre 마커 동기화 (3D 건물 미표출 시 2D GPS 원형 펄스 마커, 표출 시 3D 사람 아바타 마커)
  useEffect(() => {
    if (!map || !userLocation) {
      markerRef.current?.remove()
      markerRef.current = null
      circleMarkerRef.current?.remove()
      circleMarkerRef.current = null
      return
    }

    if (is3dBuildingsVisible && containerRef.current) {
      // 3D 뷰 모드: 2D 원형 마커 숨기고 3D 사람 아바타 표출
      circleMarkerRef.current?.remove()
      circleMarkerRef.current = null

      if (threeRefs.current) {
        const headingRad = (userLocation.heading * Math.PI) / 180
        threeRefs.current.characterGroup.rotation.y = headingRad
      }

      if (markerRef.current && markerRef.current.getElement() !== containerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }

      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker({
          element: containerRef.current,
          anchor: 'bottom',
        })
          .setLngLat([userLocation.lng, userLocation.lat])
          .addTo(map)
      } else {
        markerRef.current.setLngLat([userLocation.lng, userLocation.lat])
      }
    } else if (circleContainerRef.current) {
      // 2D 조감 모드 (3D 건물 안 보이는 경우): 3D 사람 아바타 숨기고 2D GPS 원형 펄스 포인트 표출
      markerRef.current?.remove()
      markerRef.current = null

      if (!circleMarkerRef.current) {
        circleMarkerRef.current = new maplibregl.Marker({
          element: circleContainerRef.current,
          anchor: 'center',
        })
          .setLngLat([userLocation.lng, userLocation.lat])
          .addTo(map)
      } else {
        circleMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat])
      }
    }
  }, [map, userLocation, is3dBuildingsVisible])

  // 3. 지도 줌 레벨에 맞춰 캐릭터 스케일 갱신 (축소하면 같이 작아지고, 확대하면 커짐)
  useEffect(() => {
    if (!map) return

    const updateScale = () => {
      if (!scaleWrapperRef.current) return
      // 그림자(형제 엘리먼트)와 캔버스(발밑 오프셋 포함)가 같은 비율로 같이
      // 커지고 작아지도록 wrapper 전체를 스케일한다. transform-origin이
      // bottom center라 배율에 무관하게 앵커 지점(발밑)이 고정된다.
      scaleWrapperRef.current.style.transform = `scale(${zoomToMarkerScale(map.getZoom())})`
    }

    updateScale()
    map.on('zoom', updateScale)
    return () => {
      map.off('zoom', updateScale)
    }
  }, [map])

  return null
}
