"""Weather from Open-Meteo (archive + 7-day forecast) and NASA POWER (no API keys)."""

from __future__ import annotations

import logging
from datetime import date, timedelta
from statistics import mean
from typing import Any

import httpx

from ..config import Settings
from ..schemas import WeatherDay, WeatherSummary

log = logging.getLogger(__name__)
NASA_FILL = -999.0


def _open_meteo_daily(client: httpx.Client, url: str, params: dict[str, Any]) -> dict[str, list]:
    r = client.get(url, params=params)
    r.raise_for_status()
    return r.json()["daily"]


def fetch_open_meteo(lat: float, lon: float, start: date, end: date, s: Settings, client: httpx.Client) -> list[WeatherDay]:
    daily_vars = "precipitation_sum,temperature_2m_mean,temperature_2m_max,et0_fao_evapotranspiration"
    # The archive (ERA5) lags a few days; the forecast API covers the most recent past days.
    archive_end = min(end, date.today() - timedelta(days=6))
    days: dict[date, WeatherDay] = {}

    def add(d: dict[str, list]) -> None:
        for i, t in enumerate(d["time"]):
            day = date.fromisoformat(t)
            if start <= day <= end:
                days[day] = WeatherDay(
                    date=day,
                    precipitation_mm=d["precipitation_sum"][i],
                    temp_mean_c=d["temperature_2m_mean"][i],
                    temp_max_c=d["temperature_2m_max"][i],
                    et0_mm=d["et0_fao_evapotranspiration"][i],
                )

    if archive_end >= start:
        add(
            _open_meteo_daily(
                client,
                s.open_meteo_archive_url,
                {"latitude": lat, "longitude": lon, "start_date": start.isoformat(), "end_date": archive_end.isoformat(), "daily": daily_vars, "timezone": "auto"},
            )
        )
    if end > archive_end:
        recent_start = max(start, archive_end + timedelta(days=1))
        add(
            _open_meteo_daily(
                client,
                s.open_meteo_forecast_url,
                {"latitude": lat, "longitude": lon, "start_date": recent_start.isoformat(), "end_date": min(end, date.today()).isoformat(), "daily": daily_vars, "timezone": "auto"},
            )
        )
    return [days[d] for d in sorted(days)]


def fetch_forecast_rain(lat: float, lon: float, s: Settings, client: httpx.Client) -> float:
    d = _open_meteo_daily(
        client,
        s.open_meteo_forecast_url,
        {"latitude": lat, "longitude": lon, "daily": "precipitation_sum", "forecast_days": 7, "timezone": "auto"},
    )
    return round(sum(v or 0 for v in d["precipitation_sum"]), 1)


def fetch_nasa_power(lat: float, lon: float, start: date, end: date, s: Settings, client: httpx.Client) -> dict[str, float | None]:
    r = client.get(
        s.nasa_power_url,
        params={
            "parameters": "PRECTOTCORR,T2M,ALLSKY_SFC_SW_DWN",
            "community": "AG",
            "latitude": lat,
            "longitude": lon,
            "start": start.strftime("%Y%m%d"),
            "end": end.strftime("%Y%m%d"),
            "format": "JSON",
        },
    )
    r.raise_for_status()
    p = r.json()["properties"]["parameter"]

    def values(key: str) -> list[float]:
        return [v for v in p.get(key, {}).values() if v is not None and v != NASA_FILL]

    rain, temp, solar = values("PRECTOTCORR"), values("T2M"), values("ALLSKY_SFC_SW_DWN")
    return {
        "rain_mm": round(sum(rain), 1) if rain else None,
        "temp_mean_c": round(mean(temp), 2) if temp else None,
        "solar": round(mean(solar), 2) if solar else None,
    }


def get_weather(lat: float, lon: float, start: date, end: date, s: Settings) -> WeatherSummary:
    errors: list[str] = []
    sources: list[str] = []
    days: list[WeatherDay] = []
    nasa: dict[str, float | None] = {}
    forecast: float | None = None
    with httpx.Client(timeout=s.http_timeout_s) as client:
        try:
            days = fetch_open_meteo(lat, lon, start, end, s, client)
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

    rain = sum(d.precipitation_mm or 0 for d in days)
    if not days and nasa.get("rain_mm") is not None:
        rain = float(nasa["rain_mm"] or 0)
    et0 = sum(d.et0_mm or 0 for d in days)
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
        solar_radiation_kwh_m2_day=nasa.get("solar"),
        nasa_rain_mm=nasa.get("rain_mm"),
        nasa_temp_mean_c=nasa.get("temp_mean_c"),
        forecast_rain_7d_mm=forecast,
        daily=days,
        sources=sources,
        errors=errors,
    )
