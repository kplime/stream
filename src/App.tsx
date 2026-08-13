import { useEffect } from 'react'
import './App.css'
import { ControlPanel } from './components/ControlPanel'
import { Legend } from './components/Legend'
import { MapView } from './components/MapView'
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
        {/* ShapDiagnosisModal은 렌더하지 않는다.
            이 모달은 RiskScore.shap_factors(구조화 배열)를 읽는데 현재 파이프라인은
            shap(원본 JSON 객체)만 저장해서 항상 본문이 빈 채로 떴다. 게다가
            측정소를 클릭할 때마다 열려 SHAP이 정상 표시되는 지도 팝업을 덮었다.
            컴포넌트 파일은 남겨 뒀으니 shap_factors를 채우게 되면 되살리면 된다. */}
      </main>
    </div>
  )
}

export default App


