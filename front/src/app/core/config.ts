import { defineChain, type Chain } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { DEPLOYMENTS, type Deployment } from '../web3/generated/deployments';

/** Hardhat node used by `docker compose up` / `npm run node` in contracts/. */
export const hardhatLocal = defineChain({
  id: 31337,
  name: 'Hardhat local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
});

const CHAINS: Record<number, Chain> = { 43113: avalancheFuji, 31337: hardhatLocal };

/**
 * Target chain: Fuji when a Fuji deployment was exported, otherwise the local Hardhat node.
 * Override at runtime with `?chain=31337` / `?chain=43113` (persisted in localStorage).
 */
function resolveChainId(): number {
  if (typeof window !== 'undefined') {
    const fromUrl = new URLSearchParams(window.location.search).get('chain');
    if (fromUrl && DEPLOYMENTS[Number(fromUrl)]) {
      localStorage.setItem('agro.chainId', fromUrl);
      return Number(fromUrl);
    }
    const stored = Number(localStorage.getItem('agro.chainId'));
    if (stored && DEPLOYMENTS[stored]) return stored;
  }
  return DEPLOYMENTS[43113] ? 43113 : 31337;
}

export const TARGET_CHAIN_ID = resolveChainId();
export const TARGET_CHAIN: Chain = CHAINS[TARGET_CHAIN_ID];
export const DEPLOYMENT: Deployment | undefined = DEPLOYMENTS[TARGET_CHAIN_ID];
export const IS_LOCAL_CHAIN = TARGET_CHAIN_ID === 31337;

export const API_URL =
  (typeof window !== 'undefined' && (window as { AGRO_API_URL?: string }).AGRO_API_URL) || 'http://localhost:8000';

export const EXPLORER_URL = IS_LOCAL_CHAIN ? null : 'https://testnet.snowtrace.io';
export const AVAX_FAUCET_URL = 'https://core.app/tools/testnet-faucet/?subnet=c&token=c';

export function txUrl(hash: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : null;
}
export function addressUrl(addr: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL}/address/${addr}` : null;
}

export const USDC_DECIMALS = 6;
