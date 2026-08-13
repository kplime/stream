import './App.css'
import { ControlPanel } from './components/ControlPanel'
import { Legend } from './components/Legend'
import { MapView } from './components/MapView'

function App() {
  return (
    <div className="app">
      <ControlPanel />
      <main className="app__map">
        <MapView />
        <Legend />
      </main>
    </div>
  )
}

export default App
