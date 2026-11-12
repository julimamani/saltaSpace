"""Oracle job: analyze a lot's polygon and publish its metrics on-chain."""

from __future__ import annotations

import logging
from datetime import date

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


def analyze_lot(lot_id: int, chain: Chain, store: Store, s: Settings):
    lot = chain.get_lot(lot_id)
    scenario = effective_scenario(lot_id, store, s)
    profile = store.profile(lot_id)
    sowing = date.fromisoformat(profile["sowing_date"]) if profile and profile.get("sowing_date") else None
    harvest = date.fromtimestamp(lot["maturity"])
    return scenario, analyze(lot["geometry"], None, None, s, scenario=scenario, crop=lot["crop"], sowing=sowing, harvest=harvest)


def push_lot(lot_id: int, chain: Chain, store: Store, s: Settings) -> PushResult:
    scenario, result = analyze_lot(lot_id, chain, store, s)
    wb, sar = result.water_balance, result.sar
    tx = chain.push_metrics(
        lot_id,
        ndvi=result.ndvi.mean,
        ndwi=result.ndvi.ndwi,
        risk_score=result.risk_score,
        yield_index=result.yield_index,
        water_balance_mm=wb.balance_mm,
        critical_dry_days=wb.critical_dry_days,
        rain_vs_normal=wb.rain_vs_normal,
        ndvi_drop=result.ndvi_drop,
        soil_dry_days=sar.soil_dry_days,
        data_hash=result.data_hash,
    )
    record = MetricRecord(
        lot_id=lot_id,
        timestamp=tx["timestamp"],
        ndvi=result.ndvi.mean,
        ndwi=result.ndvi.ndwi,
        risk_score=result.risk_score,
        yield_index=result.yield_index,
        water_balance_mm=wb.balance_mm,
        critical_dry_days=wb.critical_dry_days,
        rain_vs_normal=wb.rain_vs_normal,
        ndvi_drop=result.ndvi_drop,
        soil_dry_days=sar.soil_dry_days,
        trigger_seguro=result.insurance.trigger_seguro,
        source=result.ndvi.source,
        scenario=scenario,
        data_hash=result.data_hash,
        tx_hash=tx["tx_hash"],
        explorer_url=chain.explorer_url(tx["tx_hash"]),
    )
    store.add_metric(record.model_dump(exclude={"explorer_url"}))
    store.save_analysis(lot_id, result.model_dump(mode="json"), tx["timestamp"])
    log.info(
        "Lot %s pushed (%s): ndvi=%.3f ndwi=%s risk=%s yield=%.3f balance=%smm dry=%sd rain/normal=%s trigger=%s tx=%s",
        lot_id, scenario, result.ndvi.mean, result.ndvi.ndwi, result.risk_score, result.yield_index, wb.balance_mm,
        wb.critical_dry_days, wb.rain_vs_normal, result.insurance.trigger_seguro, tx["tx_hash"],
    )
    return PushResult(lot_id=lot_id, tx_hash=tx["tx_hash"], explorer_url=record.explorer_url, block_number=tx["block_number"], metrics=record, analysis=result)


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
