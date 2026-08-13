"""
부산 하천 수질 데이터 파이프라인
공공데이터포털 자동측정망 API + 기상청 ASOS → XGBoost 모델 → Supabase risk_scores push

사용법:
  pip install requests supabase python-dotenv xgboost shap scikit-learn pandas
  python fetch_and_push.py

필요한 .env 파일 (pipeline/.env):
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_KEY=your-service-role-key
  DATA_GO_KR_KEY=your-data-go-kr-api-key
"""

from __future__ import annotations

import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
DATA_GO_KR_KEY = os.getenv(
    "DATA_GO_KR_KEY",
)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

# ────────────────────────────────────────────
# 부산 자동측정망 측정소 목록 (공공데이터포털 기준)
# ────────────────────────────────────────────
STATIONS: list[dict[str, Any]] = [
    # Track A — 온천천 (대장균 Nowcast)
    {"station_id": "온천천-216", "river_name": "온천천", "track": "A", "lat": 35.2003, "lng": 129.0825},
    {"station_id": "온천천-328", "river_name": "온천천", "track": "A", "lat": 35.2118, "lng": 129.0793},
    {"station_id": "온천천-329", "river_name": "온천천", "track": "A", "lat": 35.1970, "lng": 129.0825},
    # Track B — 동천 (폐사위험)
    {"station_id": "동천-207",  "river_name": "동천",   "track": "B", "lat": 35.1380, "lng": 129.0645},
    {"station_id": "동천-208",  "river_name": "동천",   "track": "B", "lat": 35.1460, "lng": 129.0620},
    # Track B — 괴정천 (폐사위험, OSM 기준 좌표)
    {"station_id": "괴정천-301", "river_name": "괴정천", "track": "B", "lat": 35.1019, "lng": 128.9778},
]

# ────────────────────────────────────────────
# 기상청 ASOS 시간자료 조회 (부산 stnId=159)
# API: 기상청지상(종관,ASOS) 시간자료 조회서비스
# ────────────────────────────────────────────
ASOS_URL = "https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList"
BUSAN_STN = "159"


def fetch_kma_realtime(lat: float = 35.10, lon: float = 129.03) -> dict[str, float]:
    """어제 전체 ASOS 시간자료 조회 → 일강수량 합계 + 평균기온 반환.
    ASOS는 당일 실시간 확정치 제공이 지연되므로 어제 데이터를 사용."""
    from datetime import timedelta
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")

    params = {
        "serviceKey": DATA_GO_KR_KEY,
        "pageNo": 1,
        "numOfRows": 24,
        "dataType": "JSON",
        "dataCd": "ASOS",
        "dateCd": "HR",
        "startDt": yesterday,
        "startHh": "00",
        "endDt": yesterday,
        "endHh": "23",
        "stnIds": BUSAN_STN,
    }
    r = requests.get(ASOS_URL, params=params, timeout=10)
    r.raise_for_status()

    body = r.json()["response"].get("body")
    if not body:
        raise ValueError("ASOS: no body in response")

    items = body["items"]["item"]
    if isinstance(items, dict):
        items = [items]

    rain_total = 0.0
    temps = []
    for item in items:
        rn = item.get("rn")
        ta = item.get("ta")
        if rn and str(rn).strip():
            try:
                rain_total += float(rn)
            except ValueError:
                pass
        if ta and str(ta).strip():
            try:
                temps.append(float(ta))
            except ValueError:
                pass

    print(f"  [ASOS] {yesterday} 강수합계: {rain_total:.1f} mm, 평균기온: {sum(temps)/len(temps):.1f}°C ({len(items)}시간)")
    return {
        "precipitation_mm": round(rain_total, 1),
        "temperature_c": round(sum(temps) / len(temps), 1) if temps else 25.0,
    }


# ────────────────────────────────────────────
# 공공데이터포털 부산 하천 자동측정망
# ────────────────────────────────────────────
def fetch_water_quality(station_id: str) -> dict[str, float] | None:
    """
    API: 부산광역시_하천 수질(자동측정망) 정보
    실제 필드명은 API 응답 확인 후 수정 필요.
    """
    url = "https://apis.data.go.kr/6260000/BusanWaterQuality/getBusanWaterQualityList"
    params = {
        "serviceKey": DATA_GO_KR_KEY,
        "pageNo": 1,
        "numOfRows": 1,
        "type": "json",
        "msurSttnNm": station_id,
    }
    try:
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        body = r.json().get("response", {}).get("body", {})
        items = body.get("items", {}).get("item", [])
        if not items:
            return None
        item = items[0] if isinstance(items, list) else items
        return {
            "turbidity_ntu": float(item.get("tbdn", 0)),   # 탁도
            "do_mgl": float(item.get("do", 0)),             # 용존산소
            "temperature_c": float(item.get("wtTp", 25)),  # 수온
            "ph": float(item.get("ph", 7)),
        }
    except Exception as e:
        print(f"  [WARN] water quality fetch failed for {station_id}: {e}")
        return None


# ────────────────────────────────────────────
# 위험도 산출 (룰베이스 — ML 모델 완성 전 임시)
# Track A: EPA Nowcast 근사 (탁도 + 강수 조합)
# Track B: DO 기반 폐사위험 (Streeter-Phelps 근사)
# ────────────────────────────────────────────
DO_CRIT = 3.0  # mg/L — 어류 치사 임계값

def compute_risk_track_a(wq: dict, weather: dict) -> tuple[float, str]:
    """대장균 접촉위험 (온천천)"""
    turbidity = wq.get("turbidity_ntu", 0)
    rain = weather.get("precipitation_mm", 0)

    # 탁도 기여 (NTU → 초과확률 근사)
    turbidity_score = min(turbidity / 100.0, 1.0)
    # 강수 기여 (CSO 유발 기준 ~5mm/h 이상)
    rain_score = min(rain / 10.0, 1.0)

    score = 0.6 * turbidity_score + 0.4 * rain_score
    level = "high" if score >= 0.66 else "medium" if score >= 0.33 else "low"
    return round(score, 3), level


def compute_risk_track_b(wq: dict, weather: dict) -> tuple[float, str]:
    """폐사위험 (동천·괴정천) — DO 기반"""
    do_val = wq.get("do_mgl", 8.0)
    rain = weather.get("precipitation_mm", 0)

    # DO 감소 위험: DO_CRIT 이하면 즉각 위험
    do_deficit = max(0, DO_CRIT - do_val) / DO_CRIT
    # 강수 이후 DO 저하 지연효과 (lag 반영 — 단순화)
    lag_factor = min(rain / 15.0, 0.4)

    score = min(do_deficit + lag_factor, 1.0)
    level = "high" if score >= 0.66 else "medium" if score >= 0.33 else "low"
    return round(score, 3), level


# ────────────────────────────────────────────
# 메인 루프
# ────────────────────────────────────────────
def run_once():
    print(f"[{datetime.now(timezone.utc).isoformat()}] 파이프라인 실행 시작")
    rows = []

    # 기상 데이터 (부산 공통 — 격자 1개로 대표)
    try:
        weather = fetch_kma_realtime(lat=35.17, lon=129.055)
        print(f"  기상: 강수 {weather['precipitation_mm']} mm/h, 기온 {weather['temperature_c']} °C")
    except Exception as e:
        print(f"  [WARN] 기상 API 실패, 0 사용: {e}")
        weather = {"precipitation_mm": 0.0, "temperature_c": 25.0}

    for s in STATIONS:
        wq = fetch_water_quality(s["station_id"])
        if wq is None:
            # 괴정천 등 센서 없는 구간: 기상 데이터만으로 추정
            wq = {"turbidity_ntu": weather["precipitation_mm"] * 8, "do_mgl": 7.0, "temperature_c": weather["temperature_c"], "ph": 7.0}
            print(f"  {s['station_id']}: 수질 API 없음 → 강수 기반 추정")

        if s["track"] == "A":
            score, level = compute_risk_track_a(wq, weather)
        else:
            score, level = compute_risk_track_b(wq, weather)

        rows.append({
            "station_id": s["station_id"],
            "river_name": s["river_name"],
            "track": s["track"],
            "lat": s["lat"],
            "lng": s["lng"],
            "risk_score": score,
            "risk_level": level,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        print(f"  {s['station_id']}: score={score}, level={level}")

    # Supabase upsert
    res = supabase.table("risk_scores").upsert(rows, on_conflict="station_id,track").execute()
    print(f"  Supabase upsert 완료: {len(res.data)} rows")


if __name__ == "__main__":
    # 5분마다 반복 실행 (해커톤 데모 중에는 foreground로 돌려두면 됨)
    while True:
        try:
            run_once()
        except Exception as e:
            print(f"[ERROR] {e}")
        print("  다음 실행까지 300초 대기...\n")
        time.sleep(300)
