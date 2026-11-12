import { ethers, network } from 'hardhat';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Creates two demo lots in Salta so the marketplace is not empty, and funds the first one
 * partially. Uses the deployer as producer/investor.
 *   npx hardhat run scripts/seed-demo.ts --network localhost
 */
const LOTS = [
  {
    name: 'Porotos Rosario de la Frontera',
    symbol: 'AGRO-POR-01',
    crop: 'Poroto',
    hectaresX100: 4_500,
    coords: [
      [-64.995, -25.805],
      [-64.975, -25.805],
      [-64.975, -25.82],
      [-64.995, -25.82],
      [-64.995, -25.805],
    ],
    goal: 5_000,
    price: 10,
    apyBps: 1_800,
  },
  {
    name: 'Maíz Valle de Lerma',
    symbol: 'AGRO-MAI-02',
    crop: 'Maíz',
    hectaresX100: 3_000,
    coords: [
      [-65.47, -24.93],
      [-65.455, -24.93],
      [-65.455, -24.942],
      [-65.47, -24.942],
      [-65.47, -24.93],
    ],
    goal: 3_000,
    price: 25,
    apyBps: 1_500,
  },
];

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'deployments', `${network.name}.json`), 'utf8'),
  );
  const [deployer] = await ethers.getSigners();
  const usdc = await ethers.getContractAt('MockUSDC', dep.contracts.MockUSDC);
  const factory = await ethers.getContractAt('LotFactory', dep.contracts.LotFactory);
  const vault = await ethers.getContractAt('CampaignVault', dep.contracts.CampaignVault);

  const now = (await ethers.provider.getBlock('latest'))!.timestamp;
  for (const l of LOTS) {
    const tx = await factory.createLot({
      name: l.name,
      symbol: l.symbol,
      crop: l.crop,
      hectaresX100: l.hectaresX100,
      geoJson: JSON.stringify({ type: 'Polygon', coordinates: [l.coords] }),
      fundingGoal: ethers.parseUnits(String(l.goal), 6),
      pricePerToken: ethers.parseUnits(String(l.price), 6),
      fundingDeadline: BigInt(now + 30 * 86400),
      maturity: BigInt(now + 180 * 86400),
      targetApyBps: l.apyBps,
    });
    await tx.wait();
    console.log(`Created lot "${l.name}"`);
  }

  if (dep.usdcIsMock === false) {
    console.log('Payment token is not MockUSDC; skipping faucet/investor seeding.');
    return;
  }
  // KYC gate: the deployer must be a verified investor to buy shares.
  const registry = await ethers.getContractAt('InvestorRegistry', dep.contracts.InvestorRegistry);
  await (await registry.setInvestor(deployer.address, true)).wait();
  await (await usdc.faucet()).wait();
  await (await usdc.approve(dep.contracts.CampaignVault, ethers.MaxUint256)).wait();
  const firstId = (await factory.lotCount()) - BigInt(LOTS.length);
  await (await vault.invest(firstId, 150)).wait();
  console.log(`Deployer ${deployer.address} invested 150 shares in lot ${firstId}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
