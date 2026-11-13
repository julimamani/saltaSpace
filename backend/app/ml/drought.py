"""XGBoost drought-risk model: P(severe drought in the next 15 days) from today's oracle data.

Trained on a *simulated* 5-year daily dataset of the NOA (seasonal rain regime with persistent
dry/wet spells, FAO-like ET0, soil bucket, NDVI/NDWI and radar soil moisture that respond to it).
It is an educational MVP model: replace `generate_mock_dataset` with real oracle history to
make it meaningful. Per-lot "factors" are XGBoost SHAP contributions (`pred_contribs=True`).
"""

from __future__ import annotations

import logging
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

MODEL_VERSION = "xgb-sequia-v1"
HORIZON_DAYS = 15
FEATURES = [
    "precipitacion_7d_acumulada",
    "precipitacion_15d_acumulada",
    "temp_max_promedio",
    "radiacion_solar",
    "ET0_fao",
    "NDVI_actual",
    "NDWI_actual",
    "radar_soil_moisture",
    "dia_del_anio",
    "etapa_floracion",
]
# Feature -> factor shown to the investor (several features can share one factor).
GROUPS: dict[str, tuple[str, str]] = {
    "precipitacion_7d_acumulada": ("lluvia", "Lluvia (7 y 15 días)"),
    "precipitacion_15d_acumulada": ("lluvia", "Lluvia (7 y 15 días)"),
    "temp_max_promedio": ("temperatura", "Temperatura y radiación"),
    "radiacion_solar": ("temperatura", "Temperatura y radiación"),
    "ET0_fao": ("et0", "Evapotranspiración (ET0)"),
    "NDVI_actual": ("ndvi", "Vigor del cultivo (NDVI)"),
    "NDWI_actual": ("ndwi", "Agua en hoja (NDWI)"),
    "radar_soil_moisture": ("suelo", "Humedad de suelo (radar S1)"),
    "dia_del_anio": ("epoca", "Época del año / floración"),
    "etapa_floracion": ("epoca", "Época del año / floración"),
}

_lock = threading.Lock()
_bundle: dict[str, Any] | None = None


class ModelUnavailable(RuntimeError):
    pass


def _xgb():
    try:
        import xgboost  # noqa: F401
        return xgboost
    except ImportError as exc:  # pragma: no cover - depends on the install
        raise ModelUnavailable("xgboost no está instalado: pip install -r requirements.txt") from exc


def generate_mock_dataset(years: int = 5, seed: int = 42, start: date = date(2021, 1, 1)):
    """Simulated daily NOA series (summer rains, dry winters) with a 15-day-ahead drought label."""
    import pandas as pd

    rng = np.random.default_rng(seed)
    n = years * 365 + HORIZON_DAYS
    dates = pd.date_range(start, periods=n, freq="D")
    doy = dates.dayofyear.to_numpy()
    season = np.cos(2 * np.pi * (doy - 15) / 365)  # +1 mid-January (wet), -1 mid-July (dry)
    anomaly = np.zeros(n)
    for t in range(1, n):  # persistent dry/wet regimes
        anomaly[t] = 0.97 * anomaly[t - 1] + rng.normal(0, 0.25)
    p_rain = 1 / (1 + np.exp(-(-1.0 + 1.6 * season + 1.3 * anomaly)))
    rain = np.where(rng.random(n) < p_rain, rng.gamma(0.8, 7 + 6 * np.clip(season, 0, None)), 0.0)
    tmax = 27 + 5 * season - 2.0 * anomaly - 2.5 * (rain > 1) + rng.normal(0, 1.8, n)
    rad = np.clip(19 + 6 * season - 5 * (rain > 1) + rng.normal(0, 2, n), 5, 32)
    et0 = np.clip(0.5 + 0.12 * (tmax - 10) + 0.11 * (rad - 10) + rng.normal(0, 0.3, n), 0.5, 9)
    # Simple campaign per year: sowing 1 Dec, flowering 60-100 days after sowing (~Feb).
    das = (doy - 335) % 365
    flowering = ((das >= 60) & (das <= 100)).astype(int)
    kc = np.where(flowering == 1, 1.1, 0.8)
    sm = np.zeros(n)
    ndvi = np.zeros(n)
    sm[0], ndvi[0] = 0.3, 0.5
    for t in range(1, n):
        sm[t] = np.clip(sm[t - 1] + (rain[t] - et0[t] * kc[t]) / 90, 0.02, 0.6)
        ndvi[t] = np.clip(0.93 * ndvi[t - 1] + 0.07 * (0.2 + 1.1 * sm[t]) + rng.normal(0, 0.01), 0.05, 0.92)
    ndwi = np.clip(1.05 * ndvi - 0.45 + 0.4 * (sm - 0.25) + rng.normal(0, 0.03, n), -0.5, 0.6)
    radar = np.clip(sm + rng.normal(0, 0.03, n), 0, 0.7)

    df = pd.DataFrame({"fecha": dates, "rain": rain, "etc": et0 * kc, "sm": sm})
    df["precipitacion_7d_acumulada"] = df["rain"].rolling(7, min_periods=1).sum()
    df["precipitacion_15d_acumulada"] = df["rain"].rolling(15, min_periods=1).sum()
    df["temp_max_promedio"] = pd.Series(tmax).rolling(7, min_periods=1).mean()
    df["radiacion_solar"] = pd.Series(rad).rolling(7, min_periods=1).mean()
    df["ET0_fao"] = pd.Series(et0).rolling(7, min_periods=1).mean()
    df["NDVI_actual"], df["NDWI_actual"], df["radar_soil_moisture"] = ndvi, ndwi, radar
    df["dia_del_anio"], df["etapa_floracion"] = doy, flowering
    fut_rain = df["rain"][::-1].rolling(HORIZON_DAYS, min_periods=1).sum()[::-1].shift(-1)
    fut_etc = df["etc"][::-1].rolling(HORIZON_DAYS, min_periods=1).sum()[::-1].shift(-1)
    fut_sm = df["sm"].shift(-HORIZON_DAYS)
    df["riesgo_sequia_15dias"] = ((fut_rain < 0.35 * fut_etc) & (fut_sm < 0.15)).astype(int)
    return df.iloc[: n - HORIZON_DAYS].reset_index(drop=True)


def train(path: Path | None = None, seed: int = 42) -> dict[str, Any]:
    """Train on the mock dataset (chronological 80/20 split) and optionally save with joblib."""
    xgb = _xgb()
    from sklearn.metrics import accuracy_score, roc_auc_score
    from sklearn.model_selection import train_test_split

    df = generate_mock_dataset(seed=seed)
    X, y = df[FEATURES].astype(float), df["riesgo_sequia_15dias"]
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, shuffle=False)
    model = xgb.XGBClassifier(
        n_estimators=250, max_depth=4, learning_rate=0.05, subsample=0.9, colsample_bytree=0.9,
        eval_metric="logloss", random_state=seed, n_jobs=1,
    )
    model.fit(X_tr, y_tr)
    proba = model.predict_proba(X_te)[:, 1]
    bundle = {
        "model": model,
        "version": MODEL_VERSION,
        "features": FEATURES,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": "mock",
        "rows": len(df),
        "positive_rate": round(float(y.mean()), 4),
        "metrics": {
            "auc": round(float(roc_auc_score(y_te, proba)), 4) if y_te.nunique() > 1 else None,
            "accuracy": round(float(accuracy_score(y_te, proba >= 0.5)), 4),
        },
    }
    if path is not None:
        import joblib

        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            joblib.dump(bundle, path)
        except OSError as exc:  # read-only FS: keep the in-memory model
            log.warning("could not save drought model to %s: %s", path, exc)
    return bundle


def get_model(path: Path) -> dict[str, Any]:
    """Load the saved model, training (and saving) it on first use."""
    global _bundle
    with _lock:
        if _bundle is not None:
            return _bundle
        _xgb()
        bundle = None
        if path.exists():
            import joblib

            try:
                bundle = joblib.load(path)
                if bundle.get("version") != MODEL_VERSION:
                    bundle = None
            except Exception as exc:  # corrupt / incompatible file -> retrain
                log.warning("could not load %s (%s); retraining", path, exc)
        if bundle is None:
            log.info("training %s on the mock dataset -> %s", MODEL_VERSION, path)
            bundle = train(path)
        _bundle = bundle
        return bundle


def risk_level(p: float) -> str:
    return "ALTO" if p >= 0.6 else "MEDIO" if p >= 0.3 else "BAJO"


def _group(values: dict[str, float]) -> dict[str, tuple[str, float]]:
    out: dict[str, tuple[str, float]] = {}
    for f, v in values.items():
        key, label = GROUPS[f]
        out[key] = (label, out.get(key, (label, 0.0))[1] + v)
    return out


def predict(bundle: dict[str, Any], features: dict[str, float]) -> dict[str, Any]:
    """Probability + factor breakdown. `factores` are the per-prediction SHAP contributions that
    push the risk up (falls back to absolute contributions when nothing pushes it up)."""
    xgb = _xgb()
    model = bundle["model"]
    row = np.array([[float(features[f]) for f in FEATURES]])
    p = float(model.predict_proba(row)[0, 1])
    contribs = model.get_booster().predict(xgb.DMatrix(row, feature_names=FEATURES), pred_contribs=True)[0][:-1]
    raw = dict(zip(FEATURES, (float(c) for c in contribs)))
    grouped = _group(raw)
    up = {k: v for k, v in grouped.items() if v[1] > 0}
    basis = up or {k: (lbl, abs(v)) for k, (lbl, v) in grouped.items()}
    total = sum(v for _lbl, v in basis.values()) or 1.0
    factores = sorted(
        (
            {"clave": k, "etiqueta": lbl, "porcentaje": round(100 * v / total, 1), "contribucion": round(grouped[k][1], 4),
             "efecto": "sube" if grouped[k][1] > 0 else "baja"}
            for k, (lbl, v) in basis.items()
        ),
        key=lambda x: -x["porcentaje"],
    )
    imp = _group(dict(zip(FEATURES, (float(v) for v in model.feature_importances_))))
    imp_total = sum(v for _l, v in imp.values()) or 1.0
    importancia = sorted(
        ({"clave": k, "etiqueta": lbl, "porcentaje": round(100 * v / imp_total, 1)} for k, (lbl, v) in imp.items()),
        key=lambda x: -x["porcentaje"],
    )
    return {
        "probabilidad_sequia": round(p, 4),
        "riesgo": risk_level(p),
        "horizonte_dias": HORIZON_DAYS,
        "factores": factores,
        "importancia_global": importancia,
        "features": {f: round(float(features[f]), 4) for f in FEATURES},
        "modelo": {k: bundle[k] for k in ("version", "trained_at", "dataset", "rows", "positive_rate", "metrics")},
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def soil_moisture_from_vv(vv_db: float | None) -> float | None:
    """Rough volumetric proxy (0.02..0.6 m3/m3) from Sentinel-1 gamma0 VV: -20 dB dry, -8 dB wet."""
    return None if vv_db is None else float(np.clip(0.02 + (vv_db + 20) * 0.04, 0.02, 0.6))


def features_from_analysis(a: dict[str, Any]) -> dict[str, float]:
    """Build today's feature vector from an `AnalysisResult` (as JSON dict) of the oracle."""
    w = a.get("weather") or {}
    daily = sorted(w.get("daily") or [], key=lambda d: d["date"])
    last7, last15 = daily[-7:], daily[-15:]

    def mean(rows: list[dict], key: str, default: float) -> float:
        vals = [r[key] for r in rows if r.get(key) is not None]
        return float(np.mean(vals)) if vals else default

    ndvi = a.get("ndvi") or {}
    ndvi_mean = float(ndvi.get("mean") or 0.5)
    ndwi = ndvi.get("ndwi")
    sar = a.get("sar") or {}
    sm = soil_moisture_from_vv(sar.get("latest_vv_db"))
    end = w.get("end_date") or date.today().isoformat()
    end_d = date.fromisoformat(str(end)[:10])
    wb = a.get("water_balance") or {}
    return {
        "precipitacion_7d_acumulada": sum(r.get("precipitation_mm") or 0 for r in last7),
        "precipitacion_15d_acumulada": sum(r.get("precipitation_mm") or 0 for r in last15),
        "temp_max_promedio": mean(last7, "temp_max_c", 28.0),
        "radiacion_solar": mean(last7, "radiation_mj_m2_day", 20.0),
        "ET0_fao": mean(last7, "et0_mm", 4.5),
        "NDVI_actual": ndvi_mean,
        "NDWI_actual": float(ndwi) if ndwi is not None else 1.05 * ndvi_mean - 0.45,
        "radar_soil_moisture": sm if sm is not None else 0.25,
        "dia_del_anio": float(end_d.timetuple().tm_yday),
        "etapa_floracion": 1.0 if wb.get("stage_today") == "floracion" else 0.0,
    }


if __name__ == "__main__":  # python -m app.ml.drought  -> trains and saves next to the DB
    from ..config import get_settings

    target = Path(get_settings().database_path).parent / "xgb_sequia.joblib"
    b = train(target)
    print(f"saved {target}  rows={b['rows']} positive_rate={b['positive_rate']} metrics={b['metrics']}")
