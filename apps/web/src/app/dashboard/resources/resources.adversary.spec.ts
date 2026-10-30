import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind } from '@motor-fix/contracts';
import type {
  CarDto,
  GarageRequestListDto,
  MeDto,
  RequestListDto,
} from '@motor-fix/data-access';

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
const rows = (...ids: string[]) =>
  ({ items: ids.map((id) => ({ id })) }) as unknown as GarageRequestListDto;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

const never = () => new Promise<never>(() => undefined);

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

async function visit<K extends keyof Held>(
  type: K,
  load: () => Promise<Held[K]>,
) {
  const first = open(type, load);
  await settle();
  first.close();
}

// @traces 1316-FR-002 1316-FR-010
describe('the stale time at its edges', () => {
  it.each([
    ['one millisecond under', 29_999, 1],
    ['exactly at', 30_000, 2],
    ['one millisecond over', 30_001, 2],
  ])(
    'for the driver’s requests, %s 30 s reads %i time(s)',
    async (_, age, reads) => {
      const load = jest.fn(async () => requests('req-1'));
      await visit('requests', load);
      await later(age);

      open('requests', load);
      await settle();

      expect(load).toHaveBeenCalledTimes(reads);
    },
  );

  it('measures the age from the answer, not from the start of a slow read', async () => {
    const answer = deferred<CarDto[]>();
    const load = jest.fn(() => answer.promise);
    const first = open('cars', load);
    await later(200_000);
    answer.resolve([car('car-1')]);
    await settle();
    first.close();
    await later(150_000);

    open('cars', load);
    await settle();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the age of the last full read when a stale read fails, so the next open reads again', async () => {
    const load = jest
      .fn<Promise<RequestListDto>, []>()
      .mockResolvedValueOnce(requests('req-1'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(requests('req-2'));
    await visit('requests', load);
    await later(30_000);
    const failing = open('requests', load);
    await settle();
    failing.close();

    const next = open('requests', load);
    await settle();

    expect(load).toHaveBeenCalledTimes(3);
    expect(next.view.value()).toEqual(requests('req-2'));
  });

  it('reads at the next open after a failed first read, with no wait for any stale time', async () => {
    const load = jest
      .fn<Promise<CarDto[]>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([car('car-1')]);
    await visit('cars', load);

    const { view } = open('cars', load);
    expect(view.isLoading()).toBe(true);
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
    expect(view.value()).toEqual([car('car-1')]);
  });

  it('treats a clock that moved backwards as stale rather than fresh for ever', async () => {
    const load = jest.fn(async () => [car('car-1')]);
    await visit('cars', load);
    jest.setSystemTime(new Date('2026-10-30T07:00:00.000Z'));

    open('cars', load);
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
  });
});

// @traces 1316-FR-001 1316-FR-002 1316-FR-010
describe('several resource types', () => {
  it('ages the garage lists apart from one another', async () => {
    const waiting = jest.fn(async () => rows('w-1'));
    const quoted = jest.fn(async () => rows('q-1'));
    await visit('garageWaiting', waiting);
    await later(20_000);
    await visit('garageQuoted', quoted);
    await later(10_000);

    open('garageWaiting', waiting);
    open('garageQuoted', quoted);
    await settle();

    expect(waiting).toHaveBeenCalledTimes(2);
    expect(quoted).toHaveBeenCalledTimes(1);
  });

  it('never lets one type’s answer land in another type’s view', async () => {
    await visit('cars', async () => [car('car-1')]);
    await visit('requests', async () => requests('req-1'));

    const closed = open('garageClosed', never);

    expect(closed.view.value()).toBeUndefined();
    expect(closed.view.isLoading()).toBe(true);
  });

  it('a live event for one type re-reads only that type', async () => {
    const loadCars = jest.fn(async () => [car('car-1')]);
    const loadRequests = jest.fn(async () => requests('req-1'));
    open('cars', loadCars, ['quote.accepted']);
    open('requests', loadRequests, ['request.created']);
    await settle();

    live.emit('quote.accepted');
    await later(300);

    expect(loadCars).toHaveBeenCalledTimes(2);
    expect(loadRequests).toHaveBeenCalledTimes(1);
  });

  it('holds a null garage list as a value, shown at once with no read inside the stale time', async () => {
    const load = jest.fn(async () => null);
    await visit('garageWaiting', load);

    const { view } = open('garageWaiting', load);
    await settle();

    expect(view.value()).toBeNull();
    expect(view.isLoading()).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps an empty list as a held value rather than treating it as nothing held', async () => {
    const load = jest.fn(async () => [] as CarDto[]);
    await visit('cars', load);

    const { view } = open('cars', load);
    await settle();

    expect(view.value()).toEqual([]);
    expect(view.isLoading()).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('holds ten thousand cars and returns the same list at once', async () => {
    const many = Array.from({ length: 10_000 }, (_, i) => car(`car-${i}`));
    const load = jest.fn(async () => many);
    await visit('cars', load);

    const { view } = open('cars', load);

    expect(view.value()).toHaveLength(10_000);
    expect(view.value()?.[9_999]).toEqual(car('car-9999'));
  });
});

// @traces 1316-FR-005 1316-FR-010
describe('a change during a read', () => {
  it('is replaced by the answer of a read that settles after it', async () => {
    await visit('cars', async () => [car('car-1')]);
    await later(300_000);
    const answer = deferred<CarDto[]>();
    const { view } = open('cars', () => answer.promise);

    TestBed.inject(Resources).update('cars', (cars) => [car('car-2'), ...cars]);
    expect(view.value()).toEqual([car('car-2'), car('car-1')]);

    answer.resolve([car('car-1'), car('car-3')]);
    await settle();

    expect(view.value()).toEqual([car('car-1'), car('car-3')]);
  });

  it('applies two changes in the order they were made', async () => {
    await visit('cars', async () => [car('car-1')]);
    const store = TestBed.inject(Resources);

    store.update('cars', (cars) => [...cars, car('car-2')]);
    store.update('cars', (cars) => cars.filter((c) => c.id !== 'car-1'));
    const { view } = open('cars', never);

    expect(view.value()).toEqual([car('car-2')]);
  });

  it('hands a null garage list to the change as null', async () => {
    await visit('garageWaiting', async () => null);
    const change = jest.fn((value: GarageRequestListDto | null) => value);

    TestBed.inject(Resources).update('garageWaiting', change);

    expect(change).toHaveBeenCalledWith(null);
  });

  it('keeps the age when the same change is applied twice', async () => {
    const load = jest.fn(async () => [car('car-1')]);
    await visit('cars', load);
    await later(299_000);
    const store = TestBed.inject(Resources);
    store.update('cars', (cars) => cars);
    store.update('cars', (cars) => cars);
    await later(1_000);

    open('cars', load);
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('is shown to a second view already open on the same type', async () => {
    const one = open('cars', async () => [car('car-1')]);
    await settle();
    const two = open('cars', async () => [car('car-1')]);

    TestBed.inject(Resources).update('cars', (cars) => [...cars, car('car-9')]);

    expect(one.view.value()).toEqual([car('car-1'), car('car-9')]);
    expect(two.view.value()).toEqual([car('car-1'), car('car-9')]);
  });

  it('is not stored when it throws, leaving the held value untouched', async () => {
    await visit('cars', async () => [car('car-1')]);

    expect(() =>
      TestBed.inject(Resources).update('cars', () => {
        throw new Error('bad change');
      }),
    ).toThrow('bad change');

    const { view } = open('cars', never);
    expect(view.value()).toEqual([car('car-1')]);
  });
});

// @traces 1316-FR-006 1316-FR-007 1316-FR-010
describe('the owner changing mid-read', () => {
  it('shows B only B’s answer when A’s read answers after B’s read began', async () => {
    const forA = deferred<CarDto[]>();
    const forB = deferred<CarDto[]>();
    const aView = open('cars', () => forA.promise);
    current.set(B);
    const bView = open('cars', () => forB.promise);

    forA.resolve([car('car-a')]);
    await settle();
    expect(bView.view.value()).toBeUndefined();
    expect(bView.view.isLoading()).toBe(true);

    forB.resolve([car('car-b')]);
    await settle();

    expect(bView.view.value()).toEqual([car('car-b')]);
    expect(aView.view.value()).toEqual([car('car-b')]);
  });

  it('keeps B’s answer when A’s earlier read answers last', async () => {
    const forA = deferred<CarDto[]>();
    const forB = deferred<CarDto[]>();
    open('cars', () => forA.promise);
    current.set(B);
    const bView = open('cars', () => forB.promise);

    forB.resolve([car('car-b')]);
    await settle();
    forA.resolve([car('car-a')]);
    await settle();

    expect(bView.view.value()).toEqual([car('car-b')]);
    const later$ = open('cars', never);
    expect(later$.view.value()).toEqual([car('car-b')]);
  });

  it('does not let B’s view join a read A started', async () => {
    const forA = deferred<CarDto[]>();
    open('cars', () => forA.promise);
    current.set(B);
    const loadB = jest.fn(never);

    open('cars', loadB);
    await settle();

    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it('drops a read that answers after a role switch', async () => {
    const answer = deferred<RequestListDto>();
    open('requests', () => answer.promise);

    current.set(A_AS_GARAGE);
    answer.resolve(requests('req-driver'));
    await settle();

    const { view } = open('requests', never);
    expect(view.value()).toBeUndefined();
  });

  it('drops a read that began for A and answers after A signed out and back in', async () => {
    const answer = deferred<CarDto[]>();
    open('cars', () => answer.promise);

    current.set(null);
    TestBed.tick();
    current.set(A);
    TestBed.tick();
    answer.resolve([car('car-old')]);
    await settle();

    const { view } = open('cars', never);
    expect(view.value()).toBeUndefined();
    expect(view.isLoading()).toBe(true);
  });

  it('shows nothing of A the moment the session is gone, before any change detection runs', async () => {
    await visit('cars', async () => [car('car-a')]);

    current.set(null);
    const { view } = open('cars', never);

    expect(view.value()).toBeUndefined();
  });

  it('stores nothing from a read that answers while no one is signed in', async () => {
    current.set(null);
    TestBed.tick();
    await visit('cars', async () => [car('car-ghost')]);

    current.set(A);
    TestBed.tick();
    const { view } = open('cars', never);

    expect(view.value()).toBeUndefined();
  });

  it('empties every type, not only the one being viewed', async () => {
    await visit('cars', async () => [car('car-a')]);
    await visit('requests', async () => requests('req-a'));
    await visit('activeRequest', async () => ({ request: null }) as never);
    await visit('garageWaiting', async () => rows('w-a'));
    await visit('garageQuoted', async () => rows('q-a'));
    await visit('garageClosed', async () => rows('c-a'));

    current.set(B);
    TestBed.tick();
    const views = [
      open('cars', never),
      open('requests', never),
      open('activeRequest', never),
      open('garageWaiting', never),
      open('garageQuoted', never),
      open('garageClosed', never),
    ];

    expect(views.map((v) => v.view.value())).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('empties the store again on a second sign-out with nothing new held', async () => {
    await visit('cars', async () => [car('car-a')]);
    current.set(null);
    TestBed.tick();
    current.set(null);
    TestBed.tick();

    current.set(A);
    const { view } = open('cars', never);

    expect(view.value()).toBeUndefined();
  });

  it('does not apply a change to B’s slot made for A’s view after the switch', async () => {
    const aStore = TestBed.inject(Resources);
    current.set(B);
    TestBed.tick();
    await visit('cars', async () => [car('car-b')]);

    aStore.update('cars', () => [car('car-a-edit')]);
    const { view } = open('cars', never);

    expect(view.value()).toEqual([car('car-a-edit')]);
  });
});

// @traces 1316-FR-009 1316-FR-010
describe('where the copy lives', () => {
  it('writes nothing to session storage, local storage or cookies through a full cycle of read, change and sign-out', async () => {
    const local = jest.spyOn(Storage.prototype, 'setItem');
    try {
      await visit('cars', async () => [car('car-1')]);
      TestBed.inject(Resources).update('cars', (cars) => [...cars, car('c2')]);
      current.set(null);
      TestBed.tick();

      expect(local).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
      expect(localStorage.length).toBe(0);
      expect(document.cookie).toBe('');
    } finally {
      local.mockRestore();
    }
  });
});
