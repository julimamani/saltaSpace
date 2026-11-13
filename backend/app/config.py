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
    explorer_tx_url: str = ""  # empty: Snowtrace on fuji, no links elsewhere (custom L1s need their own explorer)

    # --- data sources
    stac_url: str = "https://earth-search.aws.element84.com/v1"
    stac_collection: str = "sentinel-2-l2a"
    max_cloud_cover: float = 30.0
    max_scenes: int = 8
    analysis_window_days: int = 90
    cloud_priority_threshold: float = 20.0  # latest S2 scene cloudier than this -> Sentinel-1 drives soil moisture
    open_meteo_archive_url: str = "https://archive-api.open-meteo.com/v1/archive"
    open_meteo_forecast_url: str = "https://api.open-meteo.com/v1/forecast"
    nasa_power_url: str = "https://power.larc.nasa.gov/api/temporal/daily/point"
    nasa_power_climatology_url: str = "https://power.larc.nasa.gov/api/temporal/climatology/point"
    planetary_computer_stac_url: str = "https://planetarycomputer.microsoft.com/api/stac/v1"
    planetary_computer_sas_url: str = "https://planetarycomputer.microsoft.com/api/sas/v1/token"
    sar_collection: str = "sentinel-1-rtc"
    sar_max_scenes: int = 6
    sar_dry_soil_vv_db: float = -14.0  # gamma0 VV under this = dry bare/sparse soil (C-band, rough guide)
    http_timeout_s: float = 30.0
    force_mock_ndvi: bool = False
    force_mock_sar: bool = False

    # --- water balance (FAO-56), see docs/scoring.md
    soil_available_water_m3_m3: float = 0.15  # θFC − θWP for a loam
    initial_depletion_fraction: float = 0.0  # root zone full at sowing
    min_normal_rain_mm: float = 10.0  # under this the "% of normal" ratio is meaningless (dry season)

    # --- scoring (see docs/scoring.md)
    ndvi_ref_low: float = 0.2
    ndvi_ref_high: float = 0.8
    evi_ref_low: float = 0.15
    evi_ref_high: float = 0.6
    ndwi_ref_low: float = -0.1
    ndwi_ref_high: float = 0.4
    rvi_ref_low: float = 0.3
    rvi_ref_high: float = 0.95
    critical_dry_days_ref: int = 20  # stress days in flowering that zero the stress score
    weight_vigor: float = 0.35
    weight_ndwi: float = 0.15
    weight_water: float = 0.20
    weight_stress: float = 0.15
    weight_heat: float = 0.05
    weight_sar: float = 0.10
    heat_stress_temp_c: float = 35.0

    # --- parametric insurance trigger (mirrors CampaignVault.InsuranceParams defaults)
    ndwi_trigger: float = 0.05
    rain_trigger_ratio: float = 0.5
    dry_days_trigger: int = 10
    ndvi_drop_trigger: float = 0.4
    soil_dry_days_trigger: int = 21

    # --- demo / scheduler
    simulate_drought: bool = False
    enable_scheduler: bool = True
    oracle_interval_minutes: int = 30

    # --- api
    cors_origins: str = "http://localhost:4200,http://127.0.0.1:4200,http://localhost:4000"
    database_path: str = str(APP_DIR.parent / "data" / "orbitag.db")
    log_level: str = "INFO"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
