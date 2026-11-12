from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..deps import Settings, get_chain, get_settings, get_store
from ..schemas import AnalysisResult, AnalyzeRequest, LotInsuranceResponse, LotMetricsResponse, MetricRecord
from ..services.analysis import analyze
from ..services.chain import Chain, ChainNotConfigured
from ..services.oracle import analyze_lot
from ..services.store import Store

router = APIRouter(prefix="/lots", tags=["lots"])


class LotProfile(BaseModel):
    sowing_date: date | None = None
    notes: str | None = None


@router.post("/analyze", response_model=AnalysisResult)
def analyze_lot_polygon(req: AnalyzeRequest, s: Settings = Depends(get_settings)) -> AnalysisResult:
    """Sentinel-2 indices (NDVI/EVI/NDWI/LAI) + Sentinel-1 radar + Penman-Monteith water balance
    + risk/yield + parametric trigger for an arbitrary polygon."""
    try:
        return analyze(req.geometry.model_dump(), req.start_date, req.end_date, s, crop=req.crop, sowing=req.sowing_date, harvest=req.harvest_date)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("")
def list_lots(chain: Chain = Depends(get_chain)) -> list[dict]:
    """All on-chain lots with funding state, latest oracle metrics, payout preview and insurance."""
    try:
        return chain.list_lots()
    except ChainNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/{lot_id}/metrics", response_model=LotMetricsResponse)
def lot_metrics(lot_id: int, store: Store = Depends(get_store), chain: Chain = Depends(get_chain)) -> LotMetricsResponse:
    history = [MetricRecord(**r, explorer_url=chain.explorer_url(r["tx_hash"]) if r["tx_hash"] else None) for r in store.metrics(lot_id)]
    return LotMetricsResponse(lot_id=lot_id, history=history, latest_analysis=store.analysis(lot_id))


@router.put("/{lot_id}/profile")
def set_profile(lot_id: int, profile: LotProfile, store: Store = Depends(get_store)) -> dict:
    """Stores the sowing date (and notes) used by the water balance for an on-chain lot."""
    store.save_profile(lot_id, profile.model_dump(mode="json"))
    return {"lot_id": lot_id, **profile.model_dump(mode="json")}


@router.get("/{lot_id}/seguro", response_model=LotInsuranceResponse)
def lot_insurance(
    lot_id: int,
    refresh: bool = False,
    store: Store = Depends(get_store),
    chain: Chain = Depends(get_chain),
    s: Settings = Depends(get_settings),
) -> LotInsuranceResponse:
    """Parametric insurance evaluation: `{"riesgo_climatico": "ALTO", "trigger_seguro": true, ...}`
    plus the vault's on-chain view (pool, trigger, coverage). Uses the last published analysis
    unless `refresh=true`, which recomputes from live satellite/weather data."""
    saved = None if refresh else store.analysis(lot_id)
    ts = None
    try:
        if saved and saved.get("insurance"):
            evaluation = saved["insurance"]
            ts = next((r["timestamp"] for r in reversed(store.metrics(lot_id))), None)
        else:
            _scenario, result = analyze_lot(lot_id, chain, store, s)
            evaluation = result.insurance
        onchain = chain.get_lot(lot_id)["insurance"]
    except ChainNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"insurance evaluation failed: {exc}") from exc
    return LotInsuranceResponse(lot_id=lot_id, evaluacion=evaluation, onchain=onchain, analysis_timestamp=ts)
