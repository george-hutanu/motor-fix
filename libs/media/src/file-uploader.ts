import {
  HttpClient,
  HttpErrorResponse,
  type HttpEvent,
  HttpEventType,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  catchError,
  concat,
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

import { crc32Base64 } from './crc32';

export interface UploadAddress {
  headers: Record<string, string>;
  key: string;
  url: string;
}

export interface UploadOptions {
  // Retries of a dropped connection; a queue that retries itself passes 0.
  retries?: number;
}

// `sent` says the file reached the store, before the confirm is called.
export type UploadEvent<T> =
  | { progress: number }
  | { sent: string }
  | { done: T };

type Sent = { progress: number } | { sent: string };

const percent = (loaded: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((100 * loaded) / total)) : 0;

// PUTs a file straight to object storage at the address an owning endpoint
// signed for its type, length and CRC32, then calls that endpoint's confirm.
// Every screen that takes a photo or a document uploads through here.
@Injectable({ providedIn: 'root' })
export class FileUploader {
  private readonly http = inject(HttpClient);

  upload<T>(
    file: Blob,
    ask: (checksum: string) => Observable<UploadAddress>,
    confirm: (key: string) => Observable<T>,
    { retries = 3 }: UploadOptions = {},
  ): Observable<UploadEvent<T>> {
    // The store answers 403 to an expired address: one fresh address, no more.
    const attempt = (checksum: string, renewed: boolean): Observable<Sent> =>
      defer(() => ask(checksum)).pipe(
        switchMap((address) =>
          this.send(file, address, retries).pipe(
            catchError((error: unknown) =>
              !renewed &&
              error instanceof HttpErrorResponse &&
              error.status === 403
                ? attempt(checksum, true)
                : throwError(() => error),
            ),
          ),
        ),
      );

    return defer(() => crc32Base64(file)).pipe(
      switchMap((checksum) => attempt(checksum, false)),
      switchMap((event) =>
        'sent' in event
          ? concat(
              of(event),
              defer(() => confirm(event.sent)).pipe(map((done) => ({ done }))),
            )
          : of(event),
      ),
    );
  }

  private send(
    file: Blob,
    address: UploadAddress,
    retries: number,
  ): Observable<Sent> {
    return this.http
      .put(address.url, file, {
        headers: address.headers,
        observe: 'events',
        reportProgress: true,
      })
      .pipe(
        retry({
          count: retries,
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
