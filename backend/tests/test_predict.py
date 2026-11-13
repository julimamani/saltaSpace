from fastapi.testclient import TestClient

from app.deps import get_settings, get_store
from app.main import app
from app.ml import drought
from app.services import analysis
from tests.test_api import GEOM, fake_sar, fake_weather

TODAY = {
    "precipitacion_7d_acumulada": 0.0, "precipitacion_15d_acumulada": 1.0, "temp_max_promedio": 34.0,
    "radiacion_solar": 26.0, "ET0_fao": 6.5, "NDVI_actual": 0.35, "NDWI_actual": -0.1,
    "radar_soil_moisture": 0.05, "dia_del_anio": 45, "etapa_floracion": True,
}


def test_mock_dataset_is_deterministic_and_complete():
    a, b = drought.generate_mock_dataset(), drought.generate_mock_dataset()
    assert len(a) == 5 * 365 and a.equals(b)
    assert set(drought.FEATURES + ["riesgo_sequia_15dias"]) <= set(a.columns)
    assert 0.05 < a["riesgo_sequia_15dias"].mean() < 0.6


def test_train_and_predict(tmp_path):
    b = drought.train(tmp_path / "m.joblib")
    assert (tmp_path / "m.joblib").exists() and b["dataset"] == "mock" and b["metrics"]["auc"] > 0.7
    wet = drought.predict(b, {**TODAY, "precipitacion_7d_acumulada": 60, "precipitacion_15d_acumulada": 120, "radar_soil_moisture": 0.5, "NDWI_actual": 0.3, "etapa_floracion": 0})
    dry = drought.predict(b, {**TODAY, "etapa_floracion": 1})
    assert 0 <= wet["probabilidad_sequia"] < dry["probabilidad_sequia"] <= 1
    for r in (wet, dry):
        assert abs(sum(f["porcentaje"] for f in r["factores"]) - 100) < 1
        assert abs(sum(f["porcentaje"] for f in r["importancia_global"]) - 100) < 1
        assert r["riesgo"] in ("BAJO", "MEDIO", "ALTO")


def test_predict_endpoint():
    c = TestClient(app)
    r = c.post("/predict/sequia", json=TODAY)
    assert r.status_code == 200, r.text
    body = r.json()
    assert 0 <= body["probabilidad_sequia"] <= 1 and body["horizonte_dias"] == 15 and body["modelo"]["dataset"] == "mock"
    assert body["factores"] and "aviso" in body
    assert c.post("/predict/sequia", json={**TODAY, "NDVI_actual": 3}).status_code == 422
    assert c.get("/predict/modelo").json()["features"] == drought.FEATURES


def test_lot_prediction_from_saved_analysis(monkeypatch):
    s = get_settings().model_copy(update={"force_mock_ndvi": True})
    app.dependency_overrides[get_settings] = lambda: s
    monkeypatch.setattr(analysis.weather, "get_weather", fake_weather)
    monkeypatch.setattr(analysis.sar_svc, "get_sar", fake_sar)
    try:
        c = TestClient(app)
        a = c.post("/lots/analyze", json={"geometry": GEOM, "start_date": "2026-01-01", "end_date": "2026-03-01", "crop": "poroto", "sowing_date": "2025-12-20"}).json()
        get_store().save_analysis(4242, a, 0)
        r = c.get("/lots/4242/prediccion")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lot_id"] == 4242 and body["fuente"] == "ultimo_analisis_oraculo" and body["analisis_fecha"] == "2026-03-01"
    f = drought.features_from_analysis(a)
    assert f["precipitacion_7d_acumulada"] == 21.0 and f["dia_del_anio"] == 60 and 0 < f["radar_soil_moisture"] < 0.6


def test_unavailable_model_returns_503(monkeypatch):
    def boom(_path):
        raise drought.ModelUnavailable("xgboost no está instalado")

    monkeypatch.setattr(drought, "get_model", boom)
    assert TestClient(app).post("/predict/sequia", json=TODAY).status_code == 503
    assert TestClient(app).get("/health").status_code == 200
