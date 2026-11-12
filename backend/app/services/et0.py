"""Reference evapotranspiration (ET0) with the FAO-56 Penman-Monteith equation (Allen et al. 1998).

    ET0 = [0.408 Δ (Rn − G) + γ (900 / (T + 273)) u2 (es − ea)] / [Δ + γ (1 + 0.34 u2)]

Inputs are daily values: Tmax/Tmin (°C), solar radiation Rs (MJ m⁻² day⁻¹), relative humidity
(%), wind speed at 2 m (m/s), plus latitude, elevation and day of year for the radiation terms.
All helper formulas carry their FAO-56 equation number.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

SOLAR_CONSTANT = 0.0820  # MJ m-2 min-1
STEFAN_BOLTZMANN = 4.903e-9  # MJ K-4 m-2 day-1
ALBEDO = 0.23  # reference grass


@dataclass(frozen=True)
class Et0Inputs:
    day: date
    tmax_c: float
    tmin_c: float
    rs_mj_m2: float
    rh_mean_pct: float | None
    wind_2m_ms: float
    lat_deg: float
    elevation_m: float
    rh_max_pct: float | None = None
    rh_min_pct: float | None = None


def wind_10m_to_2m(u10: float) -> float:
    """Eq. 47: logarithmic wind profile, 10 m -> 2 m."""
    return u10 * 4.87 / math.log(67.8 * 10 - 5.42)


def saturation_vapour_pressure(t_c: float) -> float:
    """Eq. 11, kPa."""
    return 0.6108 * math.exp(17.27 * t_c / (t_c + 237.3))


def extraterrestrial_radiation(lat_deg: float, day: date) -> float:
    """Eq. 21, MJ m-2 day-1."""
    j = day.timetuple().tm_yday
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi * j / 365)  # Eq. 23
    delta = 0.409 * math.sin(2 * math.pi * j / 365 - 1.39)  # Eq. 24
    ws = math.acos(max(-1.0, min(1.0, -math.tan(phi) * math.tan(delta))))  # Eq. 25
    return (24 * 60 / math.pi) * SOLAR_CONSTANT * dr * (
        ws * math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.sin(ws)
    )


def et0_penman_monteith(i: Et0Inputs) -> float:
    """Daily ET0 in mm/day. Returns 0 for physically impossible inputs instead of raising."""
    tmean = (i.tmax_c + i.tmin_c) / 2
    p = 101.3 * ((293 - 0.0065 * i.elevation_m) / 293) ** 5.26  # Eq. 7, kPa
    gamma = 0.000665 * p  # Eq. 8
    delta = 4098 * saturation_vapour_pressure(tmean) / (tmean + 237.3) ** 2  # Eq. 13

    e_tmax, e_tmin = saturation_vapour_pressure(i.tmax_c), saturation_vapour_pressure(i.tmin_c)
    es = (e_tmax + e_tmin) / 2  # Eq. 12
    if i.rh_max_pct is not None and i.rh_min_pct is not None:
        ea = (e_tmin * i.rh_max_pct / 100 + e_tmax * i.rh_min_pct / 100) / 2  # Eq. 17
    elif i.rh_mean_pct is not None:
        ea = es * i.rh_mean_pct / 100  # Eq. 19
    else:
        ea = e_tmin  # Eq. 48: assume Tdew ≈ Tmin when humidity is missing
    ea = min(ea, es)

    ra = extraterrestrial_radiation(i.lat_deg, i.day)
    rso = (0.75 + 2e-5 * i.elevation_m) * ra  # Eq. 37, clear-sky radiation
    rs = max(0.0, min(i.rs_mj_m2, rso)) if rso > 0 else 0.0
    rns = (1 - ALBEDO) * rs  # Eq. 38
    rel = rs / rso if rso > 0 else 0.0
    rnl = (
        STEFAN_BOLTZMANN
        * (((i.tmax_c + 273.16) ** 4 + (i.tmin_c + 273.16) ** 4) / 2)
        * (0.34 - 0.14 * math.sqrt(ea))
        * (1.35 * min(1.0, max(0.0, rel)) - 0.35)
    )  # Eq. 39
    rn = rns - rnl  # Eq. 40
    g = 0.0  # daily soil heat flux is negligible (Eq. 42)

    u2 = max(0.0, i.wind_2m_ms)
    num = 0.408 * delta * (rn - g) + gamma * (900 / (tmean + 273)) * u2 * (es - ea)
    den = delta + gamma * (1 + 0.34 * u2)
    return round(max(0.0, num / den), 3)
