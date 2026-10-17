import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type MeDto,
  PlacesService,
  type SavedGaragesPageDto,
  SavedGaragesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import {
  fakeSavedGarages,
  pageOf,
  savedItem,
  savedItems,
} from './saved-garages.testing';
import { SavedGaragesList } from './saved-garages-list';
import { PlaceStore } from '../../home/place/place-store';
import { SavedGarages } from '../../public/saved-garages/saved-garages';
import { fakeLive, wait } from '../garage-requests/garage-requests.testing';
import { Live } from '../live';
import { Session } from '../session';

let list: jest.Mock;
let search: jest.Mock;
let live: ReturnType<typeof fakeLive>;
let saved: ReturnType<typeof fakeSavedGarages>;

async function settle() {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await wait(0);
  }
}

async function start({
  answers = [pageOf([savedItem()])],
  city = null,
}: {
  answers?: (SavedGaragesPageDto | Error)[];
  city?: string | null;
} = {}) {
  live = fakeLive();
  saved = fakeSavedGarages();
  let call = 0;
  list = jest.fn(async ({ cursor }: { cursor?: string; near?: string }) => {
    if (cursor) return pageOf([savedItem({ garageId: `after-${cursor}` })]);
    const answer = answers[Math.min(call++, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  });
  search = jest.fn(async () => ({
    items: [{ label: 'Cluj-Napoca', lat: 46.77123, lng: 23.62345 }],
  }));
  const me = signal({
    capabilities: ['driver.saved_garages'],
    city,
    role: 'driver',
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: SavedGarages, useValue: saved },
      {
        provide: SavedGaragesService,
        useValue: { savedGaragesControllerList: list },
      },
      { provide: PlacesService, useValue: { placesControllerSearch: search } },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  const store = TestBed.inject(SavedGaragesList);
  store.open();
  await settle();
  return store;
}

const firstPages = () =>
  list.mock.calls.map(([params]) => params).filter((p) => !p?.cursor);

afterEach(() => {
  TestBed.resetTestingModule();
  localStorage.clear();
});

// @traces 291-FR-006
// @traces 291-FR-009
describe('SavedGaragesList: the list', () => {
  it('reads the first page once it is opened, with the server’s counts', async () => {
    const store = await start({
      answers: [
        pageOf(savedItems(2), {
          nextCursor: 'c-2',
          total: 23,
          workingCount: 7,
        }),
      ],
    });

    expect(firstPages()).toEqual([{}]);
    expect(store.rows()?.map((row) => row.garageId)).toEqual([
      'garage-1',
      'garage-2',
    ]);
    expect(store.total()).toBe(23);
    expect(store.workingCount()).toBe(7);
    expect(store.nextCursor()).toBe('c-2');
  });

  it('reads the first page again when the other screen opens', async () => {
    const store = await start();

    store.open();
    await settle();

    expect(firstPages()).toHaveLength(2);
  });

  it('reads a further page with its cursor', async () => {
    const store = await start();

    const next = await store.page('c-2');

    expect(list).toHaveBeenLastCalledWith({ cursor: 'c-2' });
    expect(next.items[0].garageId).toBe('after-c-2');
  });

  it('is loading until the first read answers, and failed when it throws', async () => {
    const store = await start({ answers: [new Error('offline')] });

    expect(store.loading()).toBe(false);
    expect(store.failed()).toBe(true);
    expect(store.rows()).toBeUndefined();
  });
});

// @traces 291-FR-010
describe('SavedGaragesList: the place it measures from', () => {
  it('sends the kept place, rounded to three decimals', async () => {
    TestBed.inject(PlaceStore).set({
      label: 'Strada Horea 1',
      lat: 46.77123,
      lng: 23.62345,
      origin: 'address',
    });
    TestBed.resetTestingModule();

    await start();

    expect(firstPages()).toEqual([{ near: '46.771,23.623' }]);
  });

  it('sends a further page’s read with the same place', async () => {
    const store = await start();
    TestBed.inject(PlaceStore).use({
      label: null,
      lat: 44.43,
      lng: 26.1,
      origin: 'location',
    });
    await settle();

    await store.page('c-2');

    expect(list).toHaveBeenLastCalledWith({
      cursor: 'c-2',
      near: '44.43,26.1',
    });
  });

  it('reads the list again, once, when the place changes', async () => {
    await start();

    TestBed.inject(PlaceStore).use({
      label: null,
      lat: 44.43,
      lng: 26.1,
      origin: 'location',
    });
    await settle();

    expect(firstPages()).toEqual([{}, { near: '44.43,26.1' }]);
  });

  it('takes the Setări city through the address look-up when no place is kept', async () => {
    await start({ city: 'Cluj-Napoca' });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ lang: 'ro', q: 'Cluj-Napoca' });
    expect(firstPages().at(-1)).toEqual({ near: '46.771,23.623' });
    expect(TestBed.inject(PlaceStore).place()?.origin).toBe('address');
  });

  it('sends no place when neither a place nor a city is known', async () => {
    await start({ city: null });

    expect(search).not.toHaveBeenCalled();
    expect(firstPages()).toEqual([{}]);
  });
});

// @traces 291-FR-011
describe('SavedGaragesList: a removal from the list', () => {
  const three = () =>
    pageOf([
      savedItem({ garageId: 'g-1' }),
      savedItem({ brands: [], garageId: 'g-2' }),
      savedItem({ garageId: 'g-3' }),
    ]);

  it('takes the row away at once through the save control’s removal and counts it out', async () => {
    const store = await start({ answers: [three()] });

    void store.remove('g-1');
    TestBed.tick();

    expect(saved.remove).toHaveBeenCalledWith('g-1');
    expect(store.rows()?.map((row) => row.garageId)).toEqual(['g-2', 'g-3']);
    expect(store.total()).toBe(2);
    expect(store.workingCount()).toBe(1);
  });

  it('leaves the working count alone for a row with no brand', async () => {
    const store = await start({ answers: [three()] });

    void store.remove('g-2');
    TestBed.tick();

    expect(store.total()).toBe(2);
    expect(store.workingCount()).toBe(2);
  });

  it('puts the row back in its place when the removal fails or is undone', async () => {
    const store = await start({ answers: [three()] });
    void store.remove('g-2');
    TestBed.tick();

    saved.restore('g-2');
    TestBed.tick();

    expect(store.rows()?.map((row) => row.garageId)).toEqual([
      'g-1',
      'g-2',
      'g-3',
    ]);
    expect(store.total()).toBe(3);
    expect(store.workingCount()).toBe(2);
  });

  it('hides a removed row of a further page too', async () => {
    const store = await start({ answers: [three()] });
    const more = [
      savedItem({ garageId: 'g-21' }),
      savedItem({ garageId: 'g-22' }),
    ];

    void store.remove('g-21');
    TestBed.tick();

    expect(store.visible(more).map((row) => row.garageId)).toEqual(['g-22']);
  });
});

// @traces 291-FR-013
describe('SavedGaragesList: another tab', () => {
  it.each(['saved_garage.added', 'saved_garage.removed'] as const)(
    'reads the first page again on %s',
    async (kind) => {
      const store = await start({
        answers: [pageOf(savedItems(1)), pageOf(savedItems(2))],
      });

      live.emit(kind, 'garage-2');
      await wait(400);
      await settle();

      expect(firstPages()).toHaveLength(2);
      expect(store.rows()).toHaveLength(2);
    },
  );

  it('reads nothing again for another kind', async () => {
    await start();

    live.emit('quote.accepted', 'req-1');
    await wait(400);
    await settle();

    expect(firstPages()).toHaveLength(1);
  });
});
