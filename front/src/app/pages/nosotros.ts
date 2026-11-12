

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, LotCard],
  template: `
    <section class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-900 via-emerald-800 to-lime-700 px-6 py-12 text-white sm:px-10">
      <div class="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-lime-400/20 blur-3xl"></div>
      <p class="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">Avalanche · RWA agro simulado</p>
      <h1 class="max-w-2xl text-3xl font-bold leading-tight sm:text-5xl">Financiá cosechas del norte argentino con datos satelitales reales</h1>
      <p class="mt-4 max-w-2xl text-emerald-50/90">
        Productores de Salta, Jujuy y Tucumán tokenizan un lote antes de sembrar. Inversores compran fracciones con USDC de prueba
        y, al cosechar, un contrato inteligente liquida el pago según Sentinel‑2 (NDVI/NDWI), radar Sentinel‑1 y el balance hídrico
        Penman‑Monteith de Open‑Meteo / NASA POWER. Un <b>seguro paramétrico embebido</b> paga solo cuando los datos marcan sequía: sin peritos.
      </p>
      <div class="mt-6 flex flex-wrap gap-3">
        <a routerLink="/lots" class="rounded-xl bg-white px-5 py-3 font-semibold text-emerald-900 shadow hover:bg-lime-50">Ver lotes para invertir</a>
        <a routerLink="/producer" class="rounded-xl border border-white/40 px-5 py-3 font-semibold hover:bg-white/10">Soy productor: registrar lote</a>
      </div>
    </section>

    <section class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="stat"><p class="stat-label">Total financiado</p><p class="stat-value">{{ usd(totalRaised(), 0) }} <span class="text-base font-medium text-stone-500">USDC</span></p></div>
      <div class="stat"><p class="stat-label">Lotes activos</p><p class="stat-value">{{ activeCount() }} <span class="text-base font-medium text-stone-500">/ {{ lots().length }}</span></p></div>
      <div class="stat"><p class="stat-label">Retorno estimado promedio</p><p class="stat-value text-emerald-700">{{ pct(avgReturn()) }}</p></div>
      <div class="stat"><p class="stat-label">Hectáreas tokenizadas</p><p class="stat-value">{{ totalHa().toLocaleString('es-AR') }} <span class="text-base font-medium text-stone-500">ha</span></p></div>
    </section>
    <section class="mt-4 grid gap-4 sm:grid-cols-2">
      <div class="stat"><p class="stat-label">Pool de seguro paramétrico</p><p class="stat-value">{{ pool() !== null ? usd(pool()!, 0) : '—' }} <span class="text-base font-medium text-stone-500">USDC</span></p><p class="text-xs text-stone-500">3% de cada capital liberado + aportes. Paga cobertura automática cuando el oráculo marca sequía.</p></div>
      <div class="stat"><p class="stat-label">Lotes con trigger de seguro</p><p class="stat-value" [class.text-red-700]="triggered() > 0">{{ triggered() }}</p><p class="text-xs text-stone-500">NDWI bajo + lluvia &lt; 50% del histórico o días críticos secos en floración; caída de NDVI; suelo seco en radar.</p></div>
    </section>

    <section class="mt-4 flex flex-wrap gap-2 text-xs">
      <span class="chip">Red: {{ wallet.chain.name }}</span>
      @if (health(); as h) {
        <span class="chip" [class.!bg-emerald-100]="h.chain.connected">Backend/oráculo: {{ h.chain.connected ? 'conectado' : 'sin cadena' }}</span>
        @if (h.simulate_drought) { <span class="chip !bg-amber-100">SIMULATE_DROUGHT activo</span> }
      } @else if (healthError()) {
        <span class="chip !bg-red-100">Backend no disponible</span>
      }
    </section>

    <section class="mt-10">
      <div class="mb-4 flex items-end justify-between">
        <h2 class="text-2xl font-bold text-stone-900">Lotes destacados</h2>
        <a routerLink="/lots" class="text-sm font-semibold text-emerald-700 hover:underline">Ver todos →</a>
      </div>
      @if (loading()) {
        <div class="grid gap-4 md:grid-cols-3">@for (i of [1, 2, 3]; track i) { <div class="h-52 animate-pulse rounded-2xl bg-stone-200/70"></div> }</div>
      } @else if (error()) {
        <div class="alert-error">{{ error() }}</div>
      } @else if (!lots().length) {
        <div class="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-stone-500">
          Todavía no hay lotes. <a routerLink="/producer" class="font-semibold text-emerald-700 underline">Registrá el primero</a>.
        </div>
      } @else {
        <div class="grid gap-4 md:grid-cols-3">
          @for (l of lots().slice(0, 3); track l.id) { <app-lot-card [lot]="l" [now]="lotsSvc.chainNow()" /> }
        </div>
      }
    </section>

    <section class="mt-12">
      <h2 class="mb-4 text-2xl font-bold text-stone-900">Cómo funciona</h2>
      <ol class="grid gap-4 md:grid-cols-4">
        @for (s of steps; track s.t; let i = $index) {
          <li class="rounded-2xl border border-stone-200 bg-white p-5">
            <span class="mb-2 grid h-8 w-8 place-items-center rounded-full bg-lime-100 font-bold text-emerald-800">{{ i + 1 }}</span>
            <p class="font-semibold">{{ s.t }}</p>
            <p class="mt-1 text-sm text-stone-600">{{ s.d }}</p>
          </li>
        }
      </ol>
    </section>
  `,
})
export class Dashboard {
  
}
