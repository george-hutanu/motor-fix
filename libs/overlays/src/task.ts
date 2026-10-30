import { InjectionToken, inject, type Type } from '@angular/core';

export type OverlayShape = 'dialog' | 'drawer' | 'drawer-wide';

export type OverlayResult<R> = R | 'cancelled';

// A task component, or a loader that fetches it on demand.
export type OverlaySource = Type<unknown> | (() => Promise<Type<unknown>>);

export interface OverlayOptions<D = undefined> {
  shape: OverlayShape;
  // An i18n key, and the values it names.
  title: string;
  titleParams?: Record<string, string>;
  data?: D;
  // Ask before closing a task whose fields changed. On unless set to false.
  confirmDiscard?: boolean;
  // Off: no X, grip, Escape, click outside or Back closes it; only the
  // task's own buttons do. On unless set to false.
  dismissible?: boolean;
  // The opener's way to close the task itself: an abort closes it, unasked,
  // with "cancelled".
  signal?: AbortSignal;
}

// What a task component gets from the overlay it is shown in.
export interface OverlayTask<D = undefined, R = never> {
  readonly data: D;
  close(result: R): void;
  // After a save: closing no longer asks about the changes.
  markUnchanged(): void;
  // The task's own Renunță: closes with "cancelled" as the X does, asking
  // first when a field changed. A task opened not dismissible closes too.
  dismiss(): void;
  // While held, such as during a save, nothing closes the task (X, Escape,
  // a click outside, a drag, Back, dismiss) but the task's own close.
  hold(held: boolean): void;
  // Content shown after opening, such as a form behind a load, takes the
  // opening focus once rendered, unless the person moved it inside the task.
  focusStart(): void;
}

export interface PanelContext extends OverlayOptions<unknown> {
  source: OverlaySource;
  titleId: string;
  // A phone: whatever its shape, the task is a bottom sheet until it closes.
  sheet: boolean;
}

export const OVERLAY_TASK = new InjectionToken<OverlayTask<unknown, unknown>>(
  'OVERLAY_TASK',
);

export function injectOverlayTask<D = undefined, R = never>(): OverlayTask<
  D,
  R
> {
  return inject(OVERLAY_TASK) as OverlayTask<D, R>;
}
