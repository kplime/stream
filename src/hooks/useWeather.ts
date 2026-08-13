import { useQuery } from '@tanstack/react-query'

export interface WeatherData {
  precipitation_mm: number
  temperature_c: number
  forecast_3h_mm: number
  updated_at: string
}

// 기상청 격자 좌표 변환 (람베르트 정각원추도법)
// 온천천·동천·괴정천 중심 좌표 → 격자 (nx, ny) ≈ (97, 74) 부산 중구 근방
const BUSAN_NX = 97
const BUSAN_NY = 74

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function getBaseTime(d: Date): string {
  // 기상청 초단기실황은 매 정각 발표 (0200, 0300, ... 2300)
  const h = d.getHours()
  return String(h).padStart(2, '0') + '00'
}

async function fetchKmaWeather(): Promise<WeatherData> {
  const apiKey = import.meta.env.VITE_KMA_API_KEY
  if (!apiKey) throw new Error('KMA_API_KEY not set')

  const now = new Date()
  const baseDate = formatDate(now)
  const baseTime = getBaseTime(now)

  const params = new URLSearchParams({
    serviceKey: apiKey,
    numOfRows: '10',
    pageNo: '1',
    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(BUSAN_NX),
    ny: String(BUSAN_NY),
  })

  const res = await fetch(
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?${params}`,
  )
  if (!res.ok) throw new Error(`KMA API ${res.status}`)

  const json = (await res.json()) as {
    response: {
      body: {
        items: {
          item: { category: string; obsrValue: string }[]
        }
      }
    }
  }

  const items = json.response.body.items.item
  const get = (cat: string) =>
    parseFloat(items.find((i) => i.category === cat)?.obsrValue ?? '0')

  return {
    precipitation_mm: get('RN1'),
    temperature_c: get('T1H'),
    forecast_3h_mm: 0, // 단기예보 별도 호출 필요 — mock으로 채움
    updated_at: new Date().toISOString(),
  }
}

function generateMockWeather(): WeatherData {
  // 해커톤 데모용 — 여름 부산 기준 약간 비 오는 상황 연출
  const hour = new Date().getHours()
  const isAfternoon = hour >= 13 && hour <= 18
  return {
    precipitation_mm: isAfternoon ? 3.5 + Math.random() * 4 : Math.random() * 0.5,
    temperature_c: 28 + Math.random() * 4,
    forecast_3h_mm: isAfternoon ? 5.0 : 0,
    updated_at: new Date().toISOString(),
  }
}

export function useWeather() {
  return useQuery<WeatherData>({
    queryKey: ['weather'],
    queryFn: async () => {
      try {
        return await fetchKmaWeather()
      } catch {
        return generateMockWeather()
      }
    },
    staleTime: 60_000,
    refetchInterval: 300_000, // 5분마다 갱신
  })
}
