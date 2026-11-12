"""Crop water balance (FAO-56 chapter 8): ETc = ET0 x Kc, daily root-zone bucket and the
flowering-stage stress days that feed the drought / insurance triggers.

    TAW = 1000 (θFC − θWP) Zr          total available water, mm
    RAW = p · TAW                      readily available water
    Dr_i = Dr_{i-1} − P_i + ETc_i      depletion, clamped to [0, TAW]      (eq. 85, no irrigation)
    stress day  ⇔  Dr_i > RAW
    critical_dry_days = stress days inside the flowering (mid-season) window
"""

from __future__ import annotations

from datetime import date, timedelta

from ..config import Settings
from ..schemas import WaterBalance, WeatherDay, WeatherSummary
from .crops import CropProfile, estimate_sowing, profile_for
from .weather import normal_rain


def season_window(crop_name: str | None, today: date, sowing: date | None, harvest: date | None, s: Settings) -> tuple[CropProfile, date, str, date]:
    crop = profile_for(crop_name)
    if sowing is None:
        sowing, basis = estimate_sowing(crop, today, harvest)
    else:
        basis = "informada por el productor"
    harvest_eff = harvest or sowing + timedelta(days=crop.season_days)
    return crop, sowing, basis, harvest_eff


def run_balance(days: list[WeatherDay], crop: CropProfile, sowing: date, s: Settings) -> None:
    """Annotates each WeatherDay in place with kc, etc_mm, soil_depletion_mm, stress, stage."""
    taw = 1000 * s.soil_available_water_m3_m3 * crop.root_depth_m
    raw = crop.depletion_p * taw
    depletion = taw * s.initial_depletion_fraction
    for d in days:
        das = (d.date - sowing).days
        kc = crop.kc(das)
        et0 = d.et0_mm if d.et0_mm is not None else (d.et0_ref_mm or 0.0)
        etc = et0 * kc
        depletion = min(taw, max(0.0, depletion - (d.precipitation_mm or 0.0) + etc))
        d.kc = round(kc, 3)
        d.etc_mm = round(etc, 3)
        d.soil_depletion_mm = round(depletion, 1)
        d.stress = kc > 0 and depletion > raw
        d.stage = crop.stage(das)


def summarize(w: WeatherSummary, crop: CropProfile, sowing: date, basis: str, harvest: date, today: date, s: Settings) -> WaterBalance:
    f_start_off, f_end_off = crop.flowering_offset
    f_start, f_end = sowing + timedelta(days=f_start_off), sowing + timedelta(days=f_end_off)
    season_days = [d for d in w.daily if d.date >= sowing and (d.kc or 0) > 0]
    flowering = [d for d in season_days if f_start <= d.date <= f_end]
    critical = sum(1 for d in flowering if d.stress)

    longest = run = 0
    for d in season_days:
        run = run + 1 if d.stress else 0
        longest = max(longest, run)

    rain = sum(d.precipitation_mm or 0 for d in season_days)
    et0 = sum((d.et0_mm if d.et0_mm is not None else d.et0_ref_mm) or 0 for d in season_days)
    etc = sum(d.etc_mm or 0 for d in season_days)
    normal: float | None = None
    ratio: float | None = None
    if season_days and w.climatology_mm_day:
        # Normal rain for the season's own calendar days (not the whole data window).
        normal = normal_rain(w.climatology_mm_day, season_days[0].date, season_days[-1].date)
        ratio = round(rain / normal, 3) if normal >= s.min_normal_rain_mm else 1.0
    taw = 1000 * s.soil_available_water_m3_m3 * crop.root_depth_m
    return WaterBalance(
        crop=crop.key,
        crop_label=crop.label,
        sowing_date=sowing,
        sowing_basis=basis,
        harvest_date=harvest,
        stage_today=crop.stage((today - sowing).days),
        flowering_start=f_start,
        flowering_end=f_end,
        season_start=season_days[0].date if season_days else sowing,
        rain_mm=round(rain, 1),
        et0_mm=round(et0, 1),
        etc_mm=round(etc, 1),
        balance_mm=round(rain - etc, 1),
        critical_dry_days=critical,
        flowering_days_observed=len(flowering),
        max_dry_spell_days=longest,
        normal_rain_mm=normal,
        rain_vs_normal=ratio,
        taw_mm=round(taw, 1),
        raw_mm=round(crop.depletion_p * taw, 1),
    )


def water_balance(w: WeatherSummary, crop_name: str | None, today: date, sowing: date | None, harvest: date | None, s: Settings) -> WaterBalance:
    crop, sowing_eff, basis, harvest_eff = season_window(crop_name, today, sowing, harvest, s)
    run_balance(w.daily, crop, sowing_eff, s)
    return summarize(w, crop, sowing_eff, basis, harvest_eff, today, s)
