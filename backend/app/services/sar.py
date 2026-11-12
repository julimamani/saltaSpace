"""Sentinel-1 radar (C-band SAR) over the lot, from Microsoft Planetary Computer's
`sentinel-1-rtc` collection (radiometrically terrain corrected gamma0, 10 m, free SAS tokens).
Radar sees through clouds, so it keeps the oracle running in the cloudy NW-Argentina summer.

    VV (dB)      : dominated by soil moisture / roughness -> low VV = dry soil
    VH (dB)      : volume scattering from the canopy -> biomass
    RVI          : 4 VH / (VV + VH) in linear power, 0..1 vegetation density proxy
    soil_dry_days: consecutive days (up to the latest scene) with VV under `sar_dry_soil_vv_db`

Earth Search also lists Sentinel-1 GRD but as a requester-pays bucket (AWS credentials), hence PC.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any

import httpx
import numpy as np

from ..config import Settings
from ..schemas import SarObservation, SarSummary
from .ndvi import _read_window

log = logging.getLogger(__name__)


def _db(x: float) -> float:
    return round(10 * math.log10(max(x, 1e-6)), 2)


def search_scenes(geometry: dict[str, Any], start: date, end: date, s: Settings, client: httpx.Client) -> list[dict[str, Any]]:
    r = client.post(
        f"{s.planetary_computer_stac_url}/search",
        json={"collections": [s.sar_collection], "intersects": geometry, "datetime": f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z", "limit": 100},
    )
    r.raise_for_status()
    feats = r.json().get("features", [])
    by_day: dict[date, dict[str, Any]] = {}
    for f in feats:
        d = date.fromisoformat(f["properties"]["datetime"][:10])
        by_day.setdefault(d, f)
    items = [by_day[d] for d in sorted(by_day)]
    return items[-s.sar_max_scenes :]


def _sign(href: str, token: str) -> str:
    return f"{href}?{token}"


def sas_token(s: Settings, client: httpx.Client) -> str:
    r = client.get(f"{s.planetary_computer_sas_url}/{s.sar_collection}")
    r.raise_for_status()
    return r.json()["token"]


def observation(item: dict[str, Any], geometry: dict[str, Any], token: str, s: Settings) -> SarObservation:
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine

    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.tiff", "GDAL_HTTP_MAX_RETRY": "3", "GDAL_HTTP_RETRY_DELAY": "1"}
    with rasterio.Env(**env):
        vv, transform, _crs, geom, nodata = _read_window(_sign(item["assets"]["vv"]["href"], token), geometry)
        vh, *_ = _read_window(_sign(item["assets"]["vh"]["href"], token), geometry, out_shape=vv.shape)
    inside = ~geometry_mask([geom], out_shape=vv.shape, transform=Affine(*transform[:6]), all_touched=True)
    valid = inside & np.isfinite(vv) & np.isfinite(vh) & (vv > 0) & (vh > 0)
    if nodata is not None:
        valid &= (vv != nodata) & (vh != nodata)
    if valid.sum() < 1:
        raise ValueError("no valid radar pixels over the lot")
    vv_m, vh_m = float(vv[valid].mean()), float(vh[valid].mean())
    vv_db = _db(vv_m)
    return SarObservation(
        date=date.fromisoformat(item["properties"]["datetime"][:10]),
        vv_db=vv_db,
        vh_db=_db(vh_m),
        ratio_db=round(_db(vh_m) - vv_db, 2),
        rvi=round(min(1.0, 4 * vh_m / (vv_m + vh_m)), 4),
        dry_soil=vv_db < s.sar_dry_soil_vv_db,
        scene_id=item["id"],
        source="sentinel-1",
    )


def real_series(geometry: dict[str, Any], start: date, end: date, s: Settings) -> list[SarObservation]:
    with httpx.Client(timeout=s.http_timeout_s) as client:
        items = search_scenes(geometry, start, end, s, client)
        if not items:
            raise LookupError("no Sentinel-1 RTC scenes")
        token = sas_token(s, client)
    log.info("SAR: %d scene(s): %s", len(items), [i["id"] for i in items])
    out: list[SarObservation] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for item, fut in [(i, pool.submit(observation, i, geometry, token, s)) for i in items]:
            try:
                out.append(fut.result())
            except Exception as exc:
                log.warning("SAR scene %s failed: %s", item["id"], exc)
    if not out:
        raise RuntimeError("all Sentinel-1 scenes failed")
    return sorted(out, key=lambda o: o.date)


def mock_series(geometry: dict[str, Any], start: date, end: date, n: int, s: Settings) -> list[SarObservation]:
    seed = int(hashlib.sha256((json.dumps(geometry, sort_keys=True) + "sar").encode()).hexdigest()[:8], 16)
    rng = np.random.default_rng(seed)
    span = max(1, (end - start).days)
    days = sorted({start + timedelta(days=round(span * i / max(1, n - 1))) for i in range(n)})
    out = []
    for d in days:
        vv_db = float(rng.normal(-11.5, 1.2))
        vh_db = vv_db - float(rng.uniform(6.0, 8.5))
        vv_l, vh_l = 10 ** (vv_db / 10), 10 ** (vh_db / 10)
        out.append(SarObservation(date=d, vv_db=round(vv_db, 2), vh_db=round(vh_db, 2), ratio_db=round(vh_db - vv_db, 2), rvi=round(4 * vh_l / (vv_l + vh_l), 4), dry_soil=vv_db < s.sar_dry_soil_vv_db, source="mock"))
    return out


def soil_dry_days(obs: list[SarObservation]) -> int:
    """Days covered by the trailing run of dry-soil scenes (previous wet scene -> latest scene)."""
    if not obs or not obs[-1].dry_soil:
        return 0
    first_dry = obs[-1].date
    for o in reversed(obs):
        if not o.dry_soil:
            break
        first_dry = o.date
    return max(1, (obs[-1].date - first_dry).days + 6)  # +6: Sentinel-1 revisit interval


def summarize(obs: list[SarObservation], prioritized: bool, errors: list[str]) -> SarSummary:
    if not obs:
        return SarSummary(prioritized=prioritized, source="none", errors=errors)
    return SarSummary(
        observations=obs,
        latest_vv_db=obs[-1].vv_db,
        latest_rvi=obs[-1].rvi,
        soil_dry_days=soil_dry_days(obs),
        prioritized=prioritized,
        source=obs[-1].source,
        errors=errors,
    )


def get_sar(geometry: dict[str, Any], start: date, end: date, s: Settings, prioritized: bool) -> SarSummary:
    errors: list[str] = []
    if not s.force_mock_sar:
        try:
            return summarize(real_series(geometry, start, end, s), prioritized, errors)
        except Exception as exc:
            log.warning("Sentinel-1 unavailable, using mock fallback: %s", exc)
            errors.append(f"sentinel-1: {exc}")
    return summarize(mock_series(geometry, start, end, s.sar_max_scenes, s), prioritized, errors)
