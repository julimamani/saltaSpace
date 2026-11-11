import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { DAY, deployFixture, fundedFixture, pushMetrics, USDC } from './fixtures';

const Status = { Funding: 0, Funded: 1, Failed: 2, Settled: 3 };

describe('CampaignVault', () => {
  describe('funding', () => {
    it('invest() takes USDC and mints shares', async () => {
      const { vault, usdc, token, alice } = await loadFixture(deployFixture);
      const before = await usdc.balanceOf(alice.address);
      await expect(vault.connect(alice).invest(0, 5))
        .to.emit(vault, 'Invested')
        .withArgs(0, alice.address, 5, USDC(50));
      expect(await token.balanceOf(alice.address)).to.equal(5);
      expect(await usdc.balanceOf(alice.address)).to.equal(before - USDC(50));
      const s = await vault.getLotState(0);
      expect(s.raised).to.equal(USDC(50));
      expect(s.status).to.equal(Status.Funding);
    });

    it('moves to Funded when the goal is reached and caps oversubscription', async () => {
      const { vault, alice, bob } = await loadFixture(deployFixture);
      await vault.connect(alice).invest(0, 60);
      await expect(vault.connect(bob).invest(0, 41))
        .to.be.revertedWithCustomError(vault, 'ExceedsGoal')
        .withArgs(0, 40);
      await expect(vault.connect(bob).invest(0, 40)).to.emit(vault, 'GoalReachedEvent').withArgs(0, USDC(1_000));
      expect((await vault.getLotState(0)).status).to.equal(Status.Funded);
      await expect(vault.connect(bob).invest(0, 1)).to.be.revertedWithCustomError(vault, 'InvalidStatus');
    });

    it('rejects zero amounts and investing after the deadline', async () => {
      const { vault, alice } = await loadFixture(deployFixture);
      await expect(vault.connect(alice).invest(0, 0)).to.be.revertedWithCustomError(vault, 'ZeroAmount');
      await time.increase(8 * DAY);
      await expect(vault.connect(alice).invest(0, 1)).to.be.revertedWithCustomError(vault, 'FundingClosed');
    });

    it('releases funds to the producer exactly once', async () => {
      const { vault, usdc, producer } = await loadFixture(fundedFixture);
      const before = await usdc.balanceOf(producer.address);
      await expect(vault.releaseFundsToProducer(0))
        .to.emit(vault, 'FundsReleased')
        .withArgs(0, producer.address, USDC(1_000));
      expect(await usdc.balanceOf(producer.address)).to.equal(before + USDC(1_000));
      await expect(vault.releaseFundsToProducer(0)).to.be.revertedWithCustomError(vault, 'AlreadyReleased');
    });

    it('cannot release funds before the goal is reached', async () => {
      const { vault, alice } = await loadFixture(deployFixture);
      await vault.connect(alice).invest(0, 10);
      await expect(vault.releaseFundsToProducer(0)).to.be.revertedWithCustomError(vault, 'InvalidStatus');
    });
  });

  describe('goal not reached', () => {
    it('refunds investors after the deadline', async () => {
      const { vault, usdc, token, alice, bob } = await loadFixture(deployFixture);
      await vault.connect(alice).invest(0, 30);
      await vault.connect(bob).invest(0, 10);

      await expect(vault.connect(alice).refund(0)).to.be.revertedWithCustomError(vault, 'DeadlineNotReached');
      await time.increase(8 * DAY);

      const before = await usdc.balanceOf(alice.address);
      await expect(vault.connect(alice).refund(0))
        .to.emit(vault, 'CampaignFailed')
        .and.to.emit(vault, 'Refunded')
        .withArgs(0, alice.address, 30, USDC(300));
      expect(await usdc.balanceOf(alice.address)).to.equal(before + USDC(300));
      expect(await token.balanceOf(alice.address)).to.equal(0);
      expect((await vault.getLotState(0)).status).to.equal(Status.Failed);

      await expect(vault.connect(alice).refund(0)).to.be.revertedWithCustomError(vault, 'NothingToClaim');
      await vault.connect(bob).refund(0);
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(0);
    });

    it('does not refund a funded campaign', async () => {
      const { vault, alice } = await loadFixture(fundedFixture);
      await time.increase(8 * DAY);
      await expect(vault.connect(alice).refund(0)).to.be.revertedWithCustomError(vault, 'InvalidStatus');
    });
  });

  describe('settlement', () => {
    async function settleWith(ndvi: number, yieldBps: number, repay = USDC(1_300)) {
      const f = await fundedFixture();
      await f.vault.releaseFundsToProducer(0);
      await f.vault.connect(f.producer).depositRepayment(0, repay);
      await pushMetrics(f, ndvi, 30, yieldBps);
      return f;
    }

    it('normal harvest: capital x (1 + APY x yieldIndex)', async () => {
      const f = await settleWith(6_500, 10_000);
      // 1 + 0.18 * 1.0 = 1.18 -> 11.8 USDC per share
      expect((await f.vault.previewPayout(0)).payoutPerToken).to.equal(USDC(11.8));
      expect(await f.vault.requiredRepayment(0)).to.equal(0);

      const producerBefore = await f.usdc.balanceOf(f.producer.address);
      await expect(f.vault.settle(0))
        .to.emit(f.vault, 'Settled')
        .withArgs(0, 6_500, 10_000, 11_800, USDC(11.8), USDC(1_180), USDC(1_300), false)
        .and.to.emit(f.vault, 'SurplusReturned')
        .withArgs(0, f.producer.address, USDC(120));
      expect(await f.usdc.balanceOf(f.producer.address)).to.equal(producerBefore + USDC(120));

      await expect(f.vault.connect(f.alice).claim(0))
        .to.emit(f.vault, 'Claimed')
        .withArgs(0, f.alice.address, 60, USDC(708));
      await f.vault.connect(f.bob).claim(0);
      expect(await f.usdc.balanceOf(await f.vault.getAddress())).to.equal(0);
      expect(await f.token.totalSupply()).to.equal(0);
    });

    it('excellent harvest: yieldIndex 1.3', async () => {
      const f = await settleWith(8_500, 13_000);
      await f.vault.settle(0);
      // 1 + 0.18 * 1.3 = 1.234
      const s = await f.vault.getLotState(0);
      expect(s.settledMultiplierBps).to.equal(12_340);
      expect(s.payoutPerToken).to.equal(USDC(12.34));
    });

    it('drought: NDVI under the critical threshold applies the haircut', async () => {
      const f = await settleWith(2_000, 5_000);
      const preview = await f.vault.previewPayout(0);
      expect(preview.drought).to.equal(true);
      // 1 + 0.18 * 0.5 - 0.15 = 0.94 -> investors lose 6% of capital
      await expect(f.vault.settle(0)).to.emit(f.vault, 'Settled').withArgs(0, 2_000, 5_000, 9_400, USDC(9.4), USDC(940), USDC(1_300), true);
    });

    it('clamps the multiplier to the configured floor', async () => {
      const f = await settleWith(1_000, 5_000);
      await f.vault.setPayoutParams({ criticalNdvi: 3_000, droughtHaircutBps: 5_000, minPayoutBps: 8_000, maxPayoutBps: 13_000 });
      await f.vault.settle(0);
      expect((await f.vault.getLotState(0)).settledMultiplierBps).to.equal(8_000);
    });

    it('pays pro-rata when the producer repays less than owed', async () => {
      const f = await settleWith(6_500, 10_000, USDC(590));
      expect(await f.vault.requiredRepayment(0)).to.equal(USDC(590));
      await f.vault.settle(0);
      expect((await f.vault.getLotState(0)).payoutPerToken).to.equal(USDC(5.9));
      await f.vault.connect(f.alice).claim(0);
      expect(await f.usdc.balanceOf(f.alice.address)).to.equal(USDC(10_000 - 600 + 354));
    });

    it('uses unreleased capital when funds were never sent to the producer', async () => {
      const f = await loadFixture(fundedFixture);
      await f.vault.connect(f.producer).depositRepayment(0, USDC(180));
      await pushMetrics(f, 6_500, 30, 10_000);
      await f.vault.settle(0);
      expect((await f.vault.getLotState(0)).payoutPerToken).to.equal(USDC(11.8));
      await expect(f.vault.releaseFundsToProducer(0)).to.be.revertedWithCustomError(f.vault, 'InvalidStatus');
    });

    it('prevents double claims', async () => {
      const f = await settleWith(6_500, 10_000);
      await f.vault.settle(0);
      await f.vault.connect(f.alice).claim(0);
      await expect(f.vault.connect(f.alice).claim(0)).to.be.revertedWithCustomError(f.vault, 'NothingToClaim');
      await expect(f.vault.settle(0)).to.be.revertedWithCustomError(f.vault, 'InvalidStatus');
    });

    it('lets whoever holds the shares claim (tokens are transferable)', async () => {
      const f = await settleWith(6_500, 10_000);
      await f.token.connect(f.alice).transfer(f.stranger.address, 10);
      await f.vault.settle(0);
      await expect(f.vault.connect(f.stranger).claim(0)).to.emit(f.vault, 'Claimed').withArgs(0, f.stranger.address, 10, USDC(118));
    });

    it('requires oracle metrics and maturity (unless SETTLER_ROLE)', async () => {
      const f = await loadFixture(fundedFixture);
      await expect(f.vault.settle(0)).to.be.revertedWithCustomError(f.vault, 'NoMetrics');
      await pushMetrics(f, 6_500, 30, 10_000);
      await expect(f.vault.connect(f.stranger).settle(0)).to.be.revertedWithCustomError(f.vault, 'NotMatured');
      await time.increase(121 * DAY);
      await expect(f.vault.connect(f.stranger).settle(0)).to.emit(f.vault, 'Settled');
    });

    it('cannot claim before settlement', async () => {
      const f = await loadFixture(fundedFixture);
      await expect(f.vault.connect(f.alice).claim(0)).to.be.revertedWithCustomError(f.vault, 'InvalidStatus');
    });
  });

  describe('admin', () => {
    it('pause blocks user flows', async () => {
      const { vault, alice, stranger } = await loadFixture(deployFixture);
      await expect(vault.connect(stranger).pause()).to.be.revertedWithCustomError(vault, 'AccessControlUnauthorizedAccount');
      await vault.pause();
      await expect(vault.connect(alice).invest(0, 1)).to.be.revertedWithCustomError(vault, 'EnforcedPause');
      await vault.unpause();
      await vault.connect(alice).invest(0, 1);
    });

    it('validates payout params', async () => {
      const { vault, stranger } = await loadFixture(deployFixture);
      const p = { criticalNdvi: 3_000, droughtHaircutBps: 1_500, minPayoutBps: 9_000, maxPayoutBps: 8_000 };
      await expect(vault.setPayoutParams(p)).to.be.revertedWithCustomError(vault, 'InvalidPayoutParams');
      await expect(vault.connect(stranger).setPayoutParams({ ...p, maxPayoutBps: 13_000 })).to.be.revertedWithCustomError(
        vault,
        'AccessControlUnauthorizedAccount',
      );
    });

    it('rejects a zero address in the constructor', async () => {
      const [admin] = await ethers.getSigners();
      const Vault = await ethers.getContractFactory('CampaignVault');
      await expect(Vault.deploy(admin.address, ethers.ZeroAddress, admin.address, admin.address)).to.be.revertedWithCustomError(
        Vault,
        'ZeroAddress',
      );
    });
  });
});
