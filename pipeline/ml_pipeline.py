"""
부산 도심하천 수질 AI 예측 파이프라인
=====================================================
Track A: 온천천 대장균 Nowcast (EPA Nowcast 방법론, XGBoost + SHAP)
Track B: 동천·괴정천 폐사위험 예측 (분포시차모형 + XGBoost + SHAP)
Anomaly: Isolation Forest 이상치 탐지

사용법:
  pip install -r requirements.txt
  python ml_pipeline.py            # 전체 파이프라인 (다운로드 → 학습 → 예측)
  python ml_pipeline.py --skip-download  # 이미 data/ 있으면 다운로드 스킵
  python ml_pipeline.py --predict-only   # 저장된 모델로 현재 예측만

필드 매핑 (API 분석 확인):
  water01 = pH
  water03 = SS (mg/L)
  water06 = DO (mg/L)   ← Track B 종속변수
  water08 = 총대장균군수 (/100mL)
  water09 = 분원성대장균군수 (/100mL)  ← Track A 종속변수
  water10 = 수온 (℃)
  water11 = 전기전도도 (μS/cm)
  water20 = TN (mg/L)
  water07 = TP (mg/L)
"""

from __future__ import annotations

import argparse
import json
import os
import pickle
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from dotenv import load_dotenv
from sklearn.ensemble import IsolationForest
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_score

load_dotenv(Path(__file__).parent / ".env")

# ── 경로 설정 ──────────────────────────────────────
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "models"
DATA_DIR.mkdir(exist_ok=True)
MODEL_DIR.mkdir(exist_ok=True)

# ── API 설정 ──────────────────────────────────────
WQ_API_KEY = os.getenv(
    "DATA_GO_KR_KEY",
)
WQ_BASE = "https://apis.data.go.kr/6260000/BusanRvrwtQltyInfoService/getRvrwtQltyInfo"

# ── 측정소 코드 ──────────────────────────────────
TRACK_A_LOCS = {"215", "216", "327", "328", "329"}   # 온천천
TRACK_B_LOCS = {"206", "207", "208", "312", "301"}   # 동천 + 괴정천
ALL_TARGET_LOCS = TRACK_A_LOCS | TRACK_B_LOCS

LOC_RIVER = {
    "215": "온천천", "216": "온천천", "327": "온천천", "328": "온천천", "329": "온천천",
    "206": "동천",   "207": "동천",   "208": "동천",   "312": "동천",
    "301": "괴정천",
}

# ── 필드 매핑 ─────────────────────────────────────
FIELD_MAP = {
    "water01": "pH",
    "water03": "SS",
    "water06": "DO",
    "water07": "TP",
    "water08": "대장균총",
    "water09": "분원성대장균",
    "water10": "수온",
    "water11": "EC",
    "water20": "TN",
}

# ── 위험도 임계값 ─────────────────────────────────
# Track A: 환경정책기본법 시행령 - 분원성대장균 보통등급 하한
FECAL_COLIFORM_THRESHOLD = 1_000   # CFU/100mL

# Track B: 어류 치사 임계 DO (문헌값)
DO_CRITICAL = 3.0   # mg/L


# ==================================================
# Phase 1: 수질 데이터 다운로드
# ==================================================

def download_water_quality() -> pd.DataFrame:
    """API에서 전체 수질측정망 데이터를 다운로드하고 타겟 하천만 필터링."""
    print("\n[Phase 1] 수질측정망 데이터 다운로드 시작")
    cache_path = DATA_DIR / "water_quality_raw.csv"

    # 전체 건수 확인
    params = urllib.parse.urlencode({"serviceKey": WQ_API_KEY, "numOfRows": 1, "pageNo": 1})
    with urllib.request.urlopen(f"{WQ_BASE}?{params}", timeout=15) as r:
        root = ET.fromstring(r.read())
    total = int(root.find(".//totalCount").text)
    page_size = 500
    total_pages = (total + page_size - 1) // page_size
    print(f"  전체 {total}건, {total_pages}페이지")

    rows = []
    for page in range(1, total_pages + 1):
        params = urllib.parse.urlencode({"serviceKey": WQ_API_KEY, "numOfRows": page_size, "pageNo": page})
        with urllib.request.urlopen(f"{WQ_BASE}?{params}", timeout=20) as r:
            root = ET.fromstring(r.read())

        for item in root.findall(".//item"):
            row = {c.tag: c.text for c in item}
            if row.get("inspec_loc") in ALL_TARGET_LOCS:
                rows.append(row)

        if page % 5 == 0:
            print(f"  {page}/{total_pages} 페이지 완료, 타겟 데이터 {len(rows)}건")

    df = pd.DataFrame(rows)
    df.to_csv(cache_path, index=False, encoding="utf-8-sig")
    print(f"  저장 완료: {cache_path} ({len(df)}건)")
    return df


def load_or_download() -> pd.DataFrame:
    cache = DATA_DIR / "water_quality_raw.csv"
    if cache.exists():
        print(f"[Phase 1] 캐시 로드: {cache}")
        return pd.read_csv(cache, dtype=str)
    return download_water_quality()


# ==================================================
# Phase 2: 전처리
# ==================================================

def preprocess(df: pd.DataFrame) -> pd.DataFrame:
    print("\n[Phase 2] 전처리")

    # 숫자 컬럼 변환 (쉼표 제거)
    for col in [f"water{i:02d}" for i in range(1, 28)]:
        if col in df.columns:
            df[col] = df[col].str.replace(",", "", regex=False)
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # 컬럼 이름 정리
    rename = {f"water{int(k[5:]):02d}": v for k, v in FIELD_MAP.items()}
    df = df.rename(columns=rename)

    # 날짜 처리
    df["year"] = df["inspec_ym"].str[:4].astype(int)
    df["month"] = df["inspec_ym"].str[4:6].astype(int)

    # 하천명 추가
    df["river_name"] = df["inspec_loc"].map(LOC_RIVER)

    # Track 구분
    df["track"] = df["inspec_loc"].apply(
        lambda x: "A" if x in TRACK_A_LOCS else "B"
    )

    # 분원성대장균 없는 경우 총대장균으로 대체 (Track A 라벨용)
    if "분원성대장균" in df.columns and "대장균총" in df.columns:
        df["ecoli_label_raw"] = pd.to_numeric(df["분원성대장균"], errors="coerce").fillna(
            pd.to_numeric(df["대장균총"], errors="coerce"))
    elif "대장균총" in df.columns:
        df["ecoli_label_raw"] = pd.to_numeric(df["대장균총"], errors="coerce")
    else:
        df["ecoli_label_raw"] = np.nan

    # Track A 라벨: 분원성대장균 > 1,000 CFU/100mL → 1 (위험)
    df["label_A"] = (df["ecoli_label_raw"] > FECAL_COLIFORM_THRESHOLD).astype(int)

    # Track B 라벨: DO < 3.0 mg/L → 1 (폐사위험)
    if "DO" in df.columns:
        df["DO"] = pd.to_numeric(df["DO"], errors="coerce")
        df["label_B"] = (df["DO"] < DO_CRITICAL).astype(int)
    else:
        df["label_B"] = np.nan

    print(f"  Track A 데이터: {(df['track']=='A').sum()}건")
    print(f"  Track B 데이터: {(df['track']=='B').sum()}건")
    if "ecoli_label_raw" in df.columns:
        a_valid = df[df["track"] == "A"]["label_A"].notna().sum()
        a_pos = df[df["track"] == "A"]["label_A"].sum()
        print(f"  Track A 라벨 유효: {a_valid}건, 위험(1): {a_pos}건 ({100*a_pos/max(a_valid,1):.1f}%)")
    if "label_B" in df.columns:
        b_valid = df[df["track"] == "B"]["label_B"].notna().sum()
        b_pos = df[df["track"] == "B"]["label_B"].sum()
        print(f"  Track B 라벨 유효: {b_valid}건, 위험(1): {b_pos}건 ({100*b_pos/max(b_valid,1):.1f}%)")

    df.to_csv(DATA_DIR / "water_quality_processed.csv", index=False, encoding="utf-8-sig")
    return df


# ==================================================
# Phase 3: Track A 모델 (온천천 대장균 Nowcast)
# ==================================================

FEATURES_A = ["pH", "DO", "수온", "EC", "TP", "SS", "month"]

def train_track_a(df: pd.DataFrame) -> xgb.XGBClassifier:
    print("\n[Phase 3] Track A - 대장균 Nowcast (온천천)")

    df_a = df[(df["track"] == "A") & df["label_A"].notna()].copy()
    available_features = [f for f in FEATURES_A if f in df_a.columns]
    print(f"  사용 피처: {available_features}")

    X = df_a[available_features].copy()
    y = df_a["label_A"].astype(int)

    # 최근 데이터 확인
    print(f"  데이터 범위: {df_a['inspec_ym'].min()} ~ {df_a['inspec_ym'].max()}")
    print(f"  총 샘플: {len(X)}건 (위험={y.sum()}, 안전={len(y)-y.sum()})")

    X = X.fillna(X.median())

    if len(X) < 20:
        print("  [WARN] 샘플 부족 - 모델 신뢰도 낮음. 합성 증강 추가.")
        X, y = augment_samples(X, y)

    # 클래스 불균형 처리
    pos_ratio = y.sum() / len(y)
    scale_pos = (1 - pos_ratio) / max(pos_ratio, 0.01)

    model = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos,
        eval_metric="auc",
        random_state=42,
        verbosity=0,
    )

    # 5-fold CV
    cv = StratifiedKFold(n_splits=min(5, y.sum()), shuffle=True, random_state=42)
    scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")
    print(f"  5-Fold CV AUC: {scores.mean():.3f} ± {scores.std():.3f}")

    model.fit(X, y)

    # SHAP
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X)

    print("\n  [SHAP] 피처 중요도 (평균 |SHAP|):")
    shap_importance = pd.DataFrame({
        "feature": available_features,
        "mean_shap": np.abs(shap_values).mean(axis=0),
    }).sort_values("mean_shap", ascending=False)
    for _, r in shap_importance.iterrows():
        bar = "#" * int(r["mean_shap"] / shap_importance["mean_shap"].max() * 20)
        print(f"    {r['feature']:15s} {bar} {r['mean_shap']:.4f}")

    # 저장
    with open(MODEL_DIR / "track_a_model.pkl", "wb") as f:
        pickle.dump({"model": model, "features": available_features,
                     "shap_importance": shap_importance.to_dict()}, f)
    shap_importance.to_csv(DATA_DIR / "shap_track_a.csv", index=False, encoding="utf-8-sig")
    print(f"  모델 저장: {MODEL_DIR}/track_a_model.pkl")
    return model, available_features


# ==================================================
# Phase 4: Track B 모델 (동천·괴정천 폐사위험)
# ==================================================

FEATURES_B = ["pH", "수온", "EC", "TP", "SS", "month"]

def train_track_b(df: pd.DataFrame) -> xgb.XGBClassifier:
    print("\n[Phase 4] Track B - 폐사위험 (동천·괴정천)")

    df_b = df[(df["track"] == "B") & df["label_B"].notna() & df["DO"].notna()].copy()
    available_features = [f for f in FEATURES_B if f in df_b.columns]
    print(f"  사용 피처: {available_features}")

    X = df_b[available_features].copy()
    y = df_b["label_B"].astype(int)

    print(f"  데이터 범위: {df_b['inspec_ym'].min()} ~ {df_b['inspec_ym'].max()}")
    print(f"  총 샘플: {len(X)}건 (위험={y.sum()}, 안전={len(y)-y.sum()})")

    X = X.fillna(X.median())

    if len(X) < 20:
        print("  [WARN] 샘플 부족 - 합성 증강 추가.")
        X, y = augment_samples(X, y)

    pos_ratio = y.sum() / len(y)
    scale_pos = (1 - pos_ratio) / max(pos_ratio, 0.01)

    model = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos,
        eval_metric="auc",
        random_state=42,
        verbosity=0,
    )

    cv = StratifiedKFold(n_splits=min(5, max(y.sum(), 2)), shuffle=True, random_state=42)
    scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")
    print(f"  5-Fold CV AUC: {scores.mean():.3f} ± {scores.std():.3f}")

    model.fit(X, y)

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X)

    print("\n  [SHAP] 피처 중요도 (평균 |SHAP|):")
    shap_importance = pd.DataFrame({
        "feature": available_features,
        "mean_shap": np.abs(shap_values).mean(axis=0),
    }).sort_values("mean_shap", ascending=False)
    for _, r in shap_importance.iterrows():
        bar = "#" * int(r["mean_shap"] / shap_importance["mean_shap"].max() * 20)
        print(f"    {r['feature']:15s} {bar} {r['mean_shap']:.4f}")

    with open(MODEL_DIR / "track_b_model.pkl", "wb") as f:
        pickle.dump({"model": model, "features": available_features,
                     "shap_importance": shap_importance.to_dict()}, f)
    shap_importance.to_csv(DATA_DIR / "shap_track_b.csv", index=False, encoding="utf-8-sig")
    print(f"  모델 저장: {MODEL_DIR}/track_b_model.pkl")
    return model, available_features


# ==================================================
# Phase 5: Isolation Forest 이상치 탐지
# ==================================================

def train_anomaly(df: pd.DataFrame) -> IsolationForest:
    print("\n[Phase 5] Isolation Forest - 이상치 탐지")

    feat = ["pH", "DO", "수온", "EC"]
    available = [f for f in feat if f in df.columns]
    X = df[available].dropna()

    model = IsolationForest(contamination=0.05, random_state=42, n_estimators=200)
    model.fit(X)

    scores = model.decision_function(X)
    anomaly_mask = model.predict(X) == -1
    print(f"  이상치 탐지: 전체 {len(X)}건 중 {anomaly_mask.sum()}건 ({100*anomaly_mask.mean():.1f}%)")

    # 이상치 사례 출력
    anomaly_df = df.loc[X.index[anomaly_mask], ["inspec_ym", "inspec_loc", "river_name"] + available].copy()
    anomaly_df["anomaly_score"] = scores[anomaly_mask]
    anomaly_df = anomaly_df.sort_values("anomaly_score")
    print(f"\n  상위 이상치 5건:")
    print(anomaly_df.head(5).to_string(index=False))

    with open(MODEL_DIR / "anomaly_model.pkl", "wb") as f:
        pickle.dump({"model": model, "features": available}, f)
    print(f"  모델 저장: {MODEL_DIR}/anomaly_model.pkl")
    return model


# ==================================================
# Phase 6: 현재 위험도 예측 → Supabase push
# ==================================================

def get_latest_readings(df: pd.DataFrame) -> pd.DataFrame:
    """각 측정소의 가장 최근 측정값 추출."""
    latest = df.sort_values("inspec_ym").groupby("inspec_loc").last().reset_index()
    return latest


# 측정소 코드 → 실제 좌표 매핑 (OSM riverFallback 기준 보정)
LOC_COORDS: dict[str, tuple[float, float]] = {
    # 온천천: lat 35.197~35.289, lng 129.060~129.095
    "327": (35.2613, 129.0920),  # 온천천(청룡) — 상류
    "215": (35.2372, 129.0885),  # 온천천1(태광산업)
    "328": (35.2118, 129.0793),  # 온천천(온천)
    "216": (35.2003, 129.0825),  # 온천천2(연안교)
    "329": (35.1970, 129.0825),  # 온천천(세병) — 하류
    # 동천: lat 35.129~35.151, lng 129.058~129.066
    "312": (35.1506, 129.0582),  # 동천2-1(성서교) — 상류
    "208": (35.1460, 129.0620),  # 동천3(범일교)
    "207": (35.1380, 129.0645),  # 동천2(범4호교)
    "206": (35.1295, 129.0662),  # 동천1(광무교) — 하류
    # 괴정천: lat 35.096~35.108, lng 128.963~129.000
    "301": (35.1019, 128.9778),  # 괴정천(하단초등학교)
}


def predict_and_push(df: pd.DataFrame):
    print("\n[Phase 6] 현재 위험도 예측 → Supabase push")

    latest = get_latest_readings(df)

    # 최종 모델(조위 포함) 우선, 없으면 강수 모델 사용
    def load_model(track: str):
        final = MODEL_DIR / f"track_{track.lower()}_final_model.pkl"
        rain  = MODEL_DIR / f"track_{track.lower()}_rain_model.pkl"
        base  = MODEL_DIR / f"track_{track.lower()}_model.pkl"
        for path in [final, rain, base]:
            if path.exists():
                with open(path, "rb") as f:
                    return pickle.load(f)
        raise FileNotFoundError(f"모델 없음: track {track}")

    try:
        pkg_a = load_model("A")
        pkg_b = load_model("B")
    except FileNotFoundError as e:
        print(f"  [ERROR] {e}")
        return

    rows = []
    # 모든 측정소에 Track A + Track B 둘 다 적용
    for _, row in latest.iterrows():
        loc = str(row["inspec_loc"])
        river = LOC_RIVER.get(loc, "unknown")
        lat, lng = LOC_COORDS.get(loc, (35.17, 129.05))

        for track, pkg in [("A", pkg_a), ("B", pkg_b)]:
            feat = pkg["features"]
            model = pkg["model"]

            X = pd.DataFrame([{f: pd.to_numeric(row.get(f, np.nan), errors="coerce") for f in feat}])
            X = X.apply(pd.to_numeric, errors="coerce").fillna(0.0)

            prob = float(model.predict_proba(X)[0, 1])
            level = "high" if prob >= 0.66 else "medium" if prob >= 0.33 else "low"

            explainer = shap.TreeExplainer(model)
            shap_vals = explainer.shap_values(X)[0]
            shap_dict = {f: round(float(v), 4) for f, v in zip(feat, shap_vals)}
            top_feat = max(shap_dict, key=lambda k: abs(shap_dict[k]))

            rows.append({
                "station_id": f"{river}-{loc}",
                "river_name": river,
                "track": track,
                "lat": lat,
                "lng": lng,
                "risk_score": round(prob, 3),
                "risk_level": level,
                "shap": json.dumps(shap_dict, ensure_ascii=False),
                "updated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
            print(f"  {river}({loc}) Track{track}: {level} ({prob:.1%}) | {top_feat}")

    # Supabase push (키가 있을 때만)
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY")
    if supabase_url and supabase_key:
        try:
            from supabase import create_client
            sb = create_client(supabase_url, supabase_key)
            sb.table("risk_scores").upsert(rows, on_conflict="station_id,track").execute()
            print(f"  Supabase upsert 완료: {len(rows)}건")
        except Exception as e:
            print(f"  [WARN] Supabase push 실패: {e}")
    else:
        print("  Supabase 키 없음 - 로컬 JSON으로 저장")
        out = DATA_DIR / "latest_risk_scores.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
        print(f"  저장: {out}")

    return rows


# ==================================================
# 보조: 소규모 데이터 합성 증강
# ==================================================

def augment_samples(X: pd.DataFrame, y: pd.Series, factor: int = 3):
    """데이터가 적을 때 정규분포 노이즈로 증강 (Jitter augmentation)."""
    rng = np.random.default_rng(42)
    X_aug = [X]
    y_aug = [y]
    for _ in range(factor - 1):
        noise = rng.normal(0, X.std() * 0.05, X.shape)
        X_aug.append(X + noise)
        y_aug.append(y)
    return pd.concat(X_aug, ignore_index=True), pd.concat(y_aug, ignore_index=True)


# ==================================================
# 메인
# ==================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--predict-only", action="store_true")
    args = parser.parse_args()

    if args.predict_only:
        processed = DATA_DIR / "water_quality_processed.csv"
        if not processed.exists():
            print("[ERROR] data/water_quality_processed.csv 없음. 먼저 전체 파이프라인 실행 필요.")
            return
        df = pd.read_csv(processed, dtype=str)
        df = preprocess(df)
        predict_and_push(df)
        return

    # 전체 파이프라인
    if args.skip_download and (DATA_DIR / "water_quality_raw.csv").exists():
        df = pd.read_csv(DATA_DIR / "water_quality_raw.csv", dtype=str)
    else:
        df = download_water_quality()

    df = preprocess(df)
    train_track_a(df)
    train_track_b(df)
    train_anomaly(df)
    predict_and_push(df)

    print("\n[DONE] 파이프라인 완료")
    print(f"   모델: {MODEL_DIR}/track_a_model.pkl, track_b_model.pkl, anomaly_model.pkl")
    print(f"   SHAP: {DATA_DIR}/shap_track_a.csv, shap_track_b.csv")
    print(f"   위험도: {DATA_DIR}/latest_risk_scores.json")


if __name__ == "__main__":
    main()
