import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { USDC } from './fixtures';

describe('MockUSDC', () => {
  it('has 6 decimals and a faucet with cooldown', async () => {
    const [user] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    expect(await usdc.decimals()).to.equal(6);

    await expect(usdc.faucet()).to.emit(usdc, 'FaucetUsed').withArgs(user.address, USDC(10_000));
    expect(await usdc.balanceOf(user.address)).to.equal(USDC(10_000));

    await expect(usdc.faucet()).to.be.revertedWithCustomError(usdc, 'FaucetCooldown');
    await time.increase(60 * 60);
    await usdc.faucet();
    expect(await usdc.balanceOf(user.address)).to.equal(USDC(20_000));
  });
});
