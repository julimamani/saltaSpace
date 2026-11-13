import type { Address } from 'viem';

export type LotStatus = 'Funding' | 'Funded' | 'Failed' | 'Settled';
export const STATUS_NAMES: LotStatus[] = ['Funding', 'Funded', 'Failed', 'Settled'];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface OnchainMetrics {
  ndvi: number;
  ndwi: number;
  riskScore: number;
  yieldIndex: number;
  waterBalanceMm: number;
  criticalDryDays: number;
  rainVsNormal: number;
  ndviDrop: number;
  soilDryDays: number;
  timestamp: number;
  dataHash: string;
}

export interface LotInsuranceView {
  premium: number;
  coverage: number;
  executed: boolean;
  triggered: boolean;
  coverageAvailable: number;
}

export interface LotView {
  id: number;
  producer: Address;
  token: Address;
  name: string;
  crop: string;
  hectares: number;
  geometry: PolygonGeometry | null;
  geoHash: string;
  fundingGoal: number;
  pricePerToken: number;
  fundingDeadline: number;
  maturity: number;
  targetApy: number;
  status: LotStatus;
  fundsReleased: boolean;
  tokensSold: number;
  maxTokens: number;
  raised: number;
  repaid: number;
  payoutPerToken: number;
  metrics: OnchainMetrics | null;
  preview: { multiplier: number; payoutPerToken: number; drought: boolean };
  insurance: LotInsuranceView;
  requiredRepayment: number;
  progress: number;
  /** Expected investor return (multiplier - 1) with current oracle data, or target APY if none. */
  estimatedReturn: number;
}

export interface PayoutParams {
  criticalNdvi: number;
  criticalDryDays: number;
  droughtHaircut: number;
  minPayout: number;
  maxPayout: number;
}

export interface InsuranceParams {
  premium: number;
  coverage: number;
  rainTrigger: number;
  ndwiTrigger: number;
  dryDaysTrigger: number;
  ndviDropTrigger: number;
  soilDryDaysTrigger: number;
}

export interface LotEvent {
  name: string;
  blockNumber: bigint;
  txHash: string;
  timestamp?: number;
  args: Record<string, unknown>;
}

// ---- backend API -----------------------------------------------------------

export interface NdviObservation {
  date: string;
  mean: number;
  min: number;
  max: number;
  evi: number | null;
  ndwi: number | null;
  lai: number | null;
  scene_id?: string | null;
  cloud_cover?: number | null;
  valid_pixels?: number | null;
  week?: string | null;
  source: 'sentinel-2' | 'mock';
}

export interface SarObservation {
  date: string;
  vv_db: number;
  vh_db: number;
  ratio_db: number;
  rvi: number;
  dry_soil: boolean;
  scene_id?: string | null;
  source: 'sentinel-1' | 'mock';
}

export interface SarSummary {
  observations: SarObservation[];
  latest_vv_db: number | null;
  latest_rvi: number | null;
  soil_dry_days: number;
  prioritized: boolean;
  source: 'sentinel-1' | 'mock' | 'none';
  errors: string[];
}

export interface WeatherDay {
  date: string;
  precipitation_mm: number | null;
  temp_mean_c: number | null;
  temp_max_c: number | null;
  temp_min_c: number | null;
  rh_mean_pct: number | null;
  wind_2m_ms: number | null;
  radiation_mj_m2: number | null;
  et0_mm: number | null;
  et0_ref_mm: number | null;
  kc: number | null;
  etc_mm: number | null;
  soil_depletion_mm: number | null;
  stress: boolean | null;
  stage: string | null;
}

export interface WaterBalance {
  crop: string;
  crop_label: string;
  sowing_date: string;
  sowing_basis: string;
  harvest_date: string;
  stage_today: string;
  flowering_start: string;
  flowering_end: string;
  season_start: string;
  rain_mm: number;
  et0_mm: number;
  etc_mm: number;
  balance_mm: number;
  critical_dry_days: number;
  flowering_days_observed: number;
  max_dry_spell_days: number;
  normal_rain_mm: number | null;
  rain_vs_normal: number | null;
  taw_mm: number;
  raw_mm: number;
}

export type RiskLevel = 'BAJO' | 'MEDIO' | 'ALTO';

export interface InsuranceEvaluation {
  riesgo_hidrico: RiskLevel;
  riesgo_climatico: RiskLevel;
  trigger_seguro: boolean;
  condiciones: Record<string, boolean>;
  motivos: string[];
  umbrales: Record<string, number>;
  metricas: Record<string, number | null>;
}

export interface LotInsuranceResponse {
  lot_id: number;
  evaluacion: InsuranceEvaluation;
  onchain: Record<string, unknown> | null;
  analysis_timestamp: number | null;
}

export interface WeatherSummary {
  start_date: string;
  end_date: string;
  rain_mm: number;
  et0_mm: number;
  water_deficit_mm: number;
  temp_mean_c: number | null;
  heat_stress_days: number;
  solar_radiation_kwh_m2_day: number | null;
  nasa_rain_mm: number | null;
  nasa_temp_mean_c: number | null;
  forecast_rain_7d_mm: number | null;
  elevation_m: number | null;
  et0_ref_mm: number | null;
  normal_rain_mm: number | null;
  daily: WeatherDay[];
  sources: string[];
  errors: string[];
}

export interface AnalysisResult {
  ndvi: NdviObservation;
  series: NdviObservation[];
  sar: SarSummary;
  weather: WeatherSummary;
  water_balance: WaterBalance;
  insurance: InsuranceEvaluation;
  risk_score: number;
  yield_index: number;
  ndvi_drop: number;
  satellite_priority: 'sentinel-2' | 'sentinel-1';
  breakdown: {
    vigor_score: number;
    ndwi_score: number | null;
    water_score: number;
    stress_score: number;
    heat_score: number;
    sar_score: number | null;
    health: number;
    weights: Record<string, number>;
  };
  scenario: Scenario;
  formula_version: string;
  data_hash: string;
  centroid: [number, number];
}

export type Scenario = 'real' | 'drought' | 'excellent';

export interface MetricRecord {
  lot_id: number;
  timestamp: number;
  ndvi: number;
  ndwi: number | null;
  risk_score: number;
  yield_index: number;
  water_balance_mm: number | null;
  critical_dry_days: number | null;
  rain_vs_normal: number | null;
  ndvi_drop: number | null;
  soil_dry_days: number | null;
  trigger_seguro: boolean | null;
  source: string;
  scenario: string;
  data_hash: string;
  tx_hash: string | null;
  explorer_url: string | null;
}

export interface LotMetricsResponse {
  lot_id: number;
  history: MetricRecord[];
  latest_analysis: AnalysisResult | null;
}

export interface PushResult {
  lot_id: number;
  tx_hash: string;
  explorer_url: string | null;
  block_number: number;
  metrics: MetricRecord;
  analysis: AnalysisResult;
}

export interface HealthResponse {
  status: string;
  simulate_drought: boolean;
  force_mock_ndvi: boolean;
  chain: { connected: boolean; chain_id?: number; network?: string; oracle_configured?: boolean; error?: string };
}

export interface RiskFactor {
  clave: string;
  etiqueta: string;
  porcentaje: number;
  contribucion?: number | null;
  efecto?: 'sube' | 'baja' | null;
}

export interface DroughtFeatures {
  precipitacion_7d_acumulada: number;
  precipitacion_15d_acumulada: number;
  temp_max_promedio: number;
  radiacion_solar: number;
  ET0_fao: number;
  NDVI_actual: number;
  NDWI_actual: number;
  radar_soil_moisture: number;
  dia_del_anio: number;
  etapa_floracion: boolean;
}

export interface DroughtPrediction {
  probabilidad_sequia: number;
  riesgo: 'BAJO' | 'MEDIO' | 'ALTO';
  horizonte_dias: number;
  factores: RiskFactor[];
  importancia_global: RiskFactor[];
  features: Record<string, number>;
  modelo: { version: string; trained_at: string; dataset: string; metrics: { auc: number | null; accuracy: number } };
  timestamp: string;
  aviso: string;
  lot_id: number | null;
  fuente: string;
  analisis_fecha: string | null;
}
