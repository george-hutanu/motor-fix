import {
  HttpClient,
  HttpHandler,
  type HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject, type Provider } from '@angular/core';
import { placesControllerSearch } from '@motor-fix/data-access';
import { from, isObservable, map, type Observable, throwError } from 'rxjs';

type Asked = { lang: string | null; q: string | null };

// Answers the address field's place look-ups from `search`, given what was
// asked: a promise or a value as the API's body, an observable as the request
// itself (to hold it open, or to see it torn down). Every other request goes
// on to the HttpClient the test set up, if any.
export function placesAnswered(search: (asked: Asked) => unknown): Provider {
  return {
    provide: HttpClient,
    useFactory: () => {
      const handler = inject(HttpHandler, { optional: true });
      const rest = handler ? new HttpClient(handler) : undefined;
      return {
        request: (req: HttpRequest<unknown>): Observable<unknown> => {
          if (!req.url.endsWith(placesControllerSearch.PATH)) {
            return rest
              ? rest.request(req)
              : throwError(() => new Error(`no answer for ${req.url}`));
          }
          const answer = search({
            lang: req.params.get('lang'),
            q: req.params.get('q'),
          });
          const body = isObservable(answer)
            ? answer
            : from(Promise.resolve(answer));
          return body.pipe(map((b) => new HttpResponse({ body: b })));
        },
      };
    },
  };
}
