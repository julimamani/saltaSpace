import { Component, computed, input } from '@angular/core';
import type { LotView } from '../core/models';

export function statusInfo(lot: LotView, now: number): { label: string; cls: string } {
  switch (lot.status) {
    case 'Funding':
      return now > lot.fundingDeadline
        ? { label: 'Meta no alcanzada', cls: 'bg-red-100 text-red-800' }
        : { label: 'En financiamiento', cls: 'bg-sky-100 text-sky-800' };
    case 'Funded':
      return now >= lot.maturity
        ? { label: 'Listo para liquidar', cls: 'bg-amber-100 text-amber-800' }
        : { label: lot.fundsReleased ? 'En cultivo' : 'Financiado', cls: 'bg-emerald-100 text-emerald-800' };
    case 'Failed':
      return { label: 'Fallido · reembolso', cls: 'bg-red-100 text-red-800' };
    case 'Settled':
      return { label: 'Liquidado', cls: 'bg-violet-100 text-violet-800' };
  }
}

@Component({
  selector: 'app-status-badge',
  template: `<span class="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" [class]="info().cls">{{ info().label }}</span>`,
})
export class StatusBadge {
  readonly lot = input.required<LotView>();
  readonly now = input<number>(Math.floor(Date.now() / 1000));
  protected readonly info = computed(() => statusInfo(this.lot(), this.now()));
}
