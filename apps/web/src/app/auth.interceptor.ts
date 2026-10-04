import {
  HttpErrorResponse,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { Session } from './dashboard/session';

// Only the page's own API gets the token; the session calls work by cookie.
const carriesToken = (url: string) =>
  url.startsWith('/api/') && !url.startsWith('/api/v1/auth/');

const withToken = (req: HttpRequest<unknown>, token: string) =>
  req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

export const authInterceptor: HttpInterceptorFn = (
  req,
  next: HttpHandlerFn,
) => {
  const session = inject(Session);
  const token = carriesToken(req.url) ? session.token() : null;
  if (!token) return next(req);
  return next(withToken(req, token)).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      // An expired access token: renew once, then repeat the call.
      return from(session.renew()).pipe(
        switchMap((renewed) => {
          const fresh = session.token();
          return renewed && fresh
            ? next(withToken(req, fresh))
            : throwError(() => error);
        }),
      );
    }),
  );
};
