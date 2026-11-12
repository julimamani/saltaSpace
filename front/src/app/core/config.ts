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

/**
 * Optional custom Avalanche L1, injected at runtime — same pattern as AGRO_API_URL.
 * Add an inline <script> before </body> in index.html (or serve a config file):
 *   window.AGRO_L1 = { chainId: 12345, rpcUrl: 'https://…/rpc', name: 'Mi L1',
 *                      currencySymbol: 'GAS', explorerUrl: 'https://explorer…' ,
 *                      gasFaucetUrl: 'https://faucet…' };
 */
interface L1Config {
  chainId: number;
  rpcUrl: string;
  name?: string;
  currencyName?: string;
  currencySymbol?: string;
  currencyDecimals?: number;
  explorerUrl?: string;
  gasFaucetUrl?: string;
}

const l1Config: L1Config | undefined =
  typeof window !== 'undefined' ? (window as { AGRO_L1?: L1Config }).AGRO_L1 : undefined;

const l1Chain: Chain | undefined =
  l1Config?.chainId && l1Config.rpcUrl
    ? defineChain({
        id: l1Config.chainId,
        name: l1Config.name ?? 'Avalanche L1',
        nativeCurrency: {
          name: l1Config.currencyName ?? l1Config.currencySymbol ?? 'Gas',
          symbol: l1Config.currencySymbol ?? 'GAS',
          decimals: l1Config.currencyDecimals ?? 18,
        },
        rpcUrls: { default: { http: [l1Config.rpcUrl] } },
        blockExplorers: l1Config.explorerUrl
          ? { default: { name: 'Explorer', url: l1Config.explorerUrl } }
          : undefined,
      })
    : undefined;

const CHAINS: Record<number, Chain> = {
  43113: avalancheFuji,
  31337: hardhatLocal,
  ...(l1Chain ? { [l1Chain.id]: l1Chain } : {}),
};

/**
 * Target chain: Fuji when a Fuji deployment was exported, otherwise a configured L1
 * deployment, otherwise the local Hardhat node.
 * Override at runtime with `?chain=<id>` (persisted in localStorage).
 */
function resolveChainId(): number {
  if (typeof window !== 'undefined') {
    const fromUrl = new URLSearchParams(window.location.search).get('chain');
    if (fromUrl && DEPLOYMENTS[Number(fromUrl)] && CHAINS[Number(fromUrl)]) {
      localStorage.setItem('agro.chainId', fromUrl);
      return Number(fromUrl);
    }
    const stored = Number(localStorage.getItem('agro.chainId'));
    if (stored && DEPLOYMENTS[stored] && CHAINS[stored]) return stored;
  }
  if (DEPLOYMENTS[43113]) return 43113;
  const remoteId = Object.keys(DEPLOYMENTS)
    .map(Number)
    .find((id) => id !== 31337 && CHAINS[id]);
  return remoteId ?? 31337;
}

export const TARGET_CHAIN_ID = resolveChainId();
export const TARGET_CHAIN: Chain = CHAINS[TARGET_CHAIN_ID];
export const DEPLOYMENT: Deployment | undefined = DEPLOYMENTS[TARGET_CHAIN_ID];
export const IS_LOCAL_CHAIN = TARGET_CHAIN_ID === 31337;
export const IS_FUJI = TARGET_CHAIN_ID === 43113;

export const API_URL =
  (typeof window !== 'undefined' && (window as { AGRO_API_URL?: string }).AGRO_API_URL) || 'http://localhost:8000';

export const EXPLORER_URL = IS_LOCAL_CHAIN
  ? null
  : IS_FUJI
    ? 'https://testnet.snowtrace.io'
    : (TARGET_CHAIN.blockExplorers?.default.url ?? null);

export const AVAX_FAUCET_URL = 'https://core.app/tools/testnet-faucet/?subnet=c&token=c';
/** Where to get native gas tokens on the active chain (null = not applicable / unknown). */
export const GAS_FAUCET_URL: string | null = IS_FUJI
  ? AVAX_FAUCET_URL
  : (l1Config?.gasFaucetUrl ?? null);

export function txUrl(hash: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : null;
}
export function addressUrl(addr: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL}/address/${addr}` : null;
}

export const USDC_DECIMALS = 6;
