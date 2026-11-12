import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_URL } from './config';
import type { AnalysisResult, HealthResponse, LotInsuranceResponse, LotMetricsResponse, PolygonGeometry, PushResult, Scenario } from './models';

export interface AnalyzeOptions {
  startDate?: string;
  endDate?: string;
  crop?: string;
  sowingDate?: string;
  harvestDate?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly baseUrl = API_URL;

  health(): Promise<HealthResponse> {
    return firstValueFrom(this.http.get<HealthResponse>(`${API_URL}/health`));
  }

  analyze(geometry: PolygonGeometry, o: AnalyzeOptions = {}): Promise<AnalysisResult> {
    return firstValueFrom(
      this.http.post<AnalysisResult>(`${API_URL}/lots/analyze`, {
        geometry,
        start_date: o.startDate,
        end_date: o.endDate,
        crop: o.crop,
        sowing_date: o.sowingDate,
        harvest_date: o.harvestDate,
      }),
    );
  }

  insurance(lotId: number, refresh = false): Promise<LotInsuranceResponse> {
    return firstValueFrom(this.http.get<LotInsuranceResponse>(`${API_URL}/lots/${lotId}/seguro`, { params: { refresh } }));
  }

  setProfile(lotId: number, profile: { sowing_date?: string | null; notes?: string | null }): Promise<unknown> {
    return firstValueFrom(this.http.put(`${API_URL}/lots/${lotId}/profile`, profile));
  }

  metrics(lotId: number): Promise<LotMetricsResponse> {
    return firstValueFrom(this.http.get<LotMetricsResponse>(`${API_URL}/lots/${lotId}/metrics`));
  }

  push(lotId: number): Promise<PushResult> {
    return firstValueFrom(this.http.post<PushResult>(`${API_URL}/oracle/push/${lotId}`, {}));
  }

  getScenario(lotId: number): Promise<{ lot_id: number; scenario: Scenario; simulate_drought_env: boolean }> {
    return firstValueFrom(this.http.get<{ lot_id: number; scenario: Scenario; simulate_drought_env: boolean }>(`${API_URL}/demo/scenario/${lotId}`));
  }

  setScenario(lotId: number, scenario: Scenario, push = true): Promise<{ lot_id: number; scenario: Scenario; push?: PushResult }> {
    return firstValueFrom(
      this.http.post<{ lot_id: number; scenario: Scenario; push?: PushResult }>(`${API_URL}/demo/scenario/${lotId}`, { scenario, push }),
    );
  }
}

export function apiError(e: unknown): string {
  const err = e as { status?: number; error?: { detail?: unknown }; message?: string };
  if (err?.status === 0) return `No se pudo conectar con el backend (${API_URL}).`;
  const detail = err?.error?.detail;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return err?.message ?? String(e);
}
