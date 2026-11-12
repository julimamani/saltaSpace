import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { deployFixture } from './fixtures';

describe('InvestorRegistry (KYC allowlist)', () => {
  it('grants COMPLIANCE_ROLE to the admin at deploy', async () => {
    const { registry, admin } = await loadFixture(deployFixture);
    expect(await registry.hasRole(await registry.COMPLIANCE_ROLE(), admin.address)).to.equal(true);
    expect(await registry.isVerified(admin.address)).to.equal(true); // fixture verifies all signers
  });

  it('verifies and revokes investors, in batch too', async () => {
    const { registry } = await loadFixture(deployFixture);
    const [x, y] = (await ethers.getSigners()).slice(6, 8);

    await expect(registry.setInvestor(x.address, true)).to.emit(registry, 'InvestorUpdated').withArgs(x.address, true);
    expect(await registry.isVerified(x.address)).to.equal(true);

    await registry.setInvestors([x.address, y.address], false);
    expect(await registry.isVerified(x.address)).to.equal(false);
    expect(await registry.isVerified(y.address)).to.equal(false);

    const [, , , , , , mallory] = await ethers.getSigners();
    await expect(registry.connect(mallory).setInvestor(mallory.address, true))
      .to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount')
      .withArgs(mallory.address, await registry.COMPLIANCE_ROLE());
  });

  it('blocks invest() from an unverified wallet', async () => {
    const f = await loadFixture(deployFixture);
    const [, , , , , , mallory] = await ethers.getSigners();
    await f.usdc.connect(mallory).faucet();
    await f.usdc.connect(mallory).approve(await f.vault.getAddress(), ethers.MaxUint256);

    await expect(f.vault.connect(mallory).invest(0, 1))
      .to.be.revertedWithCustomError(f.token, 'NotVerified')
      .withArgs(mallory.address);
  });

  it('allows transfers only between verified investors', async () => {
    const f = await loadFixture(deployFixture);
    const [, , , , , , mallory] = await ethers.getSigners();
    await f.vault.connect(f.alice).invest(0, 10);

    await expect(f.token.connect(f.alice).transfer(mallory.address, 5))
      .to.be.revertedWithCustomError(f.token, 'NotVerified')
      .withArgs(mallory.address);
    await expect(f.token.connect(f.alice).transfer(f.bob.address, 5)).to.emit(f.token, 'Transfer');

    // De-verify bob: he keeps his balance but can no longer receive tokens.
    await f.registry.setInvestor(f.bob.address, false);
    await expect(f.token.connect(f.alice).transfer(f.bob.address, 1)).to.be.revertedWithCustomError(
      f.token,
      'NotVerified',
    );
  });
});
