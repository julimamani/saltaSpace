import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, untracked, viewChild } from '@angular/core';
import type { Chart as ChartJs } from 'chart.js';

export interface ChartSeries {
  label: string;
  data: (number | null)[];
  color: string;
  dashed?: boolean;
  fill?: boolean;
}

/** Small Chart.js line chart wrapper (lazy-loaded in the browser only). */
@Component({
  selector: 'app-line-chart',
  template: `<div class="relative" [style.height]="height()"><canvas #canvas></canvas></div>`,
})
export class LineChart implements OnDestroy {
  readonly labels = input<string[]>([]);
  readonly series = input<ChartSeries[]>([]);
  readonly yMin = input<number | undefined>(undefined);
  readonly yMax = input<number | undefined>(undefined);
  readonly height = input('16rem');
  readonly yFormat = input<(v: number) => string>((v) => String(v));

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: ChartJs;
  private ChartCtor?: typeof ChartJs;

  constructor() {
    afterNextRender(async () => {
      const { Chart, registerables } = await import('chart.js');
      Chart.register(...registerables);
      this.ChartCtor = Chart;
      this.render();
    });
    effect(() => {
      this.labels();
      this.series();
      untracked(() => this.render());
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private render(): void {
    if (!this.ChartCtor) return;
    const fmt = this.yFormat();
    const datasets = this.series().map((s) => ({
      label: s.label,
      data: s.data,
      borderColor: s.color,
      backgroundColor: s.color + '33',
      borderDash: s.dashed ? [6, 4] : [],
      fill: s.fill ?? false,
      tension: 0.3,
      pointRadius: 3,
      spanGaps: true,
    }));
    if (this.chart) {
      this.chart.data.labels = this.labels();
      this.chart.data.datasets = datasets;
      this.chart.update();
      return;
    }
    this.chart = new this.ChartCtor(this.canvas().nativeElement, {
      type: 'line',
      data: { labels: this.labels(), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
        scales: { y: { min: this.yMin(), max: this.yMax(), ticks: { callback: (v) => fmt(Number(v)) } } },
      },
    });
  }
}
