"""risk_score (0-100) and yield_index (0.5-1.3) from NDVI + weather. See docs/scoring.md.

    ndvi_score  = clamp((ndvi_mean - NDVI_REF_LOW) / (NDVI_REF_HIGH - NDVI_REF_LOW), 0, 1)
    water_score = 1 - clamp(water_deficit / et0, 0, 1)          (1 when et0 == 0)
    heat_score  = 1 - clamp(3 * heat_stress_days / period_days, 0, 1)
    health      = W_NDVI * ndvi_score + W_WATER * water_score + W_HEAT * heat_score   (weights normalized)
    risk_score  = round(100 * (1 - health))
    yield_index = 0.5 + 0.8 * health
"""

from ..config import Settings
from ..schemas import ScoreBreakdown

FORMULA_VERSION = "agro-score-v1"
YIELD_MIN, YIELD_MAX = 0.5, 1.3


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def score(
    ndvi_mean: float,
    water_deficit_mm: float,
    et0_mm: float,
    heat_stress_days: int,
    period_days: int,
    s: Settings,
) -> tuple[int, float, ScoreBreakdown]:
    ndvi_score = _clamp((ndvi_mean - s.ndvi_ref_low) / (s.ndvi_ref_high - s.ndvi_ref_low))
    water_score = 1.0 if et0_mm <= 0 else 1 - _clamp(water_deficit_mm / et0_mm)
    heat_score = 1 - _clamp(3 * heat_stress_days / max(1, period_days))

    total_w = s.weight_ndvi + s.weight_water + s.weight_heat
    weights = {
        "ndvi": s.weight_ndvi / total_w,
        "water": s.weight_water / total_w,
        "heat": s.weight_heat / total_w,
    }
    health = weights["ndvi"] * ndvi_score + weights["water"] * water_score + weights["heat"] * heat_score
    risk = round(100 * (1 - health))
    yield_index = round(YIELD_MIN + (YIELD_MAX - YIELD_MIN) * health, 4)
    return (
        int(risk),
        yield_index,
        ScoreBreakdown(
            ndvi_score=round(ndvi_score, 4),
            water_score=round(water_score, 4),
            heat_score=round(heat_score, 4),
            health=round(health, 4),
            weights={k: round(v, 4) for k, v in weights.items()},
        ),
    )
