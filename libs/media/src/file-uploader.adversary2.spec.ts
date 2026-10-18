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
import { of } from 'rxjs';

import {
  FileUploader,
  type UploadAddress,
  type UploadEvent,
} from './file-uploader';

const address = (n: number): UploadAddress => ({
  headers: { 'Content-Type': 'image/jpeg', 'x-amz-signed': `p${n}` },
  key: `incoming/k${n}`,
  url: `https://store.example/motorfix/incoming/k${n}?n=${n}`,
});

describe('FileUploader second round of hostile conditions', () => {
  let http: HttpTestingController;
  let uploader: FileUploader;
  let events: UploadEvent<string>[];
  let failure: unknown;
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
    let asked = 0;
    ask = jest.fn(() => of(address(++asked)));
    confirm = jest.fn((key: string) => of(`final:${key}`));
  });

  afterEach(() => {
    http.verify();
    jest.useRealTimers();
  });

  const start = () =>
    uploader.upload<string>(file, ask, confirm).subscribe({
      error: (e: unknown) => {
        failure = e;
      },
      next: (e) => events.push(e),
    });

  // Lets the checksum of the blob resolve so the address is asked for.
  const flush = () => jest.advanceTimersByTimeAsync(0);

  const drop = () =>
    http
      .expectOne((r) => r.url.startsWith('https://store.example/'))
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });

  it('waits two seconds before the second retry and four before the third', async () => {
    start();
    await flush();
    drop();
    jest.advanceTimersByTime(1000);
    drop();

    jest.advanceTimersByTime(1999);
    http.expectNone((r) => r.url.startsWith('https://store.example/'));
    jest.advanceTimersByTime(1);
    drop();

    jest.advanceTimersByTime(3999);
    http.expectNone((r) => r.url.startsWith('https://store.example/'));
    jest.advanceTimersByTime(1);
    http
      .expectOne((r) => r.url.startsWith('https://store.example/'))
      .flush(null, { status: 200, statusText: 'OK' });

    expect(events).toEqual([
      { sent: 'incoming/k1' },
      { done: 'final:incoming/k1' },
    ]);
  });

  it('confirms the key of the fresh address after an expiry, not the first one', async () => {
    start();
    await flush();
    http
      .expectOne(address(1).url)
      .flush('<Error/>', { status: 403, statusText: 'Forbidden' });
    http
      .expectOne(address(2).url)
      .flush(null, { status: 200, statusText: 'OK' });

    expect(confirm).toHaveBeenCalledWith('incoming/k2');
    expect(confirm).not.toHaveBeenCalledWith('incoming/k1');
  });

  it.each([500, 502, 503, 400, 413])(
    'gives up at once on a %i from the store without asking again',
    async (status) => {
      start();
      await flush();
      http
        .expectOne(address(1).url)
        .flush('<Error/>', { status, statusText: 'Refused' });

      expect(ask).toHaveBeenCalledTimes(1);
      expect(confirm).not.toHaveBeenCalled();
      expect(failure).toBeInstanceOf(HttpErrorResponse);
      expect((failure as HttpErrorResponse).status).toBe(status);
      jest.advanceTimersByTime(10_000);
    },
  );

  it.each([
    ['without a total', { loaded: 50, total: undefined }],
    ['with a total of zero', { loaded: 0, total: 0 }],
    ['with more loaded than the total', { loaded: 150, total: 100 }],
  ])(
    'reports a whole progress from 0 to 100 for an event %s',
    async (_, event) => {
      start();
      await flush();
      const req = http.expectOne(address(1).url);
      req.event({ type: HttpEventType.UploadProgress, ...event });

      const progress = events.filter(
        (e): e is { progress: number } => 'progress' in e,
      );
      for (const p of progress) {
        expect(Number.isFinite(p.progress)).toBe(true);
        expect(p.progress).toBeGreaterThanOrEqual(0);
        expect(p.progress).toBeLessThanOrEqual(100);
      }
      req.flush(null, { status: 200, statusText: 'OK' });
      expect(events[events.length - 1]).toEqual({ done: 'final:incoming/k1' });
    },
  );

  it('sends the fresh address headers and not the old ones after an expiry', async () => {
    start();
    await flush();
    http
      .expectOne(address(1).url)
      .flush('<Error/>', { status: 403, statusText: 'Forbidden' });

    const req = http.expectOne(address(2).url);
    expect(req.request.headers.get('x-amz-signed')).toBe('p2');
    expect(req.request.url).toBe(address(2).url);
    req.flush(null, { status: 200, statusText: 'OK' });
  });

  it('emits no done event when confirm completes without a value', async () => {
    confirm.mockReturnValue(of());
    start();
    await flush();
    http
      .expectOne(address(1).url)
      .flush(null, { status: 200, statusText: 'OK' });

    expect(events.filter((e) => 'done' in e)).toEqual([]);
    expect(failure).toBeUndefined();
  });
});
