"""
KHOA 조위 데이터 통합 + 모델 재학습
=========================================
부산항(DT_0004) 조위 → 온천천·동천·괴정천 각 위험도 모델에 추가

조위가 위험도에 미치는 경로:
  동천   : 감조구간 직접 영향 — 만조 시 역류 → DO 저하 → 폐사위험
  온천천  : 수영강 하구 간접 영향 — 비교적 약함 (decay 0.5 적용)
  괴정천  : 낙동강 하구 조위 — 가장 원거리 (decay 0.3)

API 신청:
  data.go.kr → 국립해양조사원_1시간 조위(조석성과)   → 과거 학습용
  data.go.kr → 국립해양조사원_조석예보(시계열)        → 실시간 예측용
"""

from __future__ import annotations

import json
import os
import pickle
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from dotenv import load_dotenv
from sklearn.model_selection import StratifiedKFold, cross_val_score

load_dotenv(Path(__file__).parent / ".env")

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "models"

# data.go.kr 공통 키로 KHOA API 사용 가능 (신청 완료)
KHOA_KEY = os.getenv(
    "KHOA_API_KEY",
)

# 부산항 조위관측소 코드 (KHOA, lat=35.096 lon=129.035 확인)
BUSAN_OBS_CODE = "DT_0005"

# KHOA API 엔드포인트
KHOA_FCST_URL = "https://apis.data.go.kr/1192136/tideFcstTime/GetTideFcstTimeApiService"
KHOA_OBS_URL  = "https://apis.data.go.kr/1192136/hourlyTide/GetHourlyTideApiService"

# 하천별 조위 영향 계수 (부산항 기준)
TIDE_DECAY = {
    "동천":   1.0,   # 감조구간 직접 영향
    "온천천":  0.5,   # 수영강 하구 간접
    "괴정천":  0.3,   # 낙동강 하구 원거리
}

TRACK_A_LOCS = {"215", "216", "327", "328", "329"}
TRACK_B_LOCS = {"206", "207", "208", "312", "301"}

LOC_RIVER = {
    "215": "온천천", "216": "온천천", "327": "온천천", "328": "온천천", "329": "온천천",
    "206": "동천",   "207": "동천",   "208": "동천",   "312": "동천",
    "301": "괴정천",
}


# ──────────────────────────────────────────────────
# 1. KHOA 1시간 조위 다운로드 (과거 학습용)
# ──────────────────────────────────────────────────

def fetch_khoa_hourly(year: int, month: int) -> list[dict]:
    """KHOA 1시간 조위(조석성과) API 조회."""
    if not KHOA_KEY:
        return []

    ym = f"{year}{month:02d}"
    days_in_month = 31 if month in [1,3,5,7,8,10,12] else 30 if month != 2 else (29 if year % 4 == 0 else 28)

    url = "https://www.khoa.go.kr/api/oceangrid/tideObsHhFm/search.do"
    params = urllib.parse.urlencode({
        "ServiceKey": KHOA_KEY,
        "ObsCode": BUSAN_OBS_CODE,
        "Date": ym,
        "ResultType": "json",
    })
    try:
        with urllib.request.urlopen(f"{url}?{params}", timeout=15) as r:
            data = json.loads(r.read())
        return data.get("result", {}).get("data", [])
    except Exception as e:
        print(f"  [WARN] KHOA {ym} 조회 실패: {e}")
        return []


def download_tide_history(start_ym: str = "199201", end_ym: str = "202607") -> pd.DataFrame:
    """KHOA API로 월별 조위 통계 다운로드. 키 없으면 합성 데이터 생성."""
    cache = DATA_DIR / "tide_monthly.csv"
    if cache.exists():
        print(f"[조위] 캐시 로드: {cache}")
        return pd.read_csv(cache)

    if not KHOA_KEY:
        print("[조위] KHOA 키 없음 → 부산항 조석 합성 데이터 생성")
        return generate_synthetic_tide(start_ym, end_ym)

    print(f"[조위] KHOA API 다운로드 {start_ym} ~ {end_ym}")
    records = []
    y0, m0 = int(start_ym[:4]), int(start_ym[4:])
    y1, m1 = int(end_ym[:4]), int(end_ym[4:])

    y, m = y0, m0
    while (y, m) <= (y1, m1):
        items = fetch_khoa_hourly(y, m)
        if items:
            heights = [float(d.get("tide", 0)) for d in items if d.get("tide")]
            ym_str = f"{y}{m:02d}"
            records.append(_tide_stats(ym_str, heights))
        m += 1
        if m > 12:
            m = 1; y += 1

    if records:
        df = pd.DataFrame(records)
        df.to_csv(cache, index=False)
        print(f"  KHOA 다운로드 완료: {len(df)}개월")
        return df
    else:
        print("  KHOA 데이터 없음 → 합성 데이터로 대체")
        return generate_synthetic_tide(start_ym, end_ym)


def _tide_stats(ym: str, heights: list[float]) -> dict:
    """시간별 조위 리스트 → 월별 통계."""
    h = np.array(heights)
    return {
        "ym": ym,
        "tide_mean_cm": float(np.mean(h)),
        "tide_max_cm": float(np.max(h)),
        "tide_min_cm": float(np.min(h)),
        "tide_range_cm": float(np.max(h) - np.min(h)),   # 월 평균 조차
        "tide_high_count": int((h > np.percentile(h, 75)).sum()),  # 만조 시간 수
        "tide_spring_proxy": float(np.percentile(h, 95)),  # 삭망조 대리 지표
    }


# ──────────────────────────────────────────────────
# 부산항 조석 합성 데이터 (KHOA 키 없을 때)
# 부산항 주요 조화상수 기반 근사:
#   M2(주요 반일주조): 진폭 ~67cm, 주기 12.42h
#   S2(태양 반일주조): 진폭 ~23cm
#   K1(일주조): 진폭 ~21cm
# ──────────────────────────────────────────────────

def generate_synthetic_tide(start_ym: str, end_ym: str) -> pd.DataFrame:
    """부산항 조화상수 기반 합성 조위 월별 통계 생성."""
    from math import pi, cos

    y0, m0 = int(start_ym[:4]), int(start_ym[4:])
    y1, m1 = int(end_ym[:4]), int(end_ym[4:])

    # 부산항 조화상수 (cm)
    M2_amp, M2_period = 67.0, 12.4206   # 시간
    S2_amp, S2_period = 23.0, 12.0
    K1_amp, K1_period = 21.0, 23.9345
    O1_amp, O1_period = 14.0, 25.8194
    MSL = 180.0   # 평균해수면 (부산항 기준 약 180cm)

    records = []
    y, m = y0, m0
    ref = datetime(2000, 1, 1)  # 기준 시각

    while (y, m) <= (y1, m1):
        days = 31 if m in [1,3,5,7,8,10,12] else 30 if m != 2 else (29 if y % 4 == 0 else 28)
        heights = []
        for day in range(days):
            for hour in range(24):
                dt = datetime(y, m, day+1, hour)
                t = (dt - ref).total_seconds() / 3600  # 기준 시각부터 경과 시간(h)
                h = (MSL
                     + M2_amp * cos(2*pi*t / M2_period)
                     + S2_amp * cos(2*pi*t / S2_period)
                     + K1_amp * cos(2*pi*t / K1_period)
                     + O1_amp * cos(2*pi*t / O1_period))
                heights.append(h)

        ym_str = f"{y}{m:02d}"
        records.append(_tide_stats(ym_str, heights))
        m += 1
        if m > 12:
            m = 1; y += 1

    df = pd.DataFrame(records)
    df.to_csv(DATA_DIR / "tide_monthly.csv", index=False)
    print(f"  합성 조위 생성 완료: {len(df)}개월 (부산항 조화상수 기반)")
    return df


# ──────────────────────────────────────────────────
# 2. 조위 + 수질 + 강수 병합
# ──────────────────────────────────────────────────

def merge_all(tide_df: pd.DataFrame) -> pd.DataFrame:
    """수질(processed) + 강수(rainfall) + 조위(tide) 3-way 병합."""
    wq = pd.read_csv(DATA_DIR / "water_quality_processed.csv", dtype=str)
    rain = pd.read_csv(DATA_DIR / "rainfall_monthly.csv")

    # 수치 변환
    num_cols = ["pH", "DO", "SS", "TP", "대장균총", "분원성대장균", "수온", "EC", "TN",
                "label_A", "label_B", "year", "month"]
    for col in num_cols:
        if col in wq.columns:
            wq[col] = pd.to_numeric(wq[col], errors="coerce")

    # 하천명 추가
    wq["river_name"] = wq["inspec_loc"].map(LOC_RIVER)

    # 조위 decay 적용 (하천별 영향 계수 보정)
    tide_cols = ["tide_mean_cm", "tide_max_cm", "tide_range_cm",
                 "tide_high_count", "tide_spring_proxy"]

    rain["ym"] = rain["ym"].astype(str)
    tide_df["ym"] = tide_df["ym"].astype(str)
    merged = wq.merge(rain, left_on="inspec_ym", right_on="ym", how="left")
    merged = merged.merge(tide_df[["ym"] + tide_cols], left_on="inspec_ym", right_on="ym",
                          how="left", suffixes=("", "_tide"))

    # 하천별 조위 영향 계수 적용
    for col in tide_cols:
        if col in merged.columns:
            decay = merged["river_name"].map(TIDE_DECAY).fillna(0.3)
            merged[col] = merged[col] * decay

    print(f"[병합] 수질+강수+조위 통합: {len(merged)}건")
    print(f"  조위 매칭률: {merged['tide_mean_cm'].notna().mean()*100:.1f}%")
    return merged


# ──────────────────────────────────────────────────
# 3. 모델 재학습 (조위 포함)
# ──────────────────────────────────────────────────

FEATURES_A = [
    "pH", "DO", "수온", "EC", "TP", "SS",
    "rain_total_mm", "rain_lag1_mm", "rain_lag1_max", "temp_avg_c",
    # 조위 피처
    "tide_range_cm",      # 월 조차 (클수록 역류 강함)
    "tide_spring_proxy",  # 삭망조 강도
    "tide_high_count",    # 만조 시간 수
    "month",
]

FEATURES_B = [
    "pH", "수온", "EC", "TP", "SS",
    "rain_total_mm", "rain_lag1_mm", "rain_lag1_max", "temp_avg_c",
    # 조위 피처 — Track B (폐사)에서 특히 중요
    "tide_mean_cm",       # 월 평균 조위
    "tide_range_cm",      # 월 조차
    "tide_spring_proxy",  # 삭망조 강도
    "tide_high_count",    # 만조 시간 수
    "month",
]


def train_final(df: pd.DataFrame, track: str) -> tuple:
    if track == "A":
        mask = df["inspec_loc"].isin(TRACK_A_LOCS)
        label_col = "label_A"
        features = FEATURES_A
        name = "Track A - 대장균 Nowcast + 조위 (온천천)"
        prev_auc = 0.837
    else:
        mask = df["inspec_loc"].isin(TRACK_B_LOCS)
        label_col = "label_B"
        features = FEATURES_B
        name = "Track B - 폐사위험 + 조위 (동천 괴정천)"
        prev_auc = 0.924

    sub = df[mask & df[label_col].notna()].copy()
    available = [f for f in features if f in sub.columns]
    X = sub[available].fillna(sub[available].median())
    y = sub[label_col].astype(int)

    print(f"\n[{name}]")
    print(f"  피처 {len(available)}개 (조위 포함)")
    print(f"  샘플: {len(X)}건 (위험={y.sum()}, 안전={len(y)-y.sum()})")

    pos_ratio = y.sum() / len(y)
    scale_pos = (1 - pos_ratio) / max(pos_ratio, 0.01)

    model = xgb.XGBClassifier(
        n_estimators=400, max_depth=4, learning_rate=0.04,
        subsample=0.8, colsample_bytree=0.8,
        scale_pos_weight=scale_pos,
        eval_metric="auc", random_state=42, verbosity=0,
    )

    cv = StratifiedKFold(n_splits=min(5, int(y.sum())), shuffle=True, random_state=42)
    scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")
    new_auc = scores.mean()
    delta = new_auc - prev_auc
    sign = "+" if delta >= 0 else ""
    print(f"  CV AUC: {prev_auc:.3f} -> {new_auc:.3f}  ({sign}{delta:.3f})")

    model.fit(X, y)

    # SHAP
    explainer = shap.TreeExplainer(model)
    sv = explainer.shap_values(X)
    imp = pd.DataFrame({
        "feature": available,
        "mean_shap": np.abs(sv).mean(axis=0),
    }).sort_values("mean_shap", ascending=False)

    print(f"\n  [SHAP] 피처 중요도 (조위 강조):")
    max_s = imp["mean_shap"].max()
    for _, r in imp.iterrows():
        bar = "#" * int(r["mean_shap"] / max_s * 22)
        tag = ""
        if "tide" in r["feature"]:
            tag = " <-- 조위"
        elif "rain" in r["feature"]:
            tag = " <-- 강수"
        elif r["feature"] == "temp_avg_c":
            tag = " <-- 기온"
        print(f"    {r['feature']:22s} {bar} {r['mean_shap']:.4f}{tag}")

    key = "a" if track == "A" else "b"
    with open(MODEL_DIR / f"track_{key}_final_model.pkl", "wb") as f:
        pickle.dump({"model": model, "features": available}, f)
    imp.to_csv(DATA_DIR / f"shap_track_{key}_final.csv", index=False)
    print(f"  저장: models/track_{key}_final_model.pkl")
    return model, available, new_auc


# ──────────────────────────────────────────────────
# 4. 실시간 조위 조회 (파이프라인용)
# ──────────────────────────────────────────────────

def fetch_tide_realtime() -> dict[str, float]:
    """현재 조위 실시간 조회.
    조석예보(시계열) API: 오늘 1분 단위 1440개 예측값 → 현재 시각 보간.
    실패 시 조화상수 합성으로 자동 fallback."""
    now = datetime.now()
    date_str = now.strftime("%Y%m%d")

    try:
        from xml.etree import ElementTree as ET

        # API max numOfRows=100. 현재 분 기준 페이지 계산 (1분 단위 1440개)
        current_min = now.hour * 60 + now.minute
        rows = 100
        page_now = current_min // rows + 1        # 현재 시각 포함 페이지
        page_first = 1                            # 하루 최고/최저 계산용 전체 조회

        def _fetch_page(page: int) -> list:
            params = urllib.parse.urlencode({
                "serviceKey": KHOA_KEY,
                "numOfRows": rows,
                "pageNo": page,
                "obsCode": BUSAN_OBS_CODE,
                "date": date_str,
            })
            with urllib.request.urlopen(f"{KHOA_FCST_URL}?{params}", timeout=12) as r:
                root = ET.fromstring(r.read())
            out = []
            for item in root.findall(".//item"):
                dt_str = item.findtext("predcDt", "")
                h = item.findtext("tdlvHgt", "")
                if dt_str and h:
                    t = dt_str.split(" ")[1]
                    hh, mm = map(int, t.split(":"))
                    out.append((hh * 60 + mm, float(h)))
            return out

        # 현재 시각 전후 페이지 가져오기
        heights_now = _fetch_page(page_now)
        if not heights_now:
            return _synthetic_tide_now()

        # 하루 전체 min/max: 1, 8, 15페이지 샘플링
        all_heights = heights_now[:]
        for p in [1, 8, 15]:
            if p != page_now:
                try:
                    all_heights += _fetch_page(p)
                except Exception:
                    pass

        current_cm = min(heights_now, key=lambda x: abs(x[0] - current_min))[1]
        prev_min = current_min - 1
        prev_cm_matches = [h for m, h in heights_now if m == prev_min]
        prev_cm = prev_cm_matches[0] if prev_cm_matches else current_cm - 0.5

        all_cm = [h for _, h in all_heights]
        result = {
            "tide_height_cm": round(current_cm, 1),
            "tide_rising": current_cm > prev_cm,
            "tide_phase": _phase(current_cm, prev_cm),
            "tide_max_today_cm": round(max(all_cm), 1),
            "tide_min_today_cm": round(min(all_cm), 1),
            "tide_range_today_cm": round(max(all_cm) - min(all_cm), 1),
            "source": "KHOA_forecast",
        }
        print(f"  [KHOA 조석예보 DT_0005] {current_cm:.1f}cm ({result['tide_phase']}) "
              f"| 오늘 조차: {result['tide_range_today_cm']:.1f}cm")
        return result

    except Exception as e:
        print(f"  [WARN] KHOA 조석예보 실패: {e} -> 합성 데이터 사용")
        return _synthetic_tide_now()


def _synthetic_tide_now() -> dict[str, float]:
    """KHOA 키 없을 때 조화상수로 현재 조위 계산."""
    from math import pi, cos
    now = datetime.now()
    ref = datetime(2000, 1, 1)
    t = (now - ref).total_seconds() / 3600
    M2_amp, M2_period = 67.0, 12.4206
    S2_amp, S2_period = 23.0, 12.0
    K1_amp, K1_period = 21.0, 23.9345
    O1_amp, O1_period = 14.0, 25.8194
    MSL = 180.0
    height = (MSL + M2_amp * cos(2*pi*t/M2_period) + S2_amp * cos(2*pi*t/S2_period)
              + K1_amp * cos(2*pi*t/K1_period) + O1_amp * cos(2*pi*t/O1_period))
    prev = (MSL + M2_amp * cos(2*pi*(t-1)/M2_period) + S2_amp * cos(2*pi*(t-1)/S2_period)
            + K1_amp * cos(2*pi*(t-1)/K1_period) + O1_amp * cos(2*pi*(t-1)/O1_period))
    return {
        "tide_height_cm": round(height, 1),
        "tide_rising": height > prev,
        "tide_phase": _phase(height, prev),
        "source": "synthetic",
    }


def _parse_tide(current_cm: float, items: list) -> dict:
    heights = [float(x.get("tide", 0)) for x in items if x.get("tide")]
    prev = heights[-2] if len(heights) >= 2 else current_cm - 1
    return {
        "tide_height_cm": round(current_cm, 1),
        "tide_rising": current_cm > prev,
        "tide_phase": _phase(current_cm, prev),
        "tide_max_today_cm": max(heights) if heights else current_cm,
        "tide_range_today_cm": (max(heights) - min(heights)) if heights else 0,
        "source": "KHOA",
    }


def _phase(now: float, prev: float) -> str:
    diff = now - prev
    if diff > 5:
        return "rising"
    elif diff < -5:
        return "falling"
    elif now > 220:
        return "high"
    else:
        return "low"


# ──────────────────────────────────────────────────
# main
# ──────────────────────────────────────────────────

def main():
    tide = download_tide_history()
    df = merge_all(tide)

    _, _, auc_a = train_final(df, "A")
    _, _, auc_b = train_final(df, "B")

    print("\n" + "="*52)
    print("최종 모델 AUC 비교 (강수 전 -> 강수 후 -> 조위 추가)")
    print("="*52)
    print(f"  Track A (대장균):  0.820 -> 0.837 -> {auc_a:.3f}")
    print(f"  Track B (폐사위험): 0.908 -> 0.924 -> {auc_b:.3f}")

    print("\n[실시간 조위 테스트]")
    t = fetch_tide_realtime()
    print(f"  현재 부산항 조위: {t['tide_height_cm']} cm  "
          f"({t['tide_phase']}  {'상승중' if t['tide_rising'] else '하강중'})  [{t['source']}]")

    print("\n[DONE] 조위 통합 완료")
    print("  최종 모델: models/track_a_final_model.pkl")
    print("             models/track_b_final_model.pkl")
    if not KHOA_KEY:
        print("\n  *** KHOA 키 발급 후 pipeline/.env에 KHOA_API_KEY 추가하면")
        print("      실측 조위 데이터로 자동 교체됩니다 ***")


if __name__ == "__main__":
    main()
