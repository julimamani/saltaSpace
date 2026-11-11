import { Injectable, signal } from '@angular/core';
import { txUrl } from './config';
import { errorMessage } from './errors';

export type TxStatus = 'signing' | 'pending' | 'success' | 'error';

export interface TxEntry {
  id: number;
  label: string;
  status: TxStatus;
  hash?: string;
  url?: string | null;
  error?: string;
}

/** Transaction status feed rendered as toasts (signing → pending → success / error). */
@Injectable({ providedIn: 'root' })
export class TxService {
  readonly entries = signal<TxEntry[]>([]);
  private nextId = 1;

  start(label: string): number {
    const id = this.nextId++;
    this.entries.update((l) => [{ id, label, status: 'signing' as TxStatus }, ...l].slice(0, 6));
    return id;
  }

  sent(id: number, hash: string): void {
    this.patch(id, { status: 'pending', hash, url: txUrl(hash) });
  }

  done(id: number): void {
    this.patch(id, { status: 'success' });
    setTimeout(() => this.dismiss(id), 12_000);
  }

  fail(id: number, e: unknown): string {
    const error = errorMessage(e);
    this.patch(id, { status: 'error', error });
    return error;
  }

  info(label: string, hash?: string | null): void {
    const id = this.nextId++;
    this.entries.update((l) =>
      [{ id, label, status: 'success' as TxStatus, hash: hash ?? undefined, url: hash ? txUrl(hash) : null }, ...l].slice(0, 6),
    );
    setTimeout(() => this.dismiss(id), 12_000);
  }

  dismiss(id: number): void {
    this.entries.update((l) => l.filter((e) => e.id !== id));
  }

  private patch(id: number, p: Partial<TxEntry>): void {
    this.entries.update((l) => l.map((e) => (e.id === id ? { ...e, ...p } : e)));
  }
}
