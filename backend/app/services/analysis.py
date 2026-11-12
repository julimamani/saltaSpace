"""Orchestrates satellite indices (Sentinel-2 + Sentinel-1), weather, FAO-56 water balance,
scoring and the parametric-insurance evaluation for a lot polygon, with demo scenario overrides."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import date, timedelta
from typing import Any

from ..config import Settings
from ..schemas import AnalysisResult, IndexObservation, SarSummary, WeatherSummary
from . import hydro, insurance, ndvi as ndvi_svc, sar as sar_svc, scoring, weather

log = logging.getLogger(__name__)

_CACHE_TTL_S = 3600
_cache: dict[str, tuple[float, tuple[list[IndexObservation], WeatherSummary, SarSummary]]] = {}


def _period(start: date | None, end: date | None, s: Settings) -> tuple[date, date]:
    end = end or date.today()
    start = start or end - timedelta(days=s.analysis_window_days)
    if start >= end:
        raise ValueError("start_date must be before end_date")
    return start, end


def ndvi_drop(series: list[IndexObservation]) -> float:
    """Relative fall of the latest NDVI from the season peak (0 = at peak, 1 = total loss)."""
    if not series:
        return 0.0
    peak = max(o.mean for o in series)
    if peak <= 0:
        return 0.0
    return round(max(0.0, (peak - series[-1].mean) / peak), 4)


def apply_scenario(
    series: list[IndexObservation], w: WeatherSummary, sar: SarSummary, scenario: str
) -> tuple[list[IndexObservation], WeatherSummary, SarSummary]:
    """Demo overrides: bend the latest observations, the rain and the radar, then let the normal
    formula (water balance, score, trigger) run, so the on-chain effect stays explainable."""
    if scenario == "real" or not series:
        return series, w, sar
    w = w.model_copy(deep=True)
    sar = sar.model_copy(deep=True)
    out = [o.model_copy() for o in series]
    n = len(out)
    drought = scenario == "drought"
    for i, o in enumerate(out):
        weight = (i + 1) / n  # ramp so the curve visibly drops / rises towards the end
        for attr, target in (("mean", 0.22 if drought else 0.85), ("evi", 0.12 if drought else 0.65), ("ndwi", -0.15 if drought else 0.35)):
            cur = getattr(o, attr)
            if cur is not None:
                setattr(o, attr, round(cur + (target - cur) * weight, 4))
        o.min = round(min(o.min, o.mean - 0.05), 4)
        o.max = round(max(o.max, o.mean + 0.03), 4)
        if o.evi is not None:
            o.lai = round(max(0.0, 3.618 * o.evi - 0.118), 3)
    rain_factor = 0.15 if drought else 1.6
    for d in w.daily:
        if d.precipitation_mm is not None:
            d.precipitation_mm = round(d.precipitation_mm * rain_factor, 2)
        if drought:
            d.temp_max_c = None if d.temp_max_c is None else d.temp_max_c + 4
    w.rain_mm = round(sum(d.precipitation_mm or 0 for d in w.daily), 1)
    w.water_deficit_mm = round(max(0.0, w.et0_mm - w.rain_mm), 1)
    w.heat_stress_days = max(w.heat_stress_days, 12) if drought else 0
    for o in sar.observations:
        o.vv_db = round(o.vv_db - 5 if drought else o.vv_db + 2, 2)
        o.rvi = round(max(0.05, o.rvi * (0.5 if drought else 1.15)), 4)
        o.dry_soil = drought
    if sar.observations:
        sar.latest_vv_db = sar.observations[-1].vv_db
        sar.latest_rvi = sar.observations[-1].rvi
    sar.soil_dry_days = 30 if drought else 0
    return out, w, sar


def data_hash(payload: dict[str, Any]) -> str:
    """keccak256 of the canonical JSON payload (anchored on-chain as `dataHash`)."""
    from eth_utils import keccak

    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return "0x" + keccak(blob).hex()


def analyze(
    geometry: dict[str, Any],
    start: date | None,
    end: date | None,
    s: Settings,
    scenario: str = "real",
    crop: str | None = None,
    sowing: date | None = None,
    harvest: date | None = None,
) -> AnalysisResult:
    start, end = _period(start, end, s)
    today = end
    crop_profile, sowing_eff, _basis, _harvest = hydro.season_window(crop, today, sowing, harvest, s)
    # Weather must cover the crop season (for the water balance), not only the satellite window.
    w_start = min(start, max(sowing_eff, end - timedelta(days=max(s.analysis_window_days, crop_profile.season_days))))

    geo_key = hashlib.sha256(json.dumps(geometry, sort_keys=True).encode()).hexdigest()
    key = f"{geo_key}:{start}:{end}:{w_start}"
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_S:
        series, w, sar = cached[1]
    else:
        lon, lat = ndvi_svc.centroid_of(geometry)
        # Satellite series over the whole season too, so `ndvi_drop` sees the real season peak.
        series = ndvi_svc.get_ndvi_series(geometry, w_start, end, s)
        cloudy = (series[-1].cloud_cover or 0) > s.cloud_priority_threshold or series[-1].source == "mock"
        sar = sar_svc.get_sar(geometry, w_start, end, s, prioritized=cloudy)
        w = weather.get_weather(lat, lon, w_start, end, s)
        _cache[key] = (time.time(), (series, w, sar))

    series, w, sar = apply_scenario([o.model_copy() for o in series], w.model_copy(deep=True), sar.model_copy(deep=True), scenario)
    wb = hydro.water_balance(w, crop, today, sowing, harvest, s)
    latest = series[-1]
    drop = ndvi_drop(series)
    rvi = sar.latest_rvi if sar.source != "none" else None
    risk, yield_index, breakdown = scoring.score(
        latest.mean, latest.evi, latest.ndwi, wb.rain_mm, wb.etc_mm, wb.critical_dry_days, w.heat_stress_days, (end - w_start).days, rvi, s
    )
    if sar.prioritized and sar.soil_dry_days >= s.soil_dry_days_trigger:
        # Cloudy optics: trust the radar's prolonged dry soil and lift the risk floor.
        risk = max(risk, 60)
    ins = insurance.evaluate(wb, latest.ndwi, drop, sar, risk, s)
    payload = {
        "formula": scoring.FORMULA_VERSION,
        "scenario": scenario,
        "period": [w_start.isoformat(), end.isoformat()],
        "scenes": [o.scene_id or f"mock:{o.date}" for o in series],
        "sar_scenes": [o.scene_id or f"mock:{o.date}" for o in sar.observations],
        "crop": wb.crop,
        "sowing": wb.sowing_date.isoformat(),
        "ndvi": latest.mean,
        "ndwi": latest.ndwi,
        "rain_mm": wb.rain_mm,
        "etc_mm": wb.etc_mm,
        "critical_dry_days": wb.critical_dry_days,
        "rain_vs_normal": wb.rain_vs_normal,
        "soil_dry_days": sar.soil_dry_days,
        "risk_score": risk,
        "yield_index": yield_index,
        "trigger": ins.trigger_seguro,
    }
    return AnalysisResult(
        ndvi=latest,
        series=series,
        sar=sar,
        weather=w,
        water_balance=wb,
        insurance=ins,
        risk_score=risk,
        yield_index=yield_index,
        ndvi_drop=drop,
        satellite_priority="sentinel-1" if sar.prioritized and sar.source != "none" else "sentinel-2",
        breakdown=breakdown,
        scenario=scenario,  # type: ignore[arg-type]
        formula_version=scoring.FORMULA_VERSION,
        data_hash=data_hash(payload),
        centroid=ndvi_svc.centroid_of(geometry),
    )
