import './App.css'
import { ControlPanel } from './components/ControlPanel'
import { Legend } from './components/Legend'
import { MapView } from './components/MapView'
import { TimeSlider } from './components/TimeSlider'

function App() {
  return (
    <div className="app">
      <ControlPanel />
      <main className="app__map">
        <MapView />
        <Legend />
        <TimeSlider />
      </main>
    </div>
  )
}

export default App
