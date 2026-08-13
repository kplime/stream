"""
마할라노비스 거리 기반 이상치 탐지 — CSO(오수 월류) 같은 비정상 신호 포착용.

딥러닝/반복학습 없음. 평균벡터·공분산행렬은 np.cov로 한 번에 계산하고, 판정은
행렬곱 몇 번이면 끝난다. Σ가 특이행렬(변수 간 완전공선성 등)이어도 죽지 않도록
역행렬 대신 유사역행렬(pinv)을 쓴다.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd

from utils.stats import chi2_ppf_975


class MahalanobisDetector:
    """과거 데이터로 평균·공분산을 학습해두고, 새 관측치의 이상치 여부를 판정."""

    def __init__(self, feature_names: list[str]):
        self.feature_names = feature_names
        self.mu: np.ndarray | None = None
        self.sigma_pinv: np.ndarray | None = None
        self.threshold: float | None = None

    def fit(self, df: pd.DataFrame) -> "MahalanobisDetector":
        X = df[self.feature_names].to_numpy(dtype=np.float64)
        self.mu = X.mean(axis=0)
        sigma = np.cov(X, rowvar=False)
        # 변수가 1개뿐이면 np.cov가 스칼라를 반환하므로 (1,1) 행렬로 맞춰준다.
        sigma = np.atleast_2d(sigma)
        self.sigma_pinv = np.linalg.pinv(sigma)  # Σ가 특이행렬이어도 안전
        self.threshold = chi2_ppf_975(df=len(self.feature_names))
        return self

    def score(self, x_raw: dict) -> float:
        """D² (마할라노비스 거리 제곱)을 반환."""
        if self.mu is None:
            raise RuntimeError("모델이 아직 학습되지 않았습니다 (fit()을 먼저 호출하세요)")
        x = np.array([x_raw[f] for f in self.feature_names], dtype=np.float64)
        diff = x - self.mu
        d2 = float(diff @ self.sigma_pinv @ diff)
        return d2

    def is_anomaly(self, x_raw: dict) -> tuple[bool, float]:
        """(이상치 여부, D²) 반환. D² > 카이제곱(자유도=변수개수) 97.5%ile이면 이상치."""
        d2 = self.score(x_raw)
        return d2 > self.threshold, d2

    def score_batch(self, df: pd.DataFrame) -> np.ndarray:
        """DataFrame 전체에 대해 벡터화된 D² 계산 (반복문 없이 행렬곱으로 한 번에)."""
        X = df[self.feature_names].to_numpy(dtype=np.float64)
        diff = X - self.mu
        # 각 행 i에 대해 diff[i] @ sigma_pinv @ diff[i] 를 벡터화: (diff @ pinv) * diff 를 행별로 합산
        d2 = np.einsum("ij,jk,ik->i", diff, self.sigma_pinv, diff)
        return d2


if __name__ == "__main__":
    from data.loader import load_track_a_data
    from models.track_a import FEATURE_COLUMNS

    df, is_synthetic = load_track_a_data()
    print(f"\n[Anomaly] 데이터 {len(df)}건 로드 (합성 데이터: {is_synthetic})")

    detector = MahalanobisDetector(FEATURE_COLUMNS).fit(df)
    print(f"[Anomaly] 카이제곱 임계값 (자유도={len(FEATURE_COLUMNS)}, 97.5%ile): {detector.threshold:.3f}")

    d2_all = detector.score_batch(df)
    anomaly_mask = d2_all > detector.threshold
    print(f"[Anomaly] 전체 {len(df)}건 중 이상치 {anomaly_mask.sum()}건 ({anomaly_mask.mean() * 100:.1f}%)")

    # 데모: D²가 가장 큰(가장 이상한) 상위 3건 출력
    top_idx = np.argsort(-d2_all)[:3]
    print("\n[Anomaly] D² 상위 3건 (가장 비정상적인 관측치):")
    for i in top_idx:
        row = df.iloc[i]
        is_anom, d2 = detector.is_anomaly({f: float(row[f]) for f in FEATURE_COLUMNS})
        print(
            f"  {row['river_name']} {row['timestamp']} — D²={d2:.2f} "
            f"(임계값 {detector.threshold:.2f} 대비 {'초과 → 이상치' if is_anom else '이내'})"
        )
        print(f"    turbidity={row['turbidity']:.1f} do={row['do']:.2f} "
              f"water_temp={row['water_temp']:.1f} precip_24h={row['precip_24h']:.1f}")

    # 인위적으로 극단값(CSO 월류 흉내: 탁도 급증 + DO 급락)을 주입해 정말 잡히는지 확인
    injected = {"turbidity": 190.0, "do": 0.5, "water_temp": 22.0, "precip_24h": 45.0}
    is_anom, d2 = detector.is_anomaly(injected)
    print(f"\n[Anomaly] 인위적 CSO 월류 시나리오 {injected}")
    print(f"  D²={d2:.2f}, 임계값={detector.threshold:.2f} -> {'이상치로 탐지됨 ✓' if is_anom else '탐지 실패'}")
