from fastapi import APIRouter, Depends, HTTPException

from ..deps import Settings, get_chain, get_settings, get_store
from ..schemas import PushResult
from ..services.chain import Chain, ChainNotConfigured
from ..services.oracle import push_lot
from ..services.store import Store

router = APIRouter(prefix="/oracle", tags=["oracle"])


@router.post("/push/{lot_id}", response_model=PushResult)
def push(lot_id: int, chain: Chain = Depends(get_chain), store: Store = Depends(get_store), s: Settings = Depends(get_settings)) -> PushResult:
    """Computes the lot's metrics and publishes them on-chain with ORACLE_PRIVATE_KEY."""
    try:
        return push_lot(lot_id, chain, store, s)
    except ChainNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"oracle push failed: {exc}") from exc
