import { BreakpointObserver } from '@angular/cdk/layout';
import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

export type LayoutName = 'phone' | 'tablet' | 'desktop';

// cockpit.css's phone query is `not all and (min-width: tablet)`, so the two
// never disagree, even on fractional widths.
export const BREAKPOINTS = { desktop: 1024, tablet: 768 } as const;

const TABLET = `(min-width: ${BREAKPOINTS.tablet}px)`;
const DESKTOP = `(min-width: ${BREAKPOINTS.desktop}px)`;

// The server has no width and matches no query, so it says phone.
@Injectable({ providedIn: 'root' })
export class Layout {
  readonly current = toSignal(
    inject(BreakpointObserver)
      .observe([TABLET, DESKTOP])
      .pipe(
        map(({ breakpoints }): LayoutName => {
          if (breakpoints[DESKTOP]) return 'desktop';
          return breakpoints[TABLET] ? 'tablet' : 'phone';
        }),
      ),
    { initialValue: 'phone' },
  );
}
