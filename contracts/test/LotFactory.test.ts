import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { deployFixture, GEOJSON, USDC } from './fixtures';

describe('LotFactory', () => {
  it('creates a lot with its own ERC20 share token minted only by the vault', async () => {
    const { factory, vault, producer, token, lotParams } = await loadFixture(deployFixture);
    expect(await factory.lotCount()).to.equal(1);

    const lot = await factory.getLot(0);
    expect(lot.producer).to.equal(producer.address);
    expect(lot.crop).to.equal('Poroto');
    expect(lot.geoHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(GEOJSON)));
    expect(lot.fundingGoal).to.equal(lotParams.fundingGoal);

    expect(await token.name()).to.equal(lotParams.name);
    expect(await token.symbol()).to.equal(lotParams.symbol);
    expect(await token.decimals()).to.equal(0);
    expect(await token.minter()).to.equal(await vault.getAddress());
    await expect(token.connect(producer).mint(producer.address, 1)).to.be.revertedWithCustomError(
      token,
      'NotMinter',
    );
  });

  it('emits LotCreated', async () => {
    const { factory, producer, lotParams } = await loadFixture(deployFixture);
    await expect(factory.connect(producer).createLot({ ...lotParams, name: 'Lote 2' }))
      .to.emit(factory, 'LotCreated')
      .withArgs(1, producer.address, ethers.isAddress, 'Lote 2', 'Poroto', USDC(1_000), USDC(10), lotParams.fundingDeadline, ethers.keccak256(ethers.toUtf8Bytes(GEOJSON)));
  });

  it('validates parameters', async () => {
    const { factory, producer, lotParams } = await loadFixture(deployFixture);
    const bad = async (override: Partial<typeof lotParams>, reason: string) =>
      expect(factory.connect(producer).createLot({ ...lotParams, ...override }))
        .to.be.revertedWithCustomError(factory, 'InvalidParams')
        .withArgs(reason);

    await bad({ pricePerToken: USDC(5), fundingGoal: USDC(1_000) }, 'price');
    await bad({ fundingGoal: USDC(1_005) }, 'goal');
    await bad({ fundingDeadline: BigInt(await time.latest()) }, 'deadline');
    await bad({ maturity: lotParams.fundingDeadline }, 'maturity');
    await bad({ targetApyBps: 0 }, 'apy');
    await bad({ geoJson: '' }, 'geoJson');
    await bad({ hectaresX100: 0 }, 'hectares');
  });

  it('wires the vault only once and only by the owner', async () => {
    const { factory, producer } = await loadFixture(deployFixture);
    await expect(factory.setVault(producer.address)).to.be.revertedWithCustomError(factory, 'VaultAlreadySet');
    await expect(factory.connect(producer).setVault(producer.address)).to.be.revertedWithCustomError(
      factory,
      'OwnableUnauthorizedAccount',
    );
  });

  it('reverts for unknown lots', async () => {
    const { factory } = await loadFixture(deployFixture);
    await expect(factory.getLot(99)).to.be.revertedWithCustomError(factory, 'LotNotFound').withArgs(99);
  });
});
