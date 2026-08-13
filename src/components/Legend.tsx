import { RISK_COLORS } from '../lib/mapStyle'
import { useMapStore } from '../store/useMapStore'
import { TRACK_LABELS } from '../types/risk'

const ITEMS: { level: 'low' | 'medium' | 'high'; label: string }[] = [
  { level: 'low', label: '낮음' },
  { level: 'medium', label: '중간' },
  { level: 'high', label: '높음' },
]

export function Legend() {
  const track = useMapStore((s) => s.track)

  return (
    <div className="legend">
      <div className="legend__title">위험도 · {TRACK_LABELS[track]}</div>
      <div className="legend__items">
        {ITEMS.map(({ level, label }) => (
          <div key={level} className="legend__item">
            <span className="legend__swatch" style={{ background: RISK_COLORS[level] }} />
            {label}
          </div>
        ))}
        <div className="legend__item legend__item--muted">
          <span className="legend__swatch" style={{ background: RISK_COLORS.unknown }} />
          데이터 없음
        </div>
      </div>
    </div>
  )
}
