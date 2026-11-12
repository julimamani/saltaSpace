from datetime import date, timedelta

from app.config import Settings
from app.schemas import IndexObservation, SarSummary, WeatherDay, WeatherSummary
from app.services import hydro, ndvi, scoring
from app.services.analysis import apply_scenario, ndvi_drop

S = Settings(_env_file=None)
GEOM = {"type": "Polygon", "coordinates": [[[-64.98, -25.8], [-64.97, -25.8], [-64.97, -25.81], [-64.98, -25.81], [-64.98, -25.8]]]}


def test_scores_stay_in_contract_ranges():
    for n in (-0.2, 0.1, 0.4, 0.7, 0.95):
        for rain in (0, 100, 400):
            for ndwi in (None, -0.3, 0.3):
                risk, y, _ = scoring.score(n, None, ndwi, rain, 300, 5, 5, 90, None, S)
                assert 0 <= risk <= 100
                assert scoring.YIELD_MIN <= y <= scoring.YIELD_MAX


def test_healthy_crop_beats_drought_and_missing_components_renormalize():
    good_risk, good_y, b = scoring.score(0.8, 0.6, 0.4, 400, 300, 0, 0, 90, 0.95, S)
    bad_risk, bad_y, _ = scoring.score(0.2, 0.1, -0.1, 0, 300, 25, 30, 90, 0.2, S)
    assert good_risk == 0 and good_y == 1.3
    assert bad_risk == 100 and bad_y == 0.5
    assert abs(sum(b.weights.values()) - 1) < 1e-3 and set(b.weights) == {"vigor", "ndwi", "water", "stress", "heat", "sar"}
    _, _, b2 = scoring.score(0.8, None, None, 400, 300, 0, 0, 90, None, S)
    assert set(b2.weights) == {"vigor", "water", "stress", "heat"} and abs(sum(b2.weights.values()) - 1) < 1e-3


def test_mock_ndvi_is_deterministic_and_flagged():
    a = ndvi.mock_ndvi_series(GEOM, date(2026, 1, 1), date(2026, 3, 1), 5)
    b = ndvi.mock_ndvi_series(GEOM, date(2026, 1, 1), date(2026, 3, 1), 5)
    assert a == b
    assert len(a) == 5 and all(o.source == "mock" for o in a)
    assert all(o.min <= o.mean <= o.max for o in a)
    assert all(o.evi is not None and o.ndwi is not None and o.lai is not None and o.week for o in a)


def test_scenarios_move_scores_in_the_expected_direction():
    start = date(2026, 1, 1)
    series = [IndexObservation(date=start + timedelta(days=14 * i), mean=0.6, min=0.5, max=0.7, evi=0.4, ndwi=0.2, lai=1.3, source="mock") for i in range(5)]
    daily = [WeatherDay(date=start + timedelta(days=i), precipitation_mm=6.0 if i % 2 else 0.0, temp_mean_c=25, temp_max_c=31, et0_mm=5.0) for i in range(60)]
    w = WeatherSummary(start_date=start, end_date=start + timedelta(days=59), rain_mm=180, et0_mm=300, water_deficit_mm=120, temp_mean_c=25, heat_stress_days=2, normal_rain_mm=200, daily=daily)
    sar = SarSummary(soil_dry_days=0, latest_rvi=0.5, latest_vv_db=-11, source="mock")

    def run(scenario: str):
        s2, w2, sar2 = apply_scenario(series, w, sar, scenario)
        wb = hydro.water_balance(w2, "poroto", start + timedelta(days=59), start, None, S)
        return scoring.score(s2[-1].mean, s2[-1].evi, s2[-1].ndwi, wb.rain_mm, wb.etc_mm, wb.critical_dry_days, w2.heat_stress_days, 60, sar2.latest_rvi, S), wb, sar2

    (real, _, _), (drought, wb_d, sar_d), (excellent, _, _) = run("real"), run("drought"), run("excellent")
    assert drought[1] < real[1] < excellent[1]
    assert drought[0] > real[0] > excellent[0]
    s_d = apply_scenario(series, w, sar, "drought")[0]
    assert s_d[-1].mean < 0.3 and s_d[-1].ndwi < 0.05  # under the on-chain critical NDVI / NDWI trigger
    assert wb_d.rain_vs_normal < 0.5 and sar_d.soil_dry_days >= S.soil_dry_days_trigger
    assert ndvi_drop(s_d) > 0.4 and ndvi_drop(series) == 0.0


def test_centroid():
    assert ndvi.centroid_of(GEOM) == (-64.975, -25.805)
