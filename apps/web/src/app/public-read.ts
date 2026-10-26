import {
  HttpContext,
  HttpContextToken,
  type HttpRequest,
} from '@angular/common/http';

// A read any visitor may make, sent without the token: the transfer cache
// never serves a request that carries one, so a signed-in visitor would read
// again what the server render already handed over.
export const PUBLIC_READ = new HttpContextToken<boolean>(() => false);

export const publicRead = () => new HttpContext().set(PUBLIC_READ, true);

// A read that must reach the API: until the page settles the transfer cache
// answers a request the server render made with that render's answer, so a
// re-read for a change heard in those first moments would show the old data.
export const FRESH_READ = new HttpContextToken<boolean>(() => false);

export const freshPublicRead = () => publicRead().set(FRESH_READ, true);

// The transfer cache's filter: a fresh read is neither kept nor served.
export const transferCacheFilter = (req: HttpRequest<unknown>) =>
  !req.context.get(FRESH_READ);
