import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LotsService } from '../core/lots.service';
import { WalletService } from '../core/wallet.service';
import { ApiService, apiError } from '../core/api.service';
import { TxService } from '../core/tx.service';
import { IS_LOCAL_CHAIN } from '../core/config';
import { errorMessage } from '../core/errors';
import type { LotView, Scenario } from '../core/models';
import { dateTime, pct, usd } from '../core/format';
import { StatusBadge } from '../shared/status-badge';

@Component({
  selector: 'app-demo',
  imports: [FormsModule, RouterLink, StatusBadge],
  template: `
    <h1 class="text-3xl font-bold text-stone-900">Panel de demo</h1>
    <p class="mb-6 text-stone-600">Forzá escenarios climáticos y mirá cómo cambia el pago on-chain en vivo.</p>

    @if (error()) { <div class="alert-error mb-4">{{ error() }}</div> }

    <div class="grid gap-6 lg:grid-cols-3">
      <section class="card lg:col-span-1">
        <label class="label" for="lot">Lote</label>
        <select id="lot" class="input mb-4" [ngModel]="selectedId()" (ngModelChange)="select($event)">
          @for (l of lots(); track l.id) { <option [ngValue]="l.id">#{{ l.id }} · {{ l.name }}</option> }
        </select>
        @if (lot(); as l) {
          <div class="mb-3 flex items-center justify-between"><span class="text-sm text-stone-500">Estado</span><app-status-badge [lot]="l" [now]="lotsSvc.chainNow()" /></div>
          <dl class="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt class="text-stone-500">Escenario backend</dt><dd class="text-right font-semibold">{{ scenario() ?? '—' }}</dd>
            <dt class="text-stone-500">NDVI on-chain</dt><dd class="text-right font-medium">{{ l.metrics?.ndvi?.toFixed(3) ?? '—' }}</dd>
            <dt class="text-stone-500">Riesgo</dt><dd class="text-right font-medium">{{ l.metrics?.riskScore ?? '—' }}</dd>
            <dt class="text-stone-500">Yield index</dt><dd class="text-right font-medium">{{ l.metrics?.yieldIndex?.toFixed(3) ?? '—' }}</dd>
            <dt class="text-stone-500">Pago / token</dt><dd class="text-right font-semibold" [class.text-red-700]="l.preview.drought">{{ usd(l.preview.payoutPerToken) }} USDC</dd>
            <dt class="text-stone-500">Retorno inversor</dt><dd class="text-right font-semibold">{{ pct(l.estimatedReturn) }}</dd>
            <dt class="text-stone-500">Hora de la cadena</dt><dd class="text-right text-xs">{{ dateTime(lotsSvc.chainNow()) }}</dd>
          </dl>
          <a [routerLink]="['/lots', l.id]" class="mt-4 block text-center text-sm font-semibold text-emerald-700 hover:underline">Abrir detalle del lote →</a>
        }
      </section>

      <section class="card lg:col-span-2">
        <h2 class="card-title mb-3">1 · Escenario climático (oráculo)</h2>
        <div class="grid gap-3 sm:grid-cols-3">
          <button class="scenario border-red-200 bg-red-50 hover:bg-red-100" (click)="setScenario('drought')" [disabled]="!!busy()">
            <span class="text-2xl">🔥</span><b>Sequía</b><span>NDVI 0.22, déficit hídrico alto → penalización</span>
          </button>
          <button class="scenario border-emerald-200 bg-emerald-50 hover:bg-emerald-100" (click)="setScenario('excellent')" [disabled]="!!busy()">
            <span class="text-2xl">🌾</span><b>Cosecha excelente</b><span>NDVI 0.85, lluvias normales → techo de pago</span>
          </button>
          <button class="scenario border-sky-200 bg-sky-50 hover:bg-sky-100" (click)="setScenario('real')" [disabled]="!!busy()">
            <span class="text-2xl">🛰️</span><b>Datos reales</b><span>Sentinel‑2 + Open‑Meteo + NASA POWER</span>
          </button>
        </div>
        @if (busy() === 'scenario') { <p class="mt-3 text-sm text-stone-500">Analizando y publicando en la cadena…</p> }

        <h2 class="card-title mb-3 mt-6">2 · Ciclo de vida</h2>
        <div class="flex flex-wrap gap-2">
          @if (local) {
            <button class="btn-ghost" (click)="advance(3600)" [disabled]="!!busy()">⏩ +1 hora</button>
            <button class="btn-ghost" (click)="advance(86400 * 30)" [disabled]="!!busy()">⏩ +30 días</button>
            <button class="btn-ghost" (click)="toMaturity()" [disabled]="!!busy() || !lot()">⏩ Ir a la cosecha</button>
          }
          <a class="btn-ghost" [routerLink]="lot() ? ['/lots', lot()!.id] : ['/lots']">Invertir / liberar / repagar / liquidar en el detalle →</a>
        </div>
        @if (!local) {
          <p class="mt-2 text-xs text-stone-500">En Fuji no se puede adelantar el tiempo: creá el lote con "plazos cortos para demo" o liquidá con una cuenta con SETTLER_ROLE.</p>
        }

        <div class="mt-6 rounded-xl bg-stone-50 p-4 text-sm text-stone-600">
          <p class="mb-1 font-semibold text-stone-800">Guion sugerido</p>
          <ol class="list-decimal space-y-0.5 pl-5">
            <li>Faucet de USDC → invertir hasta completar la meta del lote.</li>
            <li>Liberar fondos al productor.</li>
            <li>Elegir “Sequía”: el pago por token cae por la penalización (NDVI &lt; 0.30).</li>
            <li>Elegir “Cosecha excelente”: el pago sube hasta el techo (1.3×).</li>
            <li>Depositar repago → liquidar → cobrar.</li>
          </ol>
        </div>
      </section>
    </div>
  `,
  styles: `
    .scenario { display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-start; text-align: left; border-width: 1px; border-radius: 1rem; padding: 1rem; font-size: 0.8rem; color: #44403c; }
    .scenario b { font-size: 1rem; color: #1c1917; }
    .scenario:disabled { opacity: 0.5; }
  `,
})
export class Demo {
  protected readonly lotsSvc = inject(LotsService);
  private readonly wallet = inject(WalletService);
  private readonly api = inject(ApiService);
  private readonly tx = inject(TxService);
  private readonly route = inject(ActivatedRoute);

  protected readonly local = IS_LOCAL_CHAIN;
  protected readonly lots = signal<LotView[]>([]);
  protected readonly selectedId = signal<number | null>(null);
  protected readonly scenario = signal<Scenario | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly lot = computed(() => this.lots().find((l) => l.id === this.selectedId()) ?? null);
  protected readonly usd = usd;
  protected readonly pct = pct;
  protected readonly dateTime = dateTime;

  constructor() {
    afterNextRender(async () => {
      await this.reload();
      const q = Number(this.route.snapshot.queryParamMap.get('lot'));
      const first = this.lots().find((l) => l.id === q) ?? this.lots()[0];
      if (first) this.select(first.id);
    });
  }

  protected select(id: number): void {
    this.selectedId.set(id);
    this.api.getScenario(id).then((s) => this.scenario.set(s.scenario), () => this.scenario.set(null));
  }

  private async reload(): Promise<void> {
    try {
      this.lots.set(await this.lotsSvc.loadAll());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected async setScenario(s: Scenario): Promise<void> {
    const id = this.selectedId();
    if (id === null) return;
    this.busy.set('scenario');
    this.error.set(null);
    try {
      const r = await this.api.setScenario(id, s);
      this.scenario.set(r.scenario);
      if (r.push) this.tx.info(`Oráculo: escenario "${s}" · NDVI ${r.push.metrics.ndvi.toFixed(2)}`, r.push.tx_hash);
      await this.reload();
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(null);
    }
  }

  protected async advance(seconds: number): Promise<void> {
    this.busy.set('time');
    try {
      await this.wallet.advanceTime(seconds);
      await this.reload();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  protected toMaturity(): Promise<void> {
    const l = this.lot();
    if (!l) return Promise.resolve();
    return this.advance(Math.max(1, l.maturity - this.lotsSvc.chainNow() + 1));
  }
}
