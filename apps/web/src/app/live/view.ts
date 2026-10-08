import { HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  DestroyRef,
  inject,
  type Signal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, type Observable } from 'rxjs';

import { reuse } from '../dashboard/live-in-place/live-in-place';

export interface LiveView<T> {
  // The last data read; a re-read changes only its parts that changed.
  readonly value: Signal<T | undefined>;
  // Why the first read failed, while there is nothing to show.
  readonly error: Signal<unknown>;
  // The object is deleted or no longer shown (the read answered a gone status).
  readonly gone: Signal<boolean>;
  // True only for the first read; a background re-read keeps the data shown.
  readonly isLoading: Signal<boolean>;
  // The last read failed, the first one or a re-read with data shown.
  readonly failed: Signal<boolean>;
  reload(): void;
}

interface LiveViewOptions {
  // The events that change what the view shows; a burst of 300 ms is one re-read.
  changes: Observable<unknown>;
  // Every view re-reads its data: the stream may have missed events.
  resync: Observable<void>;
  // The statuses that mean the object is gone.
  goneOn: readonly number[];
  // When set, a failed read is tried again after this long.
  retryAfter?: number;
}

// A view's data, read through the API at once and again on every change and
// resync. A re-read that fails keeps the data shown. Call it in an injection
// context; a read still running when the view goes away is dropped.
export function liveView<T>(
  load: () => Promise<T>,
  { changes, goneOn, resync, retryAfter }: LiveViewOptions,
): LiveView<T> {
  const value = signal<T | undefined>(undefined);
  const error = signal<unknown>(undefined);
  const gone = signal(false);
  const isLoading = signal(false);
  const lastFailed = signal(false);
  const firstRead = computed(() => isLoading() && value() === undefined);
  const destroyRef = inject(DestroyRef);
  let again = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const failed = (failure: unknown) => {
    lastFailed.set(true);
    if (
      failure instanceof HttpErrorResponse &&
      goneOn.includes(failure.status)
    ) {
      gone.set(true);
      return;
    }
    if (value() === undefined) error.set(failure);
    if (retryAfter !== undefined)
      retry = setTimeout(() => void read(), retryAfter);
  };
  const readOnce = async () => {
    clearTimeout(retry);
    isLoading.set(true);
    try {
      const next = await load();
      if (destroyRef.destroyed) return;
      value.set(reuse(value(), next));
      error.set(undefined);
      gone.set(false);
      lastFailed.set(false);
    } catch (failure) {
      if (!destroyRef.destroyed) failed(failure);
    } finally {
      isLoading.set(false);
    }
  };
  // One read at a time: events during a read make one more after it.
  const read = async () => {
    if (destroyRef.destroyed) return;
    if (isLoading()) {
      again = true;
      return;
    }
    do {
      again = false;
      await readOnce();
    } while (again && !destroyRef.destroyed);
  };

  changes
    .pipe(debounceTime(300), takeUntilDestroyed(destroyRef))
    .subscribe(() => void read());
  resync.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => void read());
  destroyRef.onDestroy(() => clearTimeout(retry));
  void read();
  return {
    error: error.asReadonly(),
    failed: lastFailed.asReadonly(),
    gone: gone.asReadonly(),
    isLoading: firstRead,
    reload: () => void read(),
    value: value.asReadonly(),
  };
}
