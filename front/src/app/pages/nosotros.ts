import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Crop {
  name: string;
  region: string;
  why: string;
}

interface CropGroup {
  title: string;
  intro: string;
  crops: Crop[];
}

@Component({
  selector: 'app-nosotros',
  imports: [RouterLink],
  template: `
    <section class="rounded-3xl bg-gradient-to-br from-emerald-900 via-emerald-800 to-lime-700 px-6 py-10 text-white sm:px-10">
      <p class="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">Nosotros · Tecnología</p>
      <h1 class="max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">No se puede tokenizar cualquier cosa</h1>
      <p class="mt-4 max-w-3xl text-emerald-50/90">
        AgroToken financia la producción de economías regionales del norte argentino con tokens en Avalanche, cuyo pago depende de datos
        satelitales y climáticos reales. Para que un Activo del Mundo Real (RWA) sea viable financieramente, el producto físico que lo respalda
        tiene que cumplir tres condiciones.
      </p>
    </section>

    <section class="mt-8 grid gap-4 md:grid-cols-3">
      @for (p of pillars; track p.title) {
        <div class="card">
          <span class="mb-2 block text-2xl">{{ p.icon }}</span>
          <h2 class="card-title">{{ p.title }}</h2>
          <p class="mt-1 text-sm text-stone-600">{{ p.text }}</p>
        </div>
      }
    </section>

    <section class="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <b>¿Por qué no frutillas o tomates?</b> Se pudren en una semana: el riesgo de pérdida rompe el modelo de inversión.
      En cambio, la yerba mate (que necesita meses de estacionamiento) o los granos secos son perfectos.
    </section>

    @for (g of groups; track g.title; let i = $index) {
      <section class="mt-10">
        <h2 class="text-2xl font-bold text-stone-900">{{ i + 1 }}. {{ g.title }}</h2>
        <p class="mb-4 mt-1 max-w-3xl text-stone-600">{{ g.intro }}</p>
        <div class="grid gap-4 md:grid-cols-2">
          @for (c of g.crops; track c.name) {
            <article class="card">
              <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-semibold text-stone-900">{{ c.name }}</h3>
                <span class="chip">{{ c.region }}</span>
              </div>
              <p class="text-sm text-stone-600">{{ c.why }}</p>
            </article>
          }
        </div>
      </section>
    }

    <section class="mt-10">
      <h2 class="text-2xl font-bold text-stone-900">3. La seguridad de las stablecoins</h2>
      <p class="mb-4 mt-1 max-w-3xl text-stone-600">
        Los inversores aportan y cobran en una stablecoin (USDC) y no en una cripto volátil. Así el riesgo que asumen es el de la cosecha y
        no el del precio del token.
      </p>
      <div class="grid gap-4 md:grid-cols-3">
        @for (s of stable; track s.title) {
          <div class="card"><h3 class="font-semibold text-stone-900">{{ s.title }}</h3><p class="mt-1 text-sm text-stone-600">{{ s.text }}</p></div>
        }
      </div>
      <p class="mt-3 text-xs text-stone-500">En este prototipo se usa <b>MockUSDC</b>, un USDC de prueba sin valor real en testnet.</p>
    </section>

    <section class="mt-10">
      <h2 class="mb-4 text-2xl font-bold text-stone-900">Tecnología del proyecto</h2>
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        @for (t of tech; track t.title) {
          <div class="card">
            <h3 class="font-semibold text-emerald-800">{{ t.title }}</h3>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
              @for (item of t.items; track item) { <li>{{ item }}</li> }
            </ul>
          </div>
        }
      </div>
    </section>

    <section class="mt-10 flex flex-wrap gap-3">
      <a routerLink="/lots" class="btn-primary">Ver lotes para invertir</a>
      <a routerLink="/producer" class="btn-ghost">Registrar un lote</a>
    </section>
  `,
})
export class Nosotros {
  protected readonly pillars = [
    { icon: '⚖️', title: 'Fungibilidad', text: 'Una unidad vale lo mismo que otra de igual calidad: un kilo de poroto alubia calibre 7 es intercambiable por otro.' },
    { icon: '📏', title: 'Estandarización', text: 'Calidad medible y uniforme (calibre, humedad, clase), con estándares de mercado o internacionales.' },
    { icon: '🏚️', title: 'Almacenamiento', text: 'No perecedero a corto plazo: se guarda en silos, fardos o bolsas sin perder valor mientras dura la inversión.' },
  ];

  protected readonly groups: CropGroup[] = [
    {
      title: 'Legumbres y granos secos (el caso de uso perfecto en el NOA)',
      intro: 'Altamente fungibles, se almacenan en silos y tienen estándares internacionales de calidad (calibre y humedad).',
      crops: [
        { name: 'Poroto negro y poroto alubia', region: 'Salta · Jujuy', why: 'Salta y Jujuy son potencias productoras. Se guarda seco, su calidad es medible y se exporta: un cuasi‑commodity ideal.' },
        { name: 'Garbanzos y lentejas', region: 'NOA', why: 'Misma lógica que el poroto: mercados internacionales fuertes y no se pudren rápido.' },
        { name: 'Chía y quínoa', region: 'Andes · NOA', why: 'Cultivos andinos de alto valor agregado, con un público de alto poder adquisitivo y escala mundial. Se almacenan secos.' },
        { name: 'Soja y maíz', region: 'Todo el país', why: 'Los reyes del commodity. Ya hay modelos que tokenizan el grano guardado; nuestro diferencial es financiar la producción.' },
      ],
    },
    {
      title: 'Cultivos industriales (biomasa y procesamiento)',
      intro: 'No se venden como fruta fresca: pasan por un proceso industrial que los convierte en bienes estandarizados que se pueden estacionar.',
      crops: [
        { name: 'Tabaco (Virginia y Burley)', region: 'Jujuy · Salta', why: 'Se cosecha, se seca en estufa, se enfarda y se estaciona. Un token puede representar un fardo clasificado: el mercado ya usa calidades muy estrictas.' },
        { name: 'Caña de azúcar', region: 'Tucumán · Jujuy · Salta', why: 'La caña se muele rápido, pero lo tokenizable es el azúcar en bolsa o el bioetanol: se tokeniza el rendimiento esperado en el ingenio.' },
        { name: 'Algodón', region: 'Chaco · Santiago del Estero', why: 'La fibra desmotada se almacena en fardos, no es perecedera y tiene estándares globales.' },
        { name: 'Yerba mate', region: 'Misiones · Corrientes', why: 'Requiere meses de estacionamiento: el producto está diseñado para guardarse sin perder valor.' },
      ],
    },
  ];

  protected readonly stable = [
    { title: 'Valor estable', text: 'Cada USDC busca valer 1 dólar: el capital invertido y el pago al cosechar se miden en una unidad estable.' },
    { title: 'Respaldo y auditoría', text: 'Las stablecoins reguladas publican reportes de reservas. En producción habría que elegir emisores auditados y evaluar el riesgo de pérdida de paridad.' },
    { title: 'Liquidación on-chain', text: 'Inversión, repago, seguro paramétrico y cobro se mueven en el mismo token dentro del contrato, sin intermediarios ni conversiones.' },
  ];

  protected readonly tech = [
    { title: 'Blockchain · Avalanche', items: ['Contratos Solidity en C‑Chain (Fuji testnet)', 'Un token ERC‑20 por lote (clones EIP‑1167)', 'CampaignVault: inversión, repago, liquidación y seguro paramétrico', 'OpenZeppelin: ReentrancyGuard, Pausable, SafeERC20, roles'] },
    { title: 'Satélites', items: ['Sentinel‑2 (Earth Search): NDVI, EVI, NDWI y LAI semanales', 'Sentinel‑1 radar (Planetary Computer): VV/VH, atraviesa nubes', 'Si Sentinel‑2 tiene > 20% de nubes, manda el radar'] },
    { title: 'Clima y agua', items: ['Open‑Meteo y NASA POWER (diario + histórico 2001‑2025)', 'ET0 FAO‑56 Penman‑Monteith', 'ETc = ET0 × Kc por cultivo y balance hídrico en floración'] },
    { title: 'Oráculo', items: ['Backend Python / FastAPI', 'Publica métricas firmadas con ORACLE_ROLE', 'dataHash ancla los datos usados en cada publicación'] },
    { title: 'Seguro paramétrico', items: ['3% del capital va a un pool de cobertura', 'Se dispara por datos: NDWI bajo + lluvia < 50% del histórico, caída de NDVI o suelo seco en radar', 'Paga sin perito: cualquiera puede ejecutarlo'] },
    { title: 'Interfaz', items: ['Angular 21 con SSR y Tailwind CSS', 'viem para la wallet (Core / MetaMask)', 'Leaflet para mapas y Chart.js para gráficos'] },
  ];
}
