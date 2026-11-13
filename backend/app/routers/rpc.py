"""JSON-RPC proxy: some L1 RPC endpoints (e.g. AvaCloud managed nodes) don't send CORS
headers, so browsers block direct viem calls. Chain traffic goes through the backend,
which is also covered by the API's CORS allowlist.

Managed RPCs are rate limited (HTTP 429), so the proxy caches idempotent reads for a few
seconds, caps concurrent upstream requests and retries 429/5xx with backoff."""

import asyncio
import json
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from ..deps import Settings, get_settings

router = APIRouter(tags=["rpc"])

CACHEABLE = {
    "eth_chainId",
    "net_version",
    "eth_blockNumber",
    "eth_call",
    "eth_getBlockByNumber",
    "eth_getBlockByHash",
    "eth_getLogs",
    "eth_getCode",
}
CACHE_TTL = 3.0
MAX_CACHE_ENTRIES = 2_000
RETRY_STATUS = {429, 502, 503, 504}
MAX_ATTEMPTS = 4
BASE_DELAY = 0.5
MAX_DELAY = 5.0
MAX_CONCURRENCY = 4
JSON_HEADERS = {"content-type": "application/json"}

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_client: httpx.AsyncClient | None = None
_sem = asyncio.Semaphore(MAX_CONCURRENCY)


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=30)
    return _client


def _cache_key(req: Any) -> str | None:
    if not isinstance(req, dict) or req.get("method") not in CACHEABLE:
        return None
    params = json.dumps(req.get("params", []), sort_keys=True)
    return None if '"pending"' in params else f"{req['method']}:{params}"


def _cached(key: str | None, req_id: Any) -> dict[str, Any] | None:
    hit = _cache.get(key) if key else None
    if hit and hit[0] > time.monotonic():
        return {**hit[1], "id": req_id}
    return None


def _store(key: str | None, item: Any) -> None:
    if not key or not isinstance(item, dict) or "result" not in item or "error" in item:
        return
    now = time.monotonic()
    if len(_cache) >= MAX_CACHE_ENTRIES:
        for k in [k for k, (exp, _) in _cache.items() if exp <= now]:
            del _cache[k]
        if len(_cache) >= MAX_CACHE_ENTRIES:
            _cache.clear()
    _cache[key] = (now + CACHE_TTL, {k: v for k, v in item.items() if k != "id"})


def _retry_delay(resp: httpx.Response, attempt: int) -> float:
    try:
        return min(float(resp.headers["retry-after"]), MAX_DELAY)
    except (KeyError, ValueError):
        return min(BASE_DELAY * 2**attempt, MAX_DELAY)


async def _post(url: str, content: bytes) -> httpx.Response:
    for attempt in range(MAX_ATTEMPTS):
        async with _sem:
            resp = await _http().post(url, content=content, headers=JSON_HEADERS)
        if resp.status_code not in RETRY_STATUS or attempt == MAX_ATTEMPTS - 1:
            return resp
        await asyncio.sleep(_retry_delay(resp, attempt))
    raise AssertionError("unreachable")


def _passthrough(resp: httpx.Response) -> Response:
    return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")


def _json(resp: httpx.Response) -> Any:
    try:
        return resp.json() if resp.status_code == 200 else None
    except ValueError:
        return None


async def _single(url: str, req: dict[str, Any]) -> Response:
    key = _cache_key(req)
    if (hit := _cached(key, req.get("id"))) is not None:
        return JSONResponse(hit)
    resp = await _post(url, json.dumps(req).encode())
    _store(key, _json(resp))
    return _passthrough(resp)


async def _batch(url: str, reqs: list[Any]) -> Response:
    out: dict[int, Any] = {}
    misses: list[tuple[int, Any, str | None]] = []
    for i, req in enumerate(reqs):
        key = _cache_key(req)
        hit = _cached(key, req.get("id")) if isinstance(req, dict) else None
        if hit is not None:
            out[i] = hit
        else:
            misses.append((i, req, key))
    if misses:
        resp = await _post(url, json.dumps([r for _, r, _ in misses]).encode())
        data = _json(resp)
        if not isinstance(data, list):
            return _passthrough(resp)
        by_id = {item.get("id"): item for item in data if isinstance(item, dict)}
        for i, req, key in misses:
            req_id = req.get("id") if isinstance(req, dict) else None
            item = by_id.get(req_id) or {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32603, "message": "missing response from upstream RPC"}}
            _store(key, item)
            out[i] = item
    return JSONResponse([out[i] for i in range(len(reqs))])


@router.post("/rpc")
async def rpc_proxy(request: Request, s: Settings = Depends(get_settings)) -> Response:
    """Forwards JSON-RPC calls (single or batch) to the configured chain RPC."""
    body = await request.body()
    try:
        payload = json.loads(body)
    except ValueError:
        payload = None
    try:
        if isinstance(payload, dict):
            return await _single(s.rpc_url, payload)
        if isinstance(payload, list) and payload:
            return await _batch(s.rpc_url, payload)
        return _passthrough(await _post(s.rpc_url, body))
    except httpx.HTTPError as exc:
        return JSONResponse({"error": f"rpc upstream failed: {exc}"}, status_code=502)
