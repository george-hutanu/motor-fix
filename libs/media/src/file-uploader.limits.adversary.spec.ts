// @traces 1191-FR-006
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  FileUploader,
  type UploadAddress,
  type UploadEvent,
} from './file-uploader';

const address = (n: number): UploadAddress => ({
  headers: { 'Content-Type': 'image/jpeg', 'x-amz-checksum-crc32': 'AAAAAA==' },
  key: `incoming/k${n}`,
  url: `https://store.example/motorfix/incoming/k${n}?sig=${n}`,
});

describe('FileUploader against a hostile store', () => {
  let http: HttpTestingController;
  let uploader: FileUploader;
  let events: UploadEvent<string>[];
  let failure: unknown;
  let ask: jest.Mock;
  let confirm: jest.Mock;

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

  async function start(file: Blob, retries?: number) {
    const subscription = uploader
      .upload<string>(file, ask, confirm, { retries })
      .subscribe({
        error: (e: unknown) => {
          failure = e;
        },
        next: (e) => events.push(e),
      });
    await jest.advanceTimersByTimeAsync(0);
    return subscription;
  }

  const jpeg = () => new Blob(['jpeg bytes'], { type: 'image/jpeg' });

  it('declares an empty file with the checksum of nothing', async () => {
    await start(new Blob([], { type: 'image/jpeg' }));

    expect(ask).toHaveBeenCalledWith('AAAAAA==');
    http.expectOne(address(1).url).flush(null);
  });

  it('cancels the PUT and never confirms when the caller unsubscribes mid-upload', async () => {
    const subscription = await start(jpeg());
    const req = http.expectOne(address(1).url);

    subscription.unsubscribe();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(req.cancelled).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('reports a whole percent between 0 and 100 while the total is unknown', async () => {
    await start(jpeg());
    const req = http.expectOne(address(1).url);

    req.event({ loaded: 4, type: HttpEventType.UploadProgress });
    req.event({ loaded: 4, total: 0, type: HttpEventType.UploadProgress });
    req.flush(null);

    const reported = events
      .slice(0, 2)
      .map((e) => (e as { progress: number }).progress);
    expect(
      reported.every((p) => Number.isInteger(p) && p >= 0 && p <= 100),
    ).toBe(true);
  });

  it('never reports more than 100 percent', async () => {
    await start(jpeg());
    const req = http.expectOne(address(1).url);

    req.event({ loaded: 50, total: 10, type: HttpEventType.UploadProgress });
    req.flush(null);

    expect(events[0]).toEqual({ progress: 100 });
  });

  it.each([500, 502, 503])(
    'fails at once on a %i from the store and never confirms',
    async (status) => {
      await start(jpeg());

      http
        .expectOne(address(1).url)
        .flush('<Error/>', { status, statusText: 'Error' });
      await jest.advanceTimersByTimeAsync(60_000);

      http.expectNone(address(1).url);
      expect(failure).toMatchObject({ status });
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it('does not ask a new address for a 401 or 404 from the store', async () => {
    await start(jpeg());

    http
      .expectOne(address(1).url)
      .flush('', { status: 404, statusText: 'Not Found' });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ status: 404 });
  });

  it('fails with the address error and sends nothing when the address is refused', async () => {
    ask.mockReturnValue(throwError(() => ({ status: 422 })));

    await start(jpeg());

    http.expectNone(() => true);
    expect(failure).toEqual({ status: 422 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('retries a dropped connection once when told to, then gives up', async () => {
    await start(jpeg(), 1);

    http
      .expectOne(address(1).url)
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });
    await jest.advanceTimersByTimeAsync(1000);
    http
      .expectOne(address(1).url)
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });
    await jest.advanceTimersByTimeAsync(60_000);

    http.expectNone(address(1).url);
    expect(failure).toMatchObject({ status: 0 });
  });

  it('confirms exactly once when the store answers with extra events', async () => {
    await start(jpeg());
    const req = http.expectOne(address(1).url);

    req.event({ loaded: 10, total: 10, type: HttpEventType.UploadProgress });
    req.flush(null, { status: 200, statusText: 'OK' });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => 'done' in e)).toHaveLength(1);
  });

  it('runs two uploads of the same file independently', async () => {
    await start(jpeg());
    await start(jpeg());

    http.expectOne(address(1).url).flush(null);
    http.expectOne(address(2).url).flush(null);

    expect(ask).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls.map(([k]) => k).sort()).toEqual([
      'incoming/k1',
      'incoming/k2',
    ]);
  });

  it('sends a 12 MB file whole, as the one body', async () => {
    const big = new File([new Uint8Array(12 * 1024 * 1024)], 'big.jpg', {
      type: 'image/jpeg',
    });

    await start(big);

    const req = http.expectOne(address(1).url);
    expect(req.request.body).toBe(big);
    expect(ask).toHaveBeenCalledTimes(1);
    req.flush(null);
  });
});
