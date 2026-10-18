import {
  HttpErrorResponse,
  HttpEventType,
  provideHttpClient,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EMPTY, of, throwError } from 'rxjs';

import {
  FileUploader,
  type UploadAddress,
  type UploadEvent,
} from './file-uploader';

const address = (
  n: number,
  headers?: Record<string, string>,
): UploadAddress => ({
  headers: headers ?? {
    'Content-Type': 'image/jpeg',
    'x-amz-checksum-crc32': 'c3VtMQ==',
  },
  key: `incoming/k${n}`,
  url: `https://store.example/motorfix/incoming/k${n}?n=${n}`,
});

describe('FileUploader under hostile conditions', () => {
  let http: HttpTestingController;
  let uploader: FileUploader;
  let events: UploadEvent<string>[];
  let failure: unknown;
  let completed: boolean;
  let ask: jest.Mock;
  let confirm: jest.Mock;
  const file = new Blob(['jpeg bytes'], { type: 'image/jpeg' });

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    uploader = TestBed.inject(FileUploader);
    events = [];
    failure = undefined;
    completed = false;
    let asked = 0;
    ask = jest.fn(() => of(address(++asked)));
    confirm = jest.fn((key: string) => of(`final:${key}`));
  });

  afterEach(() => {
    http.verify();
    jest.useRealTimers();
  });

  function start(blob: Blob = file) {
    return uploader.upload<string>(blob, ask, confirm).subscribe({
      complete: () => {
        completed = true;
      },
      error: (e: unknown) => {
        failure = e;
      },
      next: (e) => events.push(e),
    });
  }

  // Lets the checksum of the blob resolve so the address is asked for.
  const flush = () => jest.advanceTimersByTimeAsync(0);

  const ok = (n: number) =>
    http
      .expectOne(address(n).url)
      .flush(null, { status: 200, statusText: 'OK' });

  const dropConnection = (n: number) =>
    http
      .expectOne(address(n).url)
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });

  const refuse = (n: number, status: number) =>
    http
      .expectOne(address(n).url)
      .flush('<Error/>', { status, statusText: 'Refused' });

  it('PUTs an empty file', async () => {
    start(new Blob([]));
    await flush();

    const req = http.expectOne(address(1).url);
    expect(req.request.body).toHaveProperty('size', 0);
    req.flush(null, { status: 200, statusText: 'OK' });

    expect(events).toEqual([
      { sent: 'incoming/k1' },
      { done: 'final:incoming/k1' },
    ]);
  });

  it('PUTs a file of tens of megabytes as one blob', async () => {
    const big = new Blob([new Uint8Array(20 * 1024 * 1024)]);
    start(big);
    await flush();

    const req = http.expectOne(address(1).url);
    expect(req.request.body).toBe(big);
    req.flush(null, { status: 200, statusText: 'OK' });

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('sends the address headers unchanged and no others', async () => {
    ask.mockReturnValue(
      of(
        address(1, {
          a: '',
          'Content-Type': 'image/heic',
          'x-amz-meta-n': 'n',
        }),
      ),
    );
    start();
    await flush();

    const req = http.expectOne(address(1).url);
    expect(req.request.headers.keys().sort()).toEqual([
      'Content-Type',
      'a',
      'x-amz-meta-n',
    ]);
    expect(req.request.headers.get('a')).toBe('');
    expect(req.request.headers.get('Content-Type')).toBe('image/heic');
    req.flush(null, { status: 200, statusText: 'OK' });
  });

  it('PUTs a file when the address has no headers', async () => {
    ask.mockReturnValue(of(address(1, {})));
    start();
    await flush();

    const req = http.expectOne(address(1).url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.keys()).toEqual([]);
    req.flush(null, { status: 200, statusText: 'OK' });
  });

  it('confirms after a 201 as well as a 200', async () => {
    start();
    await flush();
    http
      .expectOne(address(1).url)
      .flush('', { status: 201, statusText: 'Created' });

    expect(confirm).toHaveBeenCalledWith('incoming/k1');
    expect(events).toEqual([
      { sent: 'incoming/k1' },
      { done: 'final:incoming/k1' },
    ]);
    expect(completed).toBe(true);
  });

  it('fails without posting or confirming when asking for an address fails', async () => {
    ask.mockReturnValue(throwError(() => ({ status: 500 })));
    start();
    await flush();

    http.expectNone(() => true);
    expect(failure).toEqual({ status: 500 });
    expect(confirm).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('completes without posting or confirming when asking yields no address', async () => {
    ask.mockReturnValue(EMPTY);
    start();
    await flush();

    http.expectNone(() => true);
    expect(confirm).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(failure).toBeUndefined();
  });

  it('fails with the error of the second ask when the first address expired', async () => {
    let asked = 0;
    ask.mockImplementation(() =>
      ++asked === 1 ? of(address(1)) : throwError(() => ({ status: 503 })),
    );
    start();
    await flush();

    refuse(1, 403);

    expect(failure).toEqual({ status: 503 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('fails with an HttpErrorResponse carrying the status of the last refusal', async () => {
    start();
    await flush();

    refuse(1, 403);
    refuse(2, 403);

    expect(failure).toBeInstanceOf(HttpErrorResponse);
    expect((failure as HttpErrorResponse).status).toBe(403);
  });

  it('waits one second before the first retry and not less', async () => {
    start();
    await flush();

    dropConnection(1);
    jest.advanceTimersByTime(999);
    http.expectNone(address(1).url);
    jest.advanceTimersByTime(1);

    ok(1);
    expect(events).toEqual([
      { sent: 'incoming/k1' },
      { done: 'final:incoming/k1' },
    ]);
  });

  it('makes exactly four requests for a connection that always drops', async () => {
    start();
    await flush();
    let requests = 0;

    for (const wait of [0, 1000, 2000, 4000]) {
      jest.advanceTimersByTime(wait);
      dropConnection(1);
      requests++;
    }
    jest.advanceTimersByTime(60_000);

    http.expectNone(() => true);
    expect(requests).toBe(4);
    expect(failure).toMatchObject({ status: 0 });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('asks for a new address after dropped connections followed by an expiry and then uploads', async () => {
    start();
    await flush();

    dropConnection(1);
    jest.advanceTimersByTime(1000);
    dropConnection(1);
    jest.advanceTimersByTime(2000);
    refuse(1, 403);
    ok(2);

    expect(ask).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledWith('incoming/k2');
    expect(events).toEqual([
      { sent: 'incoming/k2' },
      { done: 'final:incoming/k2' },
    ]);
  });

  it('asks for at most one new address however the refusals arrive', async () => {
    start();
    await flush();

    refuse(1, 403);
    refuse(2, 403);
    jest.advanceTimersByTime(60_000);

    http.expectNone(() => true);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unauthorised', 401],
    ['too large', 413],
    ['not found', 404],
  ])('gives up at once when the store answers %s', async (_, status) => {
    start();
    await flush();

    refuse(1, status);
    jest.advanceTimersByTime(60_000);

    http.expectNone(() => true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ status });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('never reports a progress that is not a number from 0 to 100', async () => {
    start();
    await flush();

    const req = http.expectOne(address(1).url);
    req.event({ loaded: 5, type: HttpEventType.UploadProgress });
    req.event({ loaded: 0, total: 0, type: HttpEventType.UploadProgress });
    req.event({ loaded: 20, total: 10, type: HttpEventType.UploadProgress });
    req.flush(null, { status: 200, statusText: 'OK' });

    for (const event of events) {
      if ('progress' in event) {
        expect(Number.isFinite(event.progress)).toBe(true);
        expect(event.progress).toBeGreaterThanOrEqual(0);
        expect(event.progress).toBeLessThanOrEqual(100);
      }
    }
    expect(events[events.length - 1]).toEqual({ done: 'final:incoming/k1' });
  });

  it('reports progress before done and completes after done', async () => {
    start();
    await flush();

    const req = http.expectOne(address(1).url);
    req.event({ loaded: 1, total: 4, type: HttpEventType.UploadProgress });
    req.event({ loaded: 4, total: 4, type: HttpEventType.UploadProgress });
    req.flush(null, { status: 200, statusText: 'OK' });

    expect(events).toEqual([
      { progress: 25 },
      { progress: 100 },
      { sent: 'incoming/k1' },
      { done: 'final:incoming/k1' },
    ]);
    expect(completed).toBe(true);
  });

  it('confirms exactly once', async () => {
    start();
    await flush();

    ok(1);
    jest.advanceTimersByTime(60_000);

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('does not retry or confirm twice when confirm fails', async () => {
    confirm.mockReturnValue(throwError(() => ({ status: 409 })));
    start();
    await flush();

    ok(1);
    jest.advanceTimersByTime(60_000);

    http.expectNone(() => true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(failure).toEqual({ status: 409 });
  });

  it('cancels the request and never confirms when unsubscribed mid-upload', async () => {
    const subscription = start();
    await flush();
    const req = http.expectOne(address(1).url);

    subscription.unsubscribe();

    expect(req.cancelled).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('sends no further request when unsubscribed during the wait before a retry', async () => {
    const subscription = start();
    await flush();
    dropConnection(1);

    subscription.unsubscribe();
    jest.advanceTimersByTime(60_000);

    http.expectNone(() => true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('runs two uploads of the same helper independently', async () => {
    start();
    await flush();
    start();
    await flush();

    ok(1);
    ok(2);

    expect(ask).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls.map(([key]) => key).sort()).toEqual([
      'incoming/k1',
      'incoming/k2',
    ]);
  });

  it('asks again on every subscription instead of reusing an old address', async () => {
    const upload = uploader.upload(file, ask, confirm);

    upload.subscribe();
    await flush();
    ok(1);
    upload.subscribe();
    await flush();
    ok(2);

    expect(ask).toHaveBeenCalledTimes(2);
  });
});
