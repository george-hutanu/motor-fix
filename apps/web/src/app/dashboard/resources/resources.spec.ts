import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind } from '@motor-fix/contracts';
import type { CarDto, MeDto, RequestListDto } from '@motor-fix/data-access';

import { type Held, Resources } from './resources';
import { fakeLive } from '../garage-requests/garage-requests.testing';
import { Live } from '../live';
import { Session } from '../session';

const A = { id: 'account-a', role: 'driver' } as MeDto;
const B = { id: 'account-b', role: 'driver' } as MeDto;
const A_AS_GARAGE = { id: 'account-a', role: 'garage' } as MeDto;

const car = (id: string, model = 'Logan') => ({ id, model }) as CarDto;
const requests = (...ids: string[]) =>
  ({
    items: ids.map((id) => ({ id })),
    nextCursor: null,
    total: ids.length,
  }) as unknown as RequestListDto;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

let current: ReturnType<typeof signal<MeDto | null>>;
let live: ReturnType<typeof fakeLive>;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-30T09:00:00.000Z'));
  current = signal<MeDto | null>(A);
  live = fakeLive();
  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { current, shown: current } },
      { provide: Live, useValue: live },
    ],
  });
});

afterEach(() => {
  TestBed.resetTestingModule();
  jest.useRealTimers();
});

// A view on the store; close() leaves as a destroyed view does.
function open<K extends keyof Held>(
  type: K,
  load: () => Promise<Held[K]>,
  kinds: readonly EventKind[] = [],
) {
  const injector = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector),
  );
  const view = runInInjectionContext(injector, () =>
    TestBed.inject(Resources).live(type, load, kinds),
  );
  return { close: () => injector.destroy(), view };
}

const settle = () => jest.advanceTimersByTimeAsync(0);
const later = (ms: number) => jest.advanceTimersByTimeAsync(ms);

// Opens a view of the type, lets its first read answer, and leaves.
async function visit<K extends keyof Held>(
  type: K,
  load: () => Promise<Held[K]>,
) {
  const first = open(type, load);
  await settle();
  first.close();
}

// @traces 1316-FR-001 1316-FR-010
describe('a first visit', () => {
  it('shows the loading state until the first read answers, then its value', async () => {
    const answer = deferred<CarDto[]>();
    const { view } = open('cars', () => answer.promise);

    expect(view.isLoading()).toBe(true);
    expect(view.value()).toBeUndefined();

    answer.resolve([car('car-1')]);
    await settle();

    expect(view.isLoading()).toBe(false);
    expect(view.value()).toEqual([car('car-1')]);
  });
});

// @traces 1316-FR-001 1316-FR-002 1316-FR-010
describe('a return', () => {
  it('within the stale time shows the held value at once and reads nothing', async () => {
    const load = jest.fn(async () => [car('car-1')]);
    await visit('cars', load);
    await later(299_999);

    const { view } = open('cars', load);

    expect(view.isLoading()).toBe(false);
    expect(view.value()).toEqual([car('car-1')]);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['at exactly', 300_000],
    ['past', 600_000],
  ])(
    '%s the stale time shows the held value and reads once, the answer replacing it in place',
    async (_, age) => {
      const kept = car('car-1');
      const load = jest
        .fn<Promise<CarDto[]>, []>()
        .mockResolvedValueOnce([kept])
        .mockResolvedValueOnce([car('car-1'), car('car-2', 'Duster')]);
      await visit('cars', load);
      await later(age);

      const { view } = open('cars', load);

      expect(view.isLoading()).toBe(false);
      expect(view.value()).toEqual([kept]);
      await settle();
      expect(load).toHaveBeenCalledTimes(2);
      expect(view.value()).toEqual([car('car-1'), car('car-2', 'Duster')]);
      expect(view.value()?.[0]).toBe(kept);
    },
  );

  it('goes by each type’s own stale time', async () => {
    const loadCars = jest.fn(async () => [car('car-1')]);
    const loadRequests = jest.fn(async () => requests('req-1'));
    await visit('cars', loadCars);
    await visit('requests', loadRequests);
    await later(30_000);

    open('cars', loadCars);
    open('requests', loadRequests);
    await settle();

    expect(loadCars).toHaveBeenCalledTimes(1);
    expect(loadRequests).toHaveBeenCalledTimes(2);
  });

  // @traces 1316-FR-003
  it('keeps the held value with no error when its read fails, and reads again after 60 s', async () => {
    const load = jest
      .fn<Promise<RequestListDto>, []>()
      .mockResolvedValueOnce(requests('req-1'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(requests('req-1', 'req-2'));
    await visit('requests', load);
    await later(30_000);

    const { view } = open('requests', load);
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
    expect(view.value()).toEqual(requests('req-1'));
    expect(view.error()).toBeUndefined();
    expect(view.isLoading()).toBe(false);

    await later(60_000);

    expect(load).toHaveBeenCalledTimes(3);
    expect(view.value()).toEqual(requests('req-1', 'req-2'));
  });

  it('joins a read already running instead of starting another', async () => {
    const answer = deferred<CarDto[]>();
    const load = jest.fn(() => answer.promise);
    const first = open('cars', load);
    const second = open('cars', load);

    answer.resolve([car('car-1')]);
    await settle();

    expect(load).toHaveBeenCalledTimes(1);
    expect(first.view.value()).toEqual([car('car-1')]);
    expect(second.view.value()).toEqual([car('car-1')]);
  });
});

// @traces 1316-FR-004 1316-FR-010
describe('a re-read', () => {
  it('follows a live event, a resync and a reload whatever the age, and every open view shows its answer', async () => {
    let n = 0;
    const load = jest.fn(async () => requests(`req-${++n}`));
    const watching = open('requests', load, ['quote.accepted']);
    await settle();
    const other = open('requests', load);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    live.emit('quote.accepted');
    await later(300);
    expect(load).toHaveBeenCalledTimes(2);
    expect(other.view.value()).toEqual(requests('req-2'));

    live.resync.next();
    await settle();
    expect(load).toHaveBeenCalledTimes(4);

    await other.view.reload();
    await settle();
    expect(load).toHaveBeenCalledTimes(5);
    expect(watching.view.value()).toEqual(requests('req-5'));
    expect(other.view.value()).toEqual(requests('req-5'));
  });

  it('restarts the stale time', async () => {
    const load = jest.fn(async () => [car('car-1')]);
    const { view } = open('cars', load);
    await settle();
    await later(200_000);
    await view.reload();
    await later(200_000);

    open('cars', load);
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
  });
});

// @traces 1316-FR-009 1316-FR-010
describe('the copy the store keeps', () => {
  it('stays in the page’s memory: no storage, cookie or database is written', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    const database = { open: jest.fn() };
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: database,
    });
    try {
      await visit('cars', async () => [car('car-1')]);
      TestBed.inject(Resources).update('cars', (cars) => [
        car('car-2'),
        ...cars,
      ]);

      expect(setItem).not.toHaveBeenCalled();
      expect(database.open).not.toHaveBeenCalled();
      expect(document.cookie).toBe('');
    } finally {
      setItem.mockRestore();
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });
});

// @traces 1316-FR-005 1316-FR-010
describe('a change the person makes', () => {
  it('replaces the held value at once and keeps its age', async () => {
    const load = jest.fn(async () => [car('car-1')]);
    await visit('cars', load);
    await later(200_000);

    TestBed.inject(Resources).update('cars', (cars) => [
      car('car-2', 'Duster'),
      ...cars,
    ]);
    const { close, view } = open('cars', load);

    expect(view.value()).toEqual([car('car-2', 'Duster'), car('car-1')]);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    close();

    await later(100_000);
    open('cars', load);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('is shown by a view already open', async () => {
    const { view } = open('cars', async () => [car('car-1')]);
    await settle();

    TestBed.inject(Resources).update('cars', (cars) =>
      cars.filter((c) => c.id !== 'car-1'),
    );

    expect(view.value()).toEqual([]);
  });

  it('changes nothing while nothing is held, so the next view reads as on a first visit', async () => {
    const update = jest.fn((cars: CarDto[]) => [car('car-2'), ...cars]);
    TestBed.inject(Resources).update('cars', update);
    const load = jest.fn(async () => [car('car-1')]);

    const { view } = open('cars', load);

    expect(update).not.toHaveBeenCalled();
    expect(view.isLoading()).toBe(true);
    await settle();
    expect(view.value()).toEqual([car('car-1')]);
  });

  it('changes nothing after a failed first read', async () => {
    await visit('cars', () => Promise.reject(new Error('offline')));
    TestBed.inject(Resources).update('cars', (cars) => [car('car-2'), ...cars]);
    const load = jest.fn(async () => [car('car-1')]);

    const { view } = open('cars', load);

    expect(view.value()).toBeUndefined();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

// @traces 1316-FR-006 1316-FR-007 1316-FR-010
describe('another account', () => {
  it('finds none of A’s data once B is signed in, before and after B’s read', async () => {
    const aView = open('cars', async () => [car('car-a')]);
    await settle();
    expect(aView.view.value()).toEqual([car('car-a')]);

    current.set(B);
    const answer = deferred<CarDto[]>();
    const bView = open('cars', () => answer.promise);

    expect(aView.view.value()).toBeUndefined();
    expect(bView.view.value()).toBeUndefined();
    expect(bView.view.isLoading()).toBe(true);

    answer.resolve([car('car-b')]);
    await settle();

    expect(bView.view.value()).toEqual([car('car-b')]);
  });

  it('holds nothing once the account is forgotten, for the same account signing back in too', async () => {
    await visit('cars', async () => [car('car-a')]);
    await visit('requests', async () => requests('req-a'));

    current.set(null);
    TestBed.tick();
    current.set(A);
    const cars = open('cars', () => new Promise<never>(() => undefined));
    const list = open('requests', () => new Promise<never>(() => undefined));

    expect(cars.view.value()).toBeUndefined();
    expect(cars.view.isLoading()).toBe(true);
    expect(list.view.value()).toBeUndefined();
  });

  it('holds nothing of the other role after a role switch', async () => {
    await visit('requests', async () => requests('req-a'));

    current.set(A_AS_GARAGE);
    TestBed.tick();
    current.set(A);
    const { view } = open(
      'requests',
      () => new Promise<never>(() => undefined),
    );

    expect(view.value()).toBeUndefined();
  });

  it('drops a read that answers after the account changed', async () => {
    const answer = deferred<CarDto[]>();
    const aView = open('cars', () => answer.promise);

    current.set(B);
    answer.resolve([car('car-a')]);
    await settle();

    expect(aView.view.value()).toBeUndefined();
    const loadB = jest.fn(() => new Promise<never>(() => undefined));
    const bView = open('cars', loadB);
    expect(bView.view.value()).toBeUndefined();
    await settle();
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it('changes nothing of a slot held for another account', async () => {
    await visit('cars', async () => [car('car-a')]);
    current.set(B);

    const update = jest.fn((cars: CarDto[]) => cars);
    TestBed.inject(Resources).update('cars', update);

    expect(update).not.toHaveBeenCalled();
  });
});

// @traces 1394-FR-003
describe('the sold cars', () => {
  it('are read once, then again when a car is taken over', async () => {
    let n = 0;
    const load = jest.fn(async () => ({
      items: Array.from({ length: n++ }, (_, i) => ({ id: `sold-${i}` })),
    }));
    const watching = open('soldCars', load as never, ['car_transfer.accepted']);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(watching.view.value()).toEqual({ items: [] });

    live.emit('car_transfer.accepted');
    await later(300);
    expect(load).toHaveBeenCalledTimes(2);
    expect(watching.view.value()).toEqual({ items: [{ id: 'sold-0' }] });
  });
});
