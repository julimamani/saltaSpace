from datetime import date

from app.config import Settings
from app.schemas import NdviObservation, WeatherSummary
from app.services import ndvi, scoring
from app.services.analysis import apply_scenario

S = Settings(_env_file=None)
GEOM = {"type": "Polygon", "coordinates": [[[-64.98, -25.8], [-64.97, -25.8], [-64.97, -25.81], [-64.98, -25.81], [-64.98, -25.8]]]}


def test_scores_stay_in_contract_ranges():
    for n in (-0.2, 0.1, 0.4, 0.7, 0.95):
        for deficit in (0, 100, 400):
            risk, y, _ = scoring.score(n, deficit, 300, 5, 90, S)
            assert 0 <= risk <= 100
            assert scoring.YIELD_MIN <= y <= scoring.YIELD_MAX


def test_healthy_crop_beats_drought():
    good_risk, good_y, _ = scoring.score(0.8, 0, 300, 0, 90, S)
    bad_risk, bad_y, _ = scoring.score(0.2, 300, 300, 30, 90, S)
    assert good_risk == 0 and good_y == 1.3
    assert bad_risk == 100 and bad_y == 0.5


def test_mock_ndvi_is_deterministic_and_flagged():
    a = ndvi.mock_ndvi_series(GEOM, date(2026, 1, 1), date(2026, 3, 1), 5)
    b = ndvi.mock_ndvi_series(GEOM, date(2026, 1, 1), date(2026, 3, 1), 5)
    assert a == b
    assert len(a) == 5 and all(o.source == "mock" for o in a)
    assert all(o.min <= o.mean <= o.max for o in a)


def test_scenarios_move_scores_in_the_expected_direction():
    series = [NdviObservation(date=date(2026, 1, i + 1), mean=0.6, min=0.5, max=0.7, source="mock") for i in range(4)]
    w = WeatherSummary(start_date=date(2026, 1, 1), end_date=date(2026, 3, 1), rain_mm=200, et0_mm=300, water_deficit_mm=100, temp_mean_c=25, heat_stress_days=2)

    def run(scenario: str):
        s2, w2 = apply_scenario(series, w, scenario)
        return scoring.score(s2[-1].mean, w2.water_deficit_mm, w2.et0_mm, w2.heat_stress_days, 59, S)

    real, drought, excellent = run("real"), run("drought"), run("excellent")
    assert drought[1] < real[1] < excellent[1]
    assert drought[0] > real[0] > excellent[0]
    assert apply_scenario(series, w, "drought")[0][-1].mean < 0.3  # under the on-chain critical NDVI


def test_centroid():
    assert ndvi.centroid_of(GEOM) == (-64.975, -25.805)
