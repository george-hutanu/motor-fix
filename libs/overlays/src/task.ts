import { InjectionToken, inject, type Type } from '@angular/core';

export type OverlayShape = 'dialog' | 'drawer' | 'drawer-wide';

export type OverlayResult<R> = R | 'cancelled';

// A task component, or a loader that fetches it on demand.
export type OverlaySource = Type<unknown> | (() => Promise<Type<unknown>>);

export interface OverlayOptions<D = undefined> {
  shape: OverlayShape;
  // An i18n key.
  title: string;
  data?: D;
  // Ask before closing a task whose fields changed. On unless set to false.
  confirmDiscard?: boolean;
}

// What a task component gets from the overlay it is shown in.
export interface OverlayTask<D = undefined, R = never> {
  readonly data: D;
  close(result: R): void;
  // After a save: closing no longer asks about the changes.
  markUnchanged(): void;
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
