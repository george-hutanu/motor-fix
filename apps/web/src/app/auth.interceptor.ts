import { DOCUMENT, isPlatformServer } from '@angular/common';
import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { toProblem } from '@motor-fix/overlays';
import {
  catchError,
  from,
  type Observable,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import { Session } from './dashboard/session';
import { PlatformStatus } from './maintenance/platform-status';
import { PUBLIC_READ } from './public-read';
import { SignInDialog } from './sign-in/sign-in-dialog';

// Only the page's own API gets the token; the session calls work by cookie.
// Approving an assistant and changing the password are the auth calls made
// as the signed-in person.
const AS_THE_PERSON = new Set([
  '/api/v1/auth/assistant/approve',
  '/api/v1/auth/password',
]);
const carriesToken = (path: string) =>
  path.startsWith('/api/') &&
  (!path.startsWith('/api/v1/auth/') || AS_THE_PERSON.has(path));

// The path of a call to the page's own origin, however the address is
// written; null for any other origin, the server's private API included.
const ownPath = (url: string, origin: string) => {
  const target = URL.parse(url, origin);
  return target?.origin === origin ? target.pathname : null;
};

// Signed out is a normal answer to "who am I", never a reason to ask.
const isWhoAmI = (req: HttpRequest<unknown>, path: string | null) =>
  req.method === 'GET' && path === '/api/v1/me';

const withToken = (req: HttpRequest<unknown>, token: string) =>
  req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

const signInRequired = (error: unknown) => {
  const problem = toProblem(error);
  return problem.status === 401 && problem.code === 'sign_in_required';
};

// A wrong password is the answer, not an expired token: sending it again
// would count a second wrong try.
const wrongPassword = (error: unknown) =>
  toProblem(error).code === 'invalid_credentials';

const inMaintenance = (error: unknown) => {
  const problem = toProblem(error);
  return problem.status === 503 && problem.code === 'maintenance';
};

// Whichever answer shows the page, a refusal for maintenance turns it on.
const watchMaintenance = (status: PlatformStatus) =>
  tap<HttpEvent<unknown>>({
    error: (error: unknown) => {
      if (inMaintenance(error)) status.on();
    },
  });

export const authInterceptor: HttpInterceptorFn = (
  req,
  next: HttpHandlerFn,
) => {
  // A public read goes as any visitor's would: no token, so nothing to renew.
  if (req.context.get(PUBLIC_READ))
    return next(
      req.headers.has('Authorization')
        ? req.clone({ headers: req.headers.delete('Authorization') })
        : req,
    ).pipe(watchMaintenance(inject(PlatformStatus)));
  const path = ownPath(req.url, inject(DOCUMENT).location.origin);
  if (path === null || !carriesToken(path)) return next(req);
  const session = inject(Session);
  const dialog = inject(SignInDialog);
  const status = inject(PlatformStatus);
  const onServer = isPlatformServer(inject(PLATFORM_ID));
  const token = session.token();
  const mayAsk = !onServer && !isWhoAmI(req, path);

  // Send the call again with whatever token the session now holds; with none,
  // hand back the first refusal.
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
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !wrongPassword(error);
      // A call with a token renews on any 401; one without only when the
      // server says a session is needed and a remembered cookie may hold one.
      if (!(expired && (token || (mayAsk && signInRequired(error))))) {
        return throwError(() => error);
      }
      return from(session.renew()).pipe(
        switchMap((renewed) => (renewed ? repeat(true, error) : ask(error))),
      );
    }),
    watchMaintenance(status),
  );
};
