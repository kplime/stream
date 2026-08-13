// 지도 줌 레벨에 맞춰 사용자 위치 마커(3D 아바타, 내 위치 핀)를 스케일링하기 위한 공용 계산식.
// MapLibre 마커는 화면 픽셀 고정 크기라서, 지도를 축소하면 건물/도로는 작아지는데
// 마커만 그대로 남아 비율이 안 맞고 어색해 보인다 (사용자 피드백). 줌 레벨에 비례해
// 마커도 같이 커지고 작아지게 해서 실제 그 자리에 서 있는 것처럼 보이게 한다.
// 1:1 실측 스케일(줌 1당 2배)은 낮은 줌에서 마커가 안 보이거나 높은 줌에서 지나치게
// 커지므로, 지수를 완화(0.55)하고 범위를 clamp해서 체감 변화만 남긴다.
const REFERENCE_ZOOM = 17
const DAMPING = 0.55
const MIN_SCALE = 0.55
const MAX_SCALE = 1.85

export function zoomToMarkerScale(zoom: number): number {
  const raw = Math.pow(2, (zoom - REFERENCE_ZOOM) * DAMPING)
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw))
}
