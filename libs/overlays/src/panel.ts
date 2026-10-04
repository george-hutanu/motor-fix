import { DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT, NgComponentOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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

// Not a phone: the complement of the kit's phone rule in cockpit.css. Below
// it every task is a bottom sheet.
export const TABLET = '(min-width: 768px)';

// A computer: wide enough not to be a phone, and a mouse or trackpad, so
// focusing a field does not pop up an on-screen keyboard.
const COMPUTER = `${TABLET} and (pointer: fine)`;

let questions = 0;

// The panel every task is shown in: the kit's dialog, right-hand sheet or, on
// a phone, bottom sheet surface (with a grip to drag it down), a header with
// the title and the X, and the task in a body that scrolls on its own.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-side]': 'side',
    '[class.mf-overlay-dialog]': "shape === 'dialog'",
    '[class.mf-overlay-dragging]': 'drag() !== null',
    '[class.mf-overlay-drawer-wide]': "shape === 'drawer-wide'",
    '[class.mf-overlay-drawer]': "shape === 'drawer'",
    '[class.mf-overlay-sheet]': 'context.sheet',
    '[class.spartan-dialog-content]': "shape === 'dialog'",
    '[class.spartan-sheet-content]': "shape !== 'dialog'",
    '[style.--mf-drag]': 'drag()',
    '[style.--mf-keyboard]': 'keyboard()',
    '[style.--mf-visible-height]': 'visibleHeight()',
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
    /* [data-side] outranks the kit's own bottom edge, whatever the load order. */
    :host.mf-overlay-sheet[data-side] {
      grid-template-rows: auto auto minmax(0, 1fr);
      max-height: calc(0.92 * var(--mf-visible-height, 100dvh));
      inset-block-end: var(--mf-keyboard, 0px);
      transform: translateY(var(--mf-drag, 0px));
      transition: transform var(--mf-motion-pop) var(--mf-motion-ease);
    }
    :host.mf-overlay-dragging {
      transition: none;
    }
    .mf-overlay-grip {
      display: flex;
      align-items: center;
      justify-content: center;
      height: var(--mf-tap);
      touch-action: none;
      cursor: grab;
    }
    .mf-overlay-grip::before {
      content: "";
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: var(--mf-line-strong);
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
    :host[data-side='right'] .mf-overlay-header {
      padding-top: calc(var(--mf-space-3) + var(--mf-safe-top));
    }
    :host.mf-overlay-sheet .mf-overlay-header {
      padding-top: 0;
      padding-inline: max(var(--mf-space-6), var(--mf-safe-left))
        max(var(--mf-space-3), var(--mf-safe-right));
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
    :host.mf-overlay-sheet .mf-overlay-question,
    :host.mf-overlay-sheet .mf-overlay-body {
      padding-inline: max(var(--mf-space-6), var(--mf-safe-left))
        max(var(--mf-space-6), var(--mf-safe-right));
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
    @if (context.sheet) {
      <div
        class="mf-overlay-grip"
        aria-hidden="true"
        (pointerdown)="grab($event)"
        (pointermove)="pull($event)"
        (pointerup)="release($event)"
        (pointercancel)="letGo($event)"
        (lostpointercapture)="letGo($event)"
      ></div>
    }
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

  protected readonly shape = this.context.sheet ? 'sheet' : this.context.shape;
  protected readonly side = this.context.sheet
    ? 'bottom'
    : this.context.shape === 'dialog'
      ? null
      : 'right';
  protected readonly questionId = `mf-overlay-question-${++questions}`;
  protected readonly asking = signal(false);
  protected readonly task = signal<Type<unknown> | null>(null);
  protected changed = false;
  private focusedBeforeAsking: HTMLElement | null = null;
  // How far the grip is pulled down, and where the pull started.
  protected readonly drag = signal<string | null>(null);
  private pullFrom: { height: number; pointer: number; y: number } | null =
    null;
  // The part of the window an on-screen keyboard hides, and what is left.
  protected readonly keyboard = signal<string | null>(null);
  protected readonly visibleHeight = signal<string | null>(null);

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
      const destroyed = inject(DestroyRef);
      (source as () => Promise<Type<unknown>>)().then(
        (component) => {
          // Closed while it was loading: nothing left to show it in.
          if (destroyed.destroyed) return;
          this.task.set(component);
          this.afterRender(() => this.focusStart());
        },
        (error) =>
          console.error('mf-overlay-panel: the task did not load.', error),
      );
    }
    this.afterRender(() => this.focusStart());
    if (this.context.sheet) this.followVisibleArea();
  }

  // One pointer drags at a time; a second finger is ignored.
  protected grab(event: PointerEvent) {
    if (event.button !== 0 || this.pullFrom) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.pullFrom = {
      height: this.host.nativeElement.offsetHeight,
      pointer: event.pointerId,
      y: event.clientY,
    };
  }

  protected pull(event: PointerEvent) {
    if (event.pointerId !== this.pullFrom?.pointer) return;
    this.drag.set(`${Math.max(0, event.clientY - this.pullFrom.y)}px`);
  }

  // Past a third of its height the sheet closes as the X does; otherwise,
  // and when the system takes the pointer, it springs back. While the discard
  // question shows, a drag only springs back, as Escape and outside only keep.
  protected release(event: PointerEvent) {
    const from = this.pullFrom;
    if (event.pointerId !== from?.pointer) return;
    this.letGo(event);
    if (!this.asking() && event.clientY - from.y > from.height / 3)
      this.dismiss();
  }

  protected letGo(event: PointerEvent) {
    if (event.pointerId !== this.pullFrom?.pointer) return;
    this.pullFrom = null;
    this.drag.set(null);
  }

  // iOS does not shrink the layout viewport for the on-screen keyboard, so a
  // sheet on the bottom edge would sit under it: follow the visual viewport.
  private followVisibleArea() {
    const window = this.window;
    const visible = window?.visualViewport;
    if (!window || !visible) return;
    const follow = () => {
      const hidden = window.innerHeight - visible.offsetTop - visible.height;
      this.keyboard.set(`${Math.max(0, Math.round(hidden))}px`);
      this.visibleHeight.set(`${visible.height}px`);
    };
    // A resize is the keyboard opening or closing: bring the field into
    // view then, not on every pan of the visible area.
    const resize = () => {
      follow();
      this.afterRender(() => {
        const focused = window.document.activeElement;
        if (
          focused instanceof HTMLElement &&
          this.body().nativeElement.contains(focused)
        )
          focused.scrollIntoView({ block: 'nearest' });
      });
    };
    follow();
    visible.addEventListener('resize', resize);
    visible.addEventListener('scroll', follow);
    inject(DestroyRef).onDestroy(() => {
      visible.removeEventListener('resize', resize);
      visible.removeEventListener('scroll', follow);
    });
  }

  // X, Escape, a click outside and a drag down: ask first when a field changed.
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
