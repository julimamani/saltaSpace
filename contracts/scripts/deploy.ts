import { ethers, network } from 'hardhat';
import fs from 'node:fs';
import path from 'node:path';
import { exportArtifacts } from './export-abis';

/**
 * Deploys MockUSDC, OracleConsumer, LotFactory and CampaignVault, wires them together and
 * writes deployments/<network>.json. Then exports ABIs + addresses to the front and backend.
 *   npx hardhat run scripts/deploy.ts --network fuji
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No deployer account. Set DEPLOYER_PRIVATE_KEY in contracts/.env');
  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Deploying to ${network.name} (chainId ${chainId}) from ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} AVAX`);

  const startBlock = await ethers.provider.getBlockNumber();

  const usdc = await ethers.deployContract('MockUSDC');
  await usdc.waitForDeployment();
  const oracle = await ethers.deployContract('OracleConsumer', [deployer.address, oracleAddress]);
  await oracle.waitForDeployment();
  const factory = await ethers.deployContract('LotFactory', [deployer.address]);
  await factory.waitForDeployment();
  const vault = await ethers.deployContract('CampaignVault', [
    deployer.address,
    await usdc.getAddress(),
    await factory.getAddress(),
    await oracle.getAddress(),
  ]);
  await vault.waitForDeployment();
  await (await factory.setVault(await vault.getAddress())).wait();

  const deployment = {
    network: network.name,
    chainId: Number(chainId),
    startBlock,
    deployer: deployer.address,
    oracle: oracleAddress,
    contracts: {
      MockUSDC: await usdc.getAddress(),
      OracleConsumer: await oracle.getAddress(),
      LotFactory: await factory.getAddress(),
      CampaignVault: await vault.getAddress(),
    },
    deployedAt: new Date().toISOString(),
  };

  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(deployment, null, 2) + '\n');
  console.log(deployment);

  exportArtifacts();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
