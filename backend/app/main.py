"""OrbiTag backend: satellite/weather analytics + on-chain oracle for Avalanche Fuji."""

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .deps import get_chain, get_settings, get_store
from .logging_setup import setup_logging
from .routers import demo, lots, oracle
from .services.chain import Chain
from .services.oracle import push_active_lots

settings = get_settings()
setup_logging(settings.log_level)
log = logging.getLogger("orbitag")


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = None
    if settings.enable_scheduler and settings.oracle_private_key:
        scheduler = BackgroundScheduler(daemon=True)
        scheduler.add_job(
            push_active_lots,
            "interval",
            minutes=settings.oracle_interval_minutes,
            args=[get_chain(), get_store(), settings],
            id="oracle-refresh",
            max_instances=1,
            coalesce=True,
            next_run_time=datetime.now() + timedelta(seconds=5),
        )
        scheduler.start()
        log.info("Oracle scheduler every %s min", settings.oracle_interval_minutes)
    else:
        log.info("Oracle scheduler disabled (ENABLE_SCHEDULER=false or no ORACLE_PRIVATE_KEY)")
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title="OrbiTag API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(lots.router)
app.include_router(oracle.router)
app.include_router(demo.router)


@app.get("/health", tags=["health"])
def health(chain: Chain = Depends(get_chain)) -> dict:
    return {
        "status": "ok",
        "simulate_drought": settings.simulate_drought,
        "force_mock_ndvi": settings.force_mock_ndvi,
        "chain": chain.status(),
    }
