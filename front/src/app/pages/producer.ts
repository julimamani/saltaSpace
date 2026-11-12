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
import { parseLatLon, parseVertices, squareAround, type LatLon } from '../core/geo';
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
    <p class="mb-6 text-stone-600">Ubicá tu finca, analizala con datos satelitales reales y publicá la campaña on-chain.</p>

    <div class="grid gap-6 lg:grid-cols-5">
      <div class="space-y-4 lg:col-span-3">
        <section class="card space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="card-title">Ubicá la finca a tokenizar</h2>
            @if (geometry()) { <span class="chip !bg-emerald-100 !text-emerald-900">✓ Polígono listo · {{ areaHa().toFixed(1) }} ha</span> }
          </div>
          <div role="tablist" aria-label="Cómo definir el lote" class="inline-flex flex-wrap rounded-xl bg-stone-100 p-1">
            @for (m of modes; track m.id) {
              <button type="button" role="tab" [attr.aria-selected]="mode() === m.id" (click)="mode.set(m.id)"
                class="rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                [class]="mode() === m.id ? 'bg-white text-emerald-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'">{{ m.label }}</button>
            }
          </div>

          @switch (mode()) {
            @case ('draw') {
              <p class="text-xs text-stone-500">Hacé clic en el mapa sobre cada esquina del lote y después “Cerrar polígono”. Tip: buscá primero tu finca con “Ir a coordenada”.</p>
              <form class="flex flex-wrap items-end gap-2" (ngSubmit)="goTo()">
                <div class="min-w-56 flex-1">
                  <label class="label" for="goto">Ir a coordenada (latitud, longitud)</label>
                  <input id="goto" name="goto" class="input" placeholder="-25.8136, -64.9703" [(ngModel)]="coords.point" />
                </div>
                <button type="submit" class="btn-ghost">Ir</button>
              </form>
            }
            @case ('vertices') {
              <p class="text-xs text-stone-500">Pegá las esquinas del lote, una por línea, en el orden del perímetro. Acepta decimal (<code>-25.8102, -64.9745</code>) o grados (<code>25°48'36"S 64°58'28"O</code>), como las copiás de Google Maps o del GPS.</p>
              <textarea name="vertices" rows="5" class="input font-mono text-xs" [(ngModel)]="coords.vertices"
                placeholder="-25.8102, -64.9745&#10;-25.8102, -64.9662&#10;-25.8171, -64.9662&#10;-25.8171, -64.9745"></textarea>
              <button type="button" class="btn-primary" (click)="applyVertices()">Crear polígono con estas coordenadas</button>
            }
            @case ('center') {
              <p class="text-xs text-stone-500">¿Solo tenés la ubicación de la finca? Ingresá el punto central y la superficie: armamos un lote cuadrado que después podés ajustar dibujando.</p>
              <div class="grid gap-2 sm:grid-cols-3">
                <div class="sm:col-span-2"><label class="label" for="center">Punto central (latitud, longitud)</label><input id="center" name="center" class="input" placeholder="-25.8136, -64.9703" [(ngModel)]="coords.point" /></div>
                <div><label class="label" for="centerHa">Superficie (ha)</label><input id="centerHa" name="centerHa" type="number" min="1" step="1" class="input" [(ngModel)]="coords.hectares" /></div>
              </div>
              <button type="button" class="btn-primary" (click)="applyCenter()">Crear lote alrededor del punto</button>
            }
          }
          @if (coordError()) { <div class="alert-error">{{ coordError() }}</div> }
        </section>

        <app-lot-map [geometry]="geometry()" [focus]="focus()" [editable]="true" height="26rem" (geometryChange)="onGeometry($event)" />
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <button class="btn-ghost" (click)="useSample()">Usar lote de ejemplo (Rosario de la Frontera)</button>
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
          <div><label class="label" for="apy">APY objetivo (% anual)</label><input id="apy" name="apy" type="number" step="0.5" min="0.5" max="100" class="input" [(ngModel)]="f.apy" /></div>
          <div><label class="label" for="price">Precio token (USDC)</label><input id="price" name="price" type="number" step="1" min="10" class="input" [(ngModel)]="f.price" /></div>
        </div>
        <fieldset class="rounded-xl border border-stone-200 p-3">
          <legend class="px-1 text-xs font-semibold text-stone-600">Superficie a tokenizar</legend>
          <label class="label" for="ha">Cantidad de hectáreas (número, no porcentaje)</label>
          <div class="relative">
            <input id="ha" name="ha" type="number" step="0.01" min="0.01" class="input pr-12" [(ngModel)]="f.hectares" aria-describedby="ha-help" />
            <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-400">ha</span>
          </div>
          @if (areaHa() > 0) {
            <div class="mt-2 flex flex-wrap gap-1" role="group" aria-label="Porcentaje del polígono">
              @for (p of sharePresets; track p) {
                <button type="button" class="rounded-lg border px-2 py-1 text-xs font-semibold transition"
                  [class]="isShare(p) ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-stone-200 text-stone-600 hover:border-stone-300'"
                  (click)="setShare(p)">{{ p }}%</button>
              }
            </div>
            <p id="ha-help" class="mt-2 text-xs text-stone-500">
              El polígono mide <b>{{ areaHa().toFixed(1) }} ha</b>. Tokenizás <b>{{ f.hectares || 0 }} ha</b> =
              <b [class.text-red-700]="sharePct() > 100">{{ sharePct().toFixed(0) }}%</b> de la finca dibujada.
            </p>
          } @else {
            <p id="ha-help" class="mt-2 text-xs text-stone-500">Ubicá la finca primero: calculamos la superficie del polígono y la cargamos acá.</p>
          }
        </fieldset>
        <div><label class="label" for="goal">Meta de financiamiento (USDC)</label><input id="goal" name="goal" type="number" step="10" min="10" class="input" [(ngModel)]="f.goal" /></div>
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
  protected readonly mode = signal<'draw' | 'vertices' | 'center'>('draw');
  protected readonly focus = signal<LatLon | null>(null);
  protected readonly coordError = signal<string | null>(null);
  protected readonly modes = [
    { id: 'draw' as const, label: 'Dibujar en el mapa' },
    { id: 'vertices' as const, label: 'Coordenadas de las esquinas' },
    { id: 'center' as const, label: 'Punto central + hectáreas' },
  ];
  protected readonly sharePresets = [25, 50, 75, 100];
  protected coords = { point: '', vertices: '', hectares: 100 };

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

  protected sharePct(): number {
    const a = this.areaHa();
    return a > 0 ? ((this.f.hectares || 0) / a) * 100 : 0;
  }

  protected isShare(p: number): boolean {
    return Math.abs(this.sharePct() - p) < 0.5;
  }

  protected setShare(p: number): void {
    this.f.hectares = +((this.areaHa() * p) / 100).toFixed(2);
  }

  protected goTo(): void {
    const p = parseLatLon(this.coords.point);
    if (!p) return this.coordError.set('Coordenada inválida. Usá "latitud, longitud", p. ej. -25.8136, -64.9703.');
    this.coordError.set(null);
    this.focus.set(p);
  }

  protected applyVertices(): void {
    const r = parseVertices(this.coords.vertices);
    if ('error' in r) return this.coordError.set(r.error);
    this.coordError.set(null);
    this.focus.set(null);
    this.onGeometry(r.geometry);
  }

  protected applyCenter(): void {
    const p = parseLatLon(this.coords.point);
    if (!p) return this.coordError.set('Coordenada inválida. Usá "latitud, longitud", p. ej. -25.8136, -64.9703.');
    if (!(this.coords.hectares > 0) || this.coords.hectares > 100_000) return this.coordError.set('Indicá una superficie entre 1 y 100.000 ha.');
    this.coordError.set(null);
    this.focus.set(p);
    this.onGeometry(squareAround(p, this.coords.hectares));
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
    if (!f.hectares || f.hectares <= 0) return this.formError.set('Indicá la cantidad de hectáreas a tokenizar.');
    if (f.hectares > this.areaHa() * 1.01) return this.formError.set(`Las hectáreas (${f.hectares}) superan la superficie del polígono (${this.areaHa().toFixed(1)} ha).`);
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
