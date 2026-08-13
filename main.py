"""
부산 도심하천 수질예보 파이프라인 — 전체 실행 진입점.

numpy/pandas 중심의 가벼운 CPU 연산만 사용 (GPU/딥러닝 학습 루프 없음).
노트북에서 몇 초 안에 전체가 끝난다: 데이터 로드(또는 합성 생성) -> Track A 학습 ->
이상치 탐지 -> Track B(선택) -> 하천별 브리핑 생성 -> Supabase 기록(또는 콘솔 폴백).

실행: python main.py
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from data.loader import TARGET_RIVERS, load_track_a_data
from models.anomaly import MahalanobisDetector
from models.track_a import FEATURE_COLUMNS, TrackAModel
from output.briefing import generate_briefing
from output.supabase_writer import build_record, write_results

# 하천별 대표 좌표 (프론트엔드 mockData.ts 측정소 좌표와 동일 계열)
RIVER_COORDS = {
    "온천천": (35.2045, 129.0835),
    "동천": (35.1500, 129.0600),
    "괴정천": (35.0940, 128.9660),
}

RUN_TRACK_B = True  # 시간 없으면 False로 끄면 4순위까지만 실행됨


def main():
    t0 = time.time()
    print("=" * 60)
    print("부산 도심하천 수질예보 파이프라인")
    print("=" * 60)

    # 1. 데이터 로드
    print("\n[1/5] 데이터 로드")
    df, is_synthetic = load_track_a_data()
    print(f"  -> {len(df)}건 (합성 데이터: {is_synthetic})")

    # 2. Track A 학습
    print("\n[2/5] Track A (대장균 위험 로지스틱 회귀) 학습")
    track_a = TrackAModel().fit(df)
    n_high_risk = int((df["coliform"] > 1000).sum())
    print(f"  -> IRLS 수렴 완료, 계수 {len(track_a.beta)}개, 임계 초과 라벨 {n_high_risk}/{len(df)}건")

    # 3. 이상치 탐지
    print("\n[3/5] 마할라노비스 이상치 탐지")
    detector = MahalanobisDetector(FEATURE_COLUMNS).fit(df)
    d2_all = detector.score_batch(df)
    n_anomaly = int((d2_all > detector.threshold).sum())
    print(f"  -> 임계값 {detector.threshold:.2f}, 이상치 {n_anomaly}/{len(df)}건 ({n_anomaly / len(df) * 100:.1f}%)")

    # 4. Track B (선택, 시간 없으면 스킵)
    track_b = None
    if RUN_TRACK_B:
        print("\n[4/5] Track B (폐사위험 분포시차모형) 학습")
        try:
            from models.track_b import LAG_HOURS, TrackBModel

            track_b = TrackBModel().fit(df)
            print(f"  -> 릿지 λ={track_b.lam}, 잔차σ={track_b.residual_std:.3f}")
        except Exception as e:  # noqa: BLE001 - 최하 우선순위, 실패해도 파이프라인은 계속
            print(f"  -> Track B 실패 ({e}) — 최하 우선순위라 스킵하고 계속 진행")
    else:
        print("\n[4/5] Track B — RUN_TRACK_B=False, 스킵")

    # 5. 하천별 브리핑 생성 + Supabase 기록
    print("\n[5/5] 하천별 위험도 브리핑 생성 + Supabase 기록")
    df_sorted = df.sort_values("timestamp").reset_index(drop=True)
    records = []
    for river in TARGET_RIVERS:
        river_rows = df_sorted[df_sorted["river_name"] == river]
        if river_rows.empty:
            continue
        latest = river_rows.iloc[-1]
        x_raw = {f: float(latest[f]) for f in FEATURE_COLUMNS}
        prob, contributions = track_a.predict(x_raw)
        briefing = generate_briefing(river, prob, contributions)

        lat, lng = RIVER_COORDS[river]
        records.append(build_record(f"{river}-대표측정소", river, "A", lat, lng, prob, briefing))
        print(f"  {river}: 위험확률 {prob * 100:.1f}% — {briefing}")

    write_results(records)

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"파이프라인 완료 — 총 소요시간 {elapsed:.2f}초")
    print("=" * 60)


if __name__ == "__main__":
    main()
