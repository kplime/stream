"""
Open-Meteo 역사 강수량 데이터 다운로드 + 수질 데이터와 병합 + 모델 재학습
키 없음 / 가입 불필요

실행:
  python add_rainfall.py
"""

from __future__ import annotations

import json
import pickle
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.ensemble import IsolationForest

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "models"

# 부산 좌표
LAT, LON = 35.10, 129.03

TRACK_A_LOCS = {"215", "216", "327", "328", "329"}
TRACK_B_LOCS = {"206", "207", "208", "312", "301"}


# ──────────────────────────────────────────────────
# 1. Open-Meteo 강수량 다운로드 (1992-2026)
# ──────────────────────────────────────────────────

def download_rainfall(start: str = "1992-01-01", end: str = "2026-07-31") -> pd.DataFrame:
    cache = DATA_DIR / "rainfall_monthly.csv"
    if cache.exists():
        print(f"[강수량] 캐시 로드: {cache}")
        return pd.read_csv(cache)

    print(f"[강수량] Open-Meteo 다운로드 {start} ~ {end} ...")

    # Open-Meteo는 1회 요청 최대 약 20년치 — 두 구간으로 나눔
    chunks = [
        ("1992-01-01", "2010-12-31"),
        ("2011-01-01", end),
    ]
    daily_records = []
    for s, e in chunks:
        url = (
            f"https://archive-api.open-meteo.com/v1/archive"
            f"?latitude={LAT}&longitude={LON}"
            f"&start_date={s}&end_date={e}"
            f"&daily=precipitation_sum,temperature_2m_max,temperature_2m_min"
            f"&timezone=Asia%2FSeoul"
        )
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.loads(r.read())

        for date, rain, tmax, tmin in zip(
            data["daily"]["time"],
            data["daily"]["precipitation_sum"],
            data["daily"]["temperature_2m_max"],
            data["daily"]["temperature_2m_min"],
        ):
            daily_records.append({
                "date": date,
                "rain_mm": rain or 0.0,
                "tmax_c": tmax,
                "tmin_c": tmin,
            })
        print(f"  {s} ~ {e}: {len(data['daily']['time'])}일")

    daily = pd.DataFrame(daily_records)
    daily["date"] = pd.to_datetime(daily["date"])
    daily["ym"] = daily["date"].dt.strftime("%Y%m")

    # 월별 집계
    monthly = daily.groupby("ym").agg(
        rain_total_mm=("rain_mm", "sum"),       # 월 총 강수량
        rain_max_day_mm=("rain_mm", "max"),     # 월 최대 일강수량 (CSO 급변 지표)
        rain_days=("rain_mm", lambda x: (x > 1).sum()),  # 강우일수
        temp_avg_c=("tmax_c", "mean"),           # 평균 최고기온
    ).reset_index()

    # 시차 변수 (CSO 지연효과: 비 온 후 1~2개월 수질 영향)
    monthly = monthly.sort_values("ym").reset_index(drop=True)
    monthly["rain_lag1_mm"] = monthly["rain_total_mm"].shift(1)   # 전월 강수량
    monthly["rain_lag2_mm"] = monthly["rain_total_mm"].shift(2)   # 전전월 강수량
    monthly["rain_lag1_max"] = monthly["rain_max_day_mm"].shift(1)

    monthly.to_csv(cache, index=False)
    print(f"  월별 집계 완료: {len(monthly)}개월 -> {cache}")
    return monthly


# ──────────────────────────────────────────────────
# 2. 수질 데이터 + 강수량 병합
# ──────────────────────────────────────────────────

def merge_data(monthly_rain: pd.DataFrame) -> pd.DataFrame:
    wq = pd.read_csv(DATA_DIR / "water_quality_processed.csv", dtype=str)

    # 숫자 컬럼 변환
    num_cols = ["pH", "DO", "SS", "TP", "대장균총", "분원성대장균", "수온", "EC", "TN",
                "label_A", "label_B", "year", "month"]
    for col in num_cols:
        if col in wq.columns:
            wq[col] = pd.to_numeric(wq[col], errors="coerce")

    # 병합 키 = inspec_ym
    merged = wq.merge(monthly_rain, left_on="inspec_ym", right_on="ym", how="left")
    print(f"[병합] 수질 {len(wq)}건 + 강수량 병합 -> {len(merged)}건")
    print(f"  강수량 매칭률: {merged['rain_total_mm'].notna().mean()*100:.1f}%")
    return merged


# ──────────────────────────────────────────────────
# 3. 모델 재학습 (강수량 포함)
# ──────────────────────────────────────────────────

FEATURES_A = [
    "pH", "DO", "수온", "EC", "TP", "SS",
    "rain_total_mm",    # 측정 당월 강수량
    "rain_lag1_mm",     # 전월 강수량
    "rain_lag1_max",    # 전월 최대 일강수량 (CSO 급변 신호)
    "temp_avg_c",       # 기온
    "month",
]

FEATURES_B = [
    "pH", "수온", "EC", "TP", "SS",
    "rain_total_mm",
    "rain_lag1_mm",
    "rain_lag1_max",
    "temp_avg_c",
    "month",
]


def train_with_rainfall(df: pd.DataFrame, track: str) -> tuple:
    if track == "A":
        mask = df["inspec_loc"].isin(TRACK_A_LOCS)
        label_col = "label_A"
        features = FEATURES_A
        name = "Track A - 대장균 Nowcast (온천천)"
    else:
        mask = df["inspec_loc"].isin(TRACK_B_LOCS)
        label_col = "label_B"
        features = FEATURES_B
        name = "Track B - 폐사위험 (동천 괴정천)"

    sub = df[mask & df[label_col].notna()].copy()
    available = [f for f in features if f in sub.columns]
    X = sub[available].fillna(sub[available].median())
    y = sub[label_col].astype(int)

    print(f"\n[{name}]")
    print(f"  피처 {len(available)}개: {available}")
    print(f"  샘플: {len(X)}건 (위험={y.sum()}, 안전={len(y)-y.sum()})")

    pos_ratio = y.sum() / len(y)
    scale_pos = (1 - pos_ratio) / max(pos_ratio, 0.01)

    model = xgb.XGBClassifier(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.04,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos,
        eval_metric="auc",
        random_state=42,
        verbosity=0,
    )

    n_splits = min(5, int(y.sum()))
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)
    scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")
    print(f"  5-Fold CV AUC: {scores.mean():.3f} +/- {scores.std():.3f}")

    model.fit(X, y)

    # SHAP
    explainer = shap.TreeExplainer(model)
    sv = explainer.shap_values(X)
    importance = pd.DataFrame({
        "feature": available,
        "mean_shap": np.abs(sv).mean(axis=0),
    }).sort_values("mean_shap", ascending=False)

    print(f"\n  [SHAP] 강수량 포함 피처 중요도:")
    max_shap = importance["mean_shap"].max()
    for _, r in importance.iterrows():
        bar = "#" * int(r["mean_shap"] / max_shap * 24)
        # 강수량 관련 피처 강조
        mark = " <-- 강수량" if "rain" in r["feature"] else ""
        mark = " <-- 기온" if r["feature"] == "temp_avg_c" else mark
        print(f"    {r['feature']:20s} {bar} {r['mean_shap']:.4f}{mark}")

    # 저장
    model_key = "a" if track == "A" else "b"
    with open(MODEL_DIR / f"track_{model_key}_rain_model.pkl", "wb") as f:
        pickle.dump({"model": model, "features": available}, f)
    importance.to_csv(DATA_DIR / f"shap_track_{model_key}_rain.csv", index=False)
    print(f"  저장: models/track_{model_key}_rain_model.pkl")

    return model, available, scores.mean()


# ──────────────────────────────────────────────────
# 4. AUC 비교 출력
# ──────────────────────────────────────────────────

def compare_auc(old_a: float, new_a: float, old_b: float, new_b: float):
    print("\n" + "="*50)
    print("강수량 추가 전후 AUC 비교")
    print("="*50)
    delta_a = new_a - old_a
    delta_b = new_b - old_b
    print(f"  Track A (대장균):  {old_a:.3f} -> {new_a:.3f}  ({'+' if delta_a>=0 else ''}{delta_a:.3f})")
    print(f"  Track B (폐사위험): {old_b:.3f} -> {new_b:.3f}  ({'+' if delta_b>=0 else ''}{delta_b:.3f})")
    print()
    if delta_a > 0.01:
        print("  Track A: 강수량이 대장균 예측에 유의미하게 기여합니다.")
    elif delta_a > -0.01:
        print("  Track A: 강수량 효과가 미미 - 현재 수질 파라미터가 이미 충분히 설명.")
    else:
        print("  Track A: 강수량 추가 후 AUC 하락 - 과적합 또는 노이즈 가능성.")

    if delta_b > 0.01:
        print("  Track B: 강수량이 폐사위험 예측에 유의미하게 기여합니다.")


# ──────────────────────────────────────────────────
# main
# ──────────────────────────────────────────────────

def main():
    rain = download_rainfall()
    df = merge_data(rain)

    # 기존 AUC 로드
    old_a, old_b = 0.820, 0.908

    _, _, new_a = train_with_rainfall(df, "A")
    _, _, new_b = train_with_rainfall(df, "B")

    compare_auc(old_a, new_a, old_b, new_b)
    print("[DONE] 강수량 포함 모델 저장 완료")


if __name__ == "__main__":
    main()
