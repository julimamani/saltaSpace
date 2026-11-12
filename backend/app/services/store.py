"""SQLite persistence for pushed metrics, latest analyses, lot profiles and demo scenarios."""

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    ndvi REAL NOT NULL,
    risk_score INTEGER NOT NULL,
    yield_index REAL NOT NULL,
    source TEXT NOT NULL,
    scenario TEXT NOT NULL,
    data_hash TEXT NOT NULL,
    tx_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_lot ON metrics(lot_id, timestamp);
CREATE TABLE IF NOT EXISTS analyses (
    lot_id INTEGER PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scenarios (
    lot_id INTEGER PRIMARY KEY,
    scenario TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
    lot_id INTEGER PRIMARY KEY,
    payload TEXT NOT NULL
);
"""
# Columns added after v1; applied with ALTER TABLE on existing databases.
_METRIC_EXTRA_COLUMNS = {
    "ndwi": "REAL",
    "water_balance_mm": "REAL",
    "critical_dry_days": "INTEGER",
    "rain_vs_normal": "REAL",
    "ndvi_drop": "REAL",
    "soil_dry_days": "INTEGER",
    "trigger_seguro": "INTEGER",
}


class Store:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(_SCHEMA)
            existing = {r["name"] for r in self._conn.execute("PRAGMA table_info(metrics)")}
            for col, typ in _METRIC_EXTRA_COLUMNS.items():
                if col not in existing:
                    self._conn.execute(f"ALTER TABLE metrics ADD COLUMN {col} {typ}")
            self._conn.commit()

    def add_metric(self, rec: dict[str, Any]) -> None:
        with self._lock, self._conn:
            cols = ["lot_id", "timestamp", "ndvi", "risk_score", "yield_index", "source", "scenario", "data_hash", "tx_hash", *_METRIC_EXTRA_COLUMNS]
            row = {c: rec.get(c) for c in cols}
            if row["trigger_seguro"] is not None:
                row["trigger_seguro"] = int(row["trigger_seguro"])
            self._conn.execute(
                f"INSERT INTO metrics ({', '.join(cols)}) VALUES ({', '.join(':' + c for c in cols)})",
                row,
            )

    def metrics(self, lot_id: int) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM metrics WHERE lot_id = ? ORDER BY timestamp", (lot_id,)
            ).fetchall()
        out = []
        for r in rows:
            d = {k: r[k] for k in r.keys() if k != "id"}
            if d.get("trigger_seguro") is not None:
                d["trigger_seguro"] = bool(d["trigger_seguro"])
            out.append(d)
        return out

    def save_analysis(self, lot_id: int, payload: dict[str, Any], ts: int) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO analyses (lot_id, payload, updated_at) VALUES (?, ?, ?)",
                (lot_id, json.dumps(payload, default=str), ts),
            )

    def analysis(self, lot_id: int) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT payload FROM analyses WHERE lot_id = ?", (lot_id,)).fetchone()
        return json.loads(row["payload"]) if row else None

    def save_profile(self, lot_id: int, payload: dict[str, Any]) -> None:
        """Off-chain agronomic details (sowing date, notes) the contract does not store."""
        with self._lock, self._conn:
            self._conn.execute("INSERT OR REPLACE INTO profiles (lot_id, payload) VALUES (?, ?)", (lot_id, json.dumps(payload, default=str)))

    def profile(self, lot_id: int) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT payload FROM profiles WHERE lot_id = ?", (lot_id,)).fetchone()
        return json.loads(row["payload"]) if row else None

    def set_scenario(self, lot_id: int, scenario: str) -> None:
        with self._lock, self._conn:
            if scenario == "real":
                self._conn.execute("DELETE FROM scenarios WHERE lot_id = ?", (lot_id,))
            else:
                self._conn.execute(
                    "INSERT OR REPLACE INTO scenarios (lot_id, scenario) VALUES (?, ?)", (lot_id, scenario)
                )

    def scenario(self, lot_id: int) -> str:
        with self._lock:
            row = self._conn.execute("SELECT scenario FROM scenarios WHERE lot_id = ?", (lot_id,)).fetchone()
        return row["scenario"] if row else "real"
