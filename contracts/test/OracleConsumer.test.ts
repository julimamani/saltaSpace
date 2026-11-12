import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { deployFixture, metrics } from './fixtures';

describe('OracleConsumer', () => {
  it('stores metrics pushed by ORACLE_ROLE and emits history events', async () => {
    const { oracle, oracleSigner } = await loadFixture(deployFixture);
    const m = await metrics({ ndvi: 7_200, ndwi: 1_500, riskScore: 25, yieldIndexBps: 11_000, waterBalanceMm: -35, criticalDryDays: 4, rainVsNormalBps: 7_000 });

    await expect(oracle.connect(oracleSigner).updateLotMetrics(0, m))
      .to.emit(oracle, 'MetricsUpdated')
      .withArgs(0, Object.values(m), oracleSigner.address);

    const stored = await oracle.latestMetrics(0);
    expect(stored.ndvi).to.equal(7_200);
    expect(stored.ndwi).to.equal(1_500);
    expect(stored.riskScore).to.equal(25);
    expect(stored.yieldIndexBps).to.equal(11_000);
    expect(stored.waterBalanceMm).to.equal(-35);
    expect(stored.criticalDryDays).to.equal(4);
    expect(stored.rainVsNormalBps).to.equal(7_000);
    expect(await oracle.hasMetrics(0)).to.equal(true);
    expect(await oracle.updateCount(0)).to.equal(1);
  });

  it('rejects unauthorized oracles', async () => {
    const { oracle, stranger } = await loadFixture(deployFixture);
    await expect(oracle.connect(stranger).updateLotMetrics(0, await metrics()))
      .to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount')
      .withArgs(stranger.address, await oracle.ORACLE_ROLE());
  });

  it('validates ranges and timestamps', async () => {
    const { oracle, oracleSigner } = await loadFixture(deployFixture);
    const o = oracle.connect(oracleSigner);
    const ts = BigInt(await time.latest());

    await expect(o.updateLotMetrics(0, await metrics({ ndvi: 10_001 }))).to.be.revertedWithCustomError(oracle, 'InvalidNdvi');
    await expect(o.updateLotMetrics(0, await metrics({ ndwi: -10_001 }))).to.be.revertedWithCustomError(oracle, 'InvalidNdwi');
    await expect(o.updateLotMetrics(0, await metrics({ riskScore: 101 }))).to.be.revertedWithCustomError(oracle, 'InvalidRiskScore');
    await expect(o.updateLotMetrics(0, await metrics({ ndviDropBps: 10_001 }))).to.be.revertedWithCustomError(oracle, 'InvalidNdviDrop');
    await expect(o.updateLotMetrics(0, await metrics({ yieldIndexBps: 4_999 }))).to.be.revertedWithCustomError(oracle, 'InvalidYieldIndex');
    await expect(o.updateLotMetrics(0, await metrics({ yieldIndexBps: 13_001 }))).to.be.revertedWithCustomError(oracle, 'InvalidYieldIndex');
    await expect(o.updateLotMetrics(0, await metrics({ timestamp: ts + 3_600n }))).to.be.revertedWithCustomError(oracle, 'FutureTimestamp');

    await o.updateLotMetrics(0, await metrics({ timestamp: ts }));
    await expect(o.updateLotMetrics(0, await metrics({ timestamp: ts }))).to.be.revertedWithCustomError(oracle, 'StaleTimestamp');
  });
});
