import { TestBed } from '@angular/core/testing';
import type { DroughtPrediction } from '../core/models';
import { RiskChart } from './risk-chart';

const PRED: DroughtPrediction = {
  probabilidad_sequia: 0.12,
  riesgo: 'BAJO',
  horizonte_dias: 15,
  factores: [
    { clave: 'lluvia', etiqueta: 'Lluvia (7 y 15 días)', porcentaje: 40, efecto: 'sube' },
    { clave: 'ndvi', etiqueta: 'Vigor del cultivo (NDVI)', porcentaje: 35, efecto: 'sube' },
    { clave: 'temperatura', etiqueta: 'Temperatura y radiación', porcentaje: 25, efecto: 'sube' },
  ],
  importancia_global: [],
  features: {},
  modelo: { version: 'xgb-sequia-v1', trained_at: '2026-11-12T00:00:00+00:00', dataset: 'mock', metrics: { auc: 0.93, accuracy: 0.9 } },
  timestamp: '2026-11-12T21:30:00+00:00',
  aviso: 'mock',
  lot_id: 1,
  fuente: 'ultimo_analisis_oraculo',
  analisis_fecha: '2026-11-12',
};

describe('RiskChart', () => {
  it('shows the total risk and the factors', () => {
    const f = TestBed.createComponent(RiskChart);
    f.componentRef.setInput('prediction', PRED);
    f.detectChanges();
    const text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('12%');
    expect(text).toContain('Lluvia (7 y 15 días)');
    expect(text).toContain('40%');
    expect(text).toContain('Análisis actualizado');
  });

  it('renders nothing without a prediction', () => {
    const f = TestBed.createComponent(RiskChart);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('canvas')).toBeNull();
  });
});
