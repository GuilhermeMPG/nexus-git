import { Component, inject } from '@angular/core';
import { NotificationService } from '../../core/notification.service';

@Component({
  selector: 'app-toast',
  template: `
    <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
      @for (toast of notifications.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-start gap-2 px-3.5 py-2.5 rounded-lg border shadow-lg text-xs
                 {{ toast.kind === 'success' ? 'bg-emerald-900/90 border-emerald-700/50 text-emerald-200'
                  : toast.kind === 'error' ? 'bg-red-900/90 border-red-700/50 text-red-200'
                  : 'bg-gray-800/95 border-gray-700/50 text-gray-200' }}">
          <span class="shrink-0">
            @switch (toast.kind) {
              @case ('success') { ✓ }
              @case ('error') { ⚠ }
              @default { ℹ }
            }
          </span>
          <span class="flex-1 leading-snug">{{ toast.text }}</span>
          <button (click)="notifications.dismiss(toast.id)"
            class="shrink-0 opacity-60 hover:opacity-100 transition">✕</button>
        </div>
      }
    </div>
  `,
})
export class ToastComponent {
  protected notifications = inject(NotificationService);
}
