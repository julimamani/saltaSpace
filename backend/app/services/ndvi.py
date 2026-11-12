"""Sentinel-2 L2A vegetation indices from the Earth Search STAC API (AWS open data COGs).

For each selected scene (best scene per ISO week) we read only the window covering the lot
(COG range requests), mask clouds/shadows with the SCL band, clip to the polygon and compute
on surface reflectance:
    NDVI = (B08 - B04) / (B08 + B04)                       vigor (saturates on dense canopies)
    EVI  = 2.5 (B08 - B04) / (B08 + 6 B04 - 7.5 B02 + 1)   vigor, atmosphere/soil corrected
    NDWI = (B08 - B11) / (B08 + B11)                       leaf water content (Gao 1996)
    LAI  = 3.618 EVI - 0.118                               leaf area, biomass proxy (Boegh 2002)
If anything fails we fall back to a deterministic mock series flagged `source="mock"`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np

from ..config import Settings
from ..schemas import IndexObservation

NdviObservation = IndexObservation

log = logging.getLogger(__name__)

# SCL classes kept as "clear": 4 vegetation, 5 bare soil, 6 water, 7 unclassified, 11 snow
CLEAR_SCL = (4, 5, 6, 7, 11)
GDAL_ENV = {
    "AWS_NO_SIGN_REQUEST": "YES",
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "GDAL_HTTP_MAX_RETRY": "3",
    "GDAL_HTTP_RETRY_DELAY": "1",
}


def bbox_of(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    ring = geometry["coordinates"][0]
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def centroid_of(geometry: dict[str, Any]) -> tuple[float, float]:
    """(lon, lat) average of the outer ring vertices (good enough for small lots)."""
    ring = geometry["coordinates"][0][:-1] or geometry["coordinates"][0]
    return (
        round(sum(p[0] for p in ring) / len(ring), 6),
        round(sum(p[1] for p in ring) / len(ring), 6),
    )


def _contains_bbox(item_bbox: list[float], bbox: tuple[float, float, float, float]) -> bool:
    return item_bbox[0] <= bbox[0] and item_bbox[1] <= bbox[1] and item_bbox[2] >= bbox[2] and item_bbox[3] >= bbox[3]


def week_label(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def search_scenes(geometry: dict[str, Any], start: date, end: date, s: Settings) -> list[Any]:
    """Least-cloudy scene per ISO week (weekly series), sampled down to `max_scenes` if needed."""
    from pystac_client import Client

    client = Client.open(s.stac_url)
    search = client.search(
        collections=[s.stac_collection],
        intersects=geometry,
        datetime=f"{start.isoformat()}/{end.isoformat()}",
        query={"eo:cloud_cover": {"lt": s.max_cloud_cover}},
        max_items=200,
    )
    bbox = bbox_of(geometry)
    by_day: dict[date, Any] = {}
    for item in search.items():
        # Skip tiles that only partially cover the lot (tile edges / overlaps between UTM zones).
        if item.bbox and not _contains_bbox(item.bbox, bbox):
            continue
        d = item.datetime.date() if item.datetime else None
        if d is None:
            continue
        cc = item.properties.get("eo:cloud_cover", 100)
        wk = week_label(d)
        if wk not in by_day or cc < by_day[wk].properties.get("eo:cloud_cover", 100):
            by_day[wk] = item
    items = sorted(by_day.values(), key=lambda i: i.datetime)
    if len(items) > s.max_scenes:
        # Always keep the latest scene; spread the rest across the window.
        idx = np.linspace(0, len(items) - 1, s.max_scenes).round().astype(int)
        items = [items[i] for i in sorted(set(idx.tolist()))]
    return items


def _band_scale(asset: Any, item: Any | None = None) -> tuple[float, float]:
    """DN -> surface reflectance. Earth Search already applies the ESA BOA_ADD_OFFSET (-1000 DN)
    to its COGs when `earthsearch:boa_offset_applied` is true, so the -0.1 offset listed in
    `raster:bands` must NOT be applied again (it would overstate NDVI, e.g. 0.51 -> 0.87)."""
    bands = asset.extra_fields.get("raster:bands") or [{}]
    offset = float(bands[0].get("offset", 0.0))
    if item is not None and item.properties.get("earthsearch:boa_offset_applied"):
        offset = 0.0
    return float(bands[0].get("scale", 0.0001)), offset


def _read_window(href: str, geometry: dict[str, Any], out_shape: tuple[int, int] | None = None):
    """Reads the lot window from a COG. Returns (array, transform, crs, nodata)."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_geom
    from rasterio.windows import Window

    with rasterio.open(href) as src:
        geom = transform_geom("EPSG:4326", src.crs, geometry)
        xs = [p[0] for p in geom["coordinates"][0]]
        ys = [p[1] for p in geom["coordinates"][0]]
        inv = ~src.transform
        cols, rows = zip(*(inv * (x, y) for x in (min(xs), max(xs)) for y in (min(ys), max(ys))))
        col0, row0 = max(0, math.floor(min(cols)) - 1), max(0, math.floor(min(rows)) - 1)
        col1 = min(src.width, math.ceil(max(cols)) + 1)
        row1 = min(src.height, math.ceil(max(rows)) + 1)
        window = Window(col0, row0, col1 - col0, row1 - row0)
        if window.width <= 0 or window.height <= 0:
            raise ValueError("lot outside scene")
        kwargs: dict[str, Any] = {"window": window}
        if out_shape is not None:
            kwargs.update(out_shape=out_shape, resampling=Resampling.nearest)
        arr = src.read(1, **kwargs)
        return arr, src.window_transform(window), src.crs, geom, src.nodata


def _scaled(item: Any, key: str, raw: np.ndarray) -> np.ndarray:
    scale, off = _band_scale(item.assets[key], item)
    return raw.astype("float64") * scale + off


def indices_for_scene(item: Any, geometry: dict[str, Any]) -> IndexObservation:
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine

    with rasterio.Env(**GDAL_ENV):
        red_raw, transform, _crs, geom, nodata = _read_window(item.assets["red"].href, geometry)
        nir_raw, *_ = _read_window(item.assets["nir"].href, geometry)
        if nir_raw.shape != red_raw.shape:
            raise ValueError("band shapes differ")
        blue_raw = swir_raw = scl = None
        if "blue" in item.assets:
            blue_raw, *_ = _read_window(item.assets["blue"].href, geometry)
        if "swir16" in item.assets:  # B11 is 20 m: resample onto the 10 m grid
            swir_raw, *_ = _read_window(item.assets["swir16"].href, geometry, out_shape=red_raw.shape)
        if "scl" in item.assets:
            scl, *_ = _read_window(item.assets["scl"].href, geometry, out_shape=red_raw.shape)

    inside = ~geometry_mask([geom], out_shape=red_raw.shape, transform=Affine(*transform[:6]), all_touched=True)
    valid = inside & (red_raw != (nodata or 0)) & (nir_raw != (nodata or 0))
    if scl is not None:
        valid &= np.isin(scl, CLEAR_SCL)

    red, nir = _scaled(item, "red", red_raw), _scaled(item, "nir", nir_raw)
    denom = nir + red
    valid &= denom > 0
    if valid.sum() < 1:
        raise ValueError("no clear pixels over the lot")
    ndvi = np.clip((nir[valid] - red[valid]) / denom[valid], -1, 1)

    evi = ndwi = lai = None
    if blue_raw is not None and blue_raw.shape == red_raw.shape:
        blue = _scaled(item, "blue", blue_raw)
        d = nir[valid] + 6 * red[valid] - 7.5 * blue[valid] + 1
        ok = np.abs(d) > 1e-6
        if ok.any():
            evi_px = np.clip(2.5 * (nir[valid][ok] - red[valid][ok]) / d[ok], -1, 1)
            evi = float(evi_px.mean())
            lai = float(np.clip(3.618 * evi - 0.118, 0, 8))
    if swir_raw is not None:
        swir = _scaled(item, "swir16", swir_raw)
        d = nir[valid] + swir[valid]
        ok = d > 0
        if ok.any():
            ndwi = float(np.clip((nir[valid][ok] - swir[valid][ok]) / d[ok], -1, 1).mean())

    return IndexObservation(
        date=item.datetime.date(),
        mean=round(float(ndvi.mean()), 4),
        min=round(float(ndvi.min()), 4),
        max=round(float(ndvi.max()), 4),
        evi=None if evi is None else round(evi, 4),
        ndwi=None if ndwi is None else round(ndwi, 4),
        lai=None if lai is None else round(lai, 3),
        scene_id=item.id,
        cloud_cover=round(float(item.properties.get("eo:cloud_cover", 0)), 2),
        valid_pixels=int(valid.sum()),
        week=week_label(item.datetime.date()),
        source="sentinel-2",
    )


ndvi_for_scene = indices_for_scene


def real_ndvi_series(geometry: dict[str, Any], start: date, end: date, s: Settings) -> list[IndexObservation]:
    items = search_scenes(geometry, start, end, s)
    if not items:
        raise LookupError("no Sentinel-2 scenes under the cloud threshold")
    log.info("NDVI: %d scene(s) selected: %s", len(items), [i.id for i in items])
    results: list[IndexObservation] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for item, fut in [(i, pool.submit(indices_for_scene, i, geometry)) for i in items]:
            try:
                results.append(fut.result())
            except Exception as exc:  # one bad scene should not kill the series
                log.warning("NDVI scene %s failed: %s", item.id, exc)
    if not results:
        raise RuntimeError("all scenes failed")
    return sorted(results, key=lambda o: o.date)


# --------------------------------------------------------------------------- mock fallback


def _seed(geometry: dict[str, Any], d: date) -> int:
    key = json.dumps(geometry, sort_keys=True) + d.isoformat()
    return int(hashlib.sha256(key.encode()).hexdigest()[:8], 16)


def mock_observation(geometry: dict[str, Any], d: date) -> IndexObservation:
    """Deterministic NDVI: a southern-hemisphere summer-crop curve (peak ~Feb) + seeded noise."""
    rng = np.random.default_rng(_seed(geometry, d))
    season = 0.5 + 0.25 * math.cos(2 * math.pi * (d.timetuple().tm_yday - 45) / 365)
    mean = float(np.clip(season + rng.normal(0, 0.03), 0.1, 0.9))
    spread = float(rng.uniform(0.08, 0.18))
    evi = float(np.clip(0.75 * mean - 0.05 + rng.normal(0, 0.02), 0.0, 1.0))
    return IndexObservation(
        date=d,
        mean=round(mean, 4),
        min=round(max(-1.0, mean - spread), 4),
        max=round(min(1.0, mean + spread * 0.6), 4),
        evi=round(evi, 4),
        ndwi=round(float(np.clip(0.6 * mean - 0.15 + rng.normal(0, 0.02), -0.5, 0.6)), 4),
        lai=round(float(np.clip(3.618 * evi - 0.118, 0, 8)), 3),
        week=week_label(d),
        source="mock",
    )


def mock_ndvi_series(geometry: dict[str, Any], start: date, end: date, n: int) -> list[IndexObservation]:
    span = max(1, (end - start).days)
    days = sorted({start + timedelta(days=round(span * i / max(1, n - 1))) for i in range(n)})
    return [mock_observation(geometry, d) for d in days]


def get_ndvi_series(geometry: dict[str, Any], start: date, end: date, s: Settings) -> list[IndexObservation]:
    if not s.force_mock_ndvi:
        try:
            return real_ndvi_series(geometry, start, end, s)
        except Exception as exc:
            log.warning("NDVI real data unavailable, using mock fallback: %s", exc)
    return mock_ndvi_series(geometry, start, end, s.max_scenes)


def today() -> date:
    return datetime.utcnow().date()
