import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { parseEventLogs, parseUnits } from 'viem';
import { WalletService } from '../core/wallet.service';
import { LotsService } from '../core/lots.service';
import { ApiService, apiError } from '../core/api.service';
import { TxService } from '../core/tx.service';
import { USDC_DECIMALS } from '../core/config';
import type { AnalysisResult, PolygonGeometry } from '../core/models';
import { pct, polygonAreaHa, riskLabel, shortDate } from '../core/format';
import { LotMap } from '../shared/lot-map';
import { LineChart, type ChartSeries } from '../shared/line-chart';
import { LotFactoryAbi } from '../web3/generated/abis';

const CROPS = ['Soja', 'Maíz', 'Poroto', 'Garbanzos', 'Lentejas', 'Chia','Quinoa','Caña de azúcar', 'Tabaco' ];
const ISO = (d: Date) => d.toISOString().slice(0, 10);

/** Example polygon: bean field near Rosario de la Frontera (Salta). */
const SAMPLE: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [[[-64.9745, -25.8102], [-64.9662, -25.8102], [-64.9662, -25.8171], [-64.9745, -25.8171], [-64.9745, -25.8102]]],
};

@Component({
  selector: 'app-producer',
  imports: [FormsModule, RouterLink, LotMap, LineChart],
  template: `
    <h1 class="text-3xl font-bold text-stone-900">Registrar lote</h1>
    <p class="mb-6 text-stone-600">Dibujá el lote, analizalo con datos satelitales reales y publicá la campaña on-chain.</p>

    <div class="grid gap-6 lg:grid-cols-5">
      <div class="space-y-4 lg:col-span-3">
        <app-lot-map [geometry]="geometry()" [editable]="true" height="26rem" (geometryChange)="onGeometry($event)" />
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <button class="btn-ghost" (click)="useSample()">Usar lote de ejemplo (Rosario de la Frontera)</button>
          @if (geometry()) { <span class="chip">Superficie ≈ {{ areaHa().toFixed(1) }} ha</span> }
        </div>

        <section class="card">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="card-title">1 · Análisis satelital, radar y balance hídrico</h2>
            <button class="btn-primary" (click)="analyze()" [disabled]="!geometry() || analyzing()">
              {{ analyzing() ? 'Analizando Sentinel‑2 / Sentinel‑1…' : 'Analizar lote' }}
            </button>
          </div>
          <div class="mb-3 grid grid-cols-2 gap-3 text-sm">
            <div><label class="label" for="sowing">Fecha de siembra (para Kc / floración)</label><input id="sowing" name="sowing" type="date" class="input" [(ngModel)]="f.sowingDate" /></div>
            <p class="self-end text-xs text-stone-500">Cultivo: <b>{{ f.crop }}</b> (curva Kc FAO‑56). Si no cargás siembra, el oráculo asume floración hoy.</p>
          </div>
          @if (analysisError()) { <div class="alert-error">{{ analysisError() }}</div> }
          @if (analysis(); as a) {
            <div class="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div class="mini"><p>NDVI medio</p><b>{{ a.ndvi.mean.toFixed(3) }}</b><span class="text-[11px] text-stone-400">EVI {{ a.ndvi.evi?.toFixed(2) ?? '—' }} · LAI {{ a.ndvi.lai?.toFixed(1) ?? '—' }}</span></div>
              <div class="mini"><p>NDWI (agua en hoja)</p><b [class.text-red-700]="(a.ndvi.ndwi ?? 1) < a.insurance.umbrales['ndwi']">{{ a.ndvi.ndwi?.toFixed(3) ?? '—' }}</b><span class="text-[11px] text-stone-400">umbral {{ a.insurance.umbrales['ndwi'] }}</span></div>
              <div class="mini"><p>Riesgo</p><b><span class="rounded px-1.5" [class]="risk().cls">{{ risk().label }}</span></b></div>
              <div class="mini"><p>Índice rendimiento</p><b>{{ a.yield_index.toFixed(3) }}</b></div>
              <div class="mini"><p>Lluvia vs ETc ({{ a.water_balance.crop_label }})</p><b [class.text-red-700]="a.water_balance.balance_mm < 0">{{ a.water_balance.rain_mm.toFixed(0) }} / {{ a.water_balance.etc_mm.toFixed(0) }} mm</b><span class="text-[11px] text-stone-400">ET0 Penman‑Monteith {{ a.water_balance.et0_mm.toFixed(0) }} mm</span></div>
              <div class="mini"><p>Días críticos floración</p><b>{{ a.water_balance.critical_dry_days }}</b><span class="text-[11px] text-stone-400">lluvia {{ a.water_balance.rain_vs_normal !== null ? (a.water_balance.rain_vs_normal * 100).toFixed(0) + '% del histórico' : '—' }}</span></div>
              <div class="mini"><p>Radar Sentinel‑1</p><b>VV {{ a.sar.latest_vv_db?.toFixed(1) ?? '—' }} dB</b><span class="text-[11px] text-stone-400">RVI {{ a.sar.latest_rvi?.toFixed(2) ?? '—' }} · suelo seco {{ a.sar.soil_dry_days }} d{{ a.sar.prioritized ? ' · prioritario' : '' }}</span></div>
              <div class="mini"><p>Seguro paramétrico</p><b [class.text-red-700]="a.insurance.trigger_seguro">{{ a.insurance.trigger_seguro ? 'TRIGGER' : 'sin trigger' }}</b><span class="text-[11px] text-stone-400">hídrico {{ a.insurance.riesgo_hidrico }} · climático {{ a.insurance.riesgo_climatico }}</span></div>
            </div>
            <p class="mb-3 text-xs">
              <span class="chip" [class.!bg-amber-100]="a.ndvi.source === 'mock'">
                {{ a.ndvi.source === 'mock' ? 'Sentinel‑2 mock (fallback: no se pudo leer el raster)' : 'Sentinel‑2 L2A · ' + a.ndvi.date + (a.ndvi.cloud_cover != null ? ' · nubes ' + a.ndvi.cloud_cover.toFixed(0) + '%' : '') }}
              </span>
              <span class="chip" [class.!bg-amber-100]="a.sar.source === 'mock'">{{ a.sar.source === 'mock' ? 'Sentinel‑1 mock' : 'Sentinel‑1 RTC · ' + a.sar.observations.length + ' escenas' }}</span>
              <span class="chip">{{ a.formula_version }}</span>
            </p>
            <p class="mb-3 text-xs text-stone-600">{{ a.insurance.motivos.join(' · ') }}</p>
            <app-line-chart [labels]="chart().labels" [series]="chart().series" [yMin]="-0.5" [yMax]="1" height="12rem" />
          } @else if (!analyzing()) {
            <p class="text-sm text-stone-500">El backend elige la mejor escena Sentinel‑2 de cada semana y calcula NDVI, EVI, NDWI y LAI sobre el polígono; lee retrodispersión VV/VH de Sentinel‑1 (radar, atraviesa nubes); y arma el balance hídrico con ET0 Penman‑Monteith × Kc del cultivo, lluvia real e histórico.</p>
          }
        </section>
      </div>

      <form class="card space-y-3 lg:col-span-2" (ngSubmit)="create()">
        <h2 class="card-title">2 · Datos de la campaña</h2>
        <div><label class="label" for="name">Nombre del lote</label><input id="name" name="name" class="input" [(ngModel)]="f.name" required /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="symbol">Símbolo token</label><input id="symbol" name="symbol" class="input uppercase" maxlength="8" [(ngModel)]="f.symbol" required /></div>
          <div>
            <label class="label" for="crop">Cultivo</label>
            <select id="crop" name="crop" class="input" [(ngModel)]="f.crop">@for (c of crops; track c) { <option [value]="c">{{ c }}</option> }</select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="ha">Hectáreas</label><input id="ha" name="ha" type="number" step="0.01" min="0.01" class="input" [(ngModel)]="f.hectares" /></div>
          <div><label class="label" for="apy">APY objetivo (%)</label><input id="apy" name="apy" type="number" step="0.5" min="0.5" max="100" class="input" [(ngModel)]="f.apy" /></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="goal">Meta (USDC)</label><input id="goal" name="goal" type="number" step="10" min="10" class="input" [(ngModel)]="f.goal" /></div>
          <div><label class="label" for="price">Precio token (USDC)</label><input id="price" name="price" type="number" step="1" min="10" class="input" [(ngModel)]="f.price" /></div>
        </div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="demo" [(ngModel)]="f.demoTimes" /> Plazos cortos para demo (minutos)</label>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="dl">Cierre en ({{ f.demoTimes ? 'min' : 'días' }})</label><input id="dl" name="dl" type="number" min="1" class="input" [(ngModel)]="f.deadline" /></div>
          <div><label class="label" for="mat">Cosecha en ({{ f.demoTimes ? 'min' : 'días' }})</label><input id="mat" name="mat" type="number" min="2" class="input" [(ngModel)]="f.maturity" /></div>
        </div>
        <p class="text-xs text-stone-500">{{ tokensInfo() }}</p>
        @if (formError()) { <div class="alert-error">{{ formError() }}</div> }
        @if (!wallet.ready()) {
          <p class="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Conectá tu wallet en {{ wallet.chain.name }} para crear el lote.</p>
        }
        <button type="submit" class="btn-primary w-full" [disabled]="creating() || !geometry() || !wallet.ready()">
          {{ creating() ? 'Creando lote on-chain…' : 'Crear lote on-chain' }}
        </button>
        <p class="text-[11px] text-stone-400">
          El polígono se guarda en el contrato (GeoJSON + hash keccak256) y el oráculo lo usa para publicar NDVI y riesgo.
          ¿Ya tenés lotes? <a routerLink="/lots" class="underline">Ver mercado</a>
        </p>
      </form>
    </div>
  `,
})
export class Producer {
  protected readonly wallet = inject(WalletService);
  private readonly lots = inject(LotsService);
  private readonly api = inject(ApiService);
  private readonly tx = inject(TxService);
  private readonly router = inject(Router);

  protected readonly crops = CROPS;
  protected readonly geometry = signal<PolygonGeometry | null>(null);
  protected readonly analysis = signal<AnalysisResult | null>(null);
  protected readonly analyzing = signal(false);
  protected readonly analysisError = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected f = {
    name: 'Porotos La Candelaria',
    symbol: 'AGPOR',
    crop: 'Poroto',
    hectares: 0,
    apy: 18,
    goal: 5000,
    price: 50,
    demoTimes: true,
    deadline: 15,
    maturity: 30,
    sowingDate: ISO(new Date(Date.now() - 45 * 86_400_000)),
  };

  protected readonly areaHa = computed(() => {
    const g = this.geometry();
    return g ? polygonAreaHa(g.coordinates[0]) : 0;
  });
  protected readonly risk = computed(() => riskLabel(this.analysis()?.risk_score));
  protected readonly chart = computed(() => {
    const s = this.analysis()?.series ?? [];
    return {
      labels: s.map((o) => shortDate(Date.parse(o.date) / 1000)),
      series: [
        { label: 'NDVI', data: s.map((o) => o.mean), color: '#16a34a', fill: true },
        { label: 'EVI', data: s.map((o) => o.evi), color: '#65a30d' },
        { label: 'NDWI', data: s.map((o) => o.ndwi), color: '#0284c7' },
      ] as ChartSeries[],
    };
  });

  protected tokensInfo(): string {
    const n = this.f.goal / this.f.price;
    return Number.isInteger(n) ? `${n} tokens de ${this.f.price} USDC · retorno objetivo ${pct(this.f.apy / 100)} ajustado por NDVI/clima.` : 'La meta debe ser múltiplo del precio del token.';
  }

  protected onGeometry(g: PolygonGeometry | null): void {
    this.geometry.set(g);
    this.analysis.set(null);
    if (g) this.f.hectares = +polygonAreaHa(g.coordinates[0]).toFixed(2);
  }

  protected useSample(): void {
    this.onGeometry(SAMPLE);
  }

  protected async analyze(): Promise<void> {
    const g = this.geometry();
    if (!g) return;
    this.analyzing.set(true);
    this.analysisError.set(null);
    try {
      this.analysis.set(await this.api.analyze(g, { crop: this.f.crop, sowingDate: this.f.sowingDate || undefined }));
    } catch (e) {
      this.analysisError.set(apiError(e));
    } finally {
      this.analyzing.set(false);
    }
  }

  protected async create(): Promise<void> {
    const g = this.geometry();
    const d = this.wallet.deployment;
    if (!g || !d) return;
    this.formError.set(null);
    const f = this.f;
    if (f.goal % f.price !== 0) return this.formError.set('La meta debe ser múltiplo del precio del token.');
    if (f.price < 10) return this.formError.set('El precio mínimo por token es 10 USDC.');
    if (+f.maturity <= +f.deadline) return this.formError.set('La cosecha debe ser posterior al cierre de la campaña.');
    if (!f.hectares || f.hectares <= 0) return this.formError.set('Indicá las hectáreas.');
    this.creating.set(true);
    try {
      const now = await this.lots.refreshChainTime();
      const unit = f.demoTimes ? 60 : 86_400;
      const receipt = await this.wallet.write(`Crear lote "${f.name}"`, {
        address: d.contracts.LotFactory,
        abi: LotFactoryAbi,
        functionName: 'createLot',
        args: [
          {
            name: f.name.trim(),
            symbol: f.symbol.trim().toUpperCase(),
            crop: f.crop,
            hectaresX100: Math.round(f.hectares * 100),
            geoJson: JSON.stringify(g),
            fundingGoal: parseUnits(String(f.goal), USDC_DECIMALS),
            pricePerToken: parseUnits(String(f.price), USDC_DECIMALS),
            fundingDeadline: BigInt(now + Math.round(f.deadline * unit)),
            maturity: BigInt(now + Math.round(f.maturity * unit)),
            targetApyBps: Math.round(f.apy * 100),
          },
        ],
      });
      const [created] = parseEventLogs({ abi: LotFactoryAbi, logs: receipt.logs, eventName: 'LotCreated' });
      const lotId = Number(created.args.lotId);
      // Best effort: sowing date for the water balance, then a first oracle publication.
      const profile = f.sowingDate ? this.api.setProfile(lotId, { sowing_date: f.sowingDate }).catch(() => undefined) : Promise.resolve();
      profile.then(() => this.api.push(lotId)).then(
        (r) => this.tx.info(`Oráculo publicó NDVI ${r.metrics.ndvi.toFixed(2)} para lote #${lotId}`, r.tx_hash),
        () => undefined,
      );
      await this.router.navigate(['/lots', lotId]);
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.creating.set(false);
    }
  }
}
