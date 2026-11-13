import { Component, ElementRef, OnDestroy, afterNextRender, computed, effect, input, untracked, viewChild } from '@angular/core';
import type { Chart as ChartJs } from 'chart.js';
import type { DroughtPrediction } from '../core/models';

const COLORS: Record<string, string> = {
  lluvia: '#0284c7',
  temperatura: '#f97316',
  et0: '#eab308',
  ndvi: '#16a34a',
  ndwi: '#14b8a6',
  suelo: '#a16207',
  epoca: '#8b5cf6',
};

/** Doughnut with the XGBoost drought risk in the centre and the factors that drive it today. */
@Component({
  selector: 'app-risk-chart',
  template: `
    @if (prediction(); as p) {
      <div class="grid items-center gap-5 sm:grid-cols-[minmax(0,15rem)_1fr]">
        <div class="relative mx-auto aspect-square w-full max-w-60">
          <canvas #canvas aria-label="Factores del riesgo de sequía" role="img"></canvas>
          <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span class="text-[11px] uppercase tracking-wide text-stone-500">Riesgo {{ p.horizonte_dias }} días</span>
            <b class="text-3xl font-bold" [class]="levelClass()">{{ riskPct() }}%</b>
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" [class]="badgeClass()">{{ p.riesgo }}</span>
          </div>
        </div>
        <div class="text-sm">
          <p class="text-stone-700">
            El riesgo de sequía para los próximos {{ p.horizonte_dias }} días es del <b>{{ riskPct() }}%</b>.
            {{ p.factores[0]?.efecto === 'baja' ? 'Lo que más lo mantiene bajo hoy:' : 'Los factores que más influyen hoy son:' }}
          </p>
          <ul class="mt-3 space-y-1.5">
            @for (f of p.factores; track f.clave) {
              <li class="flex items-center gap-2">
                <span class="h-3 w-3 shrink-0 rounded-full" [style.background]="color(f.clave)"></span>
                <span class="flex-1 text-stone-700">{{ f.etiqueta }}</span>
                <b class="tabular-nums text-stone-900">{{ f.porcentaje.toFixed(0) }}%</b>
              </li>
            }
          </ul>
          <p class="mt-3 text-xs text-stone-500">
            Análisis actualizado: <b>{{ updated() }}</b>
            @if (p.analisis_fecha) { · datos al {{ p.analisis_fecha }} }
            · {{ p.modelo.version }}@if (p.modelo.metrics.auc) { (AUC {{ p.modelo.metrics.auc.toFixed(2) }}) }
          </p>
        </div>
      </div>
    }
  `,
})
export class RiskChart implements OnDestroy {
  readonly prediction = input<DroughtPrediction | null>(null);

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: ChartJs;
  private ChartCtor?: typeof ChartJs;

  protected readonly riskPct = computed(() => Math.round((this.prediction()?.probabilidad_sequia ?? 0) * 100));
  protected readonly levelClass = computed(() => ({ ALTO: 'text-red-600', MEDIO: 'text-amber-600', BAJO: 'text-emerald-700' })[this.prediction()?.riesgo ?? 'BAJO']);
  protected readonly badgeClass = computed(() => ({ ALTO: 'bg-red-100 text-red-700', MEDIO: 'bg-amber-100 text-amber-700', BAJO: 'bg-emerald-100 text-emerald-700' })[this.prediction()?.riesgo ?? 'BAJO']);
  protected readonly updated = computed(() => {
    const ts = this.prediction()?.timestamp;
    return ts ? new Date(ts).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  });

  constructor() {
    afterNextRender(async () => {
      const { Chart, registerables } = await import('chart.js');
      Chart.register(...registerables);
      this.ChartCtor = Chart;
      this.render();
    });
    effect(() => {
      this.prediction();
      this.canvas();
      untracked(() => this.render());
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  protected color(key: string): string {
    return COLORS[key] ?? '#78716c';
  }

  private render(): void {
    const p = this.prediction();
    const el = this.canvas()?.nativeElement;
    if (!this.ChartCtor || !p || !el) return;
    if (this.chart && this.chart.canvas !== el) {
      this.chart.destroy();
      this.chart = undefined;
    }
    const data = {
      labels: p.factores.map((f) => f.etiqueta),
      datasets: [{
        data: p.factores.map((f) => f.porcentaje),
        backgroundColor: p.factores.map((f) => this.color(f.clave)),
        borderColor: '#fff',
        borderWidth: 3,
        hoverOffset: 10,
      }],
    };
    if (this.chart) {
      this.chart.data = data;
      this.chart.update();
      return;
    }
    this.chart = new this.ChartCtor(el, {
      type: 'doughnut',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '68%',
        animation: { animateScale: true, animateRotate: true, duration: 900, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(28,25,23,0.92)',
            padding: 10,
            cornerRadius: 10,
            displayColors: true,
            boxPadding: 4,
            callbacks: { label: (c) => ` ${c.label}: ${Number(c.raw).toFixed(1)}% del riesgo` },
          },
        },
      },
    });
  }
}
