# 부산 도심하천 수질예보 대시보드

온천천·동천·괴정천 세 하천을 3D 지도 위에 표시하고, 구간별 실시간 위험도를 색상으로 오버레이하는 해커톤 데모용 웹 대시보드.

## 스택

- Vite + React + TypeScript
- MapLibre GL JS (지도 렌더링, OpenFreeMap `dark` 벡터 스타일 + 커스텀 3D 건물 fill-extrusion 레이어)
- OpenFreeMap (무료 벡터 타일, API 키 불필요)
- Supabase JS 클라이언트 (실시간 데이터 구독)
- Zustand (지도/필터 상태관리)
- TanStack Query (Supabase 데이터 페칭·캐싱)
- Turf.js (하천 구간 색상 매핑, bbox 계산)

## 실행 방법

```bash
npm install
npm run dev       # http://localhost:5173
```

`.env` 파일 없이 바로 실행 가능합니다 — Supabase가 연결되어 있지 않으면 **자동으로 목업 데이터 모드**로 동작하며, 8초마다 위험도 점수가 살짝 흔들려서 "실시간처럼" 보이도록 되어 있습니다 (사이드바 상단에 "데모 모드 (Mock)" 배지 표시).

### 실제 Supabase 연동

팀원이 만든 `risk_scores` 테이블에 연결하려면:

```bash
cp .env.example .env
# .env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 입력
npm run dev
```

테이블이 비어있거나 연결에 실패해도 자동으로 목업 데이터로 폴백하므로, 데모 중 Supabase가 죽어도 화면은 계속 동작합니다. 연결되면 `postgres_changes` 구독으로 실시간 반영됩니다.

기대 스키마 (`src/types/risk.ts` 참고):

| 컬럼 | 타입 | 값 |
|---|---|---|
| `station_id` | text | 측정소 식별자 |
| `river_name` | text | `온천천` \| `동천` \| `괴정천` |
| `track` | text | `A`(대장균 접촉위험) \| `B`(폐사위험) |
| `lat`, `lng` | float | 측정소 좌표 |
| `risk_score` | float | 0~1 |
| `risk_level` | text | `low` \| `medium` \| `high` |
| `updated_at` | timestamp | |

## 하천 지리 데이터

`src/lib/overpass.ts`가 Overpass API(`waterway=stream\|river`)로 세 하천의 실제 좌표를 가져옵니다. 결과는 24시간 `localStorage` 캐시되고, 요청 실패/타임아웃 시 `src/data/riverFallback.json`(2026-08-13에 미리 받아둔 스냅샷)으로 자동 폴백합니다 — 해커톤 당일 와이파이가 불안정해도 하천은 항상 그려집니다.

각 하천은 여러 OSM way(구간)로 구성되며, `src/lib/riverSegments.ts`가 구간 중점에서 가장 가까운 측정소를 찾아 그 위험도로 구간 전체를 색칠합니다 (측정소 대비 구간 수가 많아 미터 단위 보간보다 이 방식이 적합).

## 알려진 이슈 / 주의사항

- **프로덕션 빌드 시 maplibre-gl 워커 이슈**: maplibre-gl v6는 Web Worker를 런타임에 동적 URL(`new URL(\`./${file}\`, import.meta.url)`)로 찾기 때문에 Rollup이 정적으로 감지하지 못해 빌드 결과물에 포함되지 않습니다. `vite.config.ts`의 `vite-plugin-static-copy` 설정이 `maplibre-gl-worker.mjs`와 그 의존 파일 `maplibre-gl-shared.mjs`를 `dist/assets/`에 직접 복사해 해결합니다. **maplibre-gl 버전을 올릴 때 이 설정이 여전히 필요한지(또는 파일명이 바뀌었는지) 확인하세요** — 빠지면 지도가 새까맣게 나오고 콘솔 에러 없이 조용히 멈춥니다 (`npm run build && npm run preview`로 프로덕션 빌드를 반드시 눈으로 확인할 것).
- 온천천 실제 유로는 더 김; Overpass가 부산광역시 행정구역 경계 안의 `waterway` way만 가져오므로 경계에 걸친 상류/하류 일부가 누락될 수 있습니다.
- 위험도 배색은 기존 3단계(낮음/중간/높음) → 초록/주황/빨강 고정 매핑입니다.

## 배포

정적 SPA라 어떤 정적 호스팅에도 올라갑니다 (Vercel / Netlify / Cloudflare Pages).
라우터가 없는 단일 페이지라 SPA rewrite 규칙은 필요 없습니다.

**빌드 설정**

| 항목 | 값 |
|---|---|
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node | 20 이상 |

**환경변수** (빌드 시점에 주입되어야 함 — `VITE_` 접두사는 브라우저 번들에 포함됩니다)

| 이름 | 비고 |
|---|---|
| `VITE_SUPABASE_URL` | 공개 전제. 보호는 RLS가 담당 |
| `VITE_SUPABASE_ANON_KEY` | 위와 동일 |
| `VITE_KMA_API_KEY` | 기상청 조회용. **번들에 포함되어 공개됩니다** — 쿼터 소진 시 재발급 필요. 미설정이어도 빌드는 되며 기상 위젯만 mock으로 대체됩니다 |

**배포 전 확인**

`npm run build && npm run preview` 로 프로덕션 빌드를 반드시 눈으로 확인하세요.
maplibre 워커 누락은 콘솔 에러 없이 지도만 까맣게 나옵니다 (위 '알려진 이슈' 참고).

## 데이터 갱신 자동화

`.github/workflows/pipeline.yml` 이 매시 정각(UTC) 실행되어 Supabase를 갱신합니다.

- `ml_pipeline.py --predict-only` → `risk_scores` (재학습 없이 추론만)
- `forecast.py --hours 48` → `risk_forecast`

동작하려면 저장소 **Settings → Secrets and variables → Actions** 에 아래를 등록해야 합니다:
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATA_GO_KR_KEY`, `KHOA_API_KEY`

추론에 필요한 모델(`pipeline/models/track_{a,b}_final_model.pkl`)과 기준 수질값
(`pipeline/data/water_quality_processed.csv`)은 러너에 로컬 파일이 없으므로
예외적으로 git에 추적됩니다. 나머지 모델·원본 CSV는 계속 제외됩니다.

발표 직전처럼 즉시 갱신이 필요하면 Actions 탭에서 **Run workflow** 로 수동 실행하세요
(예약 실행은 GitHub 혼잡 시 수 분~십수 분 밀립니다).
