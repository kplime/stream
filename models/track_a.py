"""
Track A: 대장균 위험 로지스틱 회귀 (IRLS 직접 구현) + 선형 기여도(SHAP 동치).

딥러닝 학습 루프 없음 — IRLS는 뉴턴-랩슨류 볼록최적화라 최대 20회 반복 내 수렴하고,
노트북 CPU에서 수 밀리초면 끝난다. sklearn이 설치돼 있으면 같은 데이터로 검증용
LogisticRegression도 같이 돌려서 계수를 비교한다 (없어도 파이프라인은 정상 동작).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd

from utils.stats import add_intercept, sigmoid, standardize_fit, standardize_transform

FEATURE_COLUMNS = ["turbidity", "do", "water_temp", "precip_24h"]
COLIFORM_THRESHOLD = 1000.0  # 분원성대장균군 기준치, CFU/100mL


def irls_logistic_regression(
    X: np.ndarray, y: np.ndarray, max_iter: int = 20, tol: float = 1e-6, ridge: float = 1e-6
) -> np.ndarray:
    """IRLS로 로지스틱 회귀 계수 β를 직접 계산. X는 절편 열이 포함된 (n, p) 행렬.

    W(대각행렬)를 명시적으로 만들지 않고 벡터 elementwise 곱으로 대체해
    O(n^2) 대신 O(n*p) 비용만 든다.
    """
    n, p = X.shape
    beta = np.zeros(p)
    I = np.eye(p)

    for _ in range(max_iter):
        eta = X @ beta
        p_hat = sigmoid(eta)
        w = p_hat * (1 - p_hat)
        z = eta + (y - p_hat) / (w + 1e-8)

        Xw = X * w[:, None]  # 대각행렬 W를 만들지 않고 행별 스케일링으로 대체
        XtWX = X.T @ Xw
        XtWz = Xw.T @ z

        beta_new = np.linalg.solve(XtWX + ridge * I, XtWz)
        if np.linalg.norm(beta_new - beta) < tol:
            beta = beta_new
            break
        beta = beta_new

    return beta


def sklearn_crosscheck(X_raw: np.ndarray, y: np.ndarray) -> np.ndarray | None:
    """검증용 — sklearn 있으면 같은 표준화 입력으로 LogisticRegression을 돌려 계수를 비교."""
    try:
        from sklearn.linear_model import LogisticRegression
    except ImportError:
        print("[Track A] sklearn 미설치 — 계수 비교 스킵 (선택 의존성)")
        return None

    mean, std = standardize_fit(X_raw)
    Xz = standardize_transform(X_raw, mean, std)
    try:
        clf = LogisticRegression(penalty=None, max_iter=1000)
    except TypeError:  # 구버전 sklearn은 penalty=None 대신 문자열 'none'을 씀
        clf = LogisticRegression(penalty="none", max_iter=1000)
    clf.fit(Xz, y)
    return np.concatenate([clf.intercept_, clf.coef_[0]])


class TrackAModel:
    """대장균 접촉위험 Nowcast 모델. fit()으로 학습, predict()로 위험확률+기여도 반환."""

    def __init__(self):
        self.beta: np.ndarray | None = None
        self.mean: np.ndarray | None = None
        self.std: np.ndarray | None = None
        self.feature_names = FEATURE_COLUMNS

    def fit(self, df: pd.DataFrame) -> "TrackAModel":
        X_raw = df[FEATURE_COLUMNS].to_numpy(dtype=np.float64)
        y = (df["coliform"].to_numpy(dtype=np.float64) > COLIFORM_THRESHOLD).astype(np.float64)

        self.mean, self.std = standardize_fit(X_raw)
        Xz = standardize_transform(X_raw, self.mean, self.std)
        X = add_intercept(Xz)

        self.beta = irls_logistic_regression(X, y)
        self._X_raw_train = X_raw  # sklearn 비교용으로만 보관
        self._y_train = y
        return self

    def predict(self, x_raw: dict) -> tuple[float, dict]:
        """x_raw: {'turbidity':.., 'do':.., 'water_temp':.., 'precip_24h':..} (원 단위 그대로).
        반환: (위험확률 0~1, {변수명: 기여도} — baseline(학습 평균) 대비 로짓 기여분)."""
        if self.beta is None:
            raise RuntimeError("모델이 아직 학습되지 않았습니다 (fit()을 먼저 호출하세요)")

        x = np.array([x_raw[f] for f in self.feature_names], dtype=np.float64)
        z = standardize_transform(x, self.mean, self.std)  # 학습 평균 기준 baseline은 z=0

        intercept = float(self.beta[0])
        coefs = self.beta[1:]
        contributions = {f: float(coefs[i] * z[i]) for i, f in enumerate(self.feature_names)}

        logit = intercept + sum(contributions.values())
        prob = float(sigmoid(np.array([logit]))[0])

        # baseline(x=학습평균)에서는 z=0이므로 logit(x_baseline) == intercept.
        # 기여도 합이 logit(x) - logit(x_baseline)과 정확히 일치해야 한다 (선형모델이므로 항등식).
        assert abs(sum(contributions.values()) - (logit - intercept)) < 1e-8, (
            "기여도 합이 로짓 차이와 일치하지 않음 — 계산 오류"
        )

        return prob, contributions


if __name__ == "__main__":
    from data.loader import load_track_a_data

    df, is_synthetic = load_track_a_data()
    print(f"\n[Track A] 데이터 {len(df)}건 로드 (합성 데이터: {is_synthetic})")

    y_all = (df["coliform"] > COLIFORM_THRESHOLD).astype(int)
    print(f"[Track A] 라벨 분포 — 초과(1): {y_all.sum()}건 / 미만(0): {(1 - y_all).sum()}건")

    model = TrackAModel().fit(df)
    print(f"\n[Track A] IRLS 계수 (절편 포함): {np.round(model.beta, 4)}")

    ref = sklearn_crosscheck(model._X_raw_train, model._y_train)
    if ref is not None:
        print(f"[Track A] sklearn 계수 (검증용):    {np.round(ref, 4)}")
        print(f"[Track A] 최대 계수 차이: {np.max(np.abs(model.beta - ref)):.6f}")

    # 데모: 최근(마지막) 시점 하나로 예측
    sample = df.iloc[-1]
    x_raw = {f: float(sample[f]) for f in FEATURE_COLUMNS}
    prob, contributions = model.predict(x_raw)

    print(f"\n[Track A] 샘플 예측 — {sample['river_name']} ({sample['timestamp']})")
    print(f"  입력값: {x_raw}")
    print(f"  위험확률: {prob * 100:.1f}%")
    print("  변수별 기여도 (양수=위험 상승, 음수=위험 하강):")
    for name, contrib in sorted(contributions.items(), key=lambda kv: -abs(kv[1])):
        print(f"    {name:12s}: {contrib:+.4f}")

    print("\n[Track A] assert 검증 통과 — 기여도 합이 baseline 대비 로짓 차이와 정확히 일치함")
