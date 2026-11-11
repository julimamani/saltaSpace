from fastapi import APIRouter, Depends, HTTPException

from ..deps import Settings, get_chain, get_settings, get_store
from ..schemas import AnalysisResult, AnalyzeRequest, LotMetricsResponse, MetricRecord
from ..services.analysis import analyze
from ..services.chain import Chain, ChainNotConfigured
from ..services.store import Store

router = APIRouter(prefix="/lots", tags=["lots"])


@router.post("/analyze", response_model=AnalysisResult)
def analyze_lot(req: AnalyzeRequest, s: Settings = Depends(get_settings)) -> AnalysisResult:
    """NDVI (Sentinel-2 or mock fallback) + weather + risk/yield for an arbitrary polygon."""
    try:
        return analyze(req.geometry.model_dump(), req.start_date, req.end_date, s)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("")
def list_lots(chain: Chain = Depends(get_chain)) -> list[dict]:
    """All on-chain lots with funding state, latest oracle metrics and payout preview."""
    try:
        return chain.list_lots()
    except ChainNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/{lot_id}/metrics", response_model=LotMetricsResponse)
def lot_metrics(lot_id: int, store: Store = Depends(get_store), chain: Chain = Depends(get_chain)) -> LotMetricsResponse:
    history = [MetricRecord(**r, explorer_url=chain.explorer_url(r["tx_hash"]) if r["tx_hash"] else None) for r in store.metrics(lot_id)]
    return LotMetricsResponse(lot_id=lot_id, history=history, latest_analysis=store.analysis(lot_id))
