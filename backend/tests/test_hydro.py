from datetime import date, timedelta

from app.config import Settings
from app.schemas import WeatherDay, WeatherSummary
from app.services import hydro
from app.services.crops import estimate_sowing, normalize, profile_for

S = Settings(_env_file=None)


def _weather(start: date, days: int, rain_every: int | None, et0: float = 5.0, normal: float | None = 150.0) -> WeatherSummary:
    daily = []
    for i in range(days):
        d = start + timedelta(days=i)
        rain = 20.0 if rain_every and i % rain_every == 0 else 0.0
        daily.append(WeatherDay(date=d, precipitation_mm=rain, temp_mean_c=25, temp_max_c=31, et0_mm=et0))
    return WeatherSummary(start_date=start, end_date=start + timedelta(days=days - 1), rain_mm=sum(d.precipitation_mm for d in daily), et0_mm=et0 * days, water_deficit_mm=0, temp_mean_c=25, heat_stress_days=0, normal_rain_mm=normal, daily=daily)


def test_crop_lookup_and_kc_curve():
    assert normalize("Poroto") == "poroto" and normalize("Maíz") == "maiz" and normalize("Soja RR") == "soja"
    assert normalize("quinoa") == "generico"
    c = profile_for("poroto")
    assert c.kc(5) == c.kc_ini and c.kc(60) == c.kc_mid and c.kc(c.season_days) == c.kc_end
    assert c.kc_ini < c.kc(35) < c.kc_mid  # development ramp
    assert c.kc(-1) == 0.0 and c.kc(c.season_days + 1) == 0.0
    assert c.stage(60) == "floracion"


def test_sowing_estimate_prefers_campaign_maturity_when_in_the_past():
    c = profile_for("poroto")
    today = date(2026, 3, 1)
    sow, basis = estimate_sowing(c, today, harvest=date(2026, 3, 20))
    assert sow == date(2026, 3, 20) - timedelta(days=c.season_days) and "madurez" in basis
    sow2, basis2 = estimate_sowing(c, today, harvest=date(2026, 9, 1))  # harvest far away: assume flowering now
    assert c.stage((today - sow2).days) == "floracion" and "floración" in basis2


def test_dry_season_accumulates_critical_days_and_wet_season_does_not():
    sowing = date(2026, 1, 1)
    dry = hydro.water_balance(_weather(sowing, 80, rain_every=None), "poroto", sowing + timedelta(days=79), sowing, None, S)
    wet = hydro.water_balance(_weather(sowing, 80, rain_every=2), "poroto", sowing + timedelta(days=79), sowing, None, S)
    assert dry.critical_dry_days > 15 and dry.balance_mm < 0 and dry.rain_vs_normal == 0.0
    assert wet.critical_dry_days == 0 and wet.balance_mm > 0 and wet.rain_vs_normal > 1
    assert dry.etc_mm < dry.et0_mm  # Kc < 1 on average over the season
    assert dry.stage_today == "floracion" and dry.flowering_days_observed > 0
    assert dry.max_dry_spell_days >= dry.critical_dry_days


def test_balance_annotates_every_day():
    sowing = date(2026, 1, 1)
    w = _weather(sowing, 40, rain_every=3)
    hydro.water_balance(w, "soja", sowing + timedelta(days=39), sowing, None, S)
    assert all(d.kc is not None and d.etc_mm is not None and d.soil_depletion_mm is not None and d.stage for d in w.daily)
    assert w.daily[0].stage == "inicial" and w.daily[-1].stage == "desarrollo"


def test_rain_vs_normal_is_neutral_in_the_dry_season():
    sowing = date(2026, 7, 1)
    wb = hydro.water_balance(_weather(sowing, 30, rain_every=None, normal=5.0), "trigo", sowing + timedelta(days=29), sowing, None, S)
    assert wb.rain_vs_normal == 1.0
