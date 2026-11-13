"""XGBoost predictive layer: 15-day drought probability. Informational only: it does not change
the rule-based score, the parametric insurance trigger or anything published on-chain."""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..deps import Settings, get_chain, get_settings, get_store
from ..ml import drought
from ..services.chain import Chain, ChainNotConfigured
from ..services.oracle import analyze_lot
from ..services.store import Store

router = APIRouter(tags=["prediccion"])

AVISO = (
    "Modelo XGBoost educativo entrenado con datos simulados (mock): orientativo, no es una "
    "garantía de rendimiento ni modifica el seguro paramétrico on-chain."
)


class DroughtFeatures(BaseModel):
    precipitacion_7d_acumulada: float = Field(ge=0, description="mm, últimos 7 días")
    precipitacion_15d_acumulada: float = Field(ge=0, description="mm, últimos 15 días")
    temp_max_promedio: float = Field(description="°C, promedio 7 días")
    radiacion_solar: float = Field(ge=0, description="MJ/m²/día, promedio 7 días")
    ET0_fao: float = Field(ge=0, description="mm/día Penman-Monteith, promedio 7 días")
    NDVI_actual: float = Field(ge=-1, le=1)
    NDWI_actual: float = Field(ge=-1, le=1)
    radar_soil_moisture: float = Field(ge=0, le=1, description="m³/m³ estimado con Sentinel-1")
    dia_del_anio: int = Field(ge=1, le=366)
    etapa_floracion: bool = False


class Factor(BaseModel):
    clave: str
    etiqueta: str
    porcentaje: float
    contribucion: float | None = None
    efecto: str | None = None


class DroughtPrediction(BaseModel):
    probabilidad_sequia: float
    riesgo: str
    horizonte_dias: int
    factores: list[Factor]
    importancia_global: list[Factor]
    features: dict[str, float]
    modelo: dict[str, Any]
    timestamp: str
    aviso: str = AVISO
    lot_id: int | None = None
    fuente: str = "manual"
    analisis_fecha: str | None = None


def model_path(s: Settings) -> Path:
    return Path(s.database_path).parent / "xgb_sequia.joblib"


def _model(s: Settings) -> dict[str, Any]:
    try:
        return drought.get_model(model_path(s))
    except drought.ModelUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/predict/modelo")
def model_info(s: Settings = Depends(get_settings)) -> dict[str, Any]:
    b = _model(s)
    return {**{k: b[k] for k in ("version", "trained_at", "dataset", "rows", "positive_rate", "metrics", "features")},
            "horizonte_dias": drought.HORIZON_DAYS, "aviso": AVISO}


@router.post("/predict/sequia", response_model=DroughtPrediction)
def predict_drought(f: DroughtFeatures, s: Settings = Depends(get_settings)) -> DroughtPrediction:
    """Probability (0..1) of severe drought in the next 15 days for today's climate/satellite data."""
    data = f.model_dump()
    data["etapa_floracion"] = float(data["etapa_floracion"])
    return DroughtPrediction(**drought.predict(_model(s), data))


@router.get("/lots/{lot_id}/prediccion", response_model=DroughtPrediction)
def lot_prediction(
    lot_id: int,
    refresh: bool = False,
    store: Store = Depends(get_store),
    chain: Chain = Depends(get_chain),
    s: Settings = Depends(get_settings),
) -> DroughtPrediction:
    """Drought prediction for a lot, built from the oracle's last published analysis
    (or a fresh one with `refresh=true`)."""
    bundle = _model(s)
    analysis = None if refresh else store.analysis(lot_id)
    fuente = "ultimo_analisis_oraculo"
    if analysis is None:
        try:
            _scenario, result = analyze_lot(lot_id, chain, store, s)
        except ChainNotConfigured as exc:
            raise HTTPException(503, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        analysis, fuente = result.model_dump(mode="json"), "analisis_en_vivo"
    out = drought.predict(bundle, drought.features_from_analysis(analysis))
    end = (analysis.get("weather") or {}).get("end_date")
    return DroughtPrediction(**out, lot_id=lot_id, fuente=fuente, analisis_fecha=str(end) if end else None)
