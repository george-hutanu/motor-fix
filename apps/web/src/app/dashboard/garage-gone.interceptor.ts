import { DOCUMENT } from '@angular/common';
import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';

import { Session } from './session';

// A 404 under the signed-in garage's own path may mean the garage is no
// longer the person's: read the account again (one read for a burst of
// them) and, when it no longer holds the garage, say so.
export const garageGoneInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(Session);
  const origin = inject(DOCUMENT).location.origin;
  return next(req).pipe(
    tap({
      error: (error: unknown) => {
        if (!(error instanceof HttpErrorResponse) || error.status !== 404)
          return;
        const garageId = session.current()?.garageId;
        const target = URL.parse(req.url, origin);
        if (
          !garageId ||
          target?.origin !== origin ||
          !target.pathname
            .toLowerCase()
            .startsWith(`/api/v1/garages/${garageId.toLowerCase()}/`)
        )
          return;
        void session.reloadOnce().then(() => session.loseGarage(garageId));
      },
    }),
  );
};
