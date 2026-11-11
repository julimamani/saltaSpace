import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { deployFixture } from './fixtures';

describe('OracleConsumer', () => {
  it('stores metrics pushed by ORACLE_ROLE and emits history events', async () => {
    const { oracle, oracleSigner } = await loadFixture(deployFixture);
    const ts = BigInt(await time.latest());
    const hash = ethers.id('payload');

    await expect(oracle.connect(oracleSigner).updateLotMetrics(0, 7_200, 25, 11_000, ts, hash))
      .to.emit(oracle, 'MetricsUpdated')
      .withArgs(0, 7_200, 25, 11_000, ts, hash, oracleSigner.address);

    const m = await oracle.latestMetrics(0);
    expect(m.ndvi).to.equal(7_200);
    expect(m.riskScore).to.equal(25);
    expect(m.yieldIndexBps).to.equal(11_000);
    expect(await oracle.hasMetrics(0)).to.equal(true);
    expect(await oracle.updateCount(0)).to.equal(1);
  });

  it('rejects unauthorized oracles', async () => {
    const { oracle, stranger } = await loadFixture(deployFixture);
    const ts = BigInt(await time.latest());
    await expect(oracle.connect(stranger).updateLotMetrics(0, 7_000, 20, 10_000, ts, ethers.ZeroHash))
      .to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount')
      .withArgs(stranger.address, await oracle.ORACLE_ROLE());
  });

  it('validates ranges and timestamps', async () => {
    const { oracle, oracleSigner } = await loadFixture(deployFixture);
    const o = oracle.connect(oracleSigner);
    const ts = BigInt(await time.latest());
    const h = ethers.ZeroHash;

    await expect(o.updateLotMetrics(0, 10_001, 20, 10_000, ts, h)).to.be.revertedWithCustomError(oracle, 'InvalidNdvi');
    await expect(o.updateLotMetrics(0, 7_000, 101, 10_000, ts, h)).to.be.revertedWithCustomError(oracle, 'InvalidRiskScore');
    await expect(o.updateLotMetrics(0, 7_000, 20, 4_999, ts, h)).to.be.revertedWithCustomError(oracle, 'InvalidYieldIndex');
    await expect(o.updateLotMetrics(0, 7_000, 20, 13_001, ts, h)).to.be.revertedWithCustomError(oracle, 'InvalidYieldIndex');
    await expect(o.updateLotMetrics(0, 7_000, 20, 10_000, ts + 3_600n, h)).to.be.revertedWithCustomError(oracle, 'FutureTimestamp');

    await o.updateLotMetrics(0, 7_000, 20, 10_000, ts, h);
    await expect(o.updateLotMetrics(0, 7_000, 20, 10_000, ts, h)).to.be.revertedWithCustomError(oracle, 'StaleTimestamp');
  });
});
