import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LotsService } from '../core/lots.service';
import { errorMessage } from '../core/errors';
import type { LotView } from '../core/models';
import { LotCard } from '../shared/lot-card';

type Sort = 'return' | 'risk' | 'progress' | 'newest';

@Component({
  selector: 'app-marketplace',
  imports: [FormsModule, RouterLink, LotCard],
  template: `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold text-stone-900">Mercado de lotes</h1>
        <p class="text-stone-600">Campañas de financiamiento agrícola tokenizadas (simuladas) con métricas satelitales.</p>
      </div>
      <button class="btn-ghost" (click)="load()" [disabled]="loading()">↻ Actualizar</button>
    </div>

    <div class="mb-6 flex flex-wrap gap-3 rounded-2xl border border-stone-200 bg-white p-3">
      <select class="input !w-auto" [(ngModel)]="crop">
        <option value="">Todos los cultivos</option>
        @for (c of crops(); track c) { <option [value]="c">{{ c }}</option> }
      </select>
      <select class="input !w-auto" [(ngModel)]="status">
        <option value="">Todos los estados</option>
        <option value="Funding">En financiamiento</option>
        <option value="Funded">Financiados</option>
        <option value="Settled">Liquidados</option>
        <option value="Failed">Fallidos</option>
      </select>
      <select class="input !w-auto" [(ngModel)]="sort">
        <option value="newest">Más recientes</option>
        <option value="return">Mayor retorno estimado</option>
        <option value="risk">Menor riesgo</option>
        <option value="progress">Más financiados</option>
      </select>
    </div>

    @if (loading() && !lots().length) {
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">@for (i of [1, 2, 3, 4, 5, 6]; track i) { <div class="h-52 animate-pulse rounded-2xl bg-stone-200/70"></div> }</div>
    } @else if (error()) {
      <div class="alert-error">{{ error() }}</div>
    } @else if (!filtered().length) {
      <div class="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-stone-500">
        No hay lotes con esos filtros. <a routerLink="/producer" class="font-semibold text-emerald-700 underline">Registrar un lote</a>
      </div>
    } @else {
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        @for (l of filtered(); track l.id) { <app-lot-card [lot]="l" [now]="lotsSvc.chainNow()" /> }
      </div>
    }
  `,
})
export class Marketplace {
  protected readonly lotsSvc = inject(LotsService);
  protected readonly lots = signal<LotView[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly cropSig = signal('');
  private readonly statusSig = signal('');
  private readonly sortSig = signal<Sort>('newest');

  get crop(): string { return this.cropSig(); }
  set crop(v: string) { this.cropSig.set(v); }
  get status(): string { return this.statusSig(); }
  set status(v: string) { this.statusSig.set(v); }
  get sort(): Sort { return this.sortSig(); }
  set sort(v: Sort) { this.sortSig.set(v); }

  protected readonly crops = computed(() => [...new Set(this.lots().map((l) => l.crop))].sort());
  protected readonly filtered = computed(() => {
    const list = this.lots().filter((l) => (!this.cropSig() || l.crop === this.cropSig()) && (!this.statusSig() || l.status === this.statusSig()));
    const key: Record<Sort, (l: LotView) => number> = {
      newest: (l) => -l.id,
      return: (l) => -l.estimatedReturn,
      risk: (l) => l.metrics?.riskScore ?? 101,
      progress: (l) => -l.progress,
    };
    const f = key[this.sortSig()];
    return [...list].sort((a, b) => f(a) - f(b));
  });

  constructor() {
    afterNextRender(() => void this.load());
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.lots.set(await this.lotsSvc.loadAll());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
