from datetime import date

from fastapi.testclient import TestClient

from app.deps import get_settings
from app.main import app
from app.schemas import WeatherSummary
from app.services import analysis

GEOM = {"type": "Polygon", "coordinates": [[[-64.98, -25.8], [-64.97, -25.8], [-64.97, -25.81], [-64.98, -25.81], [-64.98, -25.8]]]}


def fake_weather(lat, lon, start, end, s):
    return WeatherSummary(start_date=start, end_date=end, rain_mm=150, et0_mm=300, water_deficit_mm=150, temp_mean_c=24, heat_stress_days=1, sources=["fake"])


def test_health():
    r = TestClient(app).get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_analyze_with_mock_fallback(monkeypatch):
    s = get_settings().model_copy(update={"force_mock_ndvi": True})
    app.dependency_overrides[get_settings] = lambda: s
    monkeypatch.setattr(analysis.weather, "get_weather", fake_weather)
    try:
        r = TestClient(app).post("/lots/analyze", json={"geometry": GEOM, "start_date": "2026-01-01", "end_date": "2026-03-01"})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ndvi"]["source"] == "mock"
    assert 0 <= body["risk_score"] <= 100 and 0.5 <= body["yield_index"] <= 1.3
    assert body["data_hash"].startswith("0x") and len(body["data_hash"]) == 66
    assert len(body["series"]) == s.max_scenes


def test_analyze_rejects_bad_dates():
    r = TestClient(app).post("/lots/analyze", json={"geometry": GEOM, "start_date": "2026-03-01", "end_date": "2026-01-01"})
    assert r.status_code == 422


def test_metrics_empty_history():
    r = TestClient(app).get("/lots/999/metrics")
    assert r.status_code == 200 and r.json()["history"] == []
