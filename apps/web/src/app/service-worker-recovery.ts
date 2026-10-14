import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  inject,
  provideEnvironmentInitializer,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';

// The service worker reports a broken state when the files it cached no
// longer match the server's, as after a deploy; only a fresh load recovers.
export function provideServiceWorkerRecovery() {
  return provideEnvironmentInitializer(() => {
    const updates = inject(SwUpdate);
    const document = inject(DOCUMENT);
    const destroyRef = inject(DestroyRef);
    if (updates.isEnabled)
      updates.unrecoverable
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe(() => document.location.reload());
  });
}
