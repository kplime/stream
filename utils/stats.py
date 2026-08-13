"""
공통 통계 유틸리티. numpy만 사용 — 딥러닝/무거운 연산 없음, 노트북 CPU에서 즉시 실행됨.
"""

import numpy as np


def sigmoid(z):
    """오버플로 방지를 위해 양수/음수 구간을 나눠 계산."""
    z = np.asarray(z, dtype=np.float64)
    out = np.empty_like(z)
    pos = z >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-z[pos]))
    exp_z = np.exp(z[~pos])
    out[~pos] = exp_z / (1.0 + exp_z)
    return out


def standardize_fit(X: np.ndarray):
    """열 단위 평균·표준편차를 계산해 반환 (표준편차 0인 열은 1로 대체해 0-division 방지)."""
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std_safe = np.where(std < 1e-8, 1.0, std)
    return mean, std_safe


def standardize_transform(X: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    """실시간 입력에도 학습 시 저장해둔 mean/std를 그대로 적용 (재계산 금지)."""
    return (X - mean) / std


def add_intercept(X: np.ndarray) -> np.ndarray:
    """맨 앞 열에 절편(1) 열 추가."""
    ones = np.ones((X.shape[0], 1))
    return np.hstack([ones, X])


CHI2_975_TABLE = {
    1: 5.024,
    2: 7.378,
    3: 9.348,
    4: 11.143,
    5: 12.833,
    6: 14.449,
    7: 16.013,
    8: 17.535,
}


def chi2_ppf_975(df: int) -> float:
    """카이제곱분포 97.5%ile. scipy 있으면 정확히 계산, 없으면 하드코딩 테이블(자유도 1~8)."""
    try:
        from scipy import stats as scipy_stats  # noqa: PLC0415

        return float(scipy_stats.chi2.ppf(0.975, df))
    except ImportError:
        if df in CHI2_975_TABLE:
            return CHI2_975_TABLE[df]
        # Wilson-Hilferty 근사 (scipy도 테이블도 없을 때의 최후 폴백)
        z975 = 1.959964
        return df * (1 - 2 / (9 * df) + z975 * np.sqrt(2 / (9 * df))) ** 3


def norm_cdf(x):
    """표준정규분포 누적분포함수(Φ). scipy 있으면 사용, 없으면 Abramowitz-Stegun 근사(오차 <7.5e-8)."""
    x = np.asarray(x, dtype=np.float64)
    try:
        from scipy import stats as scipy_stats  # noqa: PLC0415

        return scipy_stats.norm.cdf(x)
    except ImportError:
        return _norm_cdf_abramowitz_stegun(x)


def _norm_cdf_abramowitz_stegun(x: np.ndarray) -> np.ndarray:
    # Abramowitz & Stegun 7.1.26 (erf 근사) 기반 표준정규 CDF
    sign = np.sign(x)
    ax = np.abs(x) / np.sqrt(2.0)

    a1, a2, a3, a4, a5 = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429
    p = 0.3275911

    t = 1.0 / (1.0 + p * ax)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * np.exp(-ax * ax)
    erf_approx = sign * y
    return 0.5 * (1.0 + erf_approx)
