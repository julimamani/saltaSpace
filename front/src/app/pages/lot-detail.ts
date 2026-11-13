import { Component, OnDestroy, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { parseUnits } from 'viem';
import { LotsService } from '../core/lots.service';
import { WalletService } from '../core/wallet.service';
import { ApiService, apiError } from '../core/api.service';
import { errorMessage } from '../core/errors';
import { USDC_DECIMALS, addressUrl, txUrl } from '../core/config';
import type { DroughtPrediction, InsuranceParams, LotEvent, LotMetricsResponse, LotView, PayoutParams } from '../core/models';
import { dateTime, duration, pct, riskLabel, shortAddr, shortDate, usd } from '../core/format';
import { LotMap } from '../shared/lot-map';
import { LineChart, type ChartSeries } from '../shared/line-chart';
import { RiskChart } from '../shared/risk-chart';
import { StatusBadge } from '../shared/status-badge';
import { CampaignVaultAbi } from '../web3/generated/abis';

const EVENT_LABEL: Record<string, string> = {
  LotCreated: 'Lote creado',
  Invested: 'Inversión',
  GoalReachedEvent: 'Meta alcanzada',
  FundsReleased: 'Fondos liberados al productor',
  CampaignFailed: 'Campaña fallida',
  Refunded: 'Reembolso',
  RepaymentDeposited: 'Repago depositado',
  Settled: 'Liquidación',
  SurplusReturned: 'Excedente devuelto',
  Claimed: 'Cobro',
  MetricsUpdated: 'Oráculo: métricas',
  InsurancePremiumCollected: 'Seguro: prima al pool',
  InsurancePoolFunded: 'Seguro: aporte al pool',
  InsuranceExecuted: 'Seguro paramétrico ejecutado',
  InsuranceCoverageReturned: 'Seguro: cobertura no usada vuelve al pool',
};

const CONDITION_LABEL: Record<string, string> = {
    precipitacion_menor_etc: 'Lluvia < ETc (Penman‑Monteith × Kc)',
    ndwi_bajo_umbral: 'NDWI bajo el umbral (agua en hoja)',
    lluvia_bajo_50pct_historico: 'Lluvia < 50% del histórico',
    dias_criticos_floracion: 'Días críticos secos en floración',
    caida_drastica_ndvi: 'Caída drástica del NDVI',
    suelo_seco_prolongado_sar: 'Suelo seco prolongado (Sentinel‑1)',
};

type OnchainMetricsArgs = {
  ndvi: number;
  ndwi: number;
  riskScore: number;
  yieldIndexBps: number;
  waterBalanceMm: number;
  criticalDryDays: number;
  rainVsNormalBps: number;
  ndviDropBps: number;
  soilDryDays: number;
  timestamp: bigint;
};

@Component({
  selector: 'app-lot-detail',
  imports: [FormsModule, KeyValuePipe, RouterLink, LotMap, LineChart, RiskChart, StatusBadge],
  templateUrl: './lot-detail.html',
})
export class LotDetail implements OnDestroy {
  readonly id = input.required<string>();

  private readonly lotsSvc = inject(LotsService);
  protected readonly wallet = inject(WalletService);
  private readonly api = inject(ApiService);

  protected readonly lot = signal<LotView | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly metrics = signal<LotMetricsResponse | null>(null);
  protected readonly metricsError = signal<string | null>(null);
  protected readonly events = signal<LotEvent[]>([]);
  protected readonly eventsError = signal<string | null>(null);
  protected readonly params = signal<PayoutParams | null>(null);
  protected readonly insParams = signal<InsuranceParams | null>(null);
  protected readonly pool = signal<number | null>(null);
  protected readonly poolAmount = signal(100);
  protected readonly position = signal<{ tokens: number; usdcAllowance: number } | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly tokensToBuy = signal(1);

  protected readonly usd = usd;
  protected readonly pct = pct;
  protected readonly dateTime = dateTime;
  protected readonly duration = duration;
  protected readonly short = shortAddr;
  protected readonly txUrl = txUrl;
  protected readonly addressUrl = addressUrl;
  protected readonly now = this.lotsSvc.chainNow;

  protected readonly risk = computed(() => riskLabel(this.lot()?.metrics?.riskScore));
  protected readonly available = computed(() => {
    const l = this.lot();
    return l ? l.maxTokens - l.tokensSold : 0;
  });
  protected readonly cost = computed(() => (this.lot()?.pricePerToken ?? 0) * this.tokensToBuy());
  protected readonly canInvest = computed(() => {
    const l = this.lot();
    return !!l && l.status === 'Funding' && this.now() <= l.fundingDeadline && this.available() > 0;
  });
  protected readonly canRefund = computed(() => {
    const l = this.lot();
    if (!l) return false;
    return l.status === 'Failed' || (l.status === 'Funding' && this.now() > l.fundingDeadline);
  });
  protected readonly isProducer = computed(() => {
    const l = this.lot();
    const a = this.wallet.account();
    return !!l && !!a && l.producer.toLowerCase() === a.toLowerCase();
  });
  protected readonly positionValue = computed(() => {
    const l = this.lot();
    const p = this.position();
    if (!l || !p) return 0;
    const perToken = l.status === 'Settled' ? l.payoutPerToken : l.preview.payoutPerToken || l.pricePerToken;
    return p.tokens * perToken;
  });

  protected readonly prediction = signal<DroughtPrediction | null>(null);
  protected readonly predictionError = signal<string | null>(null);
  protected readonly analysis = computed(() => this.metrics()?.latest_analysis ?? null);
  protected readonly insurance = computed(() => this.analysis()?.insurance ?? null);
  protected readonly riskLevelCls = (lvl: string | undefined) =>
    lvl === 'ALTO' ? 'bg-red-100 text-red-800' : lvl === 'MEDIO' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
  protected conditionName(key: string): string {
    return CONDITION_LABEL[key] ?? key;
  }


  /** Sentinel-2 multi-index weekly series (NDVI / EVI / NDWI). */
  protected readonly indexChart = computed(() => {
    const series = this.analysis()?.series ?? [];
    const ndwiT = this.insParams()?.ndwiTrigger ?? 0.05;
    return {
      labels: series.map((o) => shortDate(Date.parse(o.date) / 1000)),
      series: [
        { label: 'NDVI', data: series.map((o) => o.mean), color: '#16a34a', fill: true },
        { label: 'EVI', data: series.map((o) => o.evi), color: '#65a30d' },
        { label: 'NDWI (agua en hoja)', data: series.map((o) => o.ndwi), color: '#0284c7' },
        { label: 'Umbral NDWI seguro', data: series.map(() => ndwiT), color: '#dc2626', dashed: true },
      ] as ChartSeries[],
    };
  });

  /** Sentinel-1 radar: VV backscatter (soil moisture proxy) and RVI (biomass). */
  protected readonly sarChart = computed(() => {
    const obs = this.analysis()?.sar.observations ?? [];
    return {
      labels: obs.map((o) => shortDate(Date.parse(o.date) / 1000)),
      series: [
        { label: 'VV (dB) · humedad de suelo', data: obs.map((o) => o.vv_db), color: '#7c3aed', fill: true },
        { label: 'VH (dB) · biomasa', data: obs.map((o) => o.vh_db), color: '#c026d3' },
      ] as ChartSeries[],
    };
  });

  /** Season water balance: daily rain vs crop demand (ETc) and the root-zone depletion. */
  protected readonly waterChart = computed(() => {
    const days = (this.analysis()?.weather.daily ?? []).filter((d) => (d.kc ?? 0) > 0);
    const raw = this.analysis()?.water_balance.raw_mm ?? null;
    return {
      labels: days.map((d) => shortDate(Date.parse(d.date) / 1000)),
      series: [
        { label: 'Lluvia (mm)', data: days.map((d) => d.precipitation_mm), color: '#0284c7', fill: true },
        { label: 'ETc = ET0 × Kc (mm)', data: days.map((d) => d.etc_mm), color: '#f97316' },
        { label: 'Agotamiento del suelo Dr (mm)', data: days.map((d) => d.soil_depletion_mm), color: '#a16207' },
        { label: 'Umbral de estrés RAW (mm)', data: days.map(() => raw), color: '#dc2626', dashed: true },
      ] as ChartSeries[],
    };
  });

  /** NDVI: Sentinel-2 series from the latest analysis + every value the oracle pushed on-chain. */
  protected readonly ndviChart = computed(() => {
    const series = this.metrics()?.latest_analysis?.series ?? [];
    const history = this.oracleEvents();
    const points = new Map<string, { sat?: number; chain?: number }>();
    for (const o of series) points.set(o.date, { ...points.get(o.date), sat: o.mean });
    for (const h of history) {
      const d = new Date(h.ts * 1000).toISOString().slice(0, 10);
      points.set(d, { ...points.get(d), chain: h.ndvi });
    }
    const keys = [...points.keys()].sort();
    const crit = this.params()?.criticalNdvi ?? 0.3;
    return {
      labels: keys.map((k) => shortDate(Date.parse(k) / 1000)),
      series: [
        { label: 'NDVI satelital (media del lote)', data: keys.map((k) => points.get(k)?.sat ?? null), color: '#16a34a', fill: true },
        { label: 'NDVI publicado on-chain', data: keys.map((k) => points.get(k)?.chain ?? null), color: '#ca8a04' },
        { label: 'Umbral de sequía', data: keys.map(() => crit), color: '#dc2626', dashed: true },
      ] as ChartSeries[],
    };
  });

  protected readonly oracleEvents = computed(() =>
    this.events()
      .filter((e) => e.name === 'MetricsUpdated')
      .map((e) => {
        const m = e.args['metrics'] as OnchainMetricsArgs;
        return {
          ts: Number(m.timestamp),
          ndvi: m.ndvi / 10_000,
          ndwi: m.ndwi / 10_000,
          yieldIndex: m.yieldIndexBps / 10_000,
          risk: m.riskScore,
          dryDays: m.criticalDryDays,
        };
      })
      .sort((a, b) => a.ts - b.ts),
  );

  /** Payout per token implied by every oracle update (same formula as CampaignVault._payoutMultiplier). */
  protected readonly payoutChart = computed(() => {
    const l = this.lot();
    const p = this.params();
    const ev = this.oracleEvents();
    if (!l || !p) return { labels: [] as string[], series: [] as ChartSeries[] };
    const mult = (y: number, ndvi: number, dryDays: number) => {
      let m = 1 + l.targetApy * y;
      if (ndvi < p.criticalNdvi || (p.criticalDryDays > 0 && dryDays >= p.criticalDryDays)) m -= p.droughtHaircut;
      return Math.min(p.maxPayout, Math.max(p.minPayout, m));
    };
    return {
      labels: ev.map((e) => dateTime(e.ts)),
      series: [
        { label: 'Pago por token (USDC)', data: ev.map((e) => +(l.pricePerToken * mult(e.yieldIndex, e.ndvi, e.dryDays)).toFixed(4)), color: '#047857', fill: true },
        { label: 'Capital (precio del token)', data: ev.map(() => l.pricePerToken), color: '#78716c', dashed: true },
      ] as ChartSeries[],
    };
  });

  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    afterNextRender(() => {
      void this.loadAll();
      this.timer = setInterval(() => void this.refresh(), 20_000);
    });
    effect(() => {
      this.wallet.account();
      if (this.lot()) untracked(() => void this.loadPosition());
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected eventLabel(e: LotEvent): string {
    return EVENT_LABEL[e.name] ?? e.name;
  }

  protected eventDetail(e: LotEvent): string {
    const a = e.args;
    const u = (k: string) => usd(Number(a[k] as bigint) / 10 ** USDC_DECIMALS);
    switch (e.name) {
      case 'Invested': return `${shortAddr(a['investor'] as string)} compró ${a['tokens']} tokens · ${u('cost')} USDC`;
      case 'Claimed': return `${shortAddr(a['investor'] as string)} cobró ${u('amount')} USDC por ${a['tokens']} tokens`;
      case 'Refunded': return `${shortAddr(a['investor'] as string)} recuperó ${u('amount')} USDC`;
      case 'FundsReleased': return `${u('amount')} USDC → ${shortAddr(a['producer'] as string)}`;
      case 'RepaymentDeposited': return `${u('amount')} USDC depositados`;
      case 'SurplusReturned': return `${u('amount')} USDC devueltos al productor`;
      case 'GoalReachedEvent': case 'CampaignFailed': return `Recaudado ${u('raised')} USDC`;
      case 'Settled': return `Multiplicador ${(Number(a['multiplierBps']) / 10_000).toFixed(4)}× · ${u('payoutPerToken')} USDC/token${a['drought'] ? ' · sequía' : ''}`;
      case 'MetricsUpdated': {
        const m = a['metrics'] as OnchainMetricsArgs;
        return `NDVI ${(m.ndvi / 10_000).toFixed(3)} · NDWI ${(m.ndwi / 10_000).toFixed(3)} · riesgo ${m.riskScore} · yield ${(m.yieldIndexBps / 10_000).toFixed(3)} · balance ${m.waterBalanceMm} mm · ${m.criticalDryDays} días críticos`;
      }
      case 'InsurancePremiumCollected': return `${u('amount')} USDC de prima (3% del capital) al pool`;
      case 'InsuranceCoverageReturned': return `${u('amount')} USDC devueltos al pool`;
      case 'InsurancePoolFunded': return `${shortAddr(a['from'] as string)} aportó ${u('amount')} USDC al pool`;
      case 'InsuranceExecuted': return `Cobertura ${u('coverage')} USDC · NDWI ${(Number(a['ndwi']) / 10_000).toFixed(3)} · lluvia ${(Number(a['rainVsNormalBps']) / 100).toFixed(0)}% del histórico · ${a['criticalDryDays']} días críticos`;
      case 'LotCreated': return `${a['name']} (${a['crop']})`;
      default: return '';
    }
  }

  protected setTokens(v: number): void {
    this.tokensToBuy.set(Math.max(1, Math.min(this.available() || 1, Math.floor(Number(v) || 1))));
  }

  private async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      await this.refresh();
      this.params.set(await this.lotsSvc.payoutParams());
      this.insParams.set(await this.lotsSvc.insuranceParams());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    const id = Number(this.id());
    await this.lotsSvc.refreshChainTime();
    this.lot.set(await this.lotsSvc.load(id));
    this.lotsSvc.insurancePool().then((p) => this.pool.set(p), () => undefined);
    this.api.metrics(id).then(
      (m) => { this.metrics.set(m); this.metricsError.set(null); },
      (e) => this.metricsError.set(apiError(e)),
    );
    void this.loadPrediction();
    this.lotsSvc.events(id).then(
      (ev) => { this.events.set(ev); this.eventsError.set(null); },
      (e) => this.eventsError.set(errorMessage(e)),
    );
    await this.loadPosition();
  }

  async loadPrediction(refresh = false): Promise<void> {
    if (refresh) this.prediction.set(null);
    this.predictionError.set(null);
    try {
      this.prediction.set(await this.api.prediction(Number(this.id()), refresh));
    } catch (e) {
      this.prediction.set(null);
      this.predictionError.set(`Predicción no disponible: ${apiError(e)}`);
    }
  }

  private async loadPosition(): Promise<void> {
    const l = this.lot();
    const a = this.wallet.account();
    if (!l || !a || this.wallet.wrongChain()) return this.position.set(null);
    try {
      this.position.set(await this.lotsSvc.position(l, a));
    } catch {
      this.position.set(null);
    }
  }

  private async run(key: string, fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(key);
    this.actionError.set(null);
    try {
      await fn();
      await this.refresh();
    } catch (e) {
      this.actionError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(null);
    }
  }

  private vault() {
    return this.wallet.deployment!.contracts.CampaignVault;
  }

  protected invest(): Promise<void> {
    const l = this.lot()!;
    const n = this.tokensToBuy();
    return this.run('invest', async () => {
      await this.wallet.ensureAllowance(this.vault(), parseUnits(String(l.pricePerToken), USDC_DECIMALS) * BigInt(n));
      await this.wallet.write(`Invertir: ${n} tokens de ${l.name}`, {
        address: this.vault(), abi: CampaignVaultAbi, functionName: 'invest', args: [BigInt(l.id), BigInt(n)],
      });
    });
  }

  protected claim(): Promise<void> {
    const l = this.lot()!;
    return this.run('claim', () =>
      this.wallet.write(`Cobrar ${l.name}`, { address: this.vault(), abi: CampaignVaultAbi, functionName: 'claim', args: [BigInt(l.id)] }));
  }

  protected refund(): Promise<void> {
    const l = this.lot()!;
    return this.run('refund', () =>
      this.wallet.write(`Reembolso ${l.name}`, { address: this.vault(), abi: CampaignVaultAbi, functionName: 'refund', args: [BigInt(l.id)] }));
  }

  protected release(): Promise<void> {
    const l = this.lot()!;
    return this.run('release', () =>
      this.wallet.write('Liberar fondos al productor', {
        address: this.vault(), abi: CampaignVaultAbi, functionName: 'releaseFundsToProducer', args: [BigInt(l.id)],
      }));
  }

  protected repay(): Promise<void> {
    const l = this.lot()!;
    const amount = parseUnits(l.requiredRepayment.toFixed(6), USDC_DECIMALS);
    return this.run('repay', async () => {
      await this.wallet.ensureAllowance(this.vault(), amount);
      await this.wallet.write(`Depositar repago ${usd(l.requiredRepayment)} USDC`, {
        address: this.vault(), abi: CampaignVaultAbi, functionName: 'depositRepayment', args: [BigInt(l.id), amount],
      });
    });
  }

  protected settle(): Promise<void> {
    const l = this.lot()!;
    return this.run('settle', () =>
      this.wallet.write(`Liquidar ${l.name}`, { address: this.vault(), abi: CampaignVaultAbi, functionName: 'settle', args: [BigInt(l.id)] }));
  }

  protected executeInsurance(): Promise<void> {
    const l = this.lot()!;
    return this.run('insurance', () =>
      this.wallet.write(`Ejecutar seguro paramétrico ${l.name}`, {
        address: this.vault(), abi: CampaignVaultAbi, functionName: 'executeInsurance', args: [BigInt(l.id)],
      }));
  }

  protected fundPool(): Promise<void> {
    const amount = parseUnits(String(Math.max(1, this.poolAmount())), USDC_DECIMALS);
    return this.run('pool', async () => {
      await this.wallet.ensureAllowance(this.vault(), amount);
      await this.wallet.write(`Aportar ${usd(this.poolAmount())} USDC al pool de seguro`, {
        address: this.vault(), abi: CampaignVaultAbi, functionName: 'fundInsurancePool', args: [amount],
      });
    });
  }

  protected pushOracle(): Promise<void> {
    const l = this.lot()!;
    return this.run('oracle', async () => {
      try {
        const r = await this.api.push(l.id);
        return r;
      } catch (e) {
        throw new Error(apiError(e));
      }
    });
  }
}
