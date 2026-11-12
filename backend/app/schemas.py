"""Pydantic request/response models."""

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

Source = Literal["sentinel-2", "sentinel-1", "mock"]
Scenario = Literal["real", "drought", "excellent"]
RiskLevel = Literal["BAJO", "MEDIO", "ALTO"]


class Geometry(BaseModel):
    """GeoJSON Polygon geometry (lon, lat)."""

    type: Literal["Polygon"]
    coordinates: list[list[list[float]]]


class AnalyzeRequest(BaseModel):
    geometry: Geometry
    start_date: date | None = None
    end_date: date | None = None
    crop: str | None = Field(None, description="Crop name (soja, maíz, poroto, tabaco, trigo, caña); picks the FAO-56 Kc curve")
    sowing_date: date | None = Field(None, description="If omitted, estimated from harvest_date or assumed mid-flowering today")
    harvest_date: date | None = None


class IndexObservation(BaseModel):
    """One Sentinel-2 scene (or mock) over the lot: NDVI stats plus EVI / NDWI / LAI means."""

    date: date
    mean: float = Field(description="NDVI mean")
    min: float
    max: float
    evi: float | None = Field(None, description="Enhanced Vegetation Index mean")
    ndwi: float | None = Field(None, description="NDWI (B08-B11)/(B08+B11) mean: canopy water content")
    lai: float | None = Field(None, description="Leaf Area Index estimated from EVI (Boegh et al. 2002)")
    scene_id: str | None = None
    cloud_cover: float | None = None
    valid_pixels: int | None = None
    week: str | None = Field(None, description="ISO week label, e.g. 2026-W43")
    source: Source


NdviObservation = IndexObservation


class SarObservation(BaseModel):
    """Sentinel-1 RTC gamma0 backscatter over the lot (dB) and the Radar Vegetation Index."""

    date: date
    vv_db: float
    vh_db: float
    ratio_db: float = Field(description="VH - VV (dB); drops as the canopy dries")
    rvi: float = Field(description="Radar Vegetation Index 4*VH/(VV+VH), 0..1 biomass proxy")
    dry_soil: bool = Field(description="VV under the dry-soil threshold")
    scene_id: str | None = None
    source: Literal["sentinel-1", "mock"]


class SarSummary(BaseModel):
    observations: list[SarObservation] = []
    latest_vv_db: float | None = None
    latest_rvi: float | None = None
    soil_dry_days: int = Field(0, description="Consecutive days up to the latest scene with dry-soil backscatter")
    prioritized: bool = Field(False, description="True when Sentinel-2 was too cloudy and radar drives the soil-moisture reading")
    source: Literal["sentinel-1", "mock", "none"] = "none"
    errors: list[str] = []


class WeatherDay(BaseModel):
    date: date
    precipitation_mm: float | None
    temp_mean_c: float | None
    temp_max_c: float | None
    temp_min_c: float | None = None
    rh_mean_pct: float | None = None
    wind_2m_ms: float | None = None
    radiation_mj_m2: float | None = None
    et0_mm: float | None = Field(None, description="FAO-56 Penman-Monteith computed by this oracle")
    et0_ref_mm: float | None = Field(None, description="Open-Meteo's own ET0, kept to cross-check ours")
    kc: float | None = None
    etc_mm: float | None = None
    soil_depletion_mm: float | None = Field(None, description="Root-zone depletion Dr (FAO-56 eq. 85)")
    stress: bool | None = Field(None, description="Dr > RAW: crop under water stress")
    stage: str | None = None


class WeatherSummary(BaseModel):
    start_date: date
    end_date: date
    rain_mm: float
    et0_mm: float
    water_deficit_mm: float
    temp_mean_c: float | None
    heat_stress_days: int
    elevation_m: float | None = None
    et0_ref_mm: float | None = Field(None, description="Sum of Open-Meteo ET0 over the period, for comparison")
    solar_radiation_kwh_m2_day: float | None = Field(None, description="NASA POWER ALLSKY_SFC_SW_DWN mean")
    nasa_rain_mm: float | None = None
    nasa_temp_mean_c: float | None = None
    forecast_rain_7d_mm: float | None = None
    normal_rain_mm: float | None = Field(None, description="NASA POWER 2001-2025 climatology for the same calendar window")
    daily: list[WeatherDay] = []
    sources: list[str] = []
    errors: list[str] = []


class WaterBalance(BaseModel):
    """Season water balance: rain - ETc with a FAO-56 root-zone bucket. See docs/scoring.md."""

    crop: str
    crop_label: str
    sowing_date: date
    sowing_basis: str
    harvest_date: date
    stage_today: str
    flowering_start: date
    flowering_end: date
    season_start: date = Field(description="First day evaluated (sowing or start of the data window)")
    rain_mm: float
    et0_mm: float
    etc_mm: float
    balance_mm: float = Field(description="rain - ETc over the evaluated season")
    critical_dry_days: int = Field(description="Flowering days with root-zone depletion above RAW")
    flowering_days_observed: int
    max_dry_spell_days: int
    normal_rain_mm: float | None
    rain_vs_normal: float | None = Field(None, description="rain / climatological normal (1.0 = normal)")
    taw_mm: float
    raw_mm: float


class InsuranceEvaluation(BaseModel):
    """Parametric trigger evaluated off-chain with the same rule the vault applies on-chain."""

    riesgo_hidrico: RiskLevel
    riesgo_climatico: RiskLevel
    trigger_seguro: bool
    condiciones: dict[str, bool]
    motivos: list[str]
    umbrales: dict[str, float]
    metricas: dict[str, float | int | None]


class ScoreBreakdown(BaseModel):
    vigor_score: float
    ndwi_score: float | None
    water_score: float
    stress_score: float
    heat_score: float
    sar_score: float | None
    health: float
    weights: dict[str, float]


class AnalysisResult(BaseModel):
    ndvi: IndexObservation
    series: list[IndexObservation]
    sar: SarSummary
    weather: WeatherSummary
    water_balance: WaterBalance
    insurance: InsuranceEvaluation
    risk_score: int
    yield_index: float
    ndvi_drop: float = Field(description="Fall of the latest NDVI from the season peak, 0..1")
    satellite_priority: Literal["sentinel-2", "sentinel-1"]
    breakdown: ScoreBreakdown
    scenario: Scenario = "real"
    formula_version: str
    data_hash: str
    centroid: tuple[float, float]


class MetricRecord(BaseModel):
    lot_id: int
    timestamp: int
    ndvi: float
    ndwi: float | None = None
    risk_score: int
    yield_index: float
    water_balance_mm: float | None = None
    critical_dry_days: int | None = None
    rain_vs_normal: float | None = None
    ndvi_drop: float | None = None
    soil_dry_days: int | None = None
    trigger_seguro: bool | None = None
    source: str
    scenario: str
    data_hash: str
    tx_hash: str | None = None
    explorer_url: str | None = None


class LotMetricsResponse(BaseModel):
    lot_id: int
    history: list[MetricRecord]
    latest_analysis: dict[str, Any] | None = None


class PushResult(BaseModel):
    lot_id: int
    tx_hash: str
    explorer_url: str | None
    block_number: int
    metrics: MetricRecord
    analysis: AnalysisResult


class ScenarioRequest(BaseModel):
    scenario: Scenario
    push: bool = True


class LotInsuranceResponse(BaseModel):
    lot_id: int
    evaluacion: InsuranceEvaluation
    onchain: dict[str, Any] | None = Field(None, description="Vault view: pool, trigger, coverage, executed")
    analysis_timestamp: int | None = None
