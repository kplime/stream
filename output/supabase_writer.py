"""
결과를 Supabase 클라우드 프로젝트의 risk_scores 테이블에 REST(PostgREST) upsert.

로컬 Docker Supabase는 절대 안 씀 — supabase.com 무료 클라우드 프로젝트를 requests로
직접 호출만 한다. SUPABASE_URL/SUPABASE_ANON_KEY 환경변수가 없으면(또는 요청이
실패하면) pandas DataFrame을 콘솔에 출력하는 것으로 조용히 대체한다.
"""

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd
import requests

from data.loader import _load_dotenv  # noqa: F401 - .env 로드 + stdout UTF-8 고정

TABLE = "risk_scores"


def _get_supabase_credentials() -> tuple[str | None, str | None]:
    """SUPABASE_URL/SUPABASE_ANON_KEY 우선, 없으면 프론트엔드가 쓰는 VITE_ 접두 변수로 폴백
    (같은 .env에 이미 들어있는 값을 재사용 — 굳이 두 번 넣게 만들 필요 없음)."""
    url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY")
    return url, key


def risk_level_from_score(score: float) -> str:
    if score >= 0.7:
        return "high"
    if score >= 0.3:
        return "medium"
    return "low"


def build_record(
    station_id: str,
    river_name: str,
    track: str,
    lat: float,
    lng: float,
    risk_score: float,
    briefing_text: str,
) -> dict:
    return {
        "station_id": station_id,
        "river_name": river_name,
        "track": track,
        "lat": lat,
        "lng": lng,
        "risk_score": round(float(risk_score), 4),
        "risk_level": risk_level_from_score(risk_score),
        "briefing_text": briefing_text,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def upsert_risk_scores(records: list[dict]) -> bool:
    """PostgREST upsert (Prefer: resolution=merge-duplicates, station_id+track 충돌 시 갱신).
    성공하면 True, 실패(자격증명 없음/네트워크 오류/테이블 없음 등)하면 False."""
    url, key = _get_supabase_credentials()
    if not url or not key:
        print("[Supabase] SUPABASE_URL/SUPABASE_ANON_KEY 미설정 — 콘솔 출력 폴백")
        return False

    endpoint = f"{url.rstrip('/')}/rest/v1/{TABLE}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    try:
        resp = requests.post(endpoint, headers=headers, json=records, timeout=10)
        if resp.status_code >= 400:
            print(f"[Supabase] upsert 실패 (HTTP {resp.status_code}): {resp.text[:300]} — 콘솔 출력 폴백")
            return False
        print(f"[Supabase] {len(records)}건 upsert 성공 ({url})")
        return True
    except requests.RequestException as e:
        print(f"[Supabase] 요청 실패 ({e}) — 콘솔 출력 폴백")
        return False


def write_results(records: list[dict]) -> None:
    """Supabase에 쓰기를 시도하고, 실패하면(자격증명 없음 포함) DataFrame으로 콘솔에 출력."""
    if upsert_risk_scores(records):
        return

    df = pd.DataFrame(records)
    print("\n[Supabase] (폴백) 결과 DataFrame:")
    with pd.option_context("display.max_columns", None, "display.width", 160):
        print(df)


if __name__ == "__main__":
    from data.loader import load_track_a_data
    from models.track_a import TrackAModel, FEATURE_COLUMNS
    from output.briefing import generate_briefing

    df, _ = load_track_a_data()
    model = TrackAModel().fit(df)

    # 데모: 최근 시점 3건을 station_id/lat/lng는 임의로 채워 upsert 형태로 변환
    demo_stations = [
        ("온천천-데모1", 35.2045, 129.0835),
        ("동천-데모1", 35.1500, 129.0600),
        ("괴정천-데모1", 35.0940, 128.9660),
    ]

    records = []
    for i, (station_id, lat, lng) in enumerate(demo_stations):
        row = df.iloc[-(i + 1)]
        x_raw = {f: float(row[f]) for f in FEATURE_COLUMNS}
        prob, contributions = model.predict(x_raw)
        briefing = generate_briefing(row["river_name"], prob, contributions)
        records.append(build_record(station_id, row["river_name"], "A", lat, lng, prob, briefing))

    print(f"\n[Supabase] {len(records)}건 기록 시도")
    write_results(records)
