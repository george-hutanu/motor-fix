import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  Injector,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  type TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';

import { CloseIcon } from './helm/close-icon';
import { REDUCED_MOTION } from './reduced-motion';

export interface ViewerPhoto {
  alt: string;
  displayUrl: string;
  /** The host gave up on this photo: the stage shows its placeholder. */
  failed?: boolean;
  id: string;
}

export interface ViewerLabels {
  close: string;
  counter: (n: number, total: number) => string;
  next: string;
  previous: string;
}

const SWIPE = 50;
let next = 0;

// The dark around the photo, where a tap closes the view.
const dark = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  ['viewer-backdrop', 'viewer-frame', 'viewer-stage'].includes(
    target.dataset['slot'] ?? '',
  );

// A full-screen view of one photo at a time over a dark mask. Built on the CDK
// dialog, which traps focus and blocks the page scroll; focus goes back by hand
// so a host whose opener was re-rendered away can name where it lands instead.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CloseIcon],
  selector: 'mf-photo-viewer',
  styles: `
    .viewer {
      position: fixed;
      inset: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      background: var(--mf-bg);
      color: var(--mf-text);
      touch-action: none;
      user-select: none;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--mf-space-3);
      padding: var(--mf-space-2) var(--mf-space-2) var(--mf-space-2) var(--mf-space-4);
      font-family: var(--mf-font-label);
      font-size: var(--mf-size-label);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .counter {
      color: var(--mf-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .control {
      display: inline-grid;
      place-items: center;
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      border: 1px solid var(--mf-line);
      border-radius: var(--mf-radius-control);
      background: var(--mf-panel-raised);
      color: var(--mf-text);
      cursor: pointer;
    }
    .control:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .frame {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 0;
      padding: 0 var(--mf-space-2) var(--mf-space-4);
    }
    .stage {
      display: grid;
      place-items: center;
      width: min(100%, 1600px);
      height: 100%;
      min-height: 0;
      border-radius: var(--mf-radius-control);
    }
    .stage[data-loaded='false'] {
      background: var(--mf-panel-raised);
    }
    .stage img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      opacity: 0;
      -webkit-user-drag: none;
    }
    .stage[data-loaded='true'] img {
      opacity: 1;
    }
    .stage:not([data-still]) img {
      transition: opacity var(--mf-motion-pop) var(--mf-motion-ease);
    }
    .placeholder {
      color: var(--mf-text-secondary);
    }
    .step {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
    }
    .step.previous {
      left: var(--mf-space-2);
    }
    .step.next {
      right: var(--mf-space-2);
    }
  `,
  template: `
    <ng-template #view>
      <div
        class="viewer"
        data-slot="viewer-backdrop"
        (pointerdown)="down($event)"
        (pointerup)="up($event)"
      >
        <div class="bar">
          <span class="title" [id]="ids.title">{{ title() }}</span>
          <span class="counter" [id]="ids.counter" aria-live="polite">{{
            counter()
          }}</span>
          <button
            type="button"
            class="control"
            [attr.aria-label]="labels().close"
            (click)="close()"
          >
            <mf-close-icon />
          </button>
        </div>
        @if (current(); as photo) {
          <div class="frame" data-slot="viewer-frame">
            <div
              class="stage"
              data-slot="viewer-stage"
              [attr.data-loaded]="loadedId() === photo.id"
              [attr.data-failed]="!!photo.failed"
              [attr.data-still]="still() ? '' : null"
            >
              @if (photo.failed) {
                <svg
                  class="placeholder"
                  role="img"
                  [attr.aria-label]="photo.alt"
                  fill="none"
                  height="48"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  viewBox="0 0 24 24"
                  width="48"
                >
                  <rect height="16" rx="2" width="18" x="3" y="4" />
                  <path d="m3 16 5-5 4 4 3-3 6 6M3 3l18 18" />
                </svg>
              } @else {
                <img
                  draggable="false"
                  [alt]="photo.alt"
                  [src]="photo.displayUrl"
                  (error)="failed.emit({ id: photo.id })"
                  (load)="loadedId.set(photo.id)"
                />
              }
            </div>
            <button
              type="button"
              class="control step previous"
              [attr.aria-label]="labels().previous"
              [disabled]="index() === 0"
              (click)="move(-1)"
            >
              <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-width="2" viewBox="0 0 24 24" width="20">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              class="control step next"
              [attr.aria-label]="labels().next"
              [disabled]="index() === photos().length - 1"
              (click)="move(1)"
            >
              <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-width="2" viewBox="0 0 24 24" width="20">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        }
      </div>
    </ng-template>
  `,
})
export class PhotoViewer {
  readonly title = input.required<string>();
  readonly photos = input.required<ViewerPhoto[]>();
  readonly labels = input.required<ViewerLabels>();
  readonly failed = output<{ id: string }>();

  private readonly dialog = inject(Dialog);
  private readonly overlay = inject(Overlay);
  private readonly injector = inject(Injector);
  protected readonly still = inject(REDUCED_MOTION);
  private readonly view = viewChild.required<TemplateRef<unknown>>('view');

  protected readonly ids = {
    counter: `mf-photo-viewer-counter-${++next}`,
    title: `mf-photo-viewer-title-${next}`,
  };
  private readonly open$ = signal(false);
  // Follows its photo by id when the list is re-read, else keeps its place
  // within the shorter list.
  protected readonly index = linkedSignal<ViewerPhoto[], number>({
    computation: (photos, previous) => {
      if (!previous) return 0;
      const shown = previous.source[previous.value]?.id;
      const at = photos.findIndex((photo) => photo.id === shown);
      return at >= 0
        ? at
        : Math.max(0, Math.min(previous.value, photos.length - 1));
    },
    source: this.photos,
  });
  protected readonly current = computed(() => this.photos()[this.index()]);
  protected readonly counter = computed(() =>
    this.labels().counter(this.index() + 1, this.photos().length),
  );
  protected readonly loadedId = signal<string | null>(null);

  private ref: DialogRef | null = null;
  private opener: HTMLElement | null = null;
  private fallback: (() => HTMLElement | undefined) | undefined;
  private start: { target: EventTarget | null; x: number; y: number } | null =
    null;

  constructor() {
    // The dialog is the root's: a host that drops this component must not
    // leave the overlay over the next page.
    inject(DestroyRef).onDestroy(() => this.close());
    effect(() => {
      if (this.photos().length === 0) untracked(() => this.close());
    });
    effect(() => {
      if (!this.open$()) return;
      const photos = this.photos();
      const at = this.index();
      for (const near of [photos[at - 1], photos[at + 1]]) {
        if (near) new Image().src = near.displayUrl;
      }
    });
  }

  open(
    index: number,
    opener: HTMLElement,
    fallback?: () => HTMLElement | undefined,
  ): void {
    const total = this.photos().length;
    if (total === 0) return;
    const at = Number.isFinite(index) ? Math.trunc(index) : 0;
    this.index.set(Math.max(0, Math.min(at, total - 1)));
    if (this.ref) return;
    this.opener = opener;
    this.fallback = fallback;
    const ref = this.dialog.open(this.view(), {
      ariaLabelledBy: `${this.ids.title} ${this.ids.counter}`,
      ariaModal: true,
      autoFocus: 'first-tabbable',
      disableClose: true,
      hasBackdrop: false,
      injector: this.injector,
      restoreFocus: false,
      scrollStrategy: this.overlay.scrollStrategies.block(),
    });
    ref.keydownEvents.subscribe((event) => this.key(event));
    ref.closed.subscribe(() => this.closed());
    this.ref = ref;
    this.open$.set(true);
  }

  close(): void {
    this.ref?.close();
  }

  protected move(step: number): void {
    const at = this.index() + step;
    if (at >= 0 && at < this.photos().length) this.index.set(at);
  }

  protected down(event: PointerEvent): void {
    this.start = { target: event.target, x: event.clientX, y: event.clientY };
  }

  protected up(event: PointerEvent): void {
    const start = this.start;
    this.start = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy)) {
      this.move(dx < 0 ? 1 : -1);
      return;
    }
    if (
      Math.abs(dx) < SWIPE &&
      Math.abs(dy) < SWIPE &&
      dark(start.target) &&
      dark(event.target)
    ) {
      this.close();
    }
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.close();
    else if (event.key === 'ArrowRight') this.move(1);
    else if (event.key === 'ArrowLeft') this.move(-1);
    else return;
    event.preventDefault();
  }

  private closed(): void {
    this.ref = null;
    this.open$.set(false);
    this.loadedId.set(null);
    const target = this.opener?.isConnected ? this.opener : this.fallback?.();
    this.opener = null;
    this.fallback = undefined;
    target?.focus();
  }
}
