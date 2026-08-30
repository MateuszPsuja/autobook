import { Injectable, signal } from '@angular/core';

export type DialogVariant = 'info' | 'success' | 'warning' | 'error';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
}

export interface AlertOptions {
  title: string;
  message: string;
  okText?: string;
  variant?: DialogVariant;
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'alert'; opts: AlertOptions; resolve: () => void };

export type { DialogState };

/**
 * Global dialog service. Replaces native `window.confirm()` and
 * `window.alert()` with Angular-rendered overlays. Both methods
 * return a Promise that resolves to the user's choice. Only one
 * dialog is visible at a time; calling confirm/alert while one is
 * open queues the new one after the current one is dismissed.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  /** Current dialog state. Read by DialogHostComponent. */
  readonly state = signal<DialogState>({ kind: 'none' });

  /** Pending dialogs queued while another is open. */
  private queue: Array<() => void> = [];

  confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const open = () => {
        this.state.set({ kind: 'confirm', opts, resolve });
      };
      if (this.state().kind === 'none') {
        open();
      } else {
        this.queue.push(open);
      }
    });
  }

  alert(opts: AlertOptions): Promise<void> {
    return new Promise<void>(resolve => {
      const open = () => {
        this.state.set({ kind: 'alert', opts, resolve });
      };
      if (this.state().kind === 'none') {
        open();
      } else {
        this.queue.push(open);
      }
    });
  }

  /** Called by the host when the user dismisses the current dialog. */
  dismiss(value: boolean): void {
    const current = this.state();
    if (current.kind === 'none') return;
    if (current.kind === 'confirm') {
      current.resolve(value);
    } else {
      current.resolve();
    }
    this.state.set({ kind: 'none' });
    // Open the next queued dialog, if any.
    const next = this.queue.shift();
    if (next) {
      // Run on the next microtask so the host has a chance to render
      // the "none" state before the new dialog appears.
      Promise.resolve().then(next);
    }
  }
}
