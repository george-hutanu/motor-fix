import { isPlatformServer } from '@angular/common';
import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { catchError, from, type Observable, switchMap, throwError } from 'rxjs';

import { Session } from './dashboard/session';
import { SignInDialog } from './sign-in/sign-in-dialog';

// Only the page's own API gets the token; the session calls work by cookie.
const carriesToken = (url: string) =>
  url.startsWith('/api/') && !url.startsWith('/api/v1/auth/');

// Signed out is a normal answer to "who am I", never a reason to ask.
const isWhoAmI = (req: HttpRequest<unknown>) =>
  req.method === 'GET' && req.url === '/api/v1/me';

const withToken = (req: HttpRequest<unknown>, token: string) =>
  req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

const signInRequired = (error: unknown): error is HttpErrorResponse =>
  error instanceof HttpErrorResponse &&
  error.status === 401 &&
  (error.error as { code?: unknown } | null)?.code === 'sign_in_required';

export const authInterceptor: HttpInterceptorFn = (
  req,
  next: HttpHandlerFn,
) => {
  if (!carriesToken(req.url)) return next(req);
  const session = inject(Session);
  const dialog = inject(SignInDialog);
  const onServer = isPlatformServer(inject(PLATFORM_ID));
  const token = session.token();
  const mayAsk = !onServer && !isWhoAmI(req);

  // The call again with whatever token the session now holds, or the first
  // refusal when there is none.
  const repeat = (
    ok: boolean,
    refusal: unknown,
  ): Observable<HttpEvent<unknown>> => {
    const fresh = session.token();
    return ok && fresh
      ? next(withToken(req, fresh))
      : throwError(() => refusal);
  };

  // A refusal nothing renews away: sign in over the screen, then go on once.
  const ask = (refusal: unknown) =>
    mayAsk && signInRequired(refusal)
      ? from(dialog.gate().catch(() => false)).pipe(
          switchMap((signedIn) => repeat(signedIn, refusal)),
        )
      : throwError(() => refusal);

  return next(token ? withToken(req, token) : req).pipe(
    catchError((error: unknown) => {
      const expired =
        error instanceof HttpErrorResponse && error.status === 401;
      // A call with a token renews on any 401; one without only when the
      // server says a session is needed and a remembered cookie may hold one.
      if (!(expired && (token || (mayAsk && signInRequired(error))))) {
        return throwError(() => error);
      }
      return from(session.renew().catch(() => false)).pipe(
        switchMap((renewed) => (renewed ? repeat(true, error) : ask(error))),
      );
    }),
  );
};
