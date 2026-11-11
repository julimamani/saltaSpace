import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { LotView } from '../core/models';
import { pct, riskLabel, usd } from '../core/format';
import { StatusBadge } from './status-badge';

export const CROP_EMOJI: Record<string, string> = {
  Soja: '🌱', Maíz: '🌽', Poroto: '🫘', Porotos: '🫘', Trigo: '🌾', 'Caña de azúcar': '🎋', Tabaco: '🍂', Citrus: '🍋', Vid: '🍇',
};

@Component({
  selector: 'app-lot-card',
  imports: [RouterLink, StatusBadge],
  template: `
    <a [routerLink]="['/lots', lot().id]"
       class="group flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <div class="mb-3 flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs font-medium uppercase tracking-wide text-emerald-700">{{ emoji() }} {{ lot().crop }} · {{ lot().hectares }} ha</p>
          <h3 class="truncate text-lg font-semibold text-stone-900 group-hover:text-emerald-800">{{ lot().name }}</h3>
        </div>
        <app-status-badge [lot]="lot()" [now]="now()" />
      </div>
      <div class="mb-1 flex justify-between text-sm">
        <span class="text-stone-500">Financiado</span>
        <span class="font-medium">{{ usd(lot().raised, 0) }} / {{ usd(lot().fundingGoal, 0) }} USDC</span>
      </div>
      <div class="mb-4 h-2 overflow-hidden rounded-full bg-stone-100">
        <div class="h-full rounded-full bg-gradient-to-r from-lime-500 to-emerald-600" [style.width.%]="lot().progress * 100"></div>
      </div>
      <div class="mt-auto grid grid-cols-3 gap-2 text-center text-xs">
        <div class="rounded-lg bg-stone-50 p-2">
          <p class="text-stone-500">Retorno est.</p>
          <p class="text-sm font-semibold" [class.text-red-700]="lot().estimatedReturn < 0" [class.text-emerald-700]="lot().estimatedReturn >= 0">{{ pct(lot().estimatedReturn) }}</p>
        </div>
        <div class="rounded-lg bg-stone-50 p-2">
          <p class="text-stone-500">NDVI</p>
          <p class="text-sm font-semibold">{{ lot().metrics ? lot().metrics!.ndvi.toFixed(2) : '—' }}</p>
        </div>
        <div class="rounded-lg p-2" [class]="risk().cls">
          <p class="opacity-75">Riesgo</p>
          <p class="text-sm font-semibold">{{ risk().label }}</p>
        </div>
      </div>
    </a>
  `,
})
export class LotCard {
  readonly lot = input.required<LotView>();
  readonly now = input<number>(Math.floor(Date.now() / 1000));
  protected readonly risk = computed(() => riskLabel(this.lot().metrics?.riskScore));
  protected readonly emoji = computed(() => CROP_EMOJI[this.lot().crop] ?? '🌿');
  protected readonly usd = usd;
  protected readonly pct = pct;
}
