"""risk_score (0-100) and yield_index (0.5-1.3). Formula `agro-score-v2`, see docs/scoring.md.

    vigor_score  = mean(ndvi_score, evi_score)        ndvi/evi scaled between REF_LOW..REF_HIGH
    ndwi_score   = scale(ndwi, NDWI_REF_LOW, NDWI_REF_HIGH)         canopy water (Sentinel-2 B08/B11)
    water_score  = 1 - clamp((ETc - rain) / ETc, 0, 1)              season deficit vs crop demand
    stress_score = 1 - clamp(critical_dry_days / CRITICAL_DRY_DAYS_REF, 0, 1)   flowering stress days
    heat_score   = 1 - clamp(3 * heat_stress_days / period_days, 0, 1)
    sar_score    = scale(rvi, RVI_REF_LOW, RVI_REF_HIGH)             radar biomass (Sentinel-1)
    health       = Σ w_i * score_i / Σ w_i          (components without data are dropped)
    risk_score   = round(100 * (1 - health))
    yield_index  = 0.5 + 0.8 * health
"""

from __future__ import annotations

from ..config import Settings
from ..schemas import ScoreBreakdown

FORMULA_VERSION = "agro-score-v2"
YIELD_MIN, YIELD_MAX = 0.5, 1.3


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _scale(x: float, lo: float, hi: float) -> float:
    return _clamp((x - lo) / (hi - lo))


def score(
    ndvi_mean: float,
    evi: float | None,
    ndwi: float | None,
    rain_mm: float,
    etc_mm: float,
    critical_dry_days: int,
    heat_stress_days: int,
    period_days: int,
    rvi: float | None,
    s: Settings,
) -> tuple[int, float, ScoreBreakdown]:
    ndvi_score = _scale(ndvi_mean, s.ndvi_ref_low, s.ndvi_ref_high)
    vigor = ndvi_score if evi is None else (ndvi_score + _scale(evi, s.evi_ref_low, s.evi_ref_high)) / 2
    ndwi_score = None if ndwi is None else _scale(ndwi, s.ndwi_ref_low, s.ndwi_ref_high)
    water_score = 1.0 if etc_mm <= 0 else 1 - _clamp(max(0.0, etc_mm - rain_mm) / etc_mm)
    stress_score = 1 - _clamp(critical_dry_days / max(1, s.critical_dry_days_ref))
    heat_score = 1 - _clamp(3 * heat_stress_days / max(1, period_days))
    sar_score = None if rvi is None else _scale(rvi, s.rvi_ref_low, s.rvi_ref_high)

    parts: dict[str, tuple[float, float | None]] = {
        "vigor": (s.weight_vigor, vigor),
        "ndwi": (s.weight_ndwi, ndwi_score),
        "water": (s.weight_water, water_score),
        "stress": (s.weight_stress, stress_score),
        "heat": (s.weight_heat, heat_score),
        "sar": (s.weight_sar, sar_score),
    }
    present = {k: v for k, v in parts.items() if v[1] is not None}
    total_w = sum(w for w, _ in present.values()) or 1.0
    weights = {k: round(w / total_w, 4) for k, (w, _) in present.items()}
    health = sum((w / total_w) * v for w, v in present.values() if v is not None)
    risk = int(round(100 * (1 - health)))
    yield_index = round(YIELD_MIN + (YIELD_MAX - YIELD_MIN) * health, 4)
    return (
        risk,
        yield_index,
        ScoreBreakdown(
            vigor_score=round(vigor, 4),
            ndwi_score=None if ndwi_score is None else round(ndwi_score, 4),
            water_score=round(water_score, 4),
            stress_score=round(stress_score, 4),
            heat_score=round(heat_score, 4),
            sar_score=None if sar_score is None else round(sar_score, 4),
            health=round(health, 4),
            weights=weights,
        ),
    )
