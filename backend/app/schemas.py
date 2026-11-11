"""Pydantic request/response models."""

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

Source = Literal["sentinel-2", "mock"]
Scenario = Literal["real", "drought", "excellent"]


class Geometry(BaseModel):
    """GeoJSON Polygon geometry (lon, lat)."""

    type: Literal["Polygon"]
    coordinates: list[list[list[float]]]


class AnalyzeRequest(BaseModel):
    geometry: Geometry
    start_date: date | None = None
    end_date: date | None = None


class NdviObservation(BaseModel):
    date: date
    mean: float
    min: float
    max: float
    scene_id: str | None = None
    cloud_cover: float | None = None
    valid_pixels: int | None = None
    source: Source


class WeatherDay(BaseModel):
    date: date
    precipitation_mm: float | None
    temp_mean_c: float | None
    temp_max_c: float | None
    et0_mm: float | None


class WeatherSummary(BaseModel):
    start_date: date
    end_date: date
    rain_mm: float
    et0_mm: float
    water_deficit_mm: float
    temp_mean_c: float | None
    heat_stress_days: int
    solar_radiation_kwh_m2_day: float | None = Field(None, description="NASA POWER ALLSKY_SFC_SW_DWN mean")
    nasa_rain_mm: float | None = None
    nasa_temp_mean_c: float | None = None
    forecast_rain_7d_mm: float | None = None
    daily: list[WeatherDay] = []
    sources: list[str] = []
    errors: list[str] = []


class ScoreBreakdown(BaseModel):
    ndvi_score: float
    water_score: float
    heat_score: float
    health: float
    weights: dict[str, float]


class AnalysisResult(BaseModel):
    ndvi: NdviObservation
    series: list[NdviObservation]
    weather: WeatherSummary
    risk_score: int
    yield_index: float
    breakdown: ScoreBreakdown
    scenario: Scenario = "real"
    formula_version: str
    data_hash: str
    centroid: tuple[float, float]


class MetricRecord(BaseModel):
    lot_id: int
    timestamp: int
    ndvi: float
    risk_score: int
    yield_index: float
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
