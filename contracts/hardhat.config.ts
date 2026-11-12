import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import 'dotenv/config';

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const l1ChainId = Number(process.env.L1_CHAIN_ID ?? 0);
// Some L1s run an older subnet-evm; override if `cancun` is not supported.
const evmVersion = (process.env.EVM_VERSION ?? 'cancun') as 'cancun' | 'shanghai' | 'paris' | 'london';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1:8545', chainId: 31337 },
    fuji: {
      url: process.env.FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts: deployerKey ? [deployerKey] : [],
    },
    // Custom Avalanche L1 (subnet-evm). Enabled when L1_CHAIN_ID + L1_RPC_URL are set.
    ...(l1ChainId
      ? {
          l1: {
            url: process.env.L1_RPC_URL ?? '',
            chainId: l1ChainId,
            accounts: deployerKey ? [deployerKey] : [],
          },
        }
      : {}),
  },
  gasReporter: { enabled: process.env.REPORT_GAS === 'true' },
};

export default config;
