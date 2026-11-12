import { ethers, network } from 'hardhat';
import fs from 'node:fs';
import path from 'node:path';
import { exportArtifacts } from './export-abis';

/**
 * Deploys the payment token (MockUSDC, or an existing ERC-20 when USDC_ADDRESS is set),
 * OracleConsumer, LotFactory and CampaignVault, wires them together and writes
 * deployments/<network>.json. Then exports ABIs + addresses to the front and backend.
 *   npx hardhat run scripts/deploy.ts --network fuji
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No deployer account. Set DEPLOYER_PRIVATE_KEY in contracts/.env');
  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const complianceAddress = process.env.COMPLIANCE_ADDRESS || deployer.address;
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Deploying to ${network.name} (chainId ${chainId}) from ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} (native gas token)`);

  const startBlock = await ethers.provider.getBlockNumber();

  let usdcAddress = process.env.USDC_ADDRESS;
  const usdcIsMock = !usdcAddress;
  if (usdcAddress) {
    if (!ethers.isAddress(usdcAddress)) throw new Error(`Invalid USDC_ADDRESS: ${usdcAddress}`);
    console.log(`Using existing payment token at ${usdcAddress} (USDC_ADDRESS)`);
  } else {
    const usdc = await ethers.deployContract('MockUSDC');
    await usdc.waitForDeployment();
    usdcAddress = await usdc.getAddress();
  }
  const oracle = await ethers.deployContract('OracleConsumer', [deployer.address, oracleAddress]);
  await oracle.waitForDeployment();
  const registry = await ethers.deployContract('InvestorRegistry', [deployer.address, complianceAddress]);
  await registry.waitForDeployment();
  const factory = await ethers.deployContract('LotFactory', [deployer.address, await registry.getAddress()]);
  await factory.waitForDeployment();
  const vault = await ethers.deployContract('CampaignVault', [
    deployer.address,
    usdcAddress,
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
    usdcIsMock,
    contracts: {
      MockUSDC: usdcAddress,
      OracleConsumer: await oracle.getAddress(),
      InvestorRegistry: await registry.getAddress(),
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
