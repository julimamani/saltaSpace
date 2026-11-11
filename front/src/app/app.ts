import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { WalletButton } from './shared/wallet-button';
import { TxToasts } from './shared/tx-toasts';
import { DEPLOYMENT, TARGET_CHAIN } from './core/config';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, WalletButton, TxToasts],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly menuOpen = signal(false);
  protected readonly chainName = TARGET_CHAIN.name;
  protected readonly deployed = !!DEPLOYMENT;
  protected readonly links = [
    { path: '/', label: 'Inicio', exact: true },
    { path: '/lots', label: 'Mercado', exact: false },
    { path: '/producer', label: 'Registrar lote', exact: false },
    { path: '/demo', label: 'Demo', exact: false },
  ];
}
