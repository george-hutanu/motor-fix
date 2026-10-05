import { LiveAnnouncer } from '@angular/cdk/a11y';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  effect,
  Injector,
  inject,
  input,
  linkedSignal,
  PLATFORM_ID,
  type Signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

// The rules every live screen follows: a re-read changes the screen in place
// and never takes away what the person is doing.

// Data as JSON gives it, from any realm (a Date or a Map is not).
function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

const idOf = (value: unknown) =>
  isPlain(value) && typeof value['id'] === 'string' ? value['id'] : undefined;

// The new value, with every part equal to the old one swapped back for the old
// one: rows are matched by `id`, and an equal value is the old value itself.
// So `track row.id` keeps an unchanged row's DOM, and a signal that is set to
// an unchanged value does not fire.
export function reuse<T>(previous: unknown, next: T): T {
  if (Object.is(previous, next)) return previous as T;
  if (Array.isArray(previous) && Array.isArray(next)) {
    return reuseItems(previous, next) as T;
  }
  if (isPlain(previous) && isPlain(next)) return reuseFields(previous, next);
  return next;
}

function reuseItems(previous: unknown[], next: unknown[]) {
  const byId = new Map(previous.map((item) => [idOf(item), item]));
  const items = next.map((item, i) => {
    const id = idOf(item);
    return reuse(id === undefined ? previous[i] : byId.get(id), item);
  });
  const same =
    items.length === previous.length &&
    items.every((item, i) => item === previous[i]);
  return same ? previous : items;
}

function reuseFields<T>(previous: Record<string, unknown>, next: T): T {
  const fields = next as Record<string, unknown>;
  const keys = Object.keys(fields);
  const entries = keys.map((key) => [key, reuse(previous[key], fields[key])]);
  const same =
    keys.length === Object.keys(previous).length &&
    entries.every(([key, value]) => value === previous[key as string]);
  return (same ? previous : Object.fromEntries(entries)) as T;
}

export interface LiveDraft<T> {
  // What the form was filled from; a re-read never replaces it.
  readonly source: Signal<T | undefined>;
  // The object on screen, while it differs from that source.
  readonly changed: Signal<T | undefined>;
  // The form now builds on the object on screen.
  accept(): void;
}

// A form edits its own copy. Fill it once from `source()`; show
// `shell.live.changed` with the new value while `changed()` holds one.
export function liveDraft<T>(shown: Signal<T | undefined>): LiveDraft<T> {
  const source = linkedSignal<T | undefined, T | undefined>({
    computation: (next, previous) => previous?.value ?? next,
    source: shown,
  });
  return {
    accept: () => source.set(shown()),
    changed: computed(() => {
      const now = shown();
      return now !== undefined && now !== source() ? now : undefined;
    }),
    source: source.asReadonly(),
  };
}

export interface LiveRows<T> {
  readonly rows: Signal<readonly T[]>;
  // New rows held back above the rows shown.
  readonly waiting: Signal<number>;
  // Shows the held rows; gives the id of the first of them.
  showAll(): string | undefined;
}

// A list that keeps the person's place: while it is not at its top, new rows
// that sort before the rows shown wait behind the pill; rows shown update in
// place, and rows gone from the re-read leave.
export function liveRows<T extends { id: string }>(
  shown: Signal<readonly T[] | undefined>,
  atTop: () => boolean,
): LiveRows<T> {
  const state = linkedSignal<
    readonly T[] | undefined,
    { rows: readonly T[]; held: readonly T[] }
  >({
    computation: (next = [], previous) => {
      const before = previous?.value.rows ?? [];
      if (before.length === 0 || untracked(atTop))
        return { held: [], rows: next };
      const known = new Set(before.map((row) => row.id));
      const first = next.findIndex((row) => known.has(row.id));
      const cut = first === -1 ? 0 : first;
      return { held: next.slice(0, cut), rows: next.slice(cut) };
    },
    source: shown,
  });
  return {
    rows: computed(() => state().rows),
    showAll() {
      const first = state().held[0]?.id;
      state.set({ held: [], rows: shown() ?? [] });
      return first;
    },
    waiting: computed(() => state().held.length),
  };
}

// "1 actualizare nouă": shows the held rows and scrolls up to the first one.
// Rows carry `data-live-id`.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-live-pill',
  styles: `
    :host { position: sticky; top: var(--mf-space-2); z-index: 1; display: flex; justify-content: center; }
    button {
      min-height: var(--mf-tap); padding: 0 var(--mf-space-4);
      border: 1px solid var(--mf-amber); border-radius: var(--mf-radius-chip);
      background: var(--mf-panel); color: var(--mf-amber-ink);
      font: inherit; font-size: var(--mf-size-small); cursor: pointer;
    }
  `,
  template: `
    @if (rows().waiting(); as count) {
      <button type="button" (click)="show()">{{ 'shell.live.waiting' | t: { count } }}</button>
    }
  `,
})
export class LivePill {
  readonly rows = input.required<LiveRows<{ id: string }>>();
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  protected show() {
    const id = this.rows().showAll();
    afterNextRender(
      () =>
        [...this.document.querySelectorAll<HTMLElement>('[data-live-id]')]
          .find((row) => row.dataset['liveId'] === id)
          ?.scrollIntoView({ block: 'start' }),
      { injector: this.injector },
    );
  }
}

// On the list of a page that scrolls: after each update, the first row that
// was visible (`data-live-id`) is put back where it was on screen.
@Directive({ selector: '[mfLiveAnchor]' })
export class LiveAnchor {
  readonly mfLiveAnchor = input.required<unknown>();
  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private anchor: { id: string; top: number } | null = null;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const view = inject(DOCUMENT).defaultView;
    const record = () => this.record(view);
    view?.addEventListener('scroll', record, { passive: true });
    inject(DestroyRef).onDestroy(() =>
      view?.removeEventListener('scroll', record),
    );
    afterRenderEffect(() => {
      this.mfLiveAnchor();
      untracked(() => this.restore(view));
    });
  }

  private rows() {
    return [...this.host.querySelectorAll<HTMLElement>('[data-live-id]')];
  }

  private record(view: Window | null) {
    const first =
      (view?.scrollY ?? 0) > 0
        ? this.rows().find((row) => row.getBoundingClientRect().bottom > 0)
        : undefined;
    const id = first?.dataset['liveId'];
    this.anchor =
      first && id ? { id, top: first.getBoundingClientRect().top } : null;
  }

  private restore(view: Window | null) {
    const anchor = this.anchor;
    const row = anchor
      ? this.rows().find((r) => r.dataset['liveId'] === anchor.id)
      : undefined;
    if (!anchor || !row) return this.record(view);
    const moved = row.getBoundingClientRect().top - anchor.top;
    if (moved !== 0) view?.scrollBy(0, moved);
  }
}

// On a value that changes live: a 1 s highlight (none with reduced motion),
// and `mfLiveChangeSay`, when given, is announced politely. Nothing happens
// when the value first shows.
@Directive({ selector: '[mfLiveChange]' })
export class LiveChange {
  readonly mfLiveChange = input<unknown>();
  readonly mfLiveChangeSay = input<string>();

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const reduced = inject(REDUCED_MOTION);
    const announcer = inject(LiveAnnouncer);
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      this.mfLiveChange();
      if (first) {
        first = false;
        return;
      }
      untracked(() => {
        const say = this.mfLiveChangeSay();
        if (say) void announcer.announce(say, 'polite');
        if (reduced()) return;
        clearTimeout(timer);
        host.classList.remove('mf-live-changed');
        // Restarts the animation when the value changes again within 1 s.
        void host.offsetWidth;
        host.classList.add('mf-live-changed');
        timer = setTimeout(
          () => host.classList.remove('mf-live-changed'),
          1000,
        );
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}
