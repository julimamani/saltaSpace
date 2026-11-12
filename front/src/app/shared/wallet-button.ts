import { Component, inject, signal } from '@angular/core';
import { WalletService } from '../core/wallet.service';
import { GAS_FAUCET_URL, addressUrl } from '../core/config';
import { shortAddr, usd } from '../core/format';

@Component({
  selector: 'app-wallet-button',
  template: `
    @if (!w.hasProvider()) {
      <a class="btn-primary" href="https://core.app/" target="_blank" rel="noopener">Instalar wallet</a>
    } @else if (!w.connected()) {
      <button class="btn-primary" (click)="w.connect()" [disabled]="w.connecting()">
        {{ w.connecting() ? 'Conectando…' : 'Conectar wallet' }}
      </button>
    } @else if (w.wrongChain()) {
      <button class="btn-warn" (click)="switch()">Cambiar a {{ w.chain.name }}</button>
    } @else {
      <div class="relative">
        <button class="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm shadow-sm hover:bg-emerald-50"
                (click)="open.set(!open())">
          <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
          <span class="font-mono">{{ short(w.account()) }}</span>
          <span class="hidden font-semibold text-emerald-800 sm:inline">{{ usd(w.usdcBalance(), 0) }} USDC</span>
        </button>
        @if (open()) {
          <div class="absolute right-0 z-[1500] mt-2 w-72 rounded-2xl border border-stone-200 bg-white p-4 text-sm shadow-xl">
            <p class="text-xs uppercase tracking-wide text-stone-500">Red</p>
            <p class="mb-3 font-medium">{{ w.chain.name }} (chainId {{ w.chain.id }})</p>
            <div class="mb-3 grid grid-cols-2 gap-2">
              <div class="rounded-lg bg-emerald-50 p-2">
                <p class="text-xs text-stone-500">USDC test</p>
                <p class="font-semibold">{{ usd(w.usdcBalance()) }}</p>
              </div>
              <div class="rounded-lg bg-stone-50 p-2">
                <p class="text-xs text-stone-500">{{ w.chain.nativeCurrency.symbol }}</p>
                <p class="font-semibold">{{ usd(w.nativeBalance(), 3) }}</p>
              </div>
            </div>
            @if (w.verified() === true) {
              <p class="mb-2 rounded-lg bg-emerald-50 p-2 text-xs font-medium text-emerald-700">KYC: wallet verificada</p>
            } @else if (w.verified() === false) {
              @if (w.isCompliance()) {
                <button class="btn-primary mb-2 w-full" (click)="verify()" [disabled]="busy()">
                  {{ busy() ? 'Verificando…' : 'Verificar mi wallet (KYC simulado)' }}
                </button>
              } @else {
                <p class="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  KYC pendiente: pedí la verificación a un compliance officer para poder invertir.
                </p>
              }
            }
            @if (w.canFaucet()) {
              <button class="btn-primary mb-2 w-full" (click)="faucet()" [disabled]="busy()">
                {{ busy() ? 'Pidiendo…' : 'Faucet: +10.000 USDC de prueba' }}
              </button>
            }
            @if (gasFaucet; as url) {
              <a class="btn-ghost mb-2 w-full" [href]="url" target="_blank" rel="noopener">Conseguir {{ w.chain.nativeCurrency.symbol }} de test (gas) ↗</a>
            }
            @if (explorer(); as url) {
              <a class="block text-center text-xs text-emerald-700 underline" [href]="url" target="_blank" rel="noopener">Ver cuenta en el explorador ↗</a>
            }
            @if (error()) { <p class="mt-2 text-xs text-red-600">{{ error() }}</p> }
          </div>
        }
      </div>
    }
  `,
})
export class WalletButton {
  protected readonly w = inject(WalletService);
  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly short = shortAddr;
  protected readonly usd = usd;
  protected readonly gasFaucet = GAS_FAUCET_URL;

  protected explorer(): string | null {
    const a = this.w.account();
    return a ? addressUrl(a) : null;
  }

  protected async switch(): Promise<void> {
    try {
      await this.w.switchNetwork();
      await this.w.refreshBalances();
    } catch (e) {
      this.w.lastError.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected async faucet(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.w.faucet();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async verify(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.w.verifySelf();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
