import { Component, inject } from '@angular/core';
import { TxService } from '../core/tx.service';
import { shortAddr } from '../core/format';

@Component({
  selector: 'app-tx-toasts',
  template: `
    <div class="pointer-events-none fixed bottom-4 right-4 z-[2000] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
      @for (t of tx.entries(); track t.id) {
        <div class="pointer-events-auto rounded-xl border bg-white p-3 text-sm shadow-lg"
             [class.border-emerald-300]="t.status === 'success'" [class.border-red-300]="t.status === 'error'"
             [class.border-amber-300]="t.status === 'pending' || t.status === 'signing'">
          <div class="flex items-start gap-2">
            <span class="mt-0.5">
              @switch (t.status) {
                @case ('signing') { <span class="spinner"></span> }
                @case ('pending') { <span class="spinner"></span> }
                @case ('success') { <span class="text-emerald-600">✔</span> }
                @case ('error') { <span class="text-red-600">✖</span> }
              }
            </span>
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-stone-800">{{ t.label }}</p>
              <p class="text-xs text-stone-500">
                @switch (t.status) {
                  @case ('signing') { Confirmá en tu wallet… }
                  @case ('pending') { Esperando confirmación en la red… }
                  @case ('success') { Confirmada }
                  @case ('error') { <span class="text-red-700">{{ t.error }}</span> }
                }
              </p>
              @if (t.hash) {
                @if (t.url) {
                  <a class="text-xs font-medium text-emerald-700 underline" [href]="t.url" target="_blank" rel="noopener">Ver en el explorador ↗</a>
                } @else {
                  <p class="font-mono text-xs text-stone-400">tx {{ short(t.hash) }}</p>
                }
              }
            </div>
            <button class="text-stone-400 hover:text-stone-700" (click)="tx.dismiss(t.id)" aria-label="Cerrar">×</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class TxToasts {
  protected readonly tx = inject(TxService);
  protected readonly short = shortAddr;
}
