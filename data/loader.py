"""
부산 도심하천 수질예보 - 데이터 로더.

3개 공공 API(①자동측정망 실시간 수질, ②수질측정망 수동 측정, ③기상청 강수)를
순서대로 시도하고, 하나라도 인증/스키마 문제로 실패하면 즉시 현실적인 상관관계를
가진 합성 데이터로 대체한다. 해커톤 API 키 승인이 안 된 상태에서도 파이프라인
전체가 항상 실행 가능해야 하므로, "실패하면 예외를 던지고 멈춘다"가 아니라
"실패하면 조용히 다음 폴백으로 넘어간다"를 기본 동작으로 삼는다.
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

# Windows 콘솔 기본 코드페이지(cp949)는 "—" 같은 유니코드 문장부호를 못 담아서
# print()가 UnicodeEncodeError로 죽는다. 파이프라인의 모든 모듈이 결국 이 모듈을
# import하므로 여기서 한 번만 UTF-8로 강제한다.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

TARGET_RIVERS = ["온천천", "동천", "괴정천"]


def _load_dotenv():
    """레포 루트 .env를 읽어 os.environ에 채운다 (프론트엔드 Vite .env와 공유)."""
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

PUBLIC_DATA_API_KEY = os.getenv("PUBLIC_DATA_API_KEY", "")


def _http_get_json(url: str, params: dict, timeout: int = 8) -> dict:
    full_url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full_url)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# ① 자동측정망 (실시간 수질 — 탁도/DO/수온 등, 5분~1시간 단위)
# ---------------------------------------------------------------------------
def try_fetch_auto_measurement() -> pd.DataFrame | None:
    """부산 하천 자동측정망 실시간 조회. 승인 전 상태에서는 400/403이 정상 케이스."""
    if not PUBLIC_DATA_API_KEY:
        print("[Loader] PUBLIC_DATA_API_KEY 없음 — 자동측정망 호출 스킵")
        return None

    url = "http://apis.data.go.kr/6260000/BusanWaterQualityService/getWaterQualityList"
    params = {"serviceKey": PUBLIC_DATA_API_KEY, "numOfRows": 300, "pageNo": 1, "resultType": "json"}
    try:
        data = _http_get_json(url, params)
        items = data.get("response", {}).get("body", {}).get("items", {}).get("item") or []
        if isinstance(items, dict):
            items = [items]
        if not items:
            print("[Loader] 자동측정망 응답에 item 없음 — 폴백")
            return None
        df = pd.DataFrame(items)
        required = {"turbidity", "do", "waterTemp"}
        if not required.issubset(set(df.columns)):
            print(f"[Loader] 자동측정망 스키마 불일치 (필요 컬럼 {required} 없음) — 폴백")
            return None
        return df
    except Exception as e:  # noqa: BLE001 - 하나라도 실패하면 무조건 폴백으로
        print(f"[Loader] 자동측정망 호출 실패 ({e}) — 폴백")
        return None


# ---------------------------------------------------------------------------
# ② 수질측정망 (수동 측정 — BOD/COD/DO/총대장균군, 갱신주기 일 1회, 검증된 엔드포인트)
# ---------------------------------------------------------------------------
def try_fetch_manual_water_quality(rivers=TARGET_RIVERS, max_pages=10, rows_per_page=100) -> pd.DataFrame | None:
    """BusanRvrwtQltyInfoService/getRvrwtQltyInfo. 실호출로 검증된 엔드포인트지만,
    Track A가 필요로 하는 탁도·강수량 필드가 이 API 자체에는 없어서 Track A 학습에는
    직접 못 쓴다 (분원성대장균군수 라벨 검증용으로만 참고). scripts/water_quality_fields.py
    에 필드 매핑이 정리되어 있다.
    """
    if not PUBLIC_DATA_API_KEY:
        print("[Loader] PUBLIC_DATA_API_KEY 없음 — 수질측정망 호출 스킵")
        return None

    url = "https://apis.data.go.kr/6260000/BusanRvrwtQltyInfoService/getRvrwtQltyInfo"
    try:
        probe = _http_get_json(url, {"serviceKey": PUBLIC_DATA_API_KEY, "pageNo": 1, "numOfRows": 1, "resultType": "json"})
        total_count = int(probe["response"]["body"]["totalCount"])
        last_page = (total_count + rows_per_page - 1) // rows_per_page

        matched = []
        for page in range(last_page, max(last_page - max_pages, 0), -1):
            data = _http_get_json(url, {"serviceKey": PUBLIC_DATA_API_KEY, "pageNo": page, "numOfRows": rows_per_page, "resultType": "json"})
            items = data.get("response", {}).get("body", {}).get("items", {}).get("item") or []
            if isinstance(items, dict):
                items = [items]
            matched.extend(it for it in items if it.get("river_NAME") in rivers)

        if not matched:
            print("[Loader] 수질측정망 응답에 대상 하천 매칭 없음 — 폴백")
            return None
        print(f"[Loader] 수질측정망 {len(matched)}건 매칭 (전체 {total_count}건 중 최근 {max_pages}페이지 스캔)")
        return pd.DataFrame(matched)
    except Exception as e:  # noqa: BLE001
        print(f"[Loader] 수질측정망 호출 실패 ({e}) — 폴백")
        return None


# ---------------------------------------------------------------------------
# ③ 기상청 (강수량 — 동네예보 nx/ny 단일 지점 조회)
# ---------------------------------------------------------------------------
def try_fetch_weather(nx: int = 98, ny: int = 75) -> pd.DataFrame | None:
    """기상청 초단기실황 조회. 승인 전 상태에서는 403이 정상 케이스."""
    if not PUBLIC_DATA_API_KEY:
        print("[Loader] PUBLIC_DATA_API_KEY 없음 — 기상청 호출 스킵")
        return None

    url = "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
    now = datetime.now()
    params = {
        "serviceKey": PUBLIC_DATA_API_KEY,
        "pageNo": 1,
        "numOfRows": 10,
        "dataType": "JSON",
        "base_date": now.strftime("%Y%m%d"),
        "base_time": now.strftime("%H00"),
        "nx": nx,
        "ny": ny,
    }
    try:
        data = _http_get_json(url, params)
        items = data.get("response", {}).get("body", {}).get("items", {}).get("item") or []
        if not items:
            print("[Loader] 기상청 응답에 item 없음 — 폴백")
            return None
        return pd.DataFrame(items)
    except Exception as e:  # noqa: BLE001
        print(f"[Loader] 기상청 호출 실패 ({e}) — 폴백")
        return None


# ---------------------------------------------------------------------------
# 합성 데이터 (모든 실데이터 폴백의 종착점)
# ---------------------------------------------------------------------------
def generate_synthetic_track_a_dataset(n: int = 400, seed: int = 42) -> pd.DataFrame:
    """Track A 학습·데모용 합성 데이터.

    변수 간 현실적 상관관계를 강제한다:
      - 강수량↑ -> 탁도↑ (빗물 유입으로 부유물질 증가, 반응이 빠름 — 같은 시각)
      - 강수량↑(2~3시간 전 피크) -> DO↓ (BOD 분해로 산소부족이 누적되는 덴 시차가 있음 —
        Streeter-Phelps 자정작용의 임계시점 지연과 동일한 이유로 lag-weighted 강수를 씀.
        Track B의 분포시차모형이 이 지연을 실제로 학습해야 하므로 DO를 즉시 반응이 아니라
        지연 반응으로 만든다)
      - 탁도↑, DO↓ -> 분원성대장균군↑ (오수/CSO 월류 신호와 동행)
    딥러닝 학습 루프 없음 — 전부 벡터화된 numpy 연산이라 노트북에서 수 밀리초 내 생성됨.
    """
    rng = np.random.default_rng(seed)

    precip = np.clip(rng.exponential(scale=8.0, size=n), 0, 50)  # mm/hr
    turbidity = np.clip(8 + 3.2 * precip + rng.normal(0, 10, n), 0, 200)  # NTU
    water_temp = np.clip(rng.uniform(5, 30, n) - 0.03 * precip, 5, 30)  # ℃

    # DO는 지금 이 순간 강수가 아니라 2~3시간 전 강수에 더 크게 반응하도록 lag-weighted
    # 평균을 쓴다 (가중치 인덱스 k = t-k시간 전, 합=1). 앞쪽 시점은 이용 가능한 과거만 재정규화.
    lag_weights = np.array([0.05, 0.10, 0.20, 0.25, 0.15, 0.10, 0.07, 0.05, 0.03])
    lag_weights = lag_weights / lag_weights.sum()
    lagged_precip = np.zeros(n)
    for t in range(n):
        max_lag = min(t, len(lag_weights) - 1)
        w = lag_weights[: max_lag + 1]
        w = w / w.sum()
        lagged_precip[t] = np.dot(w, precip[t - max_lag : t + 1][::-1])

    do = np.clip(9.5 - 0.09 * lagged_precip - 0.012 * turbidity + rng.normal(0, 0.6, n), 0, 12)  # mg/L

    # 계수는 임계값(1000 CFU/100mL) 초과 비율이 ~30%가 되도록 보정한 값
    # (과거 튜닝값 그대로 쓰면 양성 클래스가 1% 미만으로 나와 IRLS가 분리불가 상태로 발산함).
    log_coliform = 7.2 + 0.025 * turbidity - 0.20 * do + 0.020 * precip + rng.normal(0, 0.6, n)
    coliform = np.exp(log_coliform)  # 분원성대장균군, CFU/100mL

    start = datetime.now() - timedelta(hours=n)
    timestamps = [start + timedelta(hours=i) for i in range(n)]
    rivers = rng.choice(TARGET_RIVERS, size=n)

    df = pd.DataFrame({
        "timestamp": timestamps,
        "river_name": rivers,
        "turbidity": turbidity,
        "do": do,
        "water_temp": water_temp,
        "precip_24h": precip,
        "coliform": coliform,
    })
    return df


def load_track_a_data(n_synthetic: int = 400, force_synthetic: bool = False) -> tuple[pd.DataFrame, bool]:
    """Track A 학습 데이터 로드. 반환값은 (DataFrame, is_synthetic).

    실데이터 경로: 자동측정망(탁도/DO/수온) + 기상청(강수) 결합을 시도한다.
    현재 두 API 모두 미승인 상태라 거의 항상 폴백을 타는 게 정상이며, 이는 버그가
    아니라 의도된 동작이다 (AI_HANDOVER.md 참고).
    """
    if not force_synthetic:
        auto_df = try_fetch_auto_measurement()
        weather_df = try_fetch_weather()
        if auto_df is not None and weather_df is not None:
            # TODO: 두 API 모두 승인되면 여기서 timestamp 기준으로 merge_asof 결합.
            # 현재는 스키마/승인 문제로 도달하지 않는 경로.
            print("[Loader] 실데이터 결합 경로는 아직 미구현 — 합성 데이터로 진행")

    print(f"[Loader] 합성 데이터 {n_synthetic}건 생성 (seed=42, 재현 가능)")
    return generate_synthetic_track_a_dataset(n_synthetic), True


if __name__ == "__main__":
    df, is_synthetic = load_track_a_data()
    print(f"\n합성 데이터 여부: {is_synthetic}")
    print(df.describe())
