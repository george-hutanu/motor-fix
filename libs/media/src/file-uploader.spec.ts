// @traces 1191-FR-006
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { crc32Base64 } from './crc32';
import {
  FileUploader,
  type UploadAddress,
  type UploadEvent,
  type UploadOptions,
} from './file-uploader';

const address = (n: number): UploadAddress => ({
  headers: {
    'Content-Type': 'image/jpeg',
    'x-amz-checksum-crc32': `sum${n}==`,
  },
  key: `incoming/k${n}`,
  url: `https://store.example/motorfix/incoming/k${n}?X-Amz-Signature=${n}`,
});

describe('FileUploader', () => {
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

  // The checksum is read from the blob before the address is asked for.
  async function start(options?: UploadOptions) {
    uploader.upload<string>(file, ask, confirm, options).subscribe({
      error: (e: unknown) => {
        failure = e;
      },
      next: (e) => events.push(e),
    });
    await jest.advanceTimersByTimeAsync(0);
  }

  const dropConnection = (n: number) =>
    http
      .expectOne(address(n).url)
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });

  const refuse = (n: number, status: number) =>
    http
      .expectOne(address(n).url)
      .flush('<Error/>', { status, statusText: 'Refused' });

  it('asks for the address with the CRC32 of the file', async () => {
    await start();

    expect(ask).toHaveBeenCalledWith(await crc32Base64(file));
    http.expectOne(address(1).url).flush(null);
  });

  it('PUTs the file straight to the store with the address headers, reports progress, then confirms', async () => {
    await start();

    const req = http.expectOne(address(1).url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toBe(file);
    expect(req.request.headers.get('Content-Type')).toBe('image/jpeg');
    expect(req.request.headers.get('x-amz-checksum-crc32')).toBe('sum1==');
    expect(req.request.headers.keys().sort()).toEqual([
      'Content-Type',
      'x-amz-checksum-crc32',
    ]);
    req.event({ loaded: 5, total: 10, type: HttpEventType.UploadProgress });
    req.flush(null, { status: 200, statusText: 'OK' });

    expect(confirm).toHaveBeenCalledWith('incoming/k1');
    expect(events).toEqual([
      { progress: 50 },
      { sent: 'incoming/k1' },
      { done: 'final:incoming/k1' },
    ]);
    expect(failure).toBeUndefined();
  });

  it('tells the caller the key once the PUT landed, before the confirm is called', async () => {
    confirm.mockImplementation((key: string) => {
      expect(events).toEqual([{ sent: key }]);
      return of(`final:${key}`);
    });
    await start();

    http.expectOne(address(1).url).flush(null);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ done: 'final:incoming/k1' });
  });

  it('retries a dropped connection and succeeds', async () => {
    await start();

    dropConnection(1);
    jest.advanceTimersByTime(1000);
    http
      .expectOne(address(1).url)
      .flush(null, { status: 200, statusText: 'OK' });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { sent: 'incoming/k1' },
      { done: 'final:incoming/k1' },
    ]);
  });

  it('gives up after 3 retries of a dropped connection', async () => {
    await start();

    dropConnection(1);
    jest.advanceTimersByTime(1000);
    dropConnection(1);
    jest.advanceTimersByTime(2000);
    dropConnection(1);
    jest.advanceTimersByTime(4000);
    dropConnection(1);
    jest.advanceTimersByTime(10_000);

    http.expectNone(address(1).url);
    expect(failure).toMatchObject({ status: 0 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('retries a dropped connection as many times as the caller passes, none for 0', async () => {
    await start({ retries: 0 });

    dropConnection(1);
    jest.advanceTimersByTime(60_000);

    http.expectNone(address(1).url);
    expect(failure).toMatchObject({ status: 0 });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks for one new address, with the same checksum, when the store refuses an expired one', async () => {
    await start();

    refuse(1, 403);
    http
      .expectOne(address(2).url)
      .flush(null, { status: 200, statusText: 'OK' });

    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1]).toEqual(ask.mock.calls[0]);
    expect(confirm).toHaveBeenCalledWith('incoming/k2');
    expect(events).toEqual([
      { sent: 'incoming/k2' },
      { done: 'final:incoming/k2' },
    ]);
  });

  it('asks for one new address when retries are off too', async () => {
    await start({ retries: 0 });

    refuse(1, 403);
    http.expectOne(address(2).url).flush(null);

    expect(confirm).toHaveBeenCalledWith('incoming/k2');
  });

  it('gives up when the new address is refused too', async () => {
    await start();

    refuse(1, 403);
    refuse(2, 403);

    expect(ask).toHaveBeenCalledTimes(2);
    expect(failure).toMatchObject({ status: 403 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('gives up at once on any other refusal from the store', async () => {
    await start();

    refuse(1, 400);
    jest.advanceTimersByTime(10_000);

    http.expectNone(address(1).url);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ status: 400 });
  });

  it('fails with the error of the confirm call', async () => {
    confirm.mockReturnValue(throwError(() => ({ status: 422 })));
    await start();

    http
      .expectOne(address(1).url)
      .flush(null, { status: 200, statusText: 'OK' });

    expect(failure).toEqual({ status: 422 });
    expect(events).toEqual([{ sent: 'incoming/k1' }]);
  });
});
