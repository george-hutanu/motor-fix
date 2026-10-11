import { DOCUMENT } from '@angular/common';
import { inject, provideEnvironmentInitializer } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

// The service worker reports a broken state when the files it cached no
// longer match the server's, as after a deploy; only a fresh load recovers.
export function provideServiceWorkerRecovery() {
  return provideEnvironmentInitializer(() => {
    const updates = inject(SwUpdate);
    const document = inject(DOCUMENT);
    if (updates.isEnabled)
      updates.unrecoverable.subscribe(() => document.location.reload());
  });
}
