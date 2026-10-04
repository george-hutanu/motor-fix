import {
  HttpClient,
  HttpErrorResponse,
  type HttpEvent,
  HttpEventType,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  catchError,
  defer,
  filter,
  map,
  type Observable,
  of,
  retry,
  switchMap,
  throwError,
  timer,
} from 'rxjs';

export interface UploadAddress {
  fields: Record<string, string>;
  key: string;
  url: string;
}

export type UploadEvent<T> = { progress: number } | { done: T };

type Sent = { progress: number } | { sent: string };

const RETRIES = 3;

const percent = (loaded: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((100 * loaded) / total)) : 0;

// Sends a file straight to object storage with the signed form an owning
// endpoint issued, then calls that endpoint's confirm. Every screen that takes
// a photo or a document uploads through here.
@Injectable({ providedIn: 'root' })
export class FileUploader {
  private readonly http = inject(HttpClient);

  upload<T>(
    file: Blob,
    ask: () => Observable<UploadAddress>,
    confirm: (key: string) => Observable<T>,
  ): Observable<UploadEvent<T>> {
    // The store answers 403 to an expired address: one fresh address, no more.
    const attempt = (renewed: boolean): Observable<Sent> =>
      defer(ask).pipe(
        switchMap((address) =>
          this.send(file, address).pipe(
            catchError((error: unknown) =>
              !renewed &&
              error instanceof HttpErrorResponse &&
              error.status === 403
                ? attempt(true)
                : throwError(() => error),
            ),
          ),
        ),
      );

    return attempt(false).pipe(
      switchMap((event) =>
        'sent' in event
          ? confirm(event.sent).pipe(map((done) => ({ done })))
          : of(event),
      ),
    );
  }

  private send(file: Blob, address: UploadAddress): Observable<Sent> {
    const form = new FormData();
    for (const [name, value] of Object.entries(address.fields)) {
      form.append(name, value);
    }
    // The store reads the fields before the file; the file must come last.
    form.append('file', file);
    return this.http
      .post(address.url, form, { observe: 'events', reportProgress: true })
      .pipe(
        retry({
          count: RETRIES,
          // Status 0 is a dropped connection; any answer from the store is final.
          delay: (error: HttpErrorResponse, attempt) =>
            error.status === 0
              ? timer(1000 * 2 ** (attempt - 1))
              : throwError(() => error),
        }),
        filter(
          (event: HttpEvent<unknown>) =>
            event.type === HttpEventType.UploadProgress ||
            event.type === HttpEventType.Response,
        ),
        map((event) =>
          event.type === HttpEventType.UploadProgress
            ? { progress: percent(event.loaded, event.total || file.size) }
            : { sent: address.key },
        ),
      );
  }
}
