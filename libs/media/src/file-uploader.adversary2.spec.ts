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
  fields: { key: `incoming/k${n}`, Policy: `p${n}` },
  key: `incoming/k${n}`,
  url: `https://store.example/motorfix?n=${n}`,
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

  const drop = () =>
    http
      .expectOne((r) => r.url.startsWith('https://store.example/'))
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });

  it('waits two seconds before the second retry and four before the third', () => {
    start();
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
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(events).toEqual([{ done: 'final:incoming/k1' }]);
  });

  it('confirms the key of the fresh address after an expiry, not the first one', () => {
    start();
    http
      .expectOne(address(1).url)
      .flush('<Error/>', { status: 403, statusText: 'Forbidden' });
    http
      .expectOne(address(2).url)
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(confirm).toHaveBeenCalledWith('incoming/k2');
    expect(confirm).not.toHaveBeenCalledWith('incoming/k1');
  });

  it.each([
    500, 502, 503, 400, 413,
  ])('gives up at once on a %i from the store without asking again', (status) => {
    start();
    http
      .expectOne(address(1).url)
      .flush('<Error/>', { status, statusText: 'Refused' });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(HttpErrorResponse);
    expect((failure as HttpErrorResponse).status).toBe(status);
    jest.advanceTimersByTime(10_000);
  });

  it.each([
    ['without a total', { loaded: 50, total: undefined }],
    ['with a total of zero', { loaded: 0, total: 0 }],
    ['with more loaded than the total', { loaded: 150, total: 100 }],
  ])('reports a whole progress from 0 to 100 for an event %s', (_, event) => {
    start();
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
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(events[events.length - 1]).toEqual({ done: 'final:incoming/k1' });
  });

  it('posts the fresh address fields and not the old ones after an expiry', () => {
    start();
    http
      .expectOne(address(1).url)
      .flush('<Error/>', { status: 403, statusText: 'Forbidden' });

    const req = http.expectOne(address(2).url);
    const body = req.request.body as FormData;
    expect(body.get('Policy')).toBe('p2');
    expect(body.get('key')).toBe('incoming/k2');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('emits no done event when confirm completes without a value', () => {
    confirm.mockReturnValue(of());
    start();
    http
      .expectOne(address(1).url)
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(events.filter((e) => 'done' in e)).toEqual([]);
    expect(failure).toBeUndefined();
  });
});
