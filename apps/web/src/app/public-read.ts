import { HttpContext, HttpContextToken } from '@angular/common/http';

// A read any visitor may make, sent without the token: the transfer cache
// never serves a request that carries one, so a signed-in visitor would read
// again what the server render already handed over.
export const PUBLIC_READ = new HttpContextToken<boolean>(() => false);

export const publicRead = () => new HttpContext().set(PUBLIC_READ, true);
