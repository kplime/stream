"""
부산 도심하천 (온천천·동천·괴정천) 공공데이터 수집 및 캐싱 스크립트
1. 부산광역시_하천 수질 자동측정망 정보 (5분/1시간 단위: 수온, pH, DO, 탁도, EC)
2. 부산광역시_하천 수질 수질측정망 정보 (BOD, COD, 총대장균군수 - 학습용 종속변수)
3. 기상청_단기예보 조회서비스 (초단기 강실황 및 강수예보)
"""

import os
import json
import urllib.request
import urllib.parse
from datetime import datetime

def _load_dotenv():
    """Minimal .env loader (no python-dotenv dependency) — reads the repo-root
    .env so this script shares credentials with the frontend's Vite .env."""
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

# 공공데이터포털 API KEY (환경 변수 또는 .env)
PUBLIC_DATA_API_KEY = os.getenv("PUBLIC_DATA_API_KEY", "YOUR_DECODED_API_KEY_HERE")

TARGET_RIVERS = ["온천천", "동천", "괴정천"]


def fetch_busan_manual_water_quality(rivers=TARGET_RIVERS, max_pages=10, rows_per_page=100):
    """부산광역시_하천 수질(수질측정망) 정보 수집 (BOD/COD/총대장균군수 등 학습용 라벨 데이터).

    Endpoint: BusanRvrwtQltyInfoService / getRvrwtQltyInfo (2026-08-14 실호출로 검증됨 —
    참고문서에 있던 다른 이름 후보들은 전부 NO_OPENAPI_SERVICE_ERROR였음).

    데이터는 inspec_ym(조사년월) 오름차순으로 쌓여있고 1992-10부터 시작하는 것으로 확인됨
    (totalCount ~14,500건). 최신 데이터 위주로 보기 위해 마지막 페이지부터 역순으로 스캔한다.

    TODO: 응답의 water01~water27 필드는 공공데이터포털 상세페이지 참고문서
    ("하천수질(수질측정망) 현황 서비스.docx")에 실제 측정 항목(pH/BOD/COD/DO/총대장균군수 등)
    매핑표가 있을 것으로 보이나 아직 확보하지 못함. 그 문서 내용을 받기 전까지는 water01~27을
    raw 그대로 반환한다 — 임의로 추측해서 매핑하면 학습 라벨이 잘못될 위험이 있음.
    """
    url = "https://apis.data.go.kr/6260000/BusanRvrwtQltyInfoService/getRvrwtQltyInfo"

    def _call(page_no, num_rows):
        params = {
            "serviceKey": PUBLIC_DATA_API_KEY,
            "pageNo": page_no,
            "numOfRows": num_rows,
            "resultType": "json",
        }
        full_url = f"{url}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(full_url)
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    try:
        probe = _call(1, 1)
        total_count = int(probe["response"]["body"]["totalCount"])
    except Exception as e:
        print(f"[Warning] Manual water quality probe call failed ({e}). Returning empty list.")
        return []

    last_page = (total_count + rows_per_page - 1) // rows_per_page
    matched = []

    for page in range(last_page, max(last_page - max_pages, 0), -1):
        try:
            data = _call(page, rows_per_page)
        except Exception as e:
            print(f"[Warning] Manual water quality page {page} failed ({e}), skipping.")
            continue

        items = data.get("response", {}).get("body", {}).get("items", {}).get("item") or []
        if isinstance(items, dict):  # API returns a bare object (not a list) when there's exactly one item
            items = [items]

        matched.extend(it for it in items if it.get("river_NAME") in rivers)

    print(f"[Manual Water Quality] 최근 {max_pages}페이지 스캔, {len(matched)}건 매칭 "
          f"(대상 하천: {', '.join(rivers)} / 전체 {total_count}건)")
    return matched


def fetch_busan_auto_water_quality():
    """부산광역시 하천 수질 자동측정망 정보 수집 (온천천, 동천 5개 측정소)"""
    url = "http://apis.data.go.kr/6260000/BusanWaterQualityService/getWaterQualityList"
    params = {
        "serviceKey": PUBLIC_DATA_API_KEY,
        "numOfRows": 100,
        "pageNo": 1,
        "resultType": "json"
    }
    query_string = urllib.parse.urlencode(params)
    full_url = f"{url}?{query_string}"
    
    print(f"[API Fetch] Requesting Busan Auto Water Quality from {full_url[:60]}...")
    try:
        req = urllib.request.Request(full_url)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            print("Successfully fetched Auto Water Quality data.")
            return data
    except Exception as e:
        print(f"[Warning] Public API call failed ({e}). Returning cached mock baseline.")
        return None

def fetch_kma_weather(nx=98, ny=75):
    """기상청 초단기실황 (부산 온천천/동천 좌표 격자 nx=98, ny=75)"""
    url = "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
    now_str = datetime.now().strftime("%Y%m%d")
    time_str = datetime.now().strftime("%H00")
    
    params = {
        "serviceKey": PUBLIC_DATA_API_KEY,
        "pageNo": 1,
        "numOfRows": 10,
        "dataType": "JSON",
        "base_date": now_str,
        "base_time": time_str,
        "nx": nx,
        "ny": ny
    }
    query_string = urllib.parse.urlencode(params)
    full_url = f"{url}?{query_string}"
    
    print(f"[KMA API] Fetching ultra-short weather data...")
    try:
        req = urllib.request.Request(full_url)
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"[Warning] KMA API fallback mode active: {e}")
        return None

if __name__ == "__main__":
    print("=== 부산 도심하천 공공데이터 수집 파이프라인 ===")
    manual_water_data = fetch_busan_manual_water_quality()
    water_data = fetch_busan_auto_water_quality()
    weather_data = fetch_kma_weather()
    print("수집 파이프라인 정상 작동 완료.")
