import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  type Abi,
  type Address,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { DEPLOYMENT, TARGET_CHAIN, USDC_DECIMALS } from './config';
import { TxService } from './tx.service';
import { MockUSDCAbi } from '../web3/generated/abis';

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, cb: (...args: unknown[]) => void): void;
}

export interface WriteRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

@Injectable({ providedIn: 'root' })
export class WalletService {
  private readonly tx = inject(TxService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly chain = TARGET_CHAIN;
  readonly deployment = DEPLOYMENT;
  readonly publicClient = createPublicClient({ chain: TARGET_CHAIN, transport: http() });

  readonly hasProvider = signal(false);
  readonly account = signal<Address | null>(null);
  readonly chainId = signal<number | null>(null);
  readonly connecting = signal(false);
  readonly usdcBalance = signal<number | null>(null);
  readonly nativeBalance = signal<number | null>(null);
  readonly lastError = signal<string | null>(null);

  readonly connected = computed(() => this.account() !== null);
  readonly wrongChain = computed(() => this.connected() && this.chainId() !== this.chain.id);
  readonly ready = computed(() => this.connected() && !this.wrongChain());

  constructor() {
    if (this.browser) void this.init();
  }

  private get eth(): Eip1193 | undefined {
    return (window as unknown as { ethereum?: Eip1193 }).ethereum;
  }

  private async init(): Promise<void> {
    const eth = this.eth;
    if (!eth) return;
    this.hasProvider.set(true);
    eth.on?.('accountsChanged', (accs) => {
      const list = accs as string[];
      this.account.set((list[0] as Address) ?? null);
      void this.refreshBalances();
    });
    eth.on?.('chainChanged', (id) => {
      this.chainId.set(Number(id));
      void this.refreshBalances();
    });
    try {
      const [accs, id] = await Promise.all([eth.request({ method: 'eth_accounts' }), eth.request({ method: 'eth_chainId' })]);
      this.chainId.set(Number(id));
      this.account.set(((accs as string[])[0] as Address) ?? null);
      await this.refreshBalances();
    } catch {
      /* wallet locked or unavailable */
    }
  }

  async connect(): Promise<void> {
    const eth = this.eth;
    if (!eth) {
      this.lastError.set('No se detectó una wallet. Instalá Core o MetaMask.');
      return;
    }
    this.connecting.set(true);
    this.lastError.set(null);
    try {
      const accs = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      this.account.set((accs[0] as Address) ?? null);
      this.chainId.set(Number(await eth.request({ method: 'eth_chainId' })));
      if (this.wrongChain()) await this.switchNetwork();
      await this.refreshBalances();
    } catch (e) {
      this.lastError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.connecting.set(false);
    }
  }

  async switchNetwork(): Promise<void> {
    const eth = this.eth;
    if (!eth) return;
    const hexId = `0x${this.chain.id.toString(16)}`;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code !== 4902 && code !== -32603) throw e;
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: hexId,
            chainName: this.chain.name,
            nativeCurrency: this.chain.nativeCurrency,
            rpcUrls: this.chain.rpcUrls.default.http,
            blockExplorerUrls: this.chain.blockExplorers ? [this.chain.blockExplorers.default.url] : undefined,
          },
        ],
      });
    }
    this.chainId.set(Number(await eth.request({ method: 'eth_chainId' })));
  }

  async refreshBalances(): Promise<void> {
    const acc = this.account();
    if (!acc || !this.deployment || this.wrongChain()) {
      this.usdcBalance.set(null);
      this.nativeBalance.set(null);
      return;
    }
    try {
      const [usdc, native] = await Promise.all([
        this.publicClient.readContract({
          address: this.deployment.contracts.MockUSDC,
          abi: MockUSDCAbi,
          functionName: 'balanceOf',
          args: [acc],
        }),
        this.publicClient.getBalance({ address: acc }),
      ]);
      this.usdcBalance.set(Number(formatUnits(usdc, USDC_DECIMALS)));
      this.nativeBalance.set(Number(formatUnits(native, 18)));
    } catch {
      this.usdcBalance.set(null);
    }
  }

  /** Simulates (to surface decoded revert reasons), signs, sends and waits for a contract call. */
  async write(label: string, req: WriteRequest): Promise<TransactionReceipt> {
    const id = this.tx.start(label);
    try {
      const account = this.account();
      const eth = this.eth;
      if (!account || !eth) throw new Error('Conectá tu wallet primero.');
      if (this.wrongChain()) await this.switchNetwork();
      const { request } = await this.publicClient.simulateContract({ ...req, account } as Parameters<
        typeof this.publicClient.simulateContract
      >[0]);
      const wallet = createWalletClient({ chain: this.chain, transport: custom(eth), account });
      const hash: Hash = await wallet.writeContract(request as Parameters<typeof wallet.writeContract>[0]);
      this.tx.sent(id, hash);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('La transacción revirtió.');
      this.tx.done(id);
      void this.refreshBalances();
      return receipt;
    } catch (e) {
      throw new Error(this.tx.fail(id, e));
    }
  }

  async faucet(): Promise<void> {
    if (!this.deployment) return;
    await this.write('Faucet: 10.000 USDC de prueba', {
      address: this.deployment.contracts.MockUSDC,
      abi: MockUSDCAbi,
      functionName: 'faucet',
    });
  }

  /** Approves `amount` (6 decimals) for `spender` only if the current allowance is lower. */
  async ensureAllowance(spender: Address, amount: bigint): Promise<void> {
    const acc = this.account();
    if (!acc || !this.deployment) throw new Error('Conectá tu wallet primero.');
    const current = await this.publicClient.readContract({
      address: this.deployment.contracts.MockUSDC,
      abi: MockUSDCAbi,
      functionName: 'allowance',
      args: [acc, spender],
    });
    if (current >= amount) return;
    await this.write(`Aprobar ${formatUnits(amount, USDC_DECIMALS)} USDC`, {
      address: this.deployment.contracts.MockUSDC,
      abi: MockUSDCAbi,
      functionName: 'approve',
      args: [spender, amount],
    });
  }

  /** Local Hardhat only: moves chain time forward (demo of maturity / deadlines). */
  async advanceTime(seconds: number): Promise<void> {
    const req = this.publicClient.request as unknown as (a: { method: string; params?: unknown[] }) => Promise<unknown>;
    await req({ method: 'evm_increaseTime', params: [seconds] });
    await req({ method: 'evm_mine', params: [] });
  }
}
