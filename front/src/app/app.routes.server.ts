import { RenderMode, ServerRoute } from '@angular/ssr';

// Wallet, chain reads, Leaflet and Chart.js only run in the browser, so data pages render client-side.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'nosotros', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
