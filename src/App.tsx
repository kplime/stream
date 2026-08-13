import { useEffect } from 'react'
import './App.css'
import { ControlPanel } from './components/ControlPanel'
import { Legend } from './components/Legend'
import { MapView } from './components/MapView'
import { ShapDiagnosisModal } from './components/ShapDiagnosisModal'
import { TimeSlider } from './components/TimeSlider'
import { useMapStore } from './store/useMapStore'

function App() {
  const panelOpen = useMapStore((s) => s.panelOpen)

  // 데스크톱 Chrome/Edge는 Ctrl(⌘)+휠 스크롤을 "브라우저 페이지 확대/축소"로 가로챈다.
  // viewport meta의 user-scalable=no는 모바일 핀치줌만 막을 뿐 이 데스크톱 동작에는
  // 영향이 없어서, 지도 위에서 무심코 Ctrl+스크롤을 하면 지도가 아니라 페이지 전체가
  // (그리고 그 안의 3D 아바타 캔버스가) 확대/축소되어 "캐릭터 크기가 변한다"로 보인다.
  // 이 리스너로 그 브라우저 기본 동작만 막고, 일반 스크롤(=MapLibre 자체 줌)은 그대로 둔다.
  useEffect(() => {
    const preventBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }
    window.addEventListener('wheel', preventBrowserZoom, { passive: false })
    return () => window.removeEventListener('wheel', preventBrowserZoom)
  }, [])

  return (
    // 패널이 접히면 범례·시간 슬라이더도 패널 자리를 회수해 중앙으로 돌아온다.
    <div className={`app ${panelOpen ? '' : 'app--panel-closed'}`}>
      <ControlPanel />
      <main className="app__map">
        <MapView />
        <Legend />
        <TimeSlider />
        <ShapDiagnosisModal />
      </main>
    </div>
  )
}

export default App


