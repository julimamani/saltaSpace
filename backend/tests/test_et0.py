from datetime import date

from app.services.et0 import Et0Inputs, et0_penman_monteith, wind_10m_to_2m

# Open-Meteo archive, Rosario de la Frontera (lat -25.83, 788 m), with its own et0_fao_evapotranspiration.
SAMPLES = [
    # (date, tmax, tmin, rs MJ/m2, rh_max, rh_min, rh_mean, wind10 m/s, open-meteo ET0)
    (date(2026, 9, 1), 23.0, 11.5, 20.78, 80, 42, 64, 2.31, 3.91),
    (date(2026, 9, 2), 25.9, 12.0, 21.22, 81, 37, 60, 3.11, 4.52),
    (date(2026, 9, 3), 29.4, 11.2, 21.57, 80, 26, 55, 2.24, 4.81),
    (date(2026, 9, 4), 21.2, 11.1, 21.14, 75, 33, 55, 2.57, 3.99),
    (date(2026, 9, 5), 19.7, 8.2, 19.53, 66, 31, 49, 1.78, 3.63),
]


def test_penman_monteith_matches_open_meteo_within_tolerance():
    for d, tmax, tmin, rs, rh_max, rh_min, rh_mean, w10, ref in SAMPLES:
        et0 = et0_penman_monteith(
            Et0Inputs(day=d, tmax_c=tmax, tmin_c=tmin, rs_mj_m2=rs, rh_mean_pct=rh_mean, wind_2m_ms=wind_10m_to_2m(w10), lat_deg=-25.83, elevation_m=788, rh_max_pct=rh_max, rh_min_pct=rh_min)
        )
        # Open-Meteo uses hourly inputs; daily FAO-56 should land within ~15%.
        assert abs(et0 - ref) / ref < 0.15, (d, et0, ref)


def test_et0_is_physical():
    hot_dry = et0_penman_monteith(Et0Inputs(date(2026, 1, 15), 38, 24, 28, 30, 3.0, -24.9, 1200))
    mild_humid = et0_penman_monteith(Et0Inputs(date(2026, 6, 15), 18, 8, 10, 85, 1.0, -24.9, 1200))
    assert hot_dry > 6 > 2 > mild_humid > 0
    assert et0_penman_monteith(Et0Inputs(date(2026, 1, 1), 20, 10, 0, None, 0, -24.9, 1200)) >= 0


def test_wind_profile():
    assert round(wind_10m_to_2m(1.0), 3) == 0.748
