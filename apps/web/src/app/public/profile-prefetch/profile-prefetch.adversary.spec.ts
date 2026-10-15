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

const PATH = /\/api\/v1\/garages\//;

let http: HttpTestingController;
let prefetch: ProfilePrefetch;
let preload: jest.Mock;
let seen: TestRequest[] = [];
const measured = jest.fn();
let connection: Record<string, unknown> | undefined;
// Wider than the DOM typing, which has no prerender.
let visibility: string;

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
  preload = jest.fn(() => Promise.resolve());
  jest
    .spyOn(ProfilePrefetch.prototype as never, 'preload' as never)
    .mockImplementation(preload as never);
  prefetch = TestBed.inject(ProfilePrefetch);
}

const open = () => {
  seen.push(...http.match((request) => PATH.test(request.url)));
  seen = seen.filter((request) => !request.cancelled);
  return seen;
};
const urls = () => open().map((r) => r.request.urlWithParams);
const settle = (
  slug: string,
  body: Parameters<TestRequest['flush']>[0],
  opts?: { status: number; statusText: string },
) => {
  const request = open().find((r) => r.request.url.endsWith(`/${slug}`));
  seen = seen.filter((r) => r !== request);
  request?.flush(body, opts);
};
const reported = () =>
  measured.mock.calls.map(([, , context]) => context.outcome);

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
  jest.restoreAllMocks();
  sendMeasurementsTo(undefined);
});

// @traces 1169-prefetch-intent-FR-008
describe('the age of a pre-fetched profile', () => {
  it('serves an entry 119.999 s old and drops one exactly 120 s old', () => {
    jest.useFakeTimers({ now: 1_000_000 });
    setUp();
    prefetch.want('a', 'bmw');
    settle('a', garageOf('a'));

    jest.setSystemTime(1_000_000 + 119_999);
    expect(prefetch.take('a', 'bmw')?.slug).toBe('a');

    jest.setSystemTime(1_000_000 + 120_000);
    expect(prefetch.take('a', 'bmw')).toBeUndefined();
  });

  it('reports an expiry once and then knows nothing of the entry', () => {
    jest.useFakeTimers({ now: 1_000_000 });
    setUp();
    prefetch.want('a', undefined);
    settle('a', garageOf('a'));
    jest.setSystemTime(1_000_000 + 500_000);

    expect(prefetch.take('a', undefined)).toBeUndefined();
    expect(prefetch.take('a', undefined)).toBeUndefined();

    expect(reported().filter((o) => o === 'expired')).toHaveLength(1);
  });
});

// @traces 1169-prefetch-intent-FR-008
describe('a profile that is not found or gone', () => {
  it.each([404, 410])(
    'is not read again within 120 s after a %s and is read again after',
    (status) => {
      jest.useFakeTimers({ now: 1_000_000 });
      setUp();
      prefetch.want('gone', 'bmw');
      settle('gone', null, { status, statusText: 'x' });

      prefetch.want('gone', 'bmw');
      expect(urls()).toEqual([]);
      expect(prefetch.take('gone', 'bmw')).toBeUndefined();
      expect(reported()).not.toContain('hit');

      jest.setSystemTime(1_000_000 + 120_001);
      prefetch.want('gone', 'bmw');
      expect(urls()).toHaveLength(1);
    },
  );

  it.each([0, 500, 503])(
    'is read again at the next signal after a %s',
    (status) => {
      setUp();
      prefetch.want('flaky', undefined);
      settle('flaky', null, { status, statusText: 'x' });

      prefetch.want('flaky', undefined);

      expect(urls()).toHaveLength(1);
    },
  );
});

// @traces 1169-prefetch-intent-FR-007
describe('hostile slugs and brands', () => {
  it('keeps a slug holding a slash inside one path segment', () => {
    setUp();

    prefetch.want('a/../admin', undefined);

    const [url] = urls();
    expect(url).not.toMatch(/garages\/a\/\.\.\/admin/);
    expect(url.split('?')[0].split('/garages/')[1]).not.toContain('/');
  });

  it('sends a brand holding ampersands and unicode as one parameter', () => {
    setUp();

    prefetch.want('a', 'bmw&x=1 ț');

    const [request] = open();
    expect(request.request.params.get('brand')).toBe('bmw&x=1 ț');
    expect(request.request.params.keys()).toEqual(['brand']);
  });

  it('sends no brand parameter for an empty brand', () => {
    setUp();

    prefetch.want('a', '');

    expect(urls()[0]).not.toContain('brand');
  });

  it('never hands one garage’s profile to a key that only looks like it', () => {
    setUp();
    prefetch.want('a', 'b|');
    settle('a', garageOf('a'));

    expect(prefetch.take('a|b', undefined)).toBeUndefined();
  });
});

// @traces 1169-prefetch-intent-FR-007
describe('cancelling', () => {
  it('cancels nothing and reports nothing after the answer arrived', () => {
    setUp();
    prefetch.want('a', undefined);
    settle('a', garageOf('a'));

    prefetch.cancel('a', undefined);

    expect(reported()).toEqual(['fetched']);
    expect(prefetch.take('a', undefined)?.slug).toBe('a');
  });

  it('accepts a cancel for a card it never saw', () => {
    setUp();

    prefetch.cancel('nobody', 'bmw');

    expect(reported()).toEqual([]);
  });

  it('cancels twice with one report', () => {
    setUp();
    prefetch.want('a', undefined);

    prefetch.cancel('a', undefined);
    prefetch.cancel('a', undefined);

    expect(reported()).toEqual(['cancelled']);
  });

  it('keeps three in flight through a hundred signals and a cancel of each', () => {
    setUp();
    for (let i = 0; i < 100; i++) prefetch.want(`g${i}`, undefined);
    expect(open()).toHaveLength(3);

    for (let i = 0; i < 100; i++) {
      prefetch.cancel(`g${i}`, undefined);
      expect(open().length).toBeLessThanOrEqual(3);
    }

    expect(open()).toHaveLength(0);
  });
});

// @traces 1169-prefetch-intent-FR-009
describe('when pre-fetching must stay off', () => {
  it('requests no route code while Save-Data is on', () => {
    connection = { saveData: true };
    setUp();

    prefetch.want('a', undefined);

    expect(preload).not.toHaveBeenCalled();
    expect(open()).toHaveLength(0);
  });

  it.each(['2g', 'slow-2g'])('fetches nothing on a %s connection', (type) => {
    connection = { effectiveType: type };
    setUp();

    prefetch.want('a', undefined);

    expect(open()).toHaveLength(0);
    expect(preload).not.toHaveBeenCalled();
  });

  it.each(['3g', '4g'])('fetches on a %s connection', (type) => {
    connection = { effectiveType: type };
    setUp();

    prefetch.want('a', undefined);

    expect(open()).toHaveLength(1);
  });

  it.each(['hidden', 'prerender'] as const)(
    'fetches nothing in a %s document, and nothing later when it shows',
    (state) => {
      visibility = state;
      setUp();
      prefetch.want('a', undefined);

      visibility = 'visible';

      expect(open()).toHaveLength(0);
      expect(preload).not.toHaveBeenCalled();
    },
  );

  it('does not queue a skipped signal for later', () => {
    connection = { saveData: true };
    setUp();
    prefetch.want('a', undefined);

    connection = undefined;
    prefetch.want('b', undefined);

    expect(urls().map((u) => u.split('/garages/')[1])).toEqual(['b']);
  });

  it('answers nothing and reports nothing during the server render', () => {
    setUp('server');

    prefetch.want('a', 'bmw');
    prefetch.cancel('a', 'bmw');

    expect(open()).toHaveLength(0);
    expect(prefetch.take('a', 'bmw')).toBeUndefined();
    expect(measured).not.toHaveBeenCalled();
  });
});

// @traces 1169-prefetch-intent-FR-007
describe('route code that fails to load', () => {
  it('still reads the profile when the chunk request is rejected', async () => {
    setUp();
    preload.mockRejectedValue(new Error('ChunkLoadError'));

    prefetch.want('a', undefined);
    await Promise.resolve();

    expect(open()).toHaveLength(1);
  });
});

// @traces 1169-prefetch-intent-FR-008
describe('an answer without a garage', () => {
  it('is handed to the page as nothing, not as null', () => {
    setUp();
    prefetch.want('a', undefined);
    settle('a', null);

    expect(prefetch.take('a', undefined)).toBeUndefined();
    expect(reported()).not.toContain('hit');
  });
});
