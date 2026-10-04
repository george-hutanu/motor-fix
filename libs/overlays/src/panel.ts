import { DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT, NgComponentOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  inject,
  reflectComponentType,
  signal,
  type Type,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@motor-fix/i18n';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { filter } from 'rxjs';

import { OVERLAY_TASK, type OverlayTask, type PanelContext } from './task';

const FIELD =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable]:not([contenteditable="false"])';

// A computer: wide enough not to be a phone, and a mouse or trackpad, so
// focusing a field does not pop up an on-screen keyboard.
const COMPUTER = '(min-width: 768px) and (pointer: fine)';

let questions = 0;

// The panel every task is shown in: the kit's dialog or right-hand sheet
// surface, a header with the title and the X, and the task in a body that
// scrolls on its own.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-side]': "context.shape === 'dialog' ? null : 'right'",
    '[class.mf-overlay-dialog]': "context.shape === 'dialog'",
    '[class.mf-overlay-drawer-wide]': "context.shape === 'drawer-wide'",
    '[class.mf-overlay-drawer]': "context.shape === 'drawer'",
    '[class.spartan-dialog-content]': "context.shape === 'dialog'",
    '[class.spartan-sheet-content]': "context.shape !== 'dialog'",
  },
  imports: [NgComponentOutlet, TranslatePipe],
  selector: 'mf-overlay-panel',
  styles: `
    :host.spartan-dialog-content,
    :host.spartan-sheet-content {
      grid-template-rows: auto minmax(0, 1fr);
      gap: 0;
      padding: 0;
      overflow: hidden;
    }
    :host.mf-overlay-dialog {
      max-height: calc(100dvh - 48px);
    }
    :host.mf-overlay-drawer {
      width: min(480px, 100vw);
    }
    :host.mf-overlay-drawer-wide {
      width: min(720px, 100vw);
    }
    .mf-overlay-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-space-3);
      padding: var(--mf-space-3) var(--mf-space-3) var(--mf-space-3)
        var(--mf-space-6);
      border-bottom: 1px solid var(--mf-line);
    }
    :host.spartan-sheet-content .mf-overlay-header {
      padding-top: calc(var(--mf-space-3) + var(--mf-safe-top));
    }
    .mf-overlay-title {
      min-width: 0;
      margin: 0;
      overflow-wrap: anywhere;
    }
    .mf-overlay-close {
      flex: none;
      width: var(--mf-tap);
      min-width: var(--mf-tap);
      padding: 0;
    }
    .mf-overlay-body,
    .mf-overlay-question {
      min-height: 0;
      padding: var(--mf-space-5) var(--mf-space-6)
        max(var(--mf-space-6), var(--mf-safe-bottom));
    }
    .mf-overlay-body {
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .mf-overlay-body[hidden] {
      display: none;
    }
    .mf-overlay-question {
      display: grid;
      align-content: start;
      gap: var(--mf-space-4);
    }
    .mf-overlay-question p {
      margin: 0;
    }
    .mf-overlay-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--mf-space-3);
    }
    .mf-overlay-actions button {
      white-space: normal;
    }
    .mf-overlay-skeleton {
      display: grid;
      gap: var(--mf-space-3);
    }
    .mf-overlay-skeleton span {
      height: var(--mf-space-4);
      border-radius: var(--mf-radius-chip);
      background: var(--mf-line);
    }
    .mf-overlay-skeleton span:last-child {
      width: 60%;
    }
  `,
  template: `
    <header class="mf-overlay-header">
      <h2 class="mf-label mf-overlay-title" [id]="context.titleId">
        {{ context.title | t }}
      </h2>
      <button
        type="button"
        class="spartan-button spartan-button-variant-ghost mf-overlay-close"
        [attr.aria-label]="'shell.overlay.close' | t"
        (click)="dismiss()"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="20"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-width="2"
          viewBox="0 0 24 24"
          width="20"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </header>
    <div
      #body
      class="mf-overlay-body"
      [hidden]="asking()"
      [attr.aria-busy]="task() ? null : 'true'"
      (input)="changed = true"
    >
      @if (task(); as component) {
        <ng-container *ngComponentOutlet="component; injector: taskInjector" />
      } @else {
        <div class="mf-overlay-skeleton" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      }
    </div>
    @if (asking()) {
      <div
        class="mf-overlay-question"
        role="alertdialog"
        [attr.aria-labelledby]="questionId"
      >
        <p [id]="questionId">{{ 'shell.overlay.discard.question' | t }}</p>
        <div class="mf-overlay-actions">
          <button
            #keepButton
            type="button"
            class="spartan-button spartan-button-variant-default"
            (click)="keep()"
          >
            {{ 'shell.overlay.discard.keep' | t }}
          </button>
          <button
            type="button"
            class="spartan-button spartan-button-variant-secondary"
            (click)="close()"
          >
            {{ 'shell.overlay.discard.discard' | t }}
          </button>
        </div>
      </div>
    }
  `,
})
export class OverlayPanel {
  protected readonly context = injectBrnDialogContext<PanelContext>();
  private readonly dialog = inject(BrnDialogRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
  private readonly keepButton =
    viewChild<ElementRef<HTMLButtonElement>>('keepButton');

  protected readonly questionId = `mf-overlay-question-${++questions}`;
  protected readonly asking = signal(false);
  protected readonly task = signal<Type<unknown> | null>(null);
  protected changed = false;
  private focusedBeforeAsking: HTMLElement | null = null;

  private readonly taskApi: OverlayTask<unknown, unknown> = {
    close: (result) => this.dialog.close(result),
    data: this.context.data,
    markUnchanged: () => {
      this.changed = false;
    },
  };
  protected readonly taskInjector = Injector.create({
    parent: this.injector,
    providers: [{ provide: OVERLAY_TASK, useValue: this.taskApi }],
  });

  constructor() {
    const cdkDialog = inject(DialogRef);
    cdkDialog.keydownEvents
      .pipe(
        filter((event) => event.key === 'Escape'),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        event.preventDefault();
        if (this.asking()) this.keep();
        else this.dismiss();
      });
    cdkDialog.backdropClick
      .pipe(takeUntilDestroyed())
      .subscribe(() => !this.asking() && this.dismiss());

    const { source } = this.context;
    if (reflectComponentType(source as Type<unknown>)) {
      this.task.set(source as Type<unknown>);
    } else {
      (source as () => Promise<Type<unknown>>)().then(
        (component) => {
          this.task.set(component);
          this.afterRender(() => this.focusStart());
        },
        (error) =>
          console.error('mf-overlay-panel: the task did not load.', error),
      );
    }
    this.afterRender(() => this.focusStart());
  }

  // X, Escape and a click outside: ask first when a field changed.
  protected dismiss() {
    if (!this.changed || this.context.confirmDiscard === false) {
      this.close();
      return;
    }
    const active = this.window?.document.activeElement;
    this.focusedBeforeAsking = active instanceof HTMLElement ? active : null;
    this.asking.set(true);
    this.afterRender(() => this.keepButton()?.nativeElement.focus());
  }

  protected keep() {
    this.asking.set(false);
    this.afterRender(() => {
      if (this.focusedBeforeAsking?.isConnected)
        this.focusedBeforeAsking.focus();
      else this.focusStart();
    });
  }

  protected close() {
    this.dialog.close();
  }

  private focusStart() {
    const field = this.window?.matchMedia?.(COMPUTER).matches
      ? this.body().nativeElement.querySelector<HTMLElement>(FIELD)
      : null;
    const target =
      field ??
      this.host.nativeElement.closest<HTMLElement>('[role="dialog"]') ??
      this.host.nativeElement;
    target.focus({ preventScroll: true });
  }

  private afterRender(run: () => void) {
    afterNextRender(run, { injector: this.injector });
  }
}
