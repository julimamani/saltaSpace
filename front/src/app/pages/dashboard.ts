import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LotsService } from '../core/lots.service';
import { ApiService, apiError } from '../core/api.service';
import { WalletService } from '../core/wallet.service';
import { errorMessage } from '../core/errors';
import type { DroughtFeatures, DroughtPrediction, HealthResponse, LotView } from '../core/models';
import { pct, usd } from '../core/format';
import { LotCard } from '../shared/lot-card';
import { RiskChart } from '../shared/risk-chart';

type Audience = 'inversor' | 'productor';
type Scenario = 'drought' | 'normal' | 'excellent';

const DEMO_FEATURES: DroughtFeatures = {
  precipitacion_7d_acumulada: 0,
  precipitacion_15d_acumulada: 4,
  temp_max_promedio: 34,
  radiacion_solar: 25,
  ET0_fao: 6.2,
  NDVI_actual: 0.42,
  NDWI_actual: -0.05,
  radar_soil_moisture: 0.08,
  dia_del_anio: 45,
  etapa_floracion: true,
};

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, LotCard, RiskChart],
  template: `
    <section class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-900 via-emerald-800 to-lime-700 px-6 py-12 text-white sm:px-10">
      <div class="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-lime-400/20 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-emerald-300/10 blur-3xl"></div>
      <p class="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
        <span class="h-2 w-2 animate-pulse rounded-full bg-lime-300"></span> Avalanche · RWA agro · datos satelitales en vivo
      </p>
      <h1 class="max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">Financiá cosechas del norte argentino con datos satelitales reales</h1>
      <p class="mt-4 max-w-2xl text-emerald-50/90">
        <b>Para el productor:</b> financiamiento ágil sin bancos antes de la siembra. <br>
        <b>Para el inversor:</b> acceso a rendimientos agrícolas (RWA) en USDC, respaldados por tecnología espacial. <br>
        Nuestra plataforma elimina la incertidumbre cruzando oráculos satelitales (Sentinel 1 y 2) con el balance hídrico de NASA POWER.
        Los contratos inteligentes liquidan tus ganancias automáticamente y cuentan con un <b>seguro paramétrico embebido</b> que ejecuta pagos
        inmediatos ante sequías. Confianza matemática, sin intermediarios ni peritos.
      </p>
      <div class="mt-6 flex flex-wrap gap-3">
        <a routerLink="/lots" class="rounded-xl bg-white px-5 py-3 font-semibold text-emerald-900 shadow transition hover:-translate-y-0.5 hover:bg-lime-50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-lime-300">Quiero invertir →</a>
        <a routerLink="/producer" class="rounded-xl border border-white/40 px-5 py-3 font-semibold transition hover:-translate-y-0.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40">Soy productor: financiar mi lote</a>
      </div>
      <ul class="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-emerald-50/80">
        @for (b of badges; track b) { <li class="flex items-center gap-2"><span class="text-lime-300">✓</span>{{ b }}</li> }
      </ul>
    </section>

    <section class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="stat transition hover:-translate-y-0.5 hover:shadow-md"><p class="stat-label">Total financiado</p><p class="stat-value">{{ usd(totalRaised(), 0) }} <span class="text-base font-medium text-stone-500">USDC</span></p></div>
      <div class="stat transition hover:-translate-y-0.5 hover:shadow-md"><p class="stat-label">Lotes activos</p><p class="stat-value">{{ activeCount() }} <span class="text-base font-medium text-stone-500">/ {{ lots().length }}</span></p></div>
      <div class="stat transition hover:-translate-y-0.5 hover:shadow-md"><p class="stat-label">Retorno estimado promedio</p><p class="stat-value text-emerald-700">{{ pct(avgReturn()) }}</p></div>
      <div class="stat transition hover:-translate-y-0.5 hover:shadow-md"><p class="stat-label">Hectáreas tokenizadas</p><p class="stat-value">{{ totalHa().toLocaleString('es-AR') }} <span class="text-base font-medium text-stone-500">ha</span></p></div>
    </section>
    <section class="mt-4 grid gap-4 sm:grid-cols-2">
      <div class="stat"><p class="stat-label">Pool de seguro paramétrico</p><p class="stat-value">{{ pool() !== null ? usd(pool()!, 0) : '—' }} <span class="text-base font-medium text-stone-500">USDC</span></p><p class="text-xs text-stone-500">3% de cada capital liberado + aportes. Paga cobertura automática cuando el oráculo marca sequía.</p></div>
      <div class="stat"><p class="stat-label">Lotes con trigger de seguro</p><p class="stat-value" [class.text-red-700]="triggered() > 0">{{ triggered() }}</p><p class="text-xs text-stone-500">NDWI bajo + lluvia &lt; 50% del histórico o días críticos secos en floración; caída de NDVI; suelo seco en radar.</p></div>
    </section>

    <section class="mt-4 flex flex-wrap gap-2 text-xs">
      <span class="chip">Red: {{ wallet.chain.name }}</span>
      @if (health(); as h) {
        <span class="chip" [class.!bg-emerald-100]="h.chain.connected">Backend/oráculo: {{ h.chain.connected ? 'conectado' : 'sin cadena' }}</span>
        @if (h.simulate_drought) { <span class="chip !bg-amber-100">SIMULATE_DROUGHT activo</span> }
      } @else if (healthError()) {
        <span class="chip !bg-red-100">Backend no disponible</span>
      }
    </section>

    <section class="mt-12 grid gap-6 lg:grid-cols-5">
      <div class="card lg:col-span-3">
        <div role="tablist" aria-label="Perfil" class="mb-5 inline-flex rounded-xl bg-stone-100 p-1">
          @for (a of audiences; track a.id) {
            <button role="tab" type="button" [attr.aria-selected]="audience() === a.id" (click)="audience.set(a.id)"
              class="rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              [class]="audience() === a.id ? 'bg-white text-emerald-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'">{{ a.label }}</button>
          }
        </div>
        @for (a of audiences; track a.id) {
          @if (audience() === a.id) {
            <div role="tabpanel">
              <h2 class="text-2xl font-bold text-stone-900">{{ a.title }}</h2>
              <ul class="mt-4 grid gap-3 sm:grid-cols-2">
                @for (b of a.benefits; track b.t) {
                  <li class="rounded-xl border border-stone-200 p-4 transition hover:border-emerald-300 hover:bg-emerald-50/40">
                    <p class="font-semibold text-stone-900"><span class="mr-1">{{ b.icon }}</span>{{ b.t }}</p>
                    <p class="mt-1 text-sm text-stone-600">{{ b.d }}</p>
                  </li>
                }
              </ul>
              <a [routerLink]="a.ctaLink" class="btn-primary mt-5">{{ a.cta }}</a>
            </div>
          }
        }
      </div>

      <div class="card lg:col-span-2">
        <h2 class="card-title">Simulá tu inversión</h2>
        <p class="mt-1 text-sm text-stone-500">Mové el monto y elegí cómo viene la campaña.</p>
        <label class="label mt-4" for="sim-amount">Monto a invertir: <b class="text-emerald-800">{{ usd(amount(), 0) }} USDC</b></label>
        <input id="sim-amount" type="range" min="100" max="10000" step="100" class="w-full accent-emerald-700"
          [value]="amount()" (input)="amount.set(+$any($event.target).value)" />
        <div class="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Escenario de campaña">
          @for (sc of scenarios; track sc.id) {
            <button type="button" role="radio" [attr.aria-checked]="scenario() === sc.id" (click)="scenario.set(sc.id)"
              class="rounded-xl border px-2 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              [class]="scenario() === sc.id ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-stone-200 text-stone-600 hover:border-stone-300'">
              <span class="block text-lg">{{ sc.icon }}</span>{{ sc.label }}
            </button>
          }
        </div>
        <div class="mt-5 rounded-2xl bg-gradient-to-br from-emerald-50 to-lime-50 p-4" aria-live="polite">
          <p class="text-xs font-medium uppercase tracking-wide text-stone-500">Cobrás al cosechar</p>
          <p class="text-3xl font-bold text-emerald-800">{{ usd(simPayout(), 0) }} <span class="text-base font-medium text-stone-500">USDC</span></p>
          <p class="mt-1 text-sm" [class.text-emerald-700]="simPayout() >= amount()" [class.text-red-700]="simPayout() < amount()">
            {{ simPayout() >= amount() ? '+' : '' }}{{ usd(simPayout() - amount(), 0) }} USDC · multiplicador ×{{ simMultiplier().toFixed(2) }}
          </p>
          @if (scenario() === 'drought') {
            <p class="mt-2 text-xs text-stone-600">Incluye la cobertura del seguro paramétrico, pagada desde el pool sin perito.</p>
          }
        </div>
        <p class="mt-3 text-[11px] text-stone-400">Ilustrativo, con APY objetivo de {{ pct(simApy(), 0) }} y piso/techo 0,8×–1,3×. No es una promesa de rendimiento.</p>
      </div>
    </section>

    <section class="mt-10">
      <div class="mb-4 flex items-end justify-between">
        <h2 class="text-2xl font-bold text-stone-900">Lotes destacados</h2>
        <a routerLink="/lots" class="text-sm font-semibold text-emerald-700 hover:underline">Ver todos →</a>
      </div>
      @if (loading()) {
        <div class="grid gap-4 md:grid-cols-3">@for (i of [1, 2, 3]; track i) { <div class="h-52 animate-pulse rounded-2xl bg-stone-200/70"></div> }</div>
      } @else if (error()) {
        <div class="alert-error">{{ error() }}</div>
      } @else if (!lots().length) {
        <div class="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-stone-500">
          Todavía no hay lotes. <a routerLink="/producer" class="font-semibold text-emerald-700 underline">Registrá el primero</a>.
        </div>
      } @else {
        <div class="grid gap-4 md:grid-cols-3">
          @for (l of lots().slice(0, 3); track l.id) { <app-lot-card [lot]="l" [now]="lotsSvc.chainNow()" /> }
        </div>
      }
    </section>

    <section class="mt-10 card" aria-labelledby="pred-title">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-emerald-700">De reactivo a predictivo · XGBoost</p>
          <h2 id="pred-title" class="text-2xl font-bold text-stone-900">Riesgo de sequía en los próximos 15 días</h2>
          <p class="mt-1 max-w-2xl text-sm text-stone-600">Un modelo de gradient boosting lee la lluvia, la temperatura, el ET0 Penman‑Monteith, el NDVI/NDWI de Sentinel‑2 y la humedad de suelo del radar Sentinel‑1, y anticipa el estrés hídrico antes de que ocurra.</p>
        </div>
        <label class="text-sm text-stone-600">
          <span class="mr-2">Lote</span>
          <select class="input w-auto" [value]="predLot()" (change)="selectPredLot($any($event.target).value)" aria-label="Lote para la predicción">
            @for (l of lots(); track l.id) { <option [value]="l.id">#{{ l.id }} · {{ l.name }}</option> }
            <option value="demo">Ejemplo: lote en floración sin lluvia</option>
          </select>
        </label>
      </div>
      @if (predLoading()) {
        <div class="h-60 animate-pulse rounded-2xl bg-stone-100"></div>
      } @else if (predError()) {
        <div class="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
          {{ predError() }}
          <button type="button" class="ml-2 font-semibold text-emerald-700 underline" (click)="selectPredLot('demo')">Ver el ejemplo</button>
        </div>
      } @else {
        <app-risk-chart [prediction]="prediction()" />
      }
      <p class="mt-4 text-[11px] text-stone-400">Predicción orientativa de un modelo educativo entrenado con datos simulados: no modifica el seguro paramétrico on-chain ni es una promesa de rendimiento.</p>
    </section>

    <section class="mt-12">
      <h2 class="mb-4 text-2xl font-bold text-stone-900">Cómo funciona</h2>
      <ol class="grid gap-4 md:grid-cols-4">
        @for (s of steps; track s.t; let i = $index) {
          <li>
            <button type="button" (click)="step.set(i)" [attr.aria-expanded]="step() === i"
              class="h-full w-full rounded-2xl border bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              [class]="step() === i ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-stone-200'">
              <span class="mb-2 grid h-8 w-8 place-items-center rounded-full font-bold"
                [class]="step() === i ? 'bg-emerald-700 text-white' : 'bg-lime-100 text-emerald-800'">{{ i + 1 }}</span>
              <p class="font-semibold">{{ s.t }}</p>
              <p class="mt-1 text-sm text-stone-600">{{ s.d }}</p>
            </button>
          </li>
        }
      </ol>
      <div class="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 text-sm text-emerald-900" aria-live="polite">
        <b>Paso {{ step() + 1 }} · {{ steps[step()].t }}:</b> {{ steps[step()].more }}
      </div>
    </section>
  `,
})
export class Dashboard {
  protected readonly lotsSvc = inject(LotsService);
  protected readonly wallet = inject(WalletService);
  private readonly api = inject(ApiService);
  protected readonly lots = signal<LotView[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly health = signal<HealthResponse | null>(null);
  protected readonly healthError = signal(false);
  protected readonly pool = signal<number | null>(null);
  protected readonly triggered = computed(() => this.lots().filter((l) => l.insurance.triggered && l.status === 'Funded').length);
  protected readonly usd = usd;
  protected readonly pct = pct;

  protected readonly totalRaised = computed(() => this.lots().reduce((a, l) => a + l.raised, 0));
  protected readonly totalHa = computed(() => this.lots().reduce((a, l) => a + l.hectares, 0));
  protected readonly activeCount = computed(() => this.lots().filter((l) => l.status === 'Funding' || l.status === 'Funded').length);
  protected readonly avgReturn = computed(() => {
    const l = this.lots();
    return l.length ? l.reduce((a, x) => a + x.estimatedReturn, 0) / l.length : null;
  });

  protected readonly badges = ['Pagos en USDC', 'Liquidación automática on-chain', 'Seguro paramétrico embebido', 'Datos Sentinel‑1/2 + NASA POWER'];

  protected readonly audiences: { id: Audience; label: string; title: string; cta: string; ctaLink: string; benefits: { icon: string; t: string; d: string }[] }[] = [
    {
      id: 'inversor', label: 'Soy inversor', title: 'Rendimientos agrícolas reales, en dólares digitales', cta: 'Explorar lotes', ctaLink: '/lots',
      benefits: [
        { icon: '💵', t: 'Invertí desde poco', d: 'Comprá fracciones de un lote con USDC; cada token es una parte de la campaña.' },
        { icon: '🛰️', t: 'Transparencia satelital', d: 'Seguí el vigor y el agua del cultivo con Sentinel‑1 y 2, semana a semana.' },
        { icon: '🛡️', t: 'Protección ante sequía', d: 'Si los datos marcan sequía, el seguro paga solo desde el pool de cobertura.' },
        { icon: '⚡', t: 'Cobro automático', d: 'Al cosechar, el contrato liquida y cobrás con un clic, sin trámites.' },
      ],
    },
    {
      id: 'productor', label: 'Soy productor', title: 'Capital antes de sembrar, sin bancos', cta: 'Registrar mi lote', ctaLink: '/producer',
      benefits: [
        { icon: '🗺️', t: 'Registrá tu lote en minutos', d: 'Dibujá el polígono y obtené al instante el diagnóstico satelital y climático.' },
        { icon: '🌱', t: 'Fondos para la campaña', d: 'Al llegar a la meta recibís el capital directo en tu wallet.' },
        { icon: '📉', t: 'Riesgo compartido', d: 'En un mal año el seguro cubre parte del pago a los inversores.' },
        { icon: '🌎', t: 'Inversores globales', d: 'Tu cosecha accede a capital de todo el mundo a través de Avalanche.' },
      ],
    },
  ];

  protected readonly scenarios: { id: Scenario; label: string; icon: string }[] = [
    { id: 'drought', label: 'Sequía', icon: '🌵' },
    { id: 'normal', label: 'Normal', icon: '🌾' },
    { id: 'excellent', label: 'Excelente', icon: '🌧️' },
  ];

  protected readonly steps = [
    { t: 'Registro del lote', d: 'El productor dibuja el polígono y el lote se crea on-chain.', more: 'El backend analiza NDVI, EVI, NDWI y el balance hídrico reales del polígono antes de publicar la campaña.' },
    { t: 'Inversión fraccionada', d: 'Los inversores compran tokens ERC‑20 del lote con USDC.', more: 'Cada token representa una fracción de la campaña; el precio y la meta quedan fijados en el contrato.' },
    { t: 'Financiamiento', d: 'Al alcanzar la meta, el productor recibe el capital.', more: 'El 3% del capital va al pool de seguro paramétrico; el resto llega al productor antes de la siembra.' },
    { t: 'Liquidación por datos', d: 'El contrato calcula el pago con datos del oráculo.', more: 'El oráculo publica NDVI/NDWI, balance hídrico y radar; si hay sequía, el seguro paga automáticamente y luego cada inversor cobra quemando sus tokens.' },
  ];

  protected readonly predLot = signal<string>('demo');
  protected readonly prediction = signal<DroughtPrediction | null>(null);
  protected readonly predLoading = signal(true);
  protected readonly predError = signal<string | null>(null);

  protected readonly audience = signal<Audience>('inversor');
  protected readonly amount = signal(1000);
  protected readonly scenario = signal<Scenario>('normal');
  protected readonly step = signal(0);

  protected readonly simApy = computed(() => {
    const l = this.lots();
    return l.length ? l.reduce((a, x) => a + x.targetApy, 0) / l.length : 0.2;
  });
  protected readonly simMultiplier = computed(() => {
    const apy = this.simApy();
    const m = { drought: 1 + apy * 0.6 - 0.15 + 0.2, normal: 1 + apy, excellent: 1 + apy * 1.3 }[this.scenario()];
    return Math.min(1.3, Math.max(0.8, m));
  });
  protected readonly simPayout = computed(() => this.amount() * this.simMultiplier());

  constructor() {
    afterNextRender(() => {
      void this.load();
      this.api.health().then((h) => this.health.set(h), () => this.healthError.set(true));
    });
  }

  private async load(): Promise<void> {
    try {
      this.lots.set(await this.lotsSvc.loadAll());
      this.pool.set(await this.lotsSvc.insurancePool());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
    const active = this.lots().find((l) => l.status === 'Funded' || l.status === 'Funding') ?? this.lots()[0];
    void this.selectPredLot(active ? String(active.id) : 'demo');
  }

  protected async selectPredLot(id: string): Promise<void> {
    this.predLot.set(id);
    this.predLoading.set(true);
    this.predError.set(null);
    try {
      this.prediction.set(id === 'demo' ? await this.api.predictDrought(DEMO_FEATURES) : await this.api.prediction(Number(id)));
    } catch (e) {
      this.prediction.set(null);
      this.predError.set(`No hay predicción disponible para este lote: ${apiError(e)}`);
    } finally {
      this.predLoading.set(false);
    }
  }
}
