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
  fields: { 'Content-Type': 'image/jpeg', key: `incoming/k${n}`, Policy: 'p' },
  key: `incoming/k${n}`,
  url: `https://store.example/motorfix?n=${n}`,
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

  function start() {
    uploader.upload<string>(file, ask, confirm).subscribe({
      error: (e: unknown) => {
        failure = e;
      },
      next: (e) => events.push(e),
    });
  }

  const dropConnection = (n: number) =>
    http
      .expectOne(address(n).url)
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });

  const refuse = (n: number, status: number) =>
    http
      .expectOne(address(n).url)
      .flush('<Error/>', { status, statusText: 'Refused' });

  it('posts the address fields then the file straight to the store, reports progress, then confirms', () => {
    start();

    const req = http.expectOne(address(1).url);
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect([...body.keys()]).toEqual(['Content-Type', 'key', 'Policy', 'file']);
    expect(body.get('file')).toBeInstanceOf(Blob);
    req.event({ loaded: 5, total: 10, type: HttpEventType.UploadProgress });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(confirm).toHaveBeenCalledWith('incoming/k1');
    expect(events).toEqual([{ progress: 50 }, { done: 'final:incoming/k1' }]);
    expect(failure).toBeUndefined();
  });

  it('retries a dropped connection and succeeds', () => {
    start();

    dropConnection(1);
    jest.advanceTimersByTime(1000);
    http
      .expectOne(address(1).url)
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ done: 'final:incoming/k1' }]);
  });

  it('gives up after 3 retries of a dropped connection', () => {
    start();

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

  it('asks for one new address when the store refuses an expired one', () => {
    start();

    refuse(1, 403);
    http
      .expectOne(address(2).url)
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(ask).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledWith('incoming/k2');
    expect(events).toEqual([{ done: 'final:incoming/k2' }]);
  });

  it('gives up when the new address is refused too', () => {
    start();

    refuse(1, 403);
    refuse(2, 403);

    expect(ask).toHaveBeenCalledTimes(2);
    expect(failure).toMatchObject({ status: 403 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('gives up at once on any other refusal from the store', () => {
    start();

    refuse(1, 400);
    jest.advanceTimersByTime(10_000);

    http.expectNone(address(1).url);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ status: 400 });
  });

  it('fails with the error of the confirm call', () => {
    confirm.mockReturnValue(throwError(() => ({ status: 422 })));
    start();

    http
      .expectOne(address(1).url)
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(failure).toEqual({ status: 422 });
    expect(events).toEqual([]);
  });
});
