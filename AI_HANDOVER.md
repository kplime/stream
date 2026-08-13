# 🤖 AI 인계 및 프로젝트 개발 현황 리포트 (AI_HANDOVER.md)

> **최종 갱신 시각**: 2026-08-13 (동아대 이머시브 시어터 연계형 환경 데이터 AI 해커톤)  
> **프로젝트 위치**: `C:\Users\charm\OneDrive\바탕 화면\stream`  
> **주요 목적**: 다른 AI(Claude Code, ChatGPT, Cursor 등)가 이 파일 하나만 읽고도 프로젝트의 기획 맥락, 시스템 구조, 현재 구현 상태를 100% 파악하여 인계 개발을 이어갈 수 있도록 정리한 인계 문서입니다.

---

## 1. 📌 프로젝트 개요 및 기획 맥락

* **대회/목적**: 부산 도심하천(온천천 · 동천 · 괴정천) 대상 **실시간 예측형 수질예보제 & 포켓몬GO 탐사 웹 대시보드**
* **핵심 문제의식**:
  1. 기존 대장균 배양검사는 **18~24시간 지연**되어 우천 직후(CSO 월류) 수질 위험을 방지하지 못함.
  2. 해수욕장엔 예보제가 있으나, 하루 1만 명이 찾는 온천천 세병교 물놀이장 등 도심 하천엔 정보 공백 존재.
* **하천별 이원화 예측 모델**:
  * **Track A (접촉 하천 - 온천천/동천)**: 탁도·강수량·DO 기반 **대장균 초과 확률 Nowcast 모델 (XGBoost + SHAP 설명가능 AI)**
  * **Track B (접촉 불가 - 괴정천/동천)**: 강수 유입 후 최저 용존산소($t_c$) 지연 효과를 포착하는 **Streeter-Phelps & 분포시차모형(DLM)** + **Isolation Forest 이상치 탐지**
* **이머시브 시어터 서사 연계**:
  * 가상 NPC "기호 1번 이태엽 후보" 공약 2(스마트 수질 센서 전면 도입)와 실제 행정 현실(괴정천은 13개소 자동측정망에서 전면 제외됨)의 모순을 공공데이터로 직접 실증.

---

## 2. 🛠️ 기술 스택 (Tech Stack)

| 구분 | 사용 기술 |
|---|---|
| **Core Framework** | React 19, TypeScript, Vite 8 |
| **Map / 3D Graphics** | **Three.js (WebGL 3D 아바타 렌더러)**, MapLibre GL JS (v6.3), OpenFreeMap (`dark` 3D 벡터 타일), Turf.js |
| **State / Data** | Zustand (글로벌 상태), TanStack Query, Supabase JS Client (목업/실시간 구독 겸용) |
| **AI Models (Python)** | XGBoost, SHAP (TreeExplainer), Scikit-Learn (Isolation Forest), NumPy |
| **Build & Tooling** | Vite Static Copy Plugin (maplibre-gl worker 복사), Oxlint |

---

## 3. ✅ 현재까지 완료된 핵심 구현 내역

### 1) 3D 지형 지도 & 하천 위험 오버레이 (`MapView.tsx`)
- OpenFreeMap 3D 건물 extrusion 레이어 + Overpass API 하천 유로 라인 및 24시간 localStorage/JSON 폴백 캐싱
- 하천 구간별 실시간 위험도 색상 매핑 (녹색: Safety / 주황: Caution / 빨강: Warning)

### 2) 🤖 AI SHAP 원인 분석 패널 (`ShapDiagnosisModal.tsx`)
- 측정소 클릭 시 **XGBoost SHAP** 환경 변수(초단기 강수량, 실시간 탁도, DO, 수온)의 위험도 상승/하경 기여율(%) 시각화
- **Isolation Forest** 이상치 탐지 신호 수신 시 🚨 빨간색 경보 모달 표출

### 3) 🗳️ 후보 공약 검증 모달 (`CandidatePledgeBanner.tsx`)
- 이태엽 후보 공약 2 vs 부산 공공데이터포털 실증 결과(괴정천 자동측정망 13개소 미포함) 안내 및 괴정천 위치 이동 버튼

### 4) 📍 2단계 내 위치 마커 & 포켓몬GO 3D 아바타 탐사 모드
- **일반 모드 (확대/포켓몬GO 전)**:
  - **`MyLocationMarker.tsx`**: 내 실시간 GPS 위치에 **레이더 펄스 마커(📍 내 위치)** 표시
  - **`📍 내 위치로 확대 이동`** 퀵 버튼 추가
- **포켓몬GO 3D 탐사 모드 (ON)**:
  - **`AvatarMarker.tsx`**: **Three.js 3D 캐릭터 (피부 톤, 연구원 모자/안경, 3D 수트, 빨간 배낭)** + **팔다리 60FPS Walking 3D 애니메이션** + **3D 시안색 홀로그램 파동 링**
  - **`MapView.tsx`**: **포켓몬GO 3D 시점 고정 (Pitch 45° 락, `dragRotate: false`, `touchPitch: false`, `minPitch/maxPitch: 45°`, `showCompass: false`)**으로 마우스 우클릭 드래그/터치 회전 및 각도 변경 완전 차단
  - **`useUserLocation.ts`**: 실제 GPS `navigator.geolocation` 상시 위치 추적 + **"온천천 징검다리 자동 산책"** + **"WASD / 방향키 조종"** 컨트롤러
  - **`ExplorationHUD.tsx`**: 카메라 3인칭 추적 뷰 (`pitch: 45°`) + **🚨 하천 위험 구역 감지** 팝업 및 수질 샘플 획득/시민 현장 제보 팝업

---

## 📂 4. 디렉토리 구조 & 주요 파일 지도

```
stream/
├── AI_HANDOVER.md               # [THIS FILE] AI 작업 인계 및 개발 현황 문서
├── README.md                    # 프로젝트 기본 가이드
├── package.json                 # Node 의존성 (three.js 포함)
├── vite.config.ts               # Vite 설정 (maplibre-gl worker 복사 포함)
├── scripts/                     # Python AI 수집 & 모델링 스크립트
│   ├── fetch_busan_water_data.py# 부산 공공데이터 & 기상청 API 파서
│   ├── train_nowcast_shap.py    # Track A XGBoost + SHAP 학습 스크립트
│   └── track_b_lag_model.py     # Track B Streeter-Phelps & DLM & Isolation Forest
└── src/
    ├── App.tsx                  # 루트 컴포넌트 (모달 및 HUD 통합)
    ├── App.css                  # UI 스타일 (다크 모드, 3D 아바타, SHAP 모달, HUD)
    ├── components/
    │   ├── MapView.tsx          # MapLibre 3D 지도 & 포켓몬GO 카메라 추적
    │   ├── ControlPanel.tsx     # 트랙 전환 / 내 위치 확대 / 3D 탐사 스위치
    │   ├── MyLocationMarker.tsx # 일반 모드 내 위치 GPS 펄스 마커
    │   ├── AvatarMarker.tsx     # Three.js 3D 귀여운 사람 아바타 마커 (Mesh/Animation)
    │   ├── ExplorationHUD.tsx   # 포켓몬GO 탐사 HUD & 시민 제보 팝업
    │   ├── ShapDiagnosisModal.tsx # AI SHAP 원인 분석 & 이상치 경보 패널
    │   ├── CandidatePledgeBanner.tsx # 이태엽 공약 vs 행정 현실 실증 모달
    │   └── Legend.tsx           # 지도 범례
    ├── hooks/
    │   ├── useUserLocation.ts   # GPS 위치 추적 & WASD 키보드/산책 시뮬레이터
    │   ├── useRiskScores.ts     # Supabase 연동 & Mock 데이터 생성 훅
    │   └── useRiverGeometry.ts  # Overpass API 하천 좌표 훅
    ├── lib/
    │   ├── mockData.ts          # 실시간 위험도, SHAP 요인, 이상치 탐지 생성
    │   ├── mapStyle.ts          # 지도 색상 및 레이어 ID
    │   └── riverSegments.ts     # 하천 구간 매핑 (Turf.js)
    ├── store/
    │   └── useMapStore.ts       # Zustand 글로벌 상태 (Track, GPS위치, 포켓몬GO모드 등)
    └── types/
        └── risk.ts              # RiskScore, ShapFactor, Track, RiverName 타입 정의
```

---

## 🚀 5. 핵심 실행 명령어

```powershell
# 1. 개발 서버 실행 (http://localhost:5173)
powershell -ExecutionPolicy Bypass -Command "npm run dev"

# 2. 타입체크 및 프로덕션 빌드 검증
powershell -ExecutionPolicy Bypass -Command "npm run build"
```
