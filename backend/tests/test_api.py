from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.deps import get_settings
from app.main import app
from app.schemas import SarSummary, WeatherDay, WeatherSummary
from app.services import analysis

GEOM = {"type": "Polygon", "coordinates": [[[-64.98, -25.8], [-64.97, -25.8], [-64.97, -25.81], [-64.98, -25.81], [-64.98, -25.8]]]}


def fake_weather(lat, lon, start, end, s):
    daily = [WeatherDay(date=start + timedelta(days=i), precipitation_mm=3.0, temp_mean_c=24, temp_max_c=30, et0_mm=4.5) for i in range((end - start).days + 1)]
    return WeatherSummary(start_date=start, end_date=end, rain_mm=3.0 * len(daily), et0_mm=4.5 * len(daily), water_deficit_mm=1.5 * len(daily), temp_mean_c=24, heat_stress_days=1, normal_rain_mm=250, climatology_mm_day={m: 4.0 for m in ('JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC')}, daily=daily, sources=["fake"])


def fake_sar(geometry, start, end, s, prioritized):
    return SarSummary(soil_dry_days=0, latest_vv_db=-11.2, latest_rvi=0.55, prioritized=prioritized, source="mock")


def test_health():
    r = TestClient(app).get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_analyze_with_mock_fallback(monkeypatch):
    s = get_settings().model_copy(update={"force_mock_ndvi": True})
    app.dependency_overrides[get_settings] = lambda: s
    monkeypatch.setattr(analysis.weather, "get_weather", fake_weather)
    monkeypatch.setattr(analysis.sar_svc, "get_sar", fake_sar)
    try:
        r = TestClient(app).post("/lots/analyze", json={"geometry": GEOM, "start_date": "2026-01-01", "end_date": "2026-03-01", "crop": "poroto", "sowing_date": "2025-12-20"})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ndvi"]["source"] == "mock" and body["ndvi"]["ndwi"] is not None
    assert 0 <= body["risk_score"] <= 100 and 0.5 <= body["yield_index"] <= 1.3
    assert body["data_hash"].startswith("0x") and len(body["data_hash"]) == 66
    assert len(body["series"]) == s.max_scenes
    wb = body["water_balance"]
    assert wb["crop"] == "poroto" and wb["sowing_date"] == "2025-12-20" and wb["etc_mm"] > 0 and wb["rain_vs_normal"] is not None
    assert body["insurance"]["riesgo_climatico"] in ("BAJO", "MEDIO", "ALTO") and isinstance(body["insurance"]["trigger_seguro"], bool)
    assert body["weather"]["daily"][-1]["kc"] is not None and body["weather"]["daily"][-1]["etc_mm"] is not None
    assert body["satellite_priority"] == "sentinel-1"  # mock S2 -> radar prioritized


def test_analyze_rejects_bad_dates():
    r = TestClient(app).post("/lots/analyze", json={"geometry": GEOM, "start_date": "2026-03-01", "end_date": "2026-01-01"})
    assert r.status_code == 422


def test_metrics_empty_history():
    r = TestClient(app).get("/lots/999/metrics")
    assert r.status_code == 200 and r.json()["history"] == []


def test_profile_roundtrip():
    c = TestClient(app)
    r = c.put("/lots/7/profile", json={"sowing_date": "2026-01-10"})
    assert r.status_code == 200 and r.json()["sowing_date"] == "2026-01-10"
