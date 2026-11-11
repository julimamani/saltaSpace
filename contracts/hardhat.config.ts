import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import 'dotenv/config';

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1:8545', chainId: 31337 },
    fuji: {
      url: process.env.FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts: deployerKey ? [deployerKey] : [],
    },
  },
  gasReporter: { enabled: process.env.REPORT_GAS === 'true' },
};

export default config;
