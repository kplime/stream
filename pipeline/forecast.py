"""
부산 도심하천 시간·날짜별 위험도 예측 파이프라인
=================================================
기상청 ASOS + Open-Meteo 예보 + KHOA 조석예보 →
XGBoost 모델 → Supabase risk_forecast 테이블 push

48시간 (1시간 단위) 예측값 생성.

실행:
  python forecast.py
  python forecast.py --hours 72   # 72시간 예측
"""

from __future__ import annotations

import argparse
import json
import os
import pickle
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import pandas as pd
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "models"

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
DATA_GO_KR_KEY = os.getenv(
    "DATA_GO_KR_KEY",
)
KHOA_KEY = os.getenv(
    "KHOA_API_KEY",
)

BUSAN_OBS_CODE = "DT_0005"
KHOA_FCST_URL  = "https://apis.data.go.kr/1192136/tideFcstTime/GetTideFcstTimeApiService"

# 측정소별 하천 매핑
TRACK_A_LOCS = {"215", "216", "327", "328", "329"}
TRACK_B_LOCS = {"206", "207", "208", "312", "301"}
LOC_RIVER = {
    "215": "온천천", "216": "온천천", "327": "온천천", "328": "온천천", "329": "온천천",
    "206": "동천",   "207": "동천",   "208": "동천",   "312": "동천",
    "301": "괴정천",
}
LOC_COORDS = {
    "327": (35.2613, 129.0920), "215": (35.2372, 129.0885),
    "328": (35.2118, 129.0793), "216": (35.2003, 129.0825), "329": (35.1970, 129.0825),
    "312": (35.1506, 129.0582), "208": (35.1460, 129.0620),
    "207": (35.1380, 129.0645), "206": (35.1295, 129.0662),
    "301": (35.1019, 128.9778),
}

TIDE_DECAY = {"온천천": 0.5, "동천": 1.0, "괴정천": 0.3}


# ─────────────────────────────────────────────────────
# 1. Open-Meteo 시간별 기상 예보 (48~72h, 키 불필요)
# ─────────────────────────────────────────────────────

def fetch_weather_forecast(hours: int = 48) -> pd.DataFrame:
    """Open-Meteo에서 부산 시간별 기상 예보 취득."""
    url = (
        "https://api.open-meteo.com/v1/forecast"
        "?latitude=35.10&longitude=129.03"
        "&hourly=precipitation,temperature_2m,weathercode"
        "&timezone=Asia%2FSeoul"
        f"&forecast_days={max(2, hours // 24 + 1)}"
    )
    with urllib.request.urlopen(url, timeout=15) as r:
        data = json.loads(r.read())

    times = data["hourly"]["time"]          # ISO8601 (KST naive)
    rain  = data["hourly"]["precipitation"]
    temp  = data["hourly"]["temperature_2m"]

    df = pd.DataFrame({
        "dt": pd.to_datetime(times),        # KST
        "rain_mm": rain,
        "temp_c": temp,
    })
    df["dt"] = df["dt"].dt.tz_localize("Asia/Seoul").dt.tz_convert("UTC")
    now_utc = datetime.now(timezone.utc)
    df = df[df["dt"] >= now_utc].head(hours).reset_index(drop=True)
    print(f"[기상예보] {len(df)}시간 취득 (Open-Meteo, {df['dt'].iloc[0].strftime('%m-%d %H:%M')} ~ {df['dt'].iloc[-1].strftime('%m-%d %H:%M')} UTC)")
    return df


# ─────────────────────────────────────────────────────
# 2. KHOA 조석예보 (시계열, DT_0005 부산항)
# ─────────────────────────────────────────────────────

def _fetch_tide_page(date_str: str, page: int) -> list[tuple[int, float]]:
    params = urllib.parse.urlencode({
        "serviceKey": KHOA_KEY,
        "numOfRows": 100,
        "pageNo": page,
        "obsCode": BUSAN_OBS_CODE,
        "date": date_str,
    })
    with urllib.request.urlopen(f"{KHOA_FCST_URL}?{params}", timeout=12) as r:
        root = ET.fromstring(r.read())
    result = []
    for item in root.findall(".//item"):
        dt_str = item.findtext("predcDt", "")
        h = item.findtext("tdlvHgt", "")
        if dt_str and h:
            t = dt_str.split(" ")[1]
            hh, mm = map(int, t.split(":"))
            result.append((hh * 60 + mm, float(h)))
    return result


def fetch_tide_forecast(hours: int = 48) -> pd.DataFrame:
    """KHOA 조석예보로 향후 hours시간 동안 1시간 단위 조위 취득."""
    now_kst = datetime.now(timezone.utc).astimezone(
        __import__("zoneinfo").ZoneInfo("Asia/Seoul")
    )
    records = []
    for day_offset in range((hours // 24) + 2):
        target = now_kst + timedelta(days=day_offset)
        date_str = target.strftime("%Y%m%d")
        pages_seen = set()
        for hour in range(0, 24):
            page = hour * 60 // 100 + 1
            if page in pages_seen:
                continue
            pages_seen.add(page)
            try:
                pts = _fetch_tide_page(date_str, page)
                for (m, h) in pts:
                    dt = target.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=m)
                    records.append({"dt_kst": dt, "tide_cm": h})
            except Exception:
                pass

    df = pd.DataFrame(records)
    if df.empty:
        print("[WARN] 조위 예보 취득 실패 — 합성 데이터 사용")
        return _synthetic_tide_forecast(hours)

    df = df.drop_duplicates("dt_kst").sort_values("dt_kst").reset_index(drop=True)
    # 1시간 단위 resample
    df["dt_kst"] = pd.to_datetime(df["dt_kst"])
    df = df.set_index("dt_kst").resample("1h").mean().reset_index()
    df["dt"] = df["dt_kst"].dt.tz_convert("UTC")

    now_utc = datetime.now(timezone.utc)
    df = df[df["dt"] >= now_utc].head(hours).reset_index(drop=True)
    print(f"[조위예보] {len(df)}시간 취득 (KHOA DT_0005)")
    return df[["dt", "tide_cm"]]


def _synthetic_tide_forecast(hours: int) -> pd.DataFrame:
    from math import pi, cos
    ref = datetime(2000, 1, 1, tzinfo=timezone.utc)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    rows = []
    for i in range(hours):
        dt = now + timedelta(hours=i)
        t = (dt - ref).total_seconds() / 3600
        h = (180 + 67*cos(2*pi*t/12.4206) + 23*cos(2*pi*t/12.0)
             + 21*cos(2*pi*t/23.9345) + 14*cos(2*pi*t/25.8194))
        rows.append({"dt": dt, "tide_cm": round(h, 1)})
    return pd.DataFrame(rows)


# ─────────────────────────────────────────────────────
# 3. 현재 수질 기준값 로드 (최신 processed CSV)
# ─────────────────────────────────────────────────────

def load_current_readings() -> dict[str, dict]:
    """각 측정소의 최신 수질 측정값을 기준 피처로 반환."""
    wq = pd.read_csv(DATA_DIR / "water_quality_processed.csv", dtype=str)
    num_cols = ["pH", "DO", "SS", "TP", "EC", "TN", "수온"]
    for c in num_cols:
        if c in wq.columns:
            wq[c] = pd.to_numeric(wq[c], errors="coerce")

    latest = wq.sort_values("inspec_ym").groupby("inspec_loc").last().reset_index()
    result = {}
    for _, row in latest.iterrows():
        loc = str(row["inspec_loc"])
        result[loc] = {c: float(row[c]) if pd.notna(row.get(c)) else np.nan
                       for c in num_cols}
    return result


# ─────────────────────────────────────────────────────
# 4. 피처 조합 & 모델 예측
# ─────────────────────────────────────────────────────

def load_model(track: str):
    for name in [f"track_{track.lower()}_final_model.pkl",
                 f"track_{track.lower()}_rain_model.pkl",
                 f"track_{track.lower()}_model.pkl"]:
        p = MODEL_DIR / name
        if p.exists():
            with open(p, "rb") as f:
                return pickle.load(f)
    raise FileNotFoundError(f"모델 없음: track {track}")


def adjust_base_with_weather(base: dict, rain_24h: float, temp_c: float) -> dict:
    """
    기상 예보 기반 수질 기준값 물리적 보정.

    과학적 근거:
    - SS(탁도): 강수 시 CSO·비점오염 유입으로 증가 (Novotny & Olem, 1994)
    - DO: 수온 상승 → 포화 용존산소 감소 (Henry's Law / Benson-Krause)
           강수 시 BOD 유입으로 추가 저하
    - 수온: 기상 기온과 평형 방향으로 서서히 접근 (열 지연 반영)
    """
    m = dict(base)

    # 수온: 기온의 30% 반영 (열 지연)
    wt = base.get("수온", np.nan)
    if not np.isnan(wt):
        wt_est = wt * 0.7 + temp_c * 0.3
        m["수온"] = round(wt_est, 2)
    else:
        wt_est = temp_c * 0.85  # 수온 ≈ 기온의 85%

    # DO: 온도 포화도 공식 (Benson-Krause 근사) + 강수 BOD 유입
    do_base = base.get("DO", np.nan)
    if not np.isnan(do_base):
        do_sat = 14.62 - 0.3898 * wt_est + 0.006969 * wt_est ** 2  # mg/L
        # 강수 시 BOD 유입으로 DO 추가 저하 (20mm/24h당 약 15% 저하)
        rain_stress = min(rain_24h / 20.0 * 0.15, 0.40)
        m["DO"] = round(max(1.0, min(do_base, do_sat * 0.95) * (1.0 - rain_stress)), 2)

    # SS(탁도): 24h 강수당 증가 (15mm마다 1배, 최대 3배)
    ss_base = base.get("SS", np.nan)
    if not np.isnan(ss_base):
        ss_factor = 1.0 + rain_24h / 15.0
        m["SS"] = round(ss_base * min(ss_factor, 3.0), 2)

    return m


# 당월 강수량 기준 (보정 전 기본값, 8월 부산 평균)
MONTHLY_RAIN_BASELINE = 150.0


def build_feature_row(
    base: dict,
    rain_now_mm: float,
    rain_lag1_mm: float,
    rain_lag1_max: float,
    temp_c: float,
    tide_cm: float,
    river: str,
    month: int,
) -> dict:
    """모델 피처 딕셔너리 생성."""
    decay = TIDE_DECAY.get(river, 0.5)
    return {
        **base,
        "rain_total_mm":   rain_now_mm,
        "rain_lag1_mm":    rain_lag1_mm,
        "rain_lag1_max":   rain_lag1_max,
        "temp_avg_c":      temp_c,
        "tide_mean_cm":    tide_cm * decay,
        "tide_range_cm":   95.0 * decay,     # 부산항 평균 조차 근사값
        "tide_spring_proxy": 122.0 * decay,
        "tide_high_count": 6,                # 월 평균 만조 시간 근사
        "month":           month,
    }


def predict_forecast(
    weather_df: pd.DataFrame,
    tide_df: pd.DataFrame,
    hours: int = 48,
) -> list[dict]:
    pkg_a = load_model("A")
    pkg_b = load_model("B")
    current = load_current_readings()

    # 전월 강수량 (고정값 — 이미 실측)
    rain_lag1 = 180.0   # mm (부산 7~8월 평균)
    rain_lag1_max = 45.0

    # 날씨+조위 합치기
    merged = weather_df.merge(tide_df, on="dt", how="left")
    merged["tide_cm"] = merged["tide_cm"].ffill().fillna(100.0)

    # 배치 전체가 같은 generated_at을 갖도록 한 번만 찍는다.
    # (행마다 now()를 부르면 값이 미세하게 달라져 배치 단위 정리가 불가능해진다)
    batch_ts = datetime.now(timezone.utc).isoformat()

    rows = []
    # 모든 측정소에 Track A + Track B 둘 다 적용 (ml_pipeline.py 실시간 예측과 동일)
    # 하천별 주 트랙만 내보내면 프론트 팝업에서 한쪽 위험도가 비어 보인다.
    for loc, base in current.items():
        river  = LOC_RIVER.get(loc, "unknown")
        lat, lng = LOC_COORDS.get(loc, (35.17, 129.05))

        cumulative_rain = 0.0
        prev_date = None

        for i, wx_row in merged.iterrows():
            if i >= hours:
                break
            dt_utc: pd.Timestamp = wx_row["dt"]
            dt_kst = dt_utc.tz_convert("Asia/Seoul")

            # 날짜 바뀌면 당일 누적 초기화
            if prev_date and dt_kst.date() != prev_date:
                cumulative_rain = 0.0
            prev_date = dt_kst.date()
            cumulative_rain += float(wx_row["rain_mm"] or 0)

            # 24h 슬라이딩 윈도우 강수 (수질 보정용)
            rain_24h = merged.iloc[max(0, i - 23): i + 1]["rain_mm"].fillna(0).sum()

            # 조위: 24h 롤링 평균 → 월 평균 조위 프록시 (모델이 월 평균으로 훈련됨)
            tide_24h_mean = merged.iloc[max(0, i - 23): i + 1]["tide_cm"].mean()
            tide_for_model = tide_24h_mean if not np.isnan(tide_24h_mean) else float(wx_row["tide_cm"])

            # 월 강수량 = 기준값 + 24h 누적 강수 × 월 스케일 증폭 (3배)
            # 24h 20mm → 당월 총량 +60mm 증가로 해석
            rain_monthly = MONTHLY_RAIN_BASELINE + rain_24h * 3.0

            temp_c_now = float(wx_row["temp_c"] or 25.0)

            # 기상 기반 수질 보정 (SS↑, DO↓ when rain; DO↓ when warm)
            adjusted_base = adjust_base_with_weather(base, rain_24h=float(rain_24h), temp_c=temp_c_now)

            feat = build_feature_row(
                base=adjusted_base,
                rain_now_mm=rain_monthly,
                rain_lag1_mm=rain_lag1,
                rain_lag1_max=rain_lag1_max,
                temp_c=temp_c_now,
                tide_cm=tide_for_model,
                river=river,
                month=dt_kst.month,
            )

            # 피처는 시점당 한 번만 만들고 두 모델이 각자 필요한 컬럼만 골라 쓴다
            # (Track A는 DO, Track B는 tide_mean_cm 사용 등 피처 집합이 다름)
            for track, pkg in (("A", pkg_a), ("B", pkg_b)):
                feat_names = pkg["features"]
                model = pkg["model"]

                X = pd.DataFrame([{f: feat.get(f, np.nan) for f in feat_names}])
                X = X.apply(pd.to_numeric, errors="coerce").fillna(0.0)

                prob = float(model.predict_proba(X)[0, 1])
                level = "high" if prob >= 0.66 else "medium" if prob >= 0.33 else "low"

                rows.append({
                    "station_id":  f"{river}-{loc}",
                    "river_name":  river,
                    "track":       track,
                    "forecast_dt": dt_utc.isoformat(),
                    "hours_ahead": i + 1,
                    "risk_score":  round(prob, 3),
                    "risk_level":  level,
                    "rain_mm":     round(cumulative_rain, 1),
                    "tide_cm":     round(float(wx_row["tide_cm"]), 1),
                    "temp_c":      round(float(wx_row["temp_c"] or 25.0), 1),
                    "generated_at": batch_ts,
                })

    print(f"[예측] {len(rows)}건 생성 ({len(current)}개 측정소 × 2트랙 × {hours}시간)")
    return rows


# ─────────────────────────────────────────────────────
# 5. Supabase push
# ─────────────────────────────────────────────────────

def push_to_supabase(rows: list[dict]):
    if not (SUPABASE_URL and SUPABASE_KEY):
        out = DATA_DIR / "latest_forecast.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2, default=str)
        print(f"[Supabase 없음] 로컬 저장: {out}")
        return

    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 배치 upsert (500건씩)
    chunk = 500
    for i in range(0, len(rows), chunk):
        sb.table("risk_forecast").upsert(
            rows[i:i+chunk], on_conflict="station_id,track,forecast_dt"
        ).execute()
    print(f"[Supabase] risk_forecast upsert 완료: {len(rows)}건")

    # 이전 배치 잔여 행 정리.
    # upsert 키가 (station_id, track, forecast_dt)이므로 재실행 시각이 밀리면
    # 예보 시간대가 이동해 옛 행이 덮이지 않고 남는다. 그 행들은 hours_ahead가
    # 겹쳐 프론트에서 같은 측정소가 중복 조회되는 원인이 된다.
    if rows:
        batch_ts = rows[0]["generated_at"]
        res = sb.table("risk_forecast").delete().lt("generated_at", batch_ts).execute()
        removed = len(res.data or [])
        print(f"[Supabase] 이전 배치 잔여 행 정리: {removed}건 삭제")


# ─────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=int, default=48)
    args = parser.parse_args()

    print(f"=== 부산 하천 {args.hours}시간 예측 파이프라인 ===")
    weather = fetch_weather_forecast(args.hours)
    tide    = fetch_tide_forecast(args.hours)
    rows    = predict_forecast(weather, tide, args.hours)
    push_to_supabase(rows)

    # 요약 출력 — 모든 하천이 A/B 두 트랙을 모두 가지므로 트랙별로 전체 집계
    df = pd.DataFrame(rows)
    for track, label in (("A", "대장균 위험도"), ("B", "폐사 위험도")):
        print(f"\n[예측 요약] 전 하천 (Track {track}, {label})")
        sub = df[df["track"] == track].groupby("hours_ahead").agg(
            mean_score=("risk_score", "mean"),
            max_score=("risk_score", "max"),
        ).reset_index()
        for _, r in sub[sub["hours_ahead"].isin([6, 12, 24, 48])].iterrows():
            level = "HIGH" if r["max_score"] >= 0.66 else "MED" if r["max_score"] >= 0.33 else "LOW"
            print(f"  +{int(r['hours_ahead']):2d}h: 평균 {r['mean_score']:.0%}  최고 {r['max_score']:.0%}  [{level}]")

    # 하천별 트랙 커버리지 확인 (A/B 둘 다 나오는지 검증)
    print("\n[커버리지] 하천별 트랙")
    cov = df.groupby(["river_name", "track"])["station_id"].nunique().unstack(fill_value=0)
    print(cov.to_string())

    print("\n[DONE] 예측 완료")


if __name__ == "__main__":
    main()
