import type { Address } from 'viem';

export type LotStatus = 'Funding' | 'Funded' | 'Failed' | 'Settled';
export const STATUS_NAMES: LotStatus[] = ['Funding', 'Funded', 'Failed', 'Settled'];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface OnchainMetrics {
  ndvi: number;
  riskScore: number;
  yieldIndex: number;
  timestamp: number;
  dataHash: string;
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
  requiredRepayment: number;
  progress: number;
  /** Expected investor return (multiplier - 1) with current oracle data, or target APY if none. */
  estimatedReturn: number;
}

export interface PayoutParams {
  criticalNdvi: number;
  droughtHaircut: number;
  minPayout: number;
  maxPayout: number;
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
  scene_id?: string | null;
  cloud_cover?: number | null;
  valid_pixels?: number | null;
  source: 'sentinel-2' | 'mock';
}

export interface WeatherDay {
  date: string;
  precipitation_mm: number | null;
  temp_mean_c: number | null;
  temp_max_c: number | null;
  et0_mm: number | null;
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
  daily: WeatherDay[];
  sources: string[];
  errors: string[];
}

export interface AnalysisResult {
  ndvi: NdviObservation;
  series: NdviObservation[];
  weather: WeatherSummary;
  risk_score: number;
  yield_index: number;
  breakdown: { ndvi_score: number; water_score: number; heat_score: number; health: number; weights: Record<string, number> };
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
  risk_score: number;
  yield_index: number;
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
