import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/dashboard').then((m) => m.Dashboard), title: 'AgroToken · Inicio' },
  { path: 'lots', loadComponent: () => import('./pages/marketplace').then((m) => m.Marketplace), title: 'AgroToken · Mercado' },
  { path: 'lots/:id', loadComponent: () => import('./pages/lot-detail').then((m) => m.LotDetail), title: 'AgroToken · Lote' },
  { path: 'producer', loadComponent: () => import('./pages/producer').then((m) => m.Producer), title: 'AgroToken · Registrar lote' },
  { path: 'demo', loadComponent: () => import('./pages/demo').then((m) => m.Demo), title: 'AgroToken · Demo' },
  { path: '**', redirectTo: '' },
];
