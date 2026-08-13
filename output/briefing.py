"""
위험도 수치 → 자연어 브리핑 문장. Anthropic API 1회 호출로 생성하되,
ANTHROPIC_API_KEY가 없으면 규칙 기반 템플릿으로 조립한다 (파이프라인이 절대
LLM 유무에 의존하지 않도록).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from data.loader import _load_dotenv  # noqa: F401 - import만으로 .env 로드 + stdout UTF-8 고정

FEATURE_LABELS = {
    "turbidity": "탁도",
    "do": "용존산소(DO)",
    "water_temp": "수온",
    "precip_24h": "24시간 누적강수량",
}


def _top_contributors(contributions: dict, k: int = 2) -> list[tuple[str, float]]:
    """절대값 기준 상위 k개 기여도 변수. (변수명, 기여도) 튜플 리스트."""
    return sorted(contributions.items(), key=lambda kv: -abs(kv[1]))[:k]


def _rule_based_briefing(river_name: str, risk_prob: float, contributions: dict) -> str:
    """LLM 없이 상위 기여 변수를 문장 템플릿에 꽂아 넣는 폴백."""
    top = _top_contributors(contributions, k=2)
    factor_names = [FEATURE_LABELS.get(name, name) for name, _ in top]

    if not top:
        return f"{river_name} 위험도 {risk_prob * 100:.0f}%."

    direction = "상승" if top[0][1] > 0 else "하강"
    if len(factor_names) >= 2:
        factors_str = f"{factor_names[0]}·{factor_names[1]}"
    else:
        factors_str = factor_names[0]

    return f"{river_name} 위험도 {risk_prob * 100:.0f}%, 주요 요인: {factors_str} ({direction} 방향 기여)."


def _llm_briefing(river_name: str, risk_prob: float, contributions: dict) -> str | None:
    """Anthropic API 1회 호출로 한국어 브리핑 생성. 실패 시 None (호출부가 폴백 처리)."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    try:
        import anthropic
    except ImportError:
        print("[Briefing] anthropic 미설치 — 규칙 기반 템플릿으로 폴백 (선택 의존성)")
        return None

    top = _top_contributors(contributions, k=2)
    factors_desc = ", ".join(
        f"{FEATURE_LABELS.get(name, name)} ({'위험 상승 요인' if val > 0 else '위험 완화 요인'})"
        for name, val in top
    )

    prompt = (
        f"하천명: {river_name}\n"
        f"대장균 접촉위험 확률: {risk_prob * 100:.0f}%\n"
        f"주요 기여 변수: {factors_desc}\n\n"
        "위 정보만으로 시민 대상 하천 수질 위험도 브리핑을 한국어 한 문장으로 작성해줘. "
        "예시 형식: \"온천천 현재 위험도 42%. 최근 강수량 증가가 주요 요인으로 분석됨.\" "
        "문장 외 다른 말은 붙이지 마."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-5",
            max_tokens=120,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        return text if text else None
    except Exception as e:  # noqa: BLE001 - LLM 호출은 실패해도 파이프라인을 막으면 안 됨
        print(f"[Briefing] LLM 호출 실패 ({e}) — 규칙 기반 템플릿으로 폴백")
        return None


def generate_briefing(river_name: str, risk_prob: float, contributions: dict) -> str:
    """위험확률 + 변수별 기여도 → 한국어 브리핑 문장. ANTHROPIC_API_KEY 없거나 호출
    실패 시 자동으로 규칙 기반 템플릿을 반환한다."""
    llm_text = _llm_briefing(river_name, risk_prob, contributions)
    return llm_text if llm_text is not None else _rule_based_briefing(river_name, risk_prob, contributions)


if __name__ == "__main__":
    from data.loader import load_track_a_data
    from models.track_a import TrackAModel, FEATURE_COLUMNS

    df, _ = load_track_a_data()
    model = TrackAModel().fit(df)

    sample = df.iloc[-1]
    x_raw = {f: float(sample[f]) for f in FEATURE_COLUMNS}
    prob, contributions = model.predict(x_raw)

    briefing = generate_briefing(sample["river_name"], prob, contributions)
    print(f"\n[Briefing] ANTHROPIC_API_KEY 설정 여부: {bool(os.getenv('ANTHROPIC_API_KEY'))}")
    print(f"[Briefing] 생성된 문장: {briefing}")

    # LLM 키가 있어도 규칙 기반 폴백이 정상 동작하는지 별도 확인
    rule_only = _rule_based_briefing(sample["river_name"], prob, contributions)
    print(f"[Briefing] 규칙 기반 템플릿 (참고용): {rule_only}")
