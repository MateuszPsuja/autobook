import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService, DialogVariant } from './dialog.service';

/**
 * Renders the active dialog (if any) from DialogService. Mount this
 * once near the app root — it lives outside the router-outlet so
 * dialogs are visible regardless of which page the user is on.
 *
 * Backdrop click dismisses confirm dialogs with `false` and alert
 * dialogs as an OK. Escape key behaves the same way.
 */
@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (state().kind !== 'none') {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        (click)="onBackdropClick($event)">
        <div
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId()"
          class="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          (click)="$event.stopPropagation()">
          <div class="px-6 pt-5 pb-2 flex items-start gap-3">
            <div [class]="iconWrapClass()">
              <svg class="w-5 h-5" [class]="iconColor()" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                @switch (variant()) {
                  @case ('success') {
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                  }
                  @case ('error') {
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M4.93 4.93l14.14 14.14M12 22a10 10 0 100-20 10 10 0 000 20z"></path>
                  }
                  @case ('warning') {
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"></path>
                  }
                  @default {
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  }
                }
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <h3 [id]="titleId()" class="text-base font-semibold text-gray-900 dark:text-white">
                {{ title() }}
              </h3>
              <p class="mt-1.5 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">
                {{ message() }}
              </p>
            </div>
          </div>
          <div class="px-6 py-4 flex justify-end gap-2 bg-gray-50 dark:bg-gray-900/40">
            @if (state().kind === 'confirm') {
              <button
                type="button"
                (click)="onCancel()"
                class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                {{ cancelText() }}
              </button>
            }
            <button
              type="button"
              (click)="onConfirm()"
              [class]="primaryButtonClass()">
              {{ primaryButtonText() }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
  `]
})
export class DialogHostComponent {
  private dialogService = inject(DialogService);
  readonly state = this.dialogService.state;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.state().kind === 'none') return;
    if (this.state().kind === 'confirm') {
      this.dialogService.dismiss(false);
    } else {
      this.dialogService.dismiss(false);
    }
  }

  title(): string {
    const s = this.state();
    return s.kind === 'none' ? '' : s.opts.title;
  }

  message(): string {
    const s = this.state();
    return s.kind === 'none' ? '' : s.opts.message;
  }

  variant(): DialogVariant {
    const s = this.state();
    return s.kind === 'none' ? 'info' : (s.opts.variant ?? 'info');
  }

  primaryButtonText(): string {
    const s = this.state();
    if (s.kind === 'none') return '';
    if (s.kind === 'alert') return s.opts.okText ?? 'OK';
    return s.opts.confirmText ?? 'OK';
  }

  cancelText(): string {
    const s = this.state();
    if (s.kind !== 'confirm') return '';
    return s.opts.cancelText ?? 'Cancel';
  }

  titleId(): string {
    return 'dialog-title';
  }

  iconWrapClass(): string {
    return 'flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ' + this.iconWrapBg();
  }

  private iconWrapBg(): string {
    switch (this.variant()) {
      case 'success': return 'bg-green-100 dark:bg-green-900/30';
      case 'error': return 'bg-red-100 dark:bg-red-900/30';
      case 'warning': return 'bg-amber-100 dark:bg-amber-900/30';
      default: return 'bg-blue-100 dark:bg-blue-900/30';
    }
  }

  iconColor(): string {
    switch (this.variant()) {
      case 'success': return 'text-green-600 dark:text-green-400';
      case 'error': return 'text-red-600 dark:text-red-400';
      case 'warning': return 'text-amber-600 dark:text-amber-400';
      default: return 'text-blue-600 dark:text-blue-400';
    }
  }

  primaryButtonClass(): string {
    const base = 'px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-50';
    switch (this.variant()) {
      case 'success': return base + ' bg-green-600 hover:bg-green-700';
      case 'error': return base + ' bg-red-600 hover:bg-red-700';
      case 'warning': return base + ' bg-amber-600 hover:bg-amber-700';
      default: return base + ' bg-brand-500 hover:bg-brand-600';
    }
  }

  onConfirm(): void {
    this.dialogService.dismiss(true);
  }

  onCancel(): void {
    this.dialogService.dismiss(false);
  }

  onBackdropClick(event: MouseEvent): void {
    // Only dismiss when the click was on the backdrop itself, not
    // bubbled up from a button inside the dialog.
    if (event.target === event.currentTarget) {
      this.dialogService.dismiss(false);
    }
  }
}
