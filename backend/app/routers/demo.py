from fastapi import APIRouter, Depends, HTTPException

from ..deps import Settings, get_chain, get_settings, get_store
from ..schemas import ScenarioRequest
from ..services.chain import Chain, ChainNotConfigured
from ..services.oracle import effective_scenario, push_lot
from ..services.store import Store

router = APIRouter(prefix="/demo", tags=["demo"])


@router.get("/scenario/{lot_id}")
def get_scenario(lot_id: int, store: Store = Depends(get_store), s: Settings = Depends(get_settings)) -> dict:
    return {"lot_id": lot_id, "scenario": effective_scenario(lot_id, store, s), "simulate_drought_env": s.simulate_drought}


@router.post("/scenario/{lot_id}")
def set_scenario(
    lot_id: int,
    req: ScenarioRequest,
    store: Store = Depends(get_store),
    chain: Chain = Depends(get_chain),
    s: Settings = Depends(get_settings),
) -> dict:
    """Forces `drought` / `excellent` (or back to `real`) for a lot and, by default,
    publishes the resulting metrics on-chain right away so the UI updates live."""
    store.set_scenario(lot_id, req.scenario)
    if not req.push:
        return {"lot_id": lot_id, "scenario": req.scenario}
    try:
        result = push_lot(lot_id, chain, store, s)
    except ChainNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"oracle push failed: {exc}") from exc
    return {"lot_id": lot_id, "scenario": req.scenario, "push": result.model_dump(mode="json")}
