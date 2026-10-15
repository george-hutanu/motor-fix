import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';

import { ProfilePrefetch } from './profile-prefetch';
import { sendMeasurementsTo } from '../../telemetry/browser/measure/measure';

const garageOf = (slug: string): PublicGarageDto => ({
  brandNote: null,
  doesNotTake: [],
  id: `g-${slug}`,
  jobTypes: [],
  name: slug,
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug,
  verifiedAt: null,
  worksOn: [],
});

const PATH = /\/api\/v1\/garages\/([^/?]+)/;

let http: HttpTestingController;
let prefetch: ProfilePrefetch;
let chunk: jest.SpyInstance;
const measured = jest.fn();

function setUp(platform: 'browser' | 'server' = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  seen = [];
  chunk = jest
    .spyOn(ProfilePrefetch.prototype as never, 'preload' as never)
    .mockImplementation((() => Promise.resolve()) as never);
  prefetch = TestBed.inject(ProfilePrefetch);
}

// Requests still open: matching takes them from the controller, so they are
// kept here until answered or cancelled.
let seen: TestRequest[] = [];
const open = () => {
  seen.push(...http.match((request) => PATH.test(request.url)));
  seen = seen.filter((request) => !request.cancelled);
  return seen;
};
const slugs = () => open().map((r) => r.request.url.match(PATH)?.[1]);
const answer = (
  slug: string,
  body: PublicGarageDto | null = garageOf(slug),
  opts?: { status: number; statusText: string },
) => {
  const request = open().find((r) => r.request.url.endsWith(`/${slug}`));
  seen = seen.filter((r) => r !== request);
  request?.flush(body, opts);
};
const outcomes = () =>
  measured.mock.calls.map(([type, , context]) => ({
    outcome: context.outcome,
    path: context.path,
    type,
  }));

let connection: Record<string, unknown> | undefined;
let visibility: DocumentVisibilityState;

beforeAll(() => {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    get: () => connection,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

beforeEach(() => {
  connection = undefined;
  visibility = 'visible';
  measured.mockReset();
  sendMeasurementsTo(measured);
});

afterEach(() => {
  jest.useRealTimers();
  chunk?.mockRestore();
  sendMeasurementsTo(undefined);
});

// @traces 1169-FR-007
describe('pre-fetching a garage profile', () => {
  it('reads the profile with the brand in context', () => {
    setUp();

    prefetch.want('militari', 'bmw');

    const [request] = open();
    expect(request.request.method).toBe('GET');
    expect(request.request.url).toMatch(/\/api\/v1\/garages\/militari$/);
    expect(request.request.params.get('brand')).toBe('bmw');
  });

  it('keeps at most three reads in flight and starts the next when one answers', () => {
    setUp();

    for (const slug of ['a', 'b', 'c', 'd', 'e']) prefetch.want(slug, 'bmw');

    expect(slugs()).toEqual(['a', 'b', 'c']);
    answer('a');
    expect(slugs()).toEqual(['b', 'c', 'd']);
  });

  it('starts no second read for a key in flight, waiting or stored', () => {
    setUp();
    prefetch.want('a', undefined);
    prefetch.want('a', undefined);
    expect(open()).toHaveLength(1);

    answer('a');
    prefetch.want('a', undefined);

    expect(open()).toHaveLength(0);
  });

  it('tells two brands of one garage apart', () => {
    setUp();

    prefetch.want('a', 'bmw');
    prefetch.want('a', 'dacia');

    expect(open()).toHaveLength(2);
  });

  it('cancels a read in flight and stores nothing', () => {
    setUp();
    prefetch.want('a', 'bmw');
    const [request] = open();

    prefetch.cancel('a', 'bmw');

    expect(request.cancelled).toBe(true);
    expect(prefetch.take('a', 'bmw')).toBeUndefined();
  });

  it('frees the slot of a cancelled read for one that waits', () => {
    setUp();
    for (const slug of ['a', 'b', 'c', 'd']) prefetch.want(slug, undefined);

    prefetch.cancel('a', undefined);

    expect(slugs()).toEqual(['b', 'c', 'd']);
  });

  it('drops a waiting key on cancel, so it never reads', () => {
    setUp();
    for (const slug of ['a', 'b', 'c', 'd']) prefetch.want(slug, undefined);

    prefetch.cancel('d', undefined);
    answer('a');

    expect(slugs()).not.toContain('d');
  });

  it("requests the profile page's code once, on the first signal", () => {
    setUp();
    expect(chunk).not.toHaveBeenCalled();

    prefetch.want('a', undefined);
    prefetch.want('b', undefined);

    expect(chunk).toHaveBeenCalledTimes(1);
  });

  it('sends no beacon and records no view', () => {
    const beacon = jest.fn();
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: beacon,
    });
    setUp();

    prefetch.want('a', undefined);
    answer('a');
    prefetch.take('a', undefined);

    http.verify();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('learns of the first scroll', () => {
    setUp();
    expect(prefetch.scrolled).toBe(false);

    window.dispatchEvent(new Event('scroll'));

    expect(prefetch.scrolled).toBe(true);
  });
});

// @traces 1169-FR-008
describe('the pre-fetched profile', () => {
  it('is handed to the page, and kept for a look back within 120 s', () => {
    setUp();
    prefetch.want('a', 'bmw');
    answer('a');

    expect(prefetch.take('a', 'bmw')).toEqual(garageOf('a'));
    expect(prefetch.take('a', 'bmw')).toEqual(garageOf('a'));
    expect(prefetch.take('a', undefined)).toBeUndefined();
  });

  it('is dropped once older than 120 s, and read again on the next signal', () => {
    jest.useFakeTimers();
    setUp();
    prefetch.want('a', undefined);
    answer('a');

    jest.advanceTimersByTime(121_000);

    expect(prefetch.take('a', undefined)).toBeUndefined();
    prefetch.want('a', undefined);
    expect(open()).toHaveLength(1);
  });

  it.each([404, 410])(
    'remembers a %i for 120 s, never serves it and reads it again after',
    (status) => {
      jest.useFakeTimers();
      setUp();
      prefetch.want('a', undefined);
      answer('a', null, { status, statusText: 'Gone' });

      prefetch.want('a', undefined);
      expect(open()).toHaveLength(0);
      expect(prefetch.take('a', undefined)).toBeUndefined();

      jest.advanceTimersByTime(121_000);
      prefetch.want('a', undefined);
      expect(open()).toHaveLength(1);
    },
  );

  it('stores nothing for a failed read, so the next signal reads again', () => {
    setUp();
    prefetch.want('a', undefined);
    answer('a', null, { status: 503, statusText: 'Unavailable' });

    expect(prefetch.take('a', undefined)).toBeUndefined();
    prefetch.want('a', undefined);
    expect(open()).toHaveLength(1);
  });
});

// @traces 1169-FR-009
describe('when pre-fetching stays off', () => {
  it.each([
    ['Save-Data is on', () => (connection = { saveData: true })],
    ['the connection is 2g', () => (connection = { effectiveType: '2g' })],
    [
      'the connection is slow-2g',
      () => (connection = { effectiveType: 'slow-2g' }),
    ],
    ['the page is hidden', () => (visibility = 'hidden')],
  ])('reads nothing and loads no code when %s', (_, set) => {
    setUp();
    set();

    prefetch.want('a', undefined);

    expect(open()).toHaveLength(0);
    expect(chunk).not.toHaveBeenCalled();
  });

  it('judges the connection afresh at every signal', () => {
    setUp();
    connection = { saveData: true };
    prefetch.want('a', undefined);

    connection = { effectiveType: '4g', saveData: false };
    prefetch.want('a', undefined);

    expect(open()).toHaveLength(1);
  });

  it('reads nothing during the server render', () => {
    setUp('server');

    prefetch.want('a', undefined);

    expect(open()).toHaveLength(0);
    expect(chunk).not.toHaveBeenCalled();
  });
});

// @traces 1169-FR-011
describe('what a pre-fetch reports', () => {
  it('reports a fetch with its duration', () => {
    jest.useFakeTimers();
    setUp();
    prefetch.want('a', undefined);
    jest.advanceTimersByTime(40);
    answer('a');

    expect(measured).toHaveBeenCalledWith(
      'prefetch',
      { duration: 40 },
      { outcome: 'fetched', path: 'profile' },
    );
  });

  it('reports a cancel, a hit, an expiry and one skip per page', () => {
    jest.useFakeTimers();
    setUp();
    prefetch.want('a', undefined);
    prefetch.cancel('a', undefined);
    prefetch.want('b', undefined);
    answer('b');
    prefetch.take('b', undefined);
    jest.advanceTimersByTime(121_000);
    prefetch.take('b', undefined);
    connection = { saveData: true };
    prefetch.want('c', undefined);
    prefetch.want('d', undefined);

    expect(outcomes()).toEqual(
      ['cancelled', 'fetched', 'hit', 'expired', 'skipped'].map((outcome) => ({
        outcome,
        path: 'profile',
        type: 'prefetch',
      })),
    );
  });

  it('names no garage in what it reports', () => {
    setUp();
    prefetch.want('militari', 'bmw');
    answer('militari');
    prefetch.take('militari', 'bmw');

    expect(JSON.stringify(measured.mock.calls)).not.toMatch(/militari|bmw/);
  });

  it('works on when telemetry is not loaded or fails', () => {
    sendMeasurementsTo(undefined);
    setUp();
    prefetch.want('a', undefined);
    answer('a');
    expect(prefetch.take('a', undefined)).toEqual(garageOf('a'));

    sendMeasurementsTo(() => {
      throw new Error('collector down');
    });
    expect(() => prefetch.take('a', undefined)).not.toThrow();
  });
});
