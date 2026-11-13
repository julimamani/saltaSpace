import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import rpc


@pytest.fixture
def upstream(monkeypatch):
    calls: list[object] = []
    responses: list[httpx.Response] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        calls.append(payload)
        if responses:
            return responses.pop(0)
        if isinstance(payload, list):
            return httpx.Response(200, json=[{"jsonrpc": "2.0", "id": p["id"], "result": f"0x{p['id']:x}"} for p in payload])
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": payload["id"], "result": "0x1"})

    monkeypatch.setattr(rpc, "_client", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(rpc, "_sem", asyncio.Semaphore(rpc.MAX_CONCURRENCY))
    monkeypatch.setattr(rpc, "BASE_DELAY", 0)
    rpc._cache.clear()
    return calls, responses


def call(method: str, req_id: int, params: list | None = None) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or []}


def test_retries_429(upstream):
    calls, responses = upstream
    responses.append(httpx.Response(429, text="Too Many Requests"))
    r = TestClient(app).post("/rpc", json=call("eth_chainId", 1))
    assert r.status_code == 200 and r.json()["result"] == "0x1"
    assert len(calls) == 2


def test_gives_up_after_max_attempts(upstream):
    calls, responses = upstream
    responses.extend(httpx.Response(429, text="Too Many Requests") for _ in range(rpc.MAX_ATTEMPTS))
    r = TestClient(app).post("/rpc", json=call("eth_chainId", 1))
    assert r.status_code == 429
    assert len(calls) == rpc.MAX_ATTEMPTS


def test_caches_reads_and_keeps_request_id(upstream):
    calls, _ = upstream
    client = TestClient(app)
    params = [{"to": "0xabc", "data": "0x01"}, "latest"]
    client.post("/rpc", json=call("eth_call", 1, params))
    r = client.post("/rpc", json=call("eth_call", 7, params))
    assert r.json() == {"jsonrpc": "2.0", "id": 7, "result": "0x1"}
    assert len(calls) == 1


def test_does_not_cache_writes(upstream):
    calls, _ = upstream
    client = TestClient(app)
    client.post("/rpc", json=call("eth_sendRawTransaction", 1, ["0xdead"]))
    client.post("/rpc", json=call("eth_sendRawTransaction", 2, ["0xdead"]))
    assert len(calls) == 2


def test_batch_mixes_cache_hits_and_upstream(upstream):
    calls, _ = upstream
    client = TestClient(app)
    client.post("/rpc", json=call("eth_blockNumber", 1))
    r = client.post("/rpc", json=[call("eth_call", 5, ["a"]), call("eth_blockNumber", 6), call("eth_call", 9, ["b"])])
    assert [item["id"] for item in r.json()] == [5, 6, 9]
    assert r.json()[1]["result"] == "0x1"
    assert calls[-1] == [call("eth_call", 5, ["a"]), call("eth_call", 9, ["b"])]
