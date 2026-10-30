import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SearchService } from '@motor-fix/data-access';

import { FilterWarm, LIFE_MS } from './filter-warm';
import { sendMeasurementsTo } from '../../../telemetry/browser/measure/measure';

const QUERY = { brand: 'bmw', near: '44.437,26.117', sort: 'rating' as const };

let list: jest.Mock;
let pins: jest.Mock;
const measured = jest.fn();
let visibility: DocumentVisibilityState;
let now: number;

function setUp(platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: SearchService,
        useValue: {
          garageSearchControllerForBrand: list,
          garageSearchControllerPins: pins,
        },
      },
    ],
  });
  return TestBed.inject(FilterWarm);
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const outcomes = () => measured.mock.calls.map(([, , context]) => context);

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

beforeEach(() => {
  list = jest.fn().mockResolvedValue({});
  pins = jest.fn().mockResolvedValue({});
  visibility = 'visible';
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  measured.mockReset();
  sendMeasurementsTo(measured);
  TestBed.resetTestingModule();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the filter warm under hostile conditions', () => {
  it('reads nothing on the server', () => {
    setUp('server').warm(QUERY);
    expect(list).not.toHaveBeenCalled();
    expect(pins).not.toHaveBeenCalled();
    expect(outcomes()).toEqual([]);
  });

  it('asks for open now alone, without log, cursor or sort on the pins', () => {
    setUp().warm({ ...QUERY, cursor: 'x', log: '1' } as never);
    expect(pins.mock.calls[0][0]).toEqual({
      brand: 'bmw',
      cursor: 'x',
      log: '1',
      near: '44.437,26.117',
      open_now: '1',
    });
    expect(list.mock.calls[0][0].open_now).toBe('1');
  });

  it('reports one skip for a page in the background however often it is asked', () => {
    visibility = 'hidden';
    const warm = setUp();
    warm.warm(QUERY);
    warm.warm({ ...QUERY, brand: 'audi' });
    expect(list).not.toHaveBeenCalled();
    expect(outcomes()).toEqual([{ outcome: 'skipped', path: 'filter' }]);
  });

  it('warms a search that was skipped once the page is visible again', () => {
    visibility = 'hidden';
    const warm = setUp();
    warm.warm(QUERY);
    visibility = 'visible';
    warm.warm(QUERY);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reads a search once however often it is asked', () => {
    const warm = setUp();
    warm.warm(QUERY);
    warm.warm({ ...QUERY });
    expect(list).toHaveBeenCalledTimes(1);
    expect(pins).toHaveBeenCalledTimes(1);
  });

  it('reports nothing and does not retry when a read fails', async () => {
    pins.mockRejectedValue(new Error('boom'));
    const warm = setUp();
    warm.warm(QUERY);
    await flush();
    warm.judge(QUERY);
    expect(outcomes()).toEqual([]);
    warm.warm(QUERY);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the client throws at once', () => {
    list.mockImplementation(() => {
      throw new Error('sync boom');
    });
    expect(() => setUp().warm(QUERY)).not.toThrow();
  });

  it('judges a search never warmed as nothing', () => {
    setUp().judge(QUERY);
    expect(outcomes()).toEqual([]);
  });

  it('judges before the answer landed as nothing', () => {
    const warm = setUp();
    list.mockReturnValue(new Promise(() => undefined));
    warm.warm(QUERY);
    warm.judge(QUERY);
    expect(outcomes()).toEqual([]);
  });

  it('counts a landed warm once and forgets it', async () => {
    const warm = setUp();
    warm.warm(QUERY);
    await flush();
    warm.judge(QUERY);
    warm.judge(QUERY);
    expect(outcomes().filter((c) => c.outcome === 'hit')).toHaveLength(1);
  });

  it('calls an answer one ms short of its life a hit', async () => {
    const warm = setUp();
    warm.warm(QUERY);
    await flush();
    now += LIFE_MS - 1;
    warm.judge(QUERY);
    expect(outcomes().at(-1)).toEqual({ outcome: 'hit', path: 'filter' });
  });

  it('calls an answer exactly at its life expired', async () => {
    const warm = setUp();
    warm.warm(QUERY);
    await flush();
    now += LIFE_MS;
    warm.judge(QUERY);
    expect(outcomes().at(-1)).toEqual({ outcome: 'expired', path: 'filter' });
  });

  it('judges another search as nothing', async () => {
    const warm = setUp();
    warm.warm(QUERY);
    await flush();
    warm.judge({ ...QUERY, brand: 'audi' });
    expect(outcomes().every((c) => c.outcome === 'fetched')).toBe(true);
  });

  it('reports no brand or place in what it measures', async () => {
    const warm = setUp();
    warm.warm(QUERY);
    await flush();
    expect(JSON.stringify(measured.mock.calls)).not.toMatch(/bmw|44\.437/);
  });
});
