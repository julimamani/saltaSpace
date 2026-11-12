import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';

export const USDC = (n: number | string) => ethers.parseUnits(String(n), 6);
export const DAY = 24 * 60 * 60;

/** Sample lot polygon near Rosario de la Frontera, Salta. */
export const GEOJSON = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [-64.98, -25.8],
      [-64.97, -25.8],
      [-64.97, -25.81],
      [-64.98, -25.81],
      [-64.98, -25.8],
    ],
  ],
});

export async function deployFixture() {
  const [admin, oracleSigner, producer, alice, bob, stranger] = await ethers.getSigners();

  const usdc = await ethers.deployContract('MockUSDC');
  const oracle = await ethers.deployContract('OracleConsumer', [admin.address, oracleSigner.address]);
  const factory = await ethers.deployContract('LotFactory', [admin.address]);
  const vault = await ethers.deployContract('CampaignVault', [
    admin.address,
    await usdc.getAddress(),
    await factory.getAddress(),
    await oracle.getAddress(),
  ]);
  await factory.setVault(await vault.getAddress());

  for (const s of [producer, alice, bob, stranger]) {
    await usdc.connect(s).faucet();
    await usdc.connect(s).approve(await vault.getAddress(), ethers.MaxUint256);
  }

  const now = await time.latest();
  const lotParams = {
    name: 'Porotos Rosario de la Frontera',
    symbol: 'AGRO-POR-1',
    crop: 'Poroto',
    hectaresX100: 12_50,
    geoJson: GEOJSON,
    fundingGoal: USDC(1_000),
    pricePerToken: USDC(10),
    fundingDeadline: BigInt(now + 7 * DAY),
    maturity: BigInt(now + 120 * DAY),
    targetApyBps: 1_800,
  };
  await factory.connect(producer).createLot(lotParams);
  const lot = await factory.getLot(0);
  const token = await ethers.getContractAt('LotToken', lot.token);

  return { admin, oracleSigner, producer, alice, bob, stranger, usdc, oracle, factory, vault, token, lotParams };
}

/** Fully funds lot 0: alice buys 60 shares, bob 40 (goal = 100 shares x 10 USDC). */
export async function fundedFixture() {
  const f = await deployFixture();
  await f.vault.connect(f.alice).invest(0, 60);
  await f.vault.connect(f.bob).invest(0, 40);
  return f;
}

export type MetricsInput = {
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
  dataHash: string;
};

/** Healthy-crop defaults; override only what the test is about. */
export async function metrics(over: Partial<MetricsInput> = {}): Promise<MetricsInput> {
  const ts = BigInt(await time.latest());
  return {
    ndvi: 6_500,
    ndwi: 2_000,
    riskScore: 30,
    yieldIndexBps: 10_000,
    waterBalanceMm: 40,
    criticalDryDays: 0,
    rainVsNormalBps: 10_000,
    ndviDropBps: 0,
    soilDryDays: 0,
    timestamp: ts,
    dataHash: ethers.id(`metrics-${ts}`),
    ...over,
  };
}

export async function pushMetrics(
  f: Awaited<ReturnType<typeof deployFixture>>,
  ndvi: number,
  riskScore: number,
  yieldIndexBps: number,
  over: Partial<MetricsInput> = {},
) {
  const m = await metrics({ ndvi, riskScore, yieldIndexBps, ...over });
  return f.oracle.connect(f.oracleSigner).updateLotMetrics(0, m);
}
