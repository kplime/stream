"""
Track B: 폐사 위험 분포시차모형(Distributed Lag Model) — 시간 남으면만 (최하 우선순위).

DO(t)를 [1, 강수량(t)~(t-8), 수온(t)]에 대해 릿지회귀로 적합. 딥러닝 없음 — 닫힌 해
(closed-form) 릿지회귀라 np.linalg.solve 한 번이면 끝난다. λ는 [0.01, 0.1, 1.0] 중
시계열 홀드아웃(앞 80% 학습 / 뒤 20% 검증, 랜덤 셔플 금지)으로 선택한다.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd

from utils.stats import norm_cdf

LAG_HOURS = 8  # 강수량 t, t-1, ..., t-8 => 9개 lag 열
CANDIDATE_LAMBDAS = [0.01, 0.1, 1.0]


def build_lag_matrix(precip: np.ndarray, water_temp: np.ndarray, lag_hours: int = LAG_HOURS) -> tuple[np.ndarray, int]:
    """정렬된 시계열 precip에서 [1, precip(t), precip(t-1), ..., precip(t-lag), water_temp(t)]
    설계행렬을 만든다. 앞쪽 lag_hours개 시점은 과거 lag가 없어 버린다.
    반환: (X, valid_start_idx) — valid_start_idx부터의 원본 인덱스가 X의 행에 대응.
    """
    n = len(precip)
    valid_start = lag_hours
    rows = []
    for t in range(valid_start, n):
        lags = [precip[t - k] for k in range(0, lag_hours + 1)]
        rows.append([1.0] + lags + [water_temp[t]])
    X = np.array(rows, dtype=np.float64)
    return X, valid_start


def ridge_regression(X: np.ndarray, y: np.ndarray, lam: float) -> np.ndarray:
    """닫힌 해 릿지회귀: β = (XᵀX + λI)⁻¹Xᵀy, 역행렬 대신 np.linalg.solve 사용.
    절편 열(첫 열)은 정규화하지 않는다 (관례)."""
    p = X.shape[1]
    I = np.eye(p)
    I[0, 0] = 0.0  # 절편은 릿지 페널티에서 제외
    XtX = X.T @ X
    Xty = X.T @ y
    beta = np.linalg.solve(XtX + lam * I, Xty)
    return beta


def select_lambda_by_holdout(X: np.ndarray, y: np.ndarray, candidates=CANDIDATE_LAMBDAS, holdout_frac: float = 0.2):
    """시계열이므로 셔플 없이 앞부분을 학습, 뒷부분을 검증으로 고정 분할."""
    n = len(y)
    split = int(n * (1 - holdout_frac))
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    best_lam, best_mse = candidates[0], np.inf
    scores = {}
    for lam in candidates:
        beta = ridge_regression(X_train, y_train, lam)
        pred = X_val @ beta
        mse = float(np.mean((pred - y_val) ** 2))
        scores[lam] = mse
        if mse < best_mse:
            best_mse, best_lam = mse, lam
    return best_lam, scores


class TrackBModel:
    """폐사위험 분포시차모형. DO(t)를 최근 강수 이력 + 수온으로 예측하고,
    임계 DO 미달 확률(Φ 기반)을 폐사확률로 사용한다."""

    def __init__(self, do_critical: float = 3.0):
        self.do_critical = do_critical  # 어류 폐사 임계 DO (mg/L) — 보수적으로 낮게 잡음
        self.beta: np.ndarray | None = None
        self.lam: float | None = None
        self.residual_std: float | None = None

    def fit(self, df: pd.DataFrame) -> "TrackBModel":
        df_sorted = df.sort_values("timestamp").reset_index(drop=True)
        precip = df_sorted["precip_24h"].to_numpy(dtype=np.float64)
        water_temp = df_sorted["water_temp"].to_numpy(dtype=np.float64)
        do = df_sorted["do"].to_numpy(dtype=np.float64)

        X, valid_start = build_lag_matrix(precip, water_temp)
        y = do[valid_start:]

        self.lam, holdout_scores = select_lambda_by_holdout(X, y)
        self.beta = ridge_regression(X, y, self.lam)

        residuals = y - X @ self.beta
        self.residual_std = float(np.std(residuals))
        self._holdout_scores = holdout_scores
        return self

    def predict_do(self, precip_window: np.ndarray, water_temp_now: float) -> float:
        """precip_window: [precip(t), precip(t-1), ..., precip(t-LAG_HOURS)] (길이 LAG_HOURS+1)."""
        if self.beta is None:
            raise RuntimeError("모델이 아직 학습되지 않았습니다 (fit()을 먼저 호출하세요)")
        x = np.concatenate([[1.0], precip_window, [water_temp_now]])
        return float(x @ self.beta)

    def mortality_probability(self, precip_window: np.ndarray, water_temp_now: float) -> tuple[float, float]:
        """반환: (예측 DO, 폐사확률). 폐사확률 = Φ((DO_crit - 예측DO) / σ)."""
        predicted_do = self.predict_do(precip_window, water_temp_now)
        z = (self.do_critical - predicted_do) / (self.residual_std + 1e-8)
        prob = float(norm_cdf(np.array([z]))[0])
        return predicted_do, prob


if __name__ == "__main__":
    from data.loader import load_track_a_data

    df, is_synthetic = load_track_a_data()
    print(f"\n[Track B] 데이터 {len(df)}건 로드 (합성 데이터: {is_synthetic})")

    model = TrackBModel().fit(df)
    print(f"[Track B] 홀드아웃 MSE by λ: { {k: round(v, 4) for k, v in model._holdout_scores.items()} }")
    print(f"[Track B] 선택된 λ: {model.lam}")
    print(f"[Track B] 잔차 표준편차(σ): {model.residual_std:.4f}")
    print(f"[Track B] 릿지 계수 (절편, precip t~t-{LAG_HOURS}, water_temp): {np.round(model.beta, 4)}")

    # 데모: 최근 9시간 강수 이력으로 예측 (합성 데이터는 hourly라 마지막 9개 사용)
    df_sorted = df.sort_values("timestamp").reset_index(drop=True)
    precip_window = df_sorted["precip_24h"].to_numpy()[-(LAG_HOURS + 1):][::-1]  # [t, t-1, ..., t-8]
    water_temp_now = float(df_sorted["water_temp"].iloc[-1])

    predicted_do, mortality_prob = model.mortality_probability(precip_window, water_temp_now)
    print(f"\n[Track B] 예측 DO: {predicted_do:.2f} mg/L (임계 {model.do_critical} mg/L)")
    print(f"[Track B] 폐사확률: {mortality_prob * 100:.1f}%")

    # 극단 시나리오: 최근 강수 폭증 + 고수온
    heavy_rain_window = np.array([45.0, 40.0, 35.0, 30.0, 20.0, 10.0, 5.0, 2.0, 0.0])
    predicted_do2, mortality_prob2 = model.mortality_probability(heavy_rain_window, water_temp_now=29.0)
    print(f"\n[Track B] 폭우 시나리오 — 예측 DO: {predicted_do2:.2f} mg/L, 폐사확률: {mortality_prob2 * 100:.1f}%")

    # 최악 시나리오: 강수 상한(50mm/hr)이 8시간 내내 지속 — 임계 DO 근접 확인용
    worst_case_window = np.full(LAG_HOURS + 1, 50.0)
    predicted_do3, mortality_prob3 = model.mortality_probability(worst_case_window, water_temp_now=30.0)
    print(f"[Track B] 최악 시나리오(폭우 지속) — 예측 DO: {predicted_do3:.2f} mg/L, 폐사확률: {mortality_prob3 * 100:.1f}%")
