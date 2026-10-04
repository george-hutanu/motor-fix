import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  InjectionToken,
  inject,
  type Signal,
  signal,
} from '@angular/core';

// CSS stills itself through the same query in cockpit.css; this is for code
// that drives its own motion.
const REDUCED_MOTION = new InjectionToken<Signal<boolean>>('REDUCED_MOTION', {
  factory: () => {
    const query = inject(DOCUMENT).defaultView?.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    );
    const reduced = signal(query?.matches ?? false);
    if (query) {
      const follow = (event: MediaQueryListEvent) => reduced.set(event.matches);
      // Safari before 14 has only the older listener methods.
      if (query.addEventListener) {
        query.addEventListener('change', follow);
        inject(DestroyRef).onDestroy(() =>
          query.removeEventListener('change', follow),
        );
      } else {
        query.addListener(follow);
        inject(DestroyRef).onDestroy(() => query.removeListener(follow));
      }
    }
    return reduced.asReadonly();
  },
  providedIn: 'root',
});

export const injectReducedMotion = (): Signal<boolean> =>
  inject(REDUCED_MOTION);
