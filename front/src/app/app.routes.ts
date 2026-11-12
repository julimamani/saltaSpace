import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/dashboard').then((m) => m.Dashboard), title: 'OrbiTag · Inicio' },
  { path: 'lots', loadComponent: () => import('./pages/marketplace').then((m) => m.Marketplace), title: 'OrbiTag · Mercado' },
  { path: 'lots/:id', loadComponent: () => import('./pages/lot-detail').then((m) => m.LotDetail), title: 'OrbiTag · Lote' },
  { path: 'producer', loadComponent: () => import('./pages/producer').then((m) => m.Producer), title: 'OrbiTag · Registrar lote' },
  { path: 'demo', loadComponent: () => import('./pages/demo').then((m) => m.Demo), title: 'OrbiTag · Demo' },
  { path: 'nosotros', loadComponent: () => import('./pages/nosotros').then((m) => m.Nosotros), title: 'OrbiTag · Nosotros' },
  { path: '**', redirectTo: '' },
];
