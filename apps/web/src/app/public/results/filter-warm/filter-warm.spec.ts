import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SearchService } from '@motor-fix/data-access';

import { FilterWarm, LIFE_MS } from './filter-warm';
import { sendMeasurementsTo } from '../../../telemetry/browser/measure/measure';

type Pending = {
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const QUERY = {
  brand: 'bmw',
  near: '44.437,26.117',
  sort: 'rating' as const,
};
const OTHER = { ...QUERY, brand: 'audi' };

let lists: Pending[];
let pins: Pending[];
const measured = jest.fn();
let warm: FilterWarm;
let connection: Record<string, unknown> | undefined;
let visibility: DocumentVisibilityState;

const pending = (into: () => Pending[]) =>
  jest.fn(
    (params: Record<string, unknown>) =>
      new Promise((resolve, reject) =>
        into().push({ params, reject, resolve }),
      ),
  );

function setUp(platform: 'browser' | 'server' = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: SearchService,
        useValue: {
          garageSearchControllerForBrand: pending(() => lists),
          garageSearchControllerPins: pending(() => pins),
        },
      },
    ],
  });
  warm = TestBed.inject(FilterWarm);
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
const land = async () => {
  for (const read of [...lists, ...pins]) read.resolve({});
  await flush();
};
const outcomes = () =>
  measured.mock.calls.map(([type, , context]) => ({ ...context, type }));

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
  lists = [];
  pins = [];
  connection = undefined;
  visibility = 'visible';
  measured.mockReset();
  sendMeasurementsTo(measured);
});

afterEach(() => {
  jest.useRealTimers();
  sendMeasurementsTo(undefined);
});

// @traces 1398-FR-012
describe('warming the open-now answer of a search', () => {
  it('reads the first page and the pins with open now, never logged, with no cursor', () => {
    setUp();

    warm.warm(QUERY);

    expect(lists.map((r) => r.params)).toEqual([{ ...QUERY, open_now: '1' }]);
    expect(pins.map((r) => r.params)).toEqual([
      { brand: 'bmw', near: '44.437,26.117', open_now: '1' },
    ]);
  });

  it('warms each search once', async () => {
    setUp();

    warm.warm(QUERY);
    await land();
    warm.warm(QUERY);
    warm.warm(OTHER);

    expect(lists).toHaveLength(2);
    expect(lists[1].params['brand']).toBe('audi');
  });

  it('forgets the oldest search past twenty, and warms it again', async () => {
    setUp();

    for (let n = 0; n <= 20; n++) warm.warm({ ...QUERY, near: `44.4,26.${n}` });
    await land();
    warm.warm({ ...QUERY, near: '44.4,26.20' });
    warm.warm({ ...QUERY, near: '44.4,26.0' });

    expect(lists).toHaveLength(22);
    expect(lists[21].params['near']).toBe('44.4,26.0');
  });

  it.each([
    ['Save-Data is on', () => (connection = { saveData: true })],
    ['the connection is 2g', () => (connection = { effectiveType: '2g' })],
    [
      'the connection is slow-2g',
      () => (connection = { effectiveType: 'slow-2g' }),
    ],
    ['the page is hidden', () => (visibility = 'hidden')],
  ])('reads nothing when %s, and counts one skip', (_, set) => {
    setUp();
    set();

    warm.warm(QUERY);
    warm.warm(OTHER);

    expect(lists).toHaveLength(0);
    expect(pins).toHaveLength(0);
    expect(outcomes()).toEqual([
      { outcome: 'skipped', path: 'filter', type: 'prefetch' },
    ]);
  });

  it('reads nothing during the server render', () => {
    setUp('server');

    warm.warm(QUERY);

    expect(lists).toHaveLength(0);
    expect(measured).not.toHaveBeenCalled();
  });

  it('stays silent when a read fails or is refused', async () => {
    setUp();
    warm.warm(QUERY);
    lists[0].reject({ status: 429 });
    pins[0].resolve({});
    await flush();

    expect(measured).not.toHaveBeenCalled();
  });
});

// @traces 1398-FR-013
describe('what a warm reports', () => {
  it('reports a fetch with its duration once both answers landed', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    setUp();
    warm.warm(QUERY);
    jest.advanceTimersByTime(70);
    lists[0].resolve({});
    await flush();

    expect(measured).not.toHaveBeenCalled();

    pins[0].resolve({});
    await flush();

    expect(measured).toHaveBeenCalledWith(
      'prefetch',
      { duration: 70 },
      { outcome: 'fetched', path: 'filter' },
    );
  });

  it(`counts a hit within ${LIFE_MS / 1000} s of the answers landing, then forgets it`, async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    setUp();
    warm.warm(QUERY);
    await land();
    jest.advanceTimersByTime(LIFE_MS - 1);

    warm.judge(QUERY);
    warm.judge(QUERY);

    expect(outcomes().map((o) => o.outcome)).toEqual(['fetched', 'hit']);
  });

  it('counts an expiry later than that', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    setUp();
    warm.warm(QUERY);
    await land();
    jest.advanceTimersByTime(LIFE_MS);

    warm.judge(QUERY);

    expect(outcomes().map((o) => o.outcome)).toEqual(['fetched', 'expired']);
  });

  it('counts nothing for a search it never warmed, or one still loading', () => {
    setUp();
    warm.warm(QUERY);

    warm.judge(QUERY);
    warm.judge(OTHER);

    expect(measured).not.toHaveBeenCalled();
  });

  it('names no brand or place in what it reports', async () => {
    setUp();
    warm.warm(QUERY);
    await land();
    warm.judge(QUERY);

    expect(JSON.stringify(measured.mock.calls)).not.toMatch(/bmw|44\.437/);
  });
});
