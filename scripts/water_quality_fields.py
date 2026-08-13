"""
BusanRvrwtQltyInfoService (getRvrwtQltyInfo) 응답 필드 매핑.

출처: 공공데이터포털 "하천수질(수질측정망) 현황 서비스" 참고문서
(하천수질(수질측정망) 현황 서비스.docx, API 버전 1.0 / 2018-11-30 배포).

주의:
- 이 API는 자동측정망(5분/1시간 단위 실시간)이 아니라 수동측정망 데이터이며,
  문서에 명시된 갱신주기는 "일 1회"다. 실시간 대시보드용 센서 데이터가 필요하면
  별도 자동측정망 API 키가 있어야 한다.
- water21의 원문 항목명은 "용존산소"로, water06(DO)과 이름이 중복된다. 예제 응답의
  water21 값(2.8~452 등)은 DO 범위(0~20 mg/L)를 크게 벗어나므로 원본 문서 표기 오류로
  보인다. water06을 신뢰 가능한 DO로 사용하고, water21은 실제 API 응답을 받아 값의
  분포를 확인하기 전까지는 그대로 신뢰하지 말 것.
- 문서의 예제 응답 XML은 메타 필드를 RIVER_NAME/AREA_NAME/LOC_NAME/LOC_ADDR/RIVER_CODE/
  AREA_CODE(대문자)로 표기하지만, 실제 getRvrwtQltyInfo 라이브 응답은 river_NAME/
  area_NAME/loc_NAME/loc_ADDR/river_CODE/area_CODE(소문자 접두)로 온다 (2026-08-14
  실호출로 확인). fetch_busan_water_data.py는 이미 소문자 키를 쓰고 있어 정상 동작한다.
  META_FIELD_MAP은 실제 라이브 키 기준으로 정의한다.
"""

WATER_FIELD_MAP = {
    "water01": "pH",
    "water02": "BOD",
    "water03": "COD",
    "water04": "TOC",
    "water05": "SS",  # 부유물질
    "water06": "DO",  # 용존산소
    "water07": "T-P",  # 총인
    "water08": "총대장균군",
    "water09": "분원성대장균군",
    "water10": "수온",
    "water11": "전기전도도",
    "water12": "페놀",
    "water13": "시안",
    "water14": "카드뮴",
    "water15": "수은",
    "water16": "비소",
    "water17": "납",
    "water18": "6가크롬",
    "water19": "암모니아성질소",
    "water20": "질산성질소",
    "water21": "용존산소",  # 원문 그대로. water06과 중복 표기 — 위 주의사항 참고.
    "water22": "용존총질소",
    "water23": "인산염인",
    "water24": "용존총인",
    "water25": "음이온계면활성제",
    "water26": "클로로필A",
    "water27": "안티몬",
}

# 위험도 계산에 바로 쓰는 핵심 4개 항목 (BOD/COD/DO/총대장균군)
RISK_CORE_FIELDS = {
    "water02": "BOD",
    "water03": "COD",
    "water06": "DO",
    "water08": "총대장균군",
}

# API 응답 item에 없는 메타/위치 필드 (water01~27과 별도).
# 실제 라이브 응답 키(소문자 접두) 기준 — 문서 예제 XML의 대문자 키와 다르다.
META_FIELD_MAP = {
    "inspec_ym": "측정년월",
    "inspec_loc": "측정소코드",
    "area_CODE": "권역코드",
    "area_NAME": "권역명",
    "river_CODE": "강 코드",
    "river_NAME": "강 이름",
    "loc_NAME": "측정소명",
    "loc_ADDR": "측정소 위치",
}


def rename_item_fields(item: dict) -> dict:
    """water01~27 및 메타 필드를 사람이 읽을 수 있는 한글 키로 변환.

    숫자 필드는 "1,208.1" 같은 천단위 콤마 문자열로 오므로 float 변환도 함께 수행한다.
    """
    combined_map = {**WATER_FIELD_MAP, **META_FIELD_MAP}
    renamed = {}
    for key, value in item.items():
        label = combined_map.get(key, key)
        if key in WATER_FIELD_MAP and isinstance(value, str) and value.strip():
            try:
                value = float(value.replace(",", ""))
            except ValueError:
                pass
        renamed[label] = value
    return renamed
