"""Runtime configuration, loaded from environment variables / .env."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- chain
    rpc_url: str = "http://127.0.0.1:8545"
    chain_network: str = "localhost"  # name of the file in app/chain/deployments/<name>.json
    oracle_private_key: str | None = None
    explorer_tx_url: str = "https://testnet.snowtrace.io/tx/"

    # --- data sources
    stac_url: str = "https://earth-search.aws.element84.com/v1"
    stac_collection: str = "sentinel-2-l2a"
    max_cloud_cover: float = 30.0
    max_scenes: int = 6
    analysis_window_days: int = 90
    open_meteo_archive_url: str = "https://archive-api.open-meteo.com/v1/archive"
    open_meteo_forecast_url: str = "https://api.open-meteo.com/v1/forecast"
    nasa_power_url: str = "https://power.larc.nasa.gov/api/temporal/daily/point"
    http_timeout_s: float = 30.0
    force_mock_ndvi: bool = False

    # --- scoring (see docs/scoring.md)
    ndvi_ref_low: float = 0.2
    ndvi_ref_high: float = 0.8
    weight_ndvi: float = 0.6
    weight_water: float = 0.3
    weight_heat: float = 0.1
    heat_stress_temp_c: float = 35.0

    # --- demo / scheduler
    simulate_drought: bool = False
    enable_scheduler: bool = True
    oracle_interval_minutes: int = 30

    # --- api
    cors_origins: str = "http://localhost:4200,http://127.0.0.1:4200,http://localhost:4000"
    database_path: str = str(APP_DIR.parent / "data" / "agrotoken.db")
    log_level: str = "INFO"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
