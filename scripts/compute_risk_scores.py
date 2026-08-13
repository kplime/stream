"""
실제 하천수질(수질측정망) 데이터를 받아 규칙 기반(rule-based) 위험도 점수를 계산하고
프론트엔드가 읽을 수 있는 JSON으로 저장한다.

목적: mockData.ts가 순수 난수로 찍어내던 risk_score를, 아직 모델을 실데이터로
재학습하기 전이라도 최소한 "측정된 BOD/COD/DO/총대장균군 기반의 실제 값"으로
대체하기 위한 중간 단계. XGBoost Nowcast(Track A)·Streeter-Phelps DLM(Track B)
재학습이 끝나면 이 규칙 기반 점수는 모델 예측으로 교체되어야 한다.

점수 산식은 환경정책기본법 시행령 별표 "하천의 생활환경 기준" 등급 경계값을
기준으로 삼는다 (mg/L, 총대장균군은 군수/100mL):
    등급        BOD   COD   DO(최소)  총대장균군
    Ia 매우좋음   1     2     7.5      50
    Ib 좋음      2     4     5.0      500
    II 약간좋음   3     5     5.0      1,000
    III 보통     5     7     5.0      5,000
    IV 약간나쁨   8     9     2.0      5,000
    V  나쁨      10    11    2.0      -
    VI 매우나쁨  >10   >11   <2.0      -

BOD/COD는 10·11(≈V 등급 상한)에서 위험도 1.0, DO는 5mg/L 미만부터 결핍으로 간주해
0에서 선형 증가, 총대장균군은 값의 범위가 수백~수백만까지 벌어지므로 log10 스케일로
50(Ia)~5,000(III/IV 경계) 구간을 0→1로 매핑한다(그 이상은 1로 saturate).
"""

import json
import math
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

from fetch_busan_water_data import TARGET_RIVERS, fetch_busan_manual_water_quality  # noqa: E402
from water_quality_fields import rename_item_fields  # noqa: E402

OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "src", "data", "realWaterQuality.json"
)


def _to_float(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", "").strip())
    except ValueError:
        return None


def coliform_risk(coliform):
    if coliform is None or coliform <= 0:
        return 0.0
    lo, hi = math.log10(50), math.log10(5000)
    ratio = (math.log10(coliform) - lo) / (hi - lo)
    return min(1.0, max(0.0, ratio))


def do_deficit_risk(do_val):
    if do_val is None:
        return 0.0
    return min(1.0, max(0.0, (5.0 - do_val) / 5.0))


def bod_risk(bod):
    if bod is None:
        return 0.0
    return min(1.0, max(0.0, bod / 10.0))


def cod_risk(cod):
    if cod is None:
        return 0.0
    return min(1.0, max(0.0, cod / 11.0))


def risk_level(score):
    if score >= 0.66:
        return "high"
    if score >= 0.33:
        return "medium"
    return "low"


def compute_station_risk(item: dict):
    bod = _to_float(item.get("water02"))
    cod = _to_float(item.get("water03"))
    do_val = _to_float(item.get("water06"))
    coliform = _to_float(item.get("water08"))
    water_temp = _to_float(item.get("water10"))

    has_data = any(v is not None for v in (bod, cod, do_val, coliform))

    score = (
        0.4 * coliform_risk(coliform)
        + 0.3 * do_deficit_risk(do_val)
        + 0.15 * bod_risk(bod)
        + 0.15 * cod_risk(cod)
    )
    score = min(1.0, max(0.0, score))

    return {
        "station_name": item.get("loc_NAME"),
        "address": item.get("loc_ADDR"),
        "measured_at": item.get("inspec_ym"),
        "bod": bod,
        "cod": cod,
        "do": do_val,
        "total_coliform": coliform,
        "water_temp": water_temp,
        "data_missing": not has_data,
        "risk_score": round(score, 4) if has_data else None,
        "risk_level": risk_level(score) if has_data else None,
    }


def build_real_water_quality(max_pages=20, rows_per_page=100):
    raw_items = fetch_busan_manual_water_quality(
        rivers=TARGET_RIVERS, max_pages=max_pages, rows_per_page=rows_per_page
    )

    # 측정소별 최신 레코드만 유지 (inspec_ym 오름차순 데이터이므로 나중 항목이 최신)
    latest_by_station = {}
    for item in raw_items:
        river = item.get("river_NAME")
        station = item.get("loc_NAME")
        if not river or not station:
            continue
        key = (river, station)
        existing = latest_by_station.get(key)
        if existing is None or (item.get("inspec_ym") or "") >= (existing.get("inspec_ym") or ""):
            latest_by_station[key] = item

    result = {river: [] for river in TARGET_RIVERS}
    for (river, _station), item in latest_by_station.items():
        result[river].append(compute_station_risk(item))

    for river in result:
        result[river].sort(key=lambda s: s["station_name"] or "")

    return result


def main():
    result = build_real_water_quality()
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    payload = {
        "generated_at": datetime.now().isoformat(),
        "source": "BusanRvrwtQltyInfoService.getRvrwtQltyInfo (수동측정망, 갱신주기 일 1회)",
        "note": "risk_score는 XGBoost/DLM 모델이 아직 실데이터로 재학습되지 않아 "
        "환경정책기본법 시행령 하천 생활환경기준 경계값 기반 규칙 점수입니다.",
        "rivers": result,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    for river, stations in result.items():
        print(f"{river}: {len(stations)}개 측정소")
        for s in stations:
            print(f"  - {s['station_name']} ({s['measured_at']}): "
                  f"BOD={s['bod']} COD={s['cod']} DO={s['do']} "
                  f"총대장균군={s['total_coliform']} -> risk={s['risk_score']} ({s['risk_level']})")

    print(f"\nSaved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
