import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const AUTO_DISMISS_MS = 6000;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  push(kind: ToastKind, text: string) {
    const id = this.nextId++;
    this.toasts.update(t => [...t, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
  }

  dismiss(id: number) {
    this.toasts.update(t => t.filter(x => x.id !== id));
  }
}
