"""web3.py access to the OrbiTag contracts (read lots, push oracle metrics)."""

from __future__ import annotations

import json
import logging
import threading
import time
from functools import cached_property
from pathlib import Path
from typing import Any

from eth_account import Account
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

from ..config import APP_DIR, Settings

log = logging.getLogger(__name__)
CHAIN_DIR = APP_DIR / "chain"
STATUS = ["Funding", "Funded", "Failed", "Settled"]
FUJI_EXPLORER_TX_URL = "https://testnet.snowtrace.io/tx/"


def _abi(name: str) -> list[dict[str, Any]]:
    return json.loads((CHAIN_DIR / "abi" / f"{name}.json").read_text())


class ChainNotConfigured(RuntimeError):
    pass


class Chain:
    def __init__(self, s: Settings):
        self.s = s
        self._lock = threading.Lock()  # serialize nonces for oracle txs

    @cached_property
    def deployment(self) -> dict[str, Any]:
        path = Path(CHAIN_DIR / "deployments" / f"{self.s.chain_network}.json")
        if not path.exists():
            raise ChainNotConfigured(f"missing {path}; deploy the contracts first")
        return json.loads(path.read_text())

    @cached_property
    def w3(self) -> Web3:
        w3 = Web3(Web3.HTTPProvider(self.s.rpc_url, request_kwargs={"timeout": 30}))
        # Avalanche C-Chain headers carry extraData longer than 32 bytes.
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        return w3

    def _contract(self, name: str):
        return self.w3.eth.contract(address=Web3.to_checksum_address(self.deployment["contracts"][name]), abi=_abi(name))

    @cached_property
    def factory(self):
        return self._contract("LotFactory")

    @cached_property
    def vault(self):
        return self._contract("CampaignVault")

    @cached_property
    def oracle(self):
        return self._contract("OracleConsumer")

    @cached_property
    def account(self):
        if not self.s.oracle_private_key:
            raise ChainNotConfigured("ORACLE_PRIVATE_KEY is not set")
        return Account.from_key(self.s.oracle_private_key)

    def status(self) -> dict[str, Any]:
        try:
            return {
                "connected": self.w3.is_connected(),
                "chain_id": self.w3.eth.chain_id,
                "network": self.s.chain_network,
                "contracts": self.deployment["contracts"],
                "oracle_configured": bool(self.s.oracle_private_key),
            }
        except Exception as exc:
            return {"connected": False, "error": str(exc)}

    # ----------------------------------------------------------------- reads

    def lot_count(self) -> int:
        return self.factory.functions.lotCount().call()

    def get_lot(self, lot_id: int) -> dict[str, Any]:
        lot = self.factory.functions.getLot(lot_id).call()
        state = self.vault.functions.getLotState(lot_id).call()
        m = self.oracle.functions.latestMetrics(lot_id).call()
        preview = self.vault.functions.previewPayout(lot_id).call()
        ins = self.vault.functions.getLotInsurance(lot_id).call()
        trig = self.vault.functions.insuranceTrigger(lot_id).call()
        return {
            "id": lot_id,
            "producer": lot[0],
            "token": lot[1],
            "name": lot[2],
            "crop": lot[3],
            "hectares": lot[4] / 100,
            "geometry": json.loads(lot[5]),
            "geo_hash": "0x" + lot[6].hex(),
            "funding_goal": lot[7] / 1e6,
            "price_per_token": lot[8] / 1e6,
            "funding_deadline": lot[9],
            "maturity": lot[10],
            "target_apy": lot[11] / 10_000,
            "status": STATUS[state[0]],
            "funds_released": state[1],
            "tokens_sold": state[2],
            "raised": state[3] / 1e6,
            "repaid": state[4] / 1e6,
            "payout_per_token": state[5] / 1e6,
            "metrics": None if m[9] == 0 else self._metrics(m),
            "preview": {"multiplier": preview[0] / 10_000, "payout_per_token": preview[1] / 1e6, "drought": preview[2]},
            "insurance": {
                "premium": ins[0] / 1e6,
                "coverage": ins[1] / 1e6,
                "executed": ins[2],
                "triggered": trig[0],
                "coverage_available": trig[2] / 1e6,
                "pool": self.vault.functions.insurancePool().call() / 1e6,
            },
        }

    @staticmethod
    def _metrics(m: tuple) -> dict[str, Any]:
        return {
            "ndvi": m[0] / 10_000,
            "ndwi": m[1] / 10_000,
            "risk_score": m[2],
            "yield_index": m[3] / 10_000,
            "water_balance_mm": m[4],
            "critical_dry_days": m[5],
            "rain_vs_normal": m[6] / 10_000,
            "ndvi_drop": m[7] / 10_000,
            "soil_dry_days": m[8],
            "timestamp": m[9],
            "data_hash": "0x" + m[10].hex(),
        }

    def list_lots(self) -> list[dict[str, Any]]:
        return [self.get_lot(i) for i in range(self.lot_count())]

    # ----------------------------------------------------------------- writes

    def push_metrics(
        self,
        lot_id: int,
        *,
        ndvi: float,
        ndwi: float | None,
        risk_score: int,
        yield_index: float,
        water_balance_mm: float,
        critical_dry_days: int,
        rain_vs_normal: float | None,
        ndvi_drop: float,
        soil_dry_days: int,
        data_hash: str,
    ) -> dict[str, Any]:
        """Signs and sends OracleConsumer.updateLotMetrics(lotId, Metrics) with the oracle key."""
        acct = self.account
        clamp = lambda v, lo, hi: max(lo, min(hi, v))  # noqa: E731
        with self._lock:
            last_ts = self.oracle.functions.latestMetrics(lot_id).call()[9]
            # Must be strictly increasing on-chain and not ahead of block time (+15 min drift).
            block_ts = self.w3.eth.get_block("latest")["timestamp"]
            ts = max(min(int(time.time()), block_ts + 600), last_ts + 1)
            metrics = (
                clamp(round(ndvi * 10_000), -10_000, 10_000),
                # No SWIR data: publish the trigger threshold itself so the strict "<" never fires without evidence.
                clamp(round((ndwi if ndwi is not None else self.s.ndwi_trigger) * 10_000), -10_000, 10_000),
                clamp(int(risk_score), 0, 100),
                clamp(round(yield_index * 10_000), 5_000, 13_000),
                clamp(round(water_balance_mm), -2_000_000_000, 2_000_000_000),
                clamp(int(critical_dry_days), 0, 65_535),
                clamp(round((rain_vs_normal if rain_vs_normal is not None else 1.0) * 10_000), 0, 65_535),
                clamp(round(ndvi_drop * 10_000), 0, 10_000),
                clamp(int(soil_dry_days), 0, 65_535),
                ts,
                bytes.fromhex(data_hash[2:]),
            )
            fn = self.oracle.functions.updateLotMetrics(lot_id, metrics)
            tx = fn.build_transaction(
                {"from": acct.address, "nonce": self.w3.eth.get_transaction_count(acct.address, "pending"), "chainId": self.w3.eth.chain_id}
            )
            signed = acct.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt["status"] != 1:
            raise RuntimeError(f"oracle tx reverted: {tx_hash.hex()}")
        return {"tx_hash": "0x" + tx_hash.hex().removeprefix("0x"), "block_number": receipt["blockNumber"], "timestamp": ts}

    def explorer_url(self, tx_hash: str) -> str | None:
        base = self.s.explorer_tx_url or (FUJI_EXPLORER_TX_URL if self.s.chain_network == "fuji" else "")
        return f"{base}{tx_hash}" if base else None
