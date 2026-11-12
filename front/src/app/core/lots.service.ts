import { Injectable, inject, signal } from '@angular/core';
import { formatUnits, type Address, type Log } from 'viem';
import { USDC_DECIMALS } from './config';
import { WalletService } from './wallet.service';
import { CampaignVaultAbi, LotFactoryAbi, LotTokenAbi, OracleConsumerAbi, MockUSDCAbi } from '../web3/generated/abis';
import { STATUS_NAMES, type InsuranceParams, type LotEvent, type LotView, type PayoutParams, type PolygonGeometry } from './models';

const usdc = (v: bigint) => Number(formatUnits(v, USDC_DECIMALS));
const LOG_CHUNK = 2_000n;
const MAX_CHUNKS = 30;

/** Reads lots straight from the contracts (the UI does not depend on the backend for state). */
@Injectable({ providedIn: 'root' })
export class LotsService {
  private readonly wallet = inject(WalletService);
  private get client() {
    return this.wallet.publicClient;
  }
  private get c() {
    const d = this.wallet.deployment;
    if (!d) throw new Error(`No hay contratos desplegados para la red ${this.wallet.chain.name}. Corré el deploy.`);
    return d.contracts;
  }

  /** Latest block timestamp (differs from wall clock on a time-travelled local chain). */
  readonly chainNow = signal<number>(Math.floor(Date.now() / 1000));

  async refreshChainTime(): Promise<number> {
    const block = await this.client.getBlock({ blockTag: 'latest' });
    const ts = Number(block.timestamp);
    this.chainNow.set(ts);
    return ts;
  }

  async count(): Promise<number> {
    return Number(await this.client.readContract({ address: this.c.LotFactory, abi: LotFactoryAbi, functionName: 'lotCount' }));
  }

  async loadAll(): Promise<LotView[]> {
    const [n] = await Promise.all([this.count(), this.refreshChainTime()]);
    const lots = await Promise.all(Array.from({ length: n }, (_, i) => this.load(i)));
    return lots.reverse();
  }

  async load(id: number): Promise<LotView> {
    const lotId = BigInt(id);
    const c = this.c;
    const [lot, state, metrics, preview, required, ins, trigger] = await Promise.all([
      this.client.readContract({ address: c.LotFactory, abi: LotFactoryAbi, functionName: 'getLot', args: [lotId] }),
      this.client.readContract({ address: c.CampaignVault, abi: CampaignVaultAbi, functionName: 'getLotState', args: [lotId] }),
      this.client.readContract({ address: c.OracleConsumer, abi: OracleConsumerAbi, functionName: 'latestMetrics', args: [lotId] }),
      this.client.readContract({ address: c.CampaignVault, abi: CampaignVaultAbi, functionName: 'previewPayout', args: [lotId] }),
      this.client.readContract({ address: c.CampaignVault, abi: CampaignVaultAbi, functionName: 'requiredRepayment', args: [lotId] }),
      this.client.readContract({ address: c.CampaignVault, abi: CampaignVaultAbi, functionName: 'getLotInsurance', args: [lotId] }),
      this.client.readContract({ address: c.CampaignVault, abi: CampaignVaultAbi, functionName: 'insuranceTrigger', args: [lotId] }),
    ]);
    let geometry: PolygonGeometry | null = null;
    try {
      const g = JSON.parse(lot.geoJson);
      if (g?.type === 'Polygon') geometry = g;
    } catch {
      /* invalid GeoJSON stored on-chain */
    }
    const pricePerToken = usdc(lot.pricePerToken);
    const fundingGoal = usdc(lot.fundingGoal);
    const multiplier = preview[0] / 10_000;
    const hasMetrics = metrics.timestamp > 0n;
    return {
      id,
      producer: lot.producer,
      token: lot.token,
      name: lot.name,
      crop: lot.crop,
      hectares: lot.hectaresX100 / 100,
      geometry,
      geoHash: lot.geoHash,
      fundingGoal,
      pricePerToken,
      fundingDeadline: Number(lot.fundingDeadline),
      maturity: Number(lot.maturity),
      targetApy: lot.targetApyBps / 10_000,
      status: STATUS_NAMES[state.status],
      fundsReleased: state.fundsReleased,
      tokensSold: Number(state.tokensSold),
      maxTokens: Math.round(fundingGoal / pricePerToken),
      raised: usdc(state.raised),
      repaid: usdc(state.repaid),
      payoutPerToken: usdc(state.payoutPerToken),
      metrics: hasMetrics
        ? {
            ndvi: metrics.ndvi / 10_000,
            ndwi: metrics.ndwi / 10_000,
            riskScore: metrics.riskScore,
            yieldIndex: metrics.yieldIndexBps / 10_000,
            waterBalanceMm: metrics.waterBalanceMm,
            criticalDryDays: metrics.criticalDryDays,
            rainVsNormal: metrics.rainVsNormalBps / 10_000,
            ndviDrop: metrics.ndviDropBps / 10_000,
            soilDryDays: metrics.soilDryDays,
            timestamp: Number(metrics.timestamp),
            dataHash: metrics.dataHash,
          }
        : null,
      preview: { multiplier, payoutPerToken: usdc(preview[1]), drought: preview[2] },
      insurance: {
        premium: usdc(ins.premium),
        coverage: usdc(ins.coverage),
        executed: ins.executed,
        triggered: trigger[0],
        coverageAvailable: usdc(trigger[2]),
      },
      requiredRepayment: usdc(required),
      progress: fundingGoal > 0 ? usdc(state.raised) / fundingGoal : 0,
      estimatedReturn: multiplier > 0 ? multiplier - 1 : lot.targetApyBps / 10_000,
    };
  }

  async payoutParams(): Promise<PayoutParams> {
    const [criticalNdvi, criticalDryDays, haircut, min, max] = await this.client.readContract({
      address: this.c.CampaignVault,
      abi: CampaignVaultAbi,
      functionName: 'payoutParams',
    });
    return { criticalNdvi: criticalNdvi / 10_000, criticalDryDays, droughtHaircut: haircut / 10_000, minPayout: min / 10_000, maxPayout: max / 10_000 };
  }

  async insuranceParams(): Promise<InsuranceParams> {
    const [premium, coverage, rain, ndwi, dryDays, ndviDrop, soilDry] = await this.client.readContract({
      address: this.c.CampaignVault,
      abi: CampaignVaultAbi,
      functionName: 'insuranceParams',
    });
    return {
      premium: premium / 10_000,
      coverage: coverage / 10_000,
      rainTrigger: rain / 10_000,
      ndwiTrigger: ndwi / 10_000,
      dryDaysTrigger: dryDays,
      ndviDropTrigger: ndviDrop / 10_000,
      soilDryDaysTrigger: soilDry,
    };
  }

  async insurancePool(): Promise<number> {
    return usdc(await this.client.readContract({ address: this.c.CampaignVault, abi: CampaignVaultAbi, functionName: 'insurancePool' }));
  }

  async position(lot: LotView, account: Address): Promise<{ tokens: number; usdcAllowance: number }> {
    const [tokens, allowance] = await Promise.all([
      this.client.readContract({ address: lot.token, abi: LotTokenAbi, functionName: 'balanceOf', args: [account] }),
      this.client.readContract({
        address: this.c.MockUSDC,
        abi: MockUSDCAbi,
        functionName: 'allowance',
        args: [account, this.c.CampaignVault],
      }),
    ]);
    return { tokens: Number(tokens), usdcAllowance: usdc(allowance) };
  }

  /** Vault + oracle + factory events for one lot, newest first. */
  async events(lotId: number): Promise<LotEvent[]> {
    const c = this.c;
    const id = BigInt(lotId);
    const [vault, oracle, factory] = await Promise.all([
      this.logs(() => ({ address: c.CampaignVault, abi: CampaignVaultAbi })),
      this.logs(() => ({ address: c.OracleConsumer, abi: OracleConsumerAbi, eventName: 'MetricsUpdated' as const })),
      this.logs(() => ({ address: c.LotFactory, abi: LotFactoryAbi, eventName: 'LotCreated' as const })),
    ]);
    const all = [...vault, ...oracle, ...factory]
      .filter((l) => (l.args as { lotId?: bigint }).lotId === id)
      .map((l) => ({
        name: l.eventName,
        blockNumber: l.blockNumber ?? 0n,
        txHash: l.transactionHash ?? '',
        args: l.args as Record<string, unknown>,
      }));
    const blocks = [...new Set(all.map((e) => e.blockNumber))].slice(-60);
    const times = new Map<bigint, number>();
    await Promise.all(
      blocks.map(async (b) => times.set(b, Number((await this.client.getBlock({ blockNumber: b })).timestamp))),
    );
    return all
      .map((e) => ({ ...e, timestamp: times.get(e.blockNumber) }))
      .sort((a, b) => Number(b.blockNumber - a.blockNumber));
  }

  /**
   * getContractEvents from the deployment block; public Fuji RPCs cap eth_getLogs ranges,
   * so on failure we fall back to scanning recent 2k-block windows.
   */
  private async logs<T extends object>(
    params: () => T,
  ): Promise<(Log & { eventName: string; args: unknown })[]> {
    type Ev = Log & { eventName: string; args: unknown };
    const get = this.client.getContractEvents as unknown as (p: object) => Promise<Ev[]>;
    const start = BigInt(this.wallet.deployment?.startBlock ?? 0);
    try {
      return await get({ ...params(), fromBlock: start, toBlock: 'latest' });
    } catch {
      const latest = await this.client.getBlockNumber();
      const out: Ev[] = [];
      for (let i = 0, to = latest; i < MAX_CHUNKS && to >= start; i++) {
        const from = to - LOG_CHUNK + 1n > start ? to - LOG_CHUNK + 1n : start;
        out.push(...(await get({ ...params(), fromBlock: from, toBlock: to })));
        if (from === start) break;
        to = from - 1n;
      }
      return out;
    }
  }
}
