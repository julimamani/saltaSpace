"""Orchestrates NDVI + weather + scoring for a lot polygon, with demo scenario overrides."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import date, timedelta
from typing import Any

from ..config import Settings
from ..schemas import AnalysisResult, NdviObservation, WeatherSummary
from . import ndvi as ndvi_svc
from . import scoring, weather

log = logging.getLogger(__name__)

_CACHE_TTL_S = 3600
_cache: dict[str, tuple[float, AnalysisResult]] = {}


def _period(start: date | None, end: date | None, s: Settings) -> tuple[date, date]:
    end = end or date.today()
    start = start or end - timedelta(days=s.analysis_window_days)
    if start >= end:
        raise ValueError("start_date must be before end_date")
    return start, end


def apply_scenario(series: list[NdviObservation], w: WeatherSummary, scenario: str) -> tuple[list[NdviObservation], WeatherSummary]:
    """Demo overrides: bend the latest observations and the water balance, then let the
    normal formula produce risk/yield, so the on-chain effect is consistent and explainable."""
    if scenario == "real" or not series:
        return series, w
    w = w.model_copy()
    out = [o.model_copy() for o in series]
    n = len(out)
    for i, o in enumerate(out):
        weight = (i + 1) / n  # ramp so the curve visibly drops / rises towards the end
        target = 0.22 if scenario == "drought" else 0.85
        o.mean = round(o.mean + (target - o.mean) * weight, 4)
        o.min = round(min(o.min, o.mean - 0.05), 4)
        o.max = round(max(o.max, o.mean + 0.03), 4)
    if scenario == "drought":
        w.rain_mm = round(w.rain_mm * 0.15, 1)
        w.heat_stress_days = max(w.heat_stress_days, 12)
    else:
        w.rain_mm = round(max(w.rain_mm, w.et0_mm * 1.05), 1)
        w.heat_stress_days = 0
    w.water_deficit_mm = round(max(0.0, w.et0_mm - w.rain_mm), 1)
    return out, w


def data_hash(payload: dict[str, Any]) -> str:
    """keccak256 of the canonical JSON payload (anchored on-chain as `dataHash`)."""
    from eth_utils import keccak

    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return "0x" + keccak(blob).hex()


def analyze(geometry: dict[str, Any], start: date | None, end: date | None, s: Settings, scenario: str = "real") -> AnalysisResult:
    start, end = _period(start, end, s)
    geo_key = hashlib.sha256(json.dumps(geometry, sort_keys=True).encode()).hexdigest()
    key = f"{geo_key}:{start}:{end}"
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_S:
        base = cached[1]
        series, w = base.series, base.weather
    else:
        lon, lat = ndvi_svc.centroid_of(geometry)
        series = ndvi_svc.get_ndvi_series(geometry, start, end, s)
        w = weather.get_weather(lat, lon, start, end, s)

    real_series, real_weather = series, w
    series, w = apply_scenario(series, w, scenario)
    latest = series[-1]
    risk, yield_index, breakdown = scoring.score(
        latest.mean, w.water_deficit_mm, w.et0_mm, w.heat_stress_days, (end - start).days, s
    )
    payload = {
        "formula": scoring.FORMULA_VERSION,
        "scenario": scenario,
        "period": [start.isoformat(), end.isoformat()],
        "scenes": [o.scene_id or f"mock:{o.date}" for o in series],
        "ndvi": latest.mean,
        "rain_mm": w.rain_mm,
        "et0_mm": w.et0_mm,
        "risk_score": risk,
        "yield_index": yield_index,
    }
    result = AnalysisResult(
        ndvi=latest,
        series=series,
        weather=w,
        risk_score=risk,
        yield_index=yield_index,
        breakdown=breakdown,
        scenario=scenario,  # type: ignore[arg-type]
        formula_version=scoring.FORMULA_VERSION,
        data_hash=data_hash(payload),
        centroid=ndvi_svc.centroid_of(geometry),
    )
    if scenario == "real":
        _cache[key] = (time.time(), result)
    elif not cached:
        _cache[key] = (time.time(), result.model_copy(update={"series": real_series, "weather": real_weather}))
    return result
