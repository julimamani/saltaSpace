"""Daily weather from Open-Meteo (archive + forecast) with NASA POWER as fallback and
climatology source. ET0 is computed here with FAO-56 Penman-Monteith (services/et0.py);
Open-Meteo's own ET0 is kept as `et0_ref_mm` to cross-check the implementation."""

from __future__ import annotations

import calendar
import logging
from datetime import date, timedelta
from statistics import mean
from typing import Any

import httpx

from ..config import Settings
from ..schemas import WeatherDay, WeatherSummary
from .et0 import Et0Inputs, et0_penman_monteith, wind_10m_to_2m

log = logging.getLogger(__name__)
NASA_FILL = -999.0
OPEN_METEO_DAILY = ",".join(
    [
        "precipitation_sum",
        "temperature_2m_mean",
        "temperature_2m_max",
        "temperature_2m_min",
        "relative_humidity_2m_mean",
        "relative_humidity_2m_max",
        "relative_humidity_2m_min",
        "wind_speed_10m_mean",
        "shortwave_radiation_sum",
        "et0_fao_evapotranspiration",
    ]
)


def _get_json(client: httpx.Client, url: str, params: dict[str, Any]) -> dict[str, Any]:
    r = client.get(url, params=params)
    r.raise_for_status()
    return r.json()


def _val(d: dict[str, list], key: str, i: int) -> float | None:
    v = d.get(key)
    return None if v is None or v[i] is None else float(v[i])


def _with_et0(day: WeatherDay, lat: float, elevation: float, rh_max: float | None, rh_min: float | None) -> WeatherDay:
    if day.temp_max_c is None or day.temp_min_c is None or day.radiation_mj_m2 is None:
        return day
    day.et0_mm = et0_penman_monteith(
        Et0Inputs(
            day=day.date,
            tmax_c=day.temp_max_c,
            tmin_c=day.temp_min_c,
            rs_mj_m2=day.radiation_mj_m2,
            rh_mean_pct=day.rh_mean_pct,
            wind_2m_ms=day.wind_2m_ms if day.wind_2m_ms is not None else 2.0,
            lat_deg=lat,
            elevation_m=elevation,
            rh_max_pct=rh_max,
            rh_min_pct=rh_min,
        )
    )
    return day


def fetch_open_meteo(lat: float, lon: float, start: date, end: date, s: Settings, client: httpx.Client) -> tuple[list[WeatherDay], float]:
    """Returns (days, elevation). The archive (ERA5) lags ~5 days; the forecast API fills the rest."""
    archive_end = min(end, date.today() - timedelta(days=6))
    days: dict[date, WeatherDay] = {}
    elevation = 0.0

    def add(payload: dict[str, Any]) -> None:
        nonlocal elevation
        elevation = float(payload.get("elevation") or elevation)
        d = payload["daily"]
        for i, t in enumerate(d["time"]):
            day = date.fromisoformat(t)
            if not (start <= day <= end):
                continue
            wind10 = _val(d, "wind_speed_10m_mean", i)
            wd = WeatherDay(
                date=day,
                precipitation_mm=_val(d, "precipitation_sum", i),
                temp_mean_c=_val(d, "temperature_2m_mean", i),
                temp_max_c=_val(d, "temperature_2m_max", i),
                temp_min_c=_val(d, "temperature_2m_min", i),
                rh_mean_pct=_val(d, "relative_humidity_2m_mean", i),
                wind_2m_ms=None if wind10 is None else round(wind_10m_to_2m(wind10), 2),
                radiation_mj_m2=_val(d, "shortwave_radiation_sum", i),
                et0_ref_mm=_val(d, "et0_fao_evapotranspiration", i),
            )
            days[day] = _with_et0(wd, lat, elevation, _val(d, "relative_humidity_2m_max", i), _val(d, "relative_humidity_2m_min", i))

    base = {"latitude": lat, "longitude": lon, "daily": OPEN_METEO_DAILY, "timezone": "auto", "wind_speed_unit": "ms"}
    if archive_end >= start:
        add(_get_json(client, s.open_meteo_archive_url, {**base, "start_date": start.isoformat(), "end_date": archive_end.isoformat()}))
    if end > archive_end:
        recent_start = max(start, archive_end + timedelta(days=1))
        add(_get_json(client, s.open_meteo_forecast_url, {**base, "start_date": recent_start.isoformat(), "end_date": min(end, date.today()).isoformat()}))
    return [days[d] for d in sorted(days)], elevation


def fetch_forecast_rain(lat: float, lon: float, s: Settings, client: httpx.Client) -> float:
    d = _get_json(client, s.open_meteo_forecast_url, {"latitude": lat, "longitude": lon, "daily": "precipitation_sum", "forecast_days": 7, "timezone": "auto"})["daily"]
    return round(sum(v or 0 for v in d["precipitation_sum"]), 1)


def fetch_nasa_power(lat: float, lon: float, start: date, end: date, s: Settings, client: httpx.Client) -> dict[str, Any]:
    """Daily NASA POWER (AG community: radiation in MJ/m²/day). Also usable as full fallback."""
    p = _get_json(
        client,
        s.nasa_power_url,
        {
            "parameters": "PRECTOTCORR,T2M,T2M_MAX,T2M_MIN,RH2M,WS2M,ALLSKY_SFC_SW_DWN",
            "community": "AG",
            "latitude": lat,
            "longitude": lon,
            "start": start.strftime("%Y%m%d"),
            "end": end.strftime("%Y%m%d"),
            "format": "JSON",
        },
    )["properties"]["parameter"]

    def clean(key: str) -> dict[str, float]:
        return {k: float(v) for k, v in p.get(key, {}).items() if v is not None and v != NASA_FILL}

    rain, temp, solar = clean("PRECTOTCORR"), clean("T2M"), clean("ALLSKY_SFC_SW_DWN")
    tmax, tmin, rh, wind = clean("T2M_MAX"), clean("T2M_MIN"), clean("RH2M"), clean("WS2M")
    days: list[WeatherDay] = []
    for k in sorted(rain):
        day = date(int(k[:4]), int(k[4:6]), int(k[6:8]))
        wd = WeatherDay(
            date=day,
            precipitation_mm=rain.get(k),
            temp_mean_c=temp.get(k),
            temp_max_c=tmax.get(k),
            temp_min_c=tmin.get(k),
            rh_mean_pct=rh.get(k),
            wind_2m_ms=wind.get(k),
            radiation_mj_m2=solar.get(k),
        )
        days.append(_with_et0(wd, lat, 0.0, None, None))
    return {
        "rain_mm": round(sum(rain.values()), 1) if rain else None,
        "temp_mean_c": round(mean(temp.values()), 2) if temp else None,
        "solar": round(mean(solar.values()) / 3.6, 2) if solar else None,  # MJ -> kWh
        "days": days,
    }


def fetch_climatology(lat: float, lon: float, s: Settings, client: httpx.Client) -> dict[str, float]:
    """NASA POWER 2001-2025 monthly normal rain, mm/day, keyed JAN..DEC."""
    p = _get_json(
        client, s.nasa_power_climatology_url, {"parameters": "PRECTOTCORR", "community": "AG", "latitude": lat, "longitude": lon, "format": "JSON"}
    )["properties"]["parameter"]["PRECTOTCORR"]
    return {k: float(v) for k, v in p.items() if k != "ANN"}


def normal_rain(clim: dict[str, float], days: list[date]) -> float | None:
    """Climatological rain for the given (observed) days, summing each day's monthly normal.
    None when the climatology lacks a needed month."""
    total = 0.0
    for d in days:
        v = clim.get(calendar.month_abbr[d.month].upper())
        if v is None:
            return None
        total += v
    return round(total, 1)


def get_weather(lat: float, lon: float, start: date, end: date, s: Settings) -> WeatherSummary:
    errors: list[str] = []
    sources: list[str] = []
    days: list[WeatherDay] = []
    nasa: dict[str, Any] = {}
    forecast: float | None = None
    normal: float | None = None
    clim: dict[str, float] | None = None
    elevation: float | None = None
    with httpx.Client(timeout=s.http_timeout_s) as client:
        try:
            days, elevation = fetch_open_meteo(lat, lon, start, end, s, client)
            sources.append("open-meteo")
        except Exception as exc:
            log.warning("Open-Meteo failed: %s", exc)
            errors.append(f"open-meteo: {exc}")
        try:
            forecast = fetch_forecast_rain(lat, lon, s, client)
        except Exception as exc:
            errors.append(f"open-meteo forecast: {exc}")
        try:
            nasa = fetch_nasa_power(lat, lon, start, end, s, client)
            sources.append("nasa-power")
        except Exception as exc:
            log.warning("NASA POWER failed: %s", exc)
            errors.append(f"nasa-power: {exc}")
        try:
            clim = fetch_climatology(lat, lon, s, client)
            normal = normal_rain(clim, [start + timedelta(days=i) for i in range((end - start).days + 1)])
            if normal is None:
                clim = None
                raise ValueError("climatology missing a month")
            sources.append("nasa-power-climatology")
        except Exception as exc:
            errors.append(f"nasa-power climatology: {exc}")

    if not days and nasa.get("days"):
        days = nasa["days"]  # Open-Meteo down: NASA POWER drives the whole balance
        log.warning("Using NASA POWER daily data as weather fallback")

    rain = sum(d.precipitation_mm or 0 for d in days)
    et0 = sum(d.et0_mm or 0 for d in days)
    et0_ref = [d.et0_ref_mm for d in days if d.et0_ref_mm is not None]
    temps = [d.temp_mean_c for d in days if d.temp_mean_c is not None]
    heat_days = sum(1 for d in days if (d.temp_max_c or 0) >= s.heat_stress_temp_c)
    return WeatherSummary(
        start_date=start,
        end_date=end,
        rain_mm=round(rain, 1),
        et0_mm=round(et0, 1),
        water_deficit_mm=round(max(0.0, et0 - rain), 1),
        temp_mean_c=round(mean(temps), 2) if temps else nasa.get("temp_mean_c"),
        heat_stress_days=heat_days,
        elevation_m=elevation,
        et0_ref_mm=round(sum(et0_ref), 1) if et0_ref else None,
        solar_radiation_kwh_m2_day=nasa.get("solar"),
        nasa_rain_mm=nasa.get("rain_mm"),
        nasa_temp_mean_c=nasa.get("temp_mean_c"),
        forecast_rain_7d_mm=forecast,
        normal_rain_mm=normal,
        climatology_mm_day=clim,
        daily=days,
        sources=sources,
        errors=errors,
    )
