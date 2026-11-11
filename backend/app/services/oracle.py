"""Oracle job: analyze a lot's polygon and publish its metrics on-chain."""

from __future__ import annotations

import logging

from ..config import Settings
from ..schemas import MetricRecord, PushResult
from .analysis import analyze
from .chain import Chain
from .store import Store

log = logging.getLogger(__name__)


def effective_scenario(lot_id: int, store: Store, s: Settings) -> str:
    scenario = store.scenario(lot_id)
    if scenario == "real" and s.simulate_drought:
        return "drought"
    return scenario


def push_lot(lot_id: int, chain: Chain, store: Store, s: Settings) -> PushResult:
    lot = chain.get_lot(lot_id)
    scenario = effective_scenario(lot_id, store, s)
    result = analyze(lot["geometry"], None, None, s, scenario=scenario)
    tx = chain.push_metrics(lot_id, result.ndvi.mean, result.risk_score, result.yield_index, result.data_hash)
    record = MetricRecord(
        lot_id=lot_id,
        timestamp=tx["timestamp"],
        ndvi=result.ndvi.mean,
        risk_score=result.risk_score,
        yield_index=result.yield_index,
        source=result.ndvi.source,
        scenario=scenario,
        data_hash=result.data_hash,
        tx_hash=tx["tx_hash"],
        explorer_url=chain.explorer_url(tx["tx_hash"]),
    )
    store.add_metric(record.model_dump(exclude={"explorer_url"}))
    store.save_analysis(lot_id, result.model_dump(mode="json"), tx["timestamp"])
    log.info("Lot %s pushed (%s): ndvi=%.3f risk=%s yield=%.3f tx=%s", lot_id, scenario, result.ndvi.mean, result.risk_score, result.yield_index, tx["tx_hash"])
    return PushResult(
        lot_id=lot_id,
        tx_hash=tx["tx_hash"],
        explorer_url=record.explorer_url,
        block_number=tx["block_number"],
        metrics=record,
        analysis=result,
    )


def push_active_lots(chain: Chain, store: Store, s: Settings) -> None:
    """Scheduled job: refresh every lot that is still Funding or Funded."""
    try:
        count = chain.lot_count()
    except Exception as exc:
        log.warning("Scheduler: chain unavailable: %s", exc)
        return
    for lot_id in range(count):
        try:
            status = chain.vault.functions.getLotState(lot_id).call()[0]
            if status in (0, 1):
                push_lot(lot_id, chain, store, s)
        except Exception as exc:
            log.warning("Scheduler: lot %s failed: %s", lot_id, exc)
