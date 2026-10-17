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
import { SavedGarages } from '../../public/saved-garages/saved-garages';
import { fakeLive, wait } from '../garage-requests/garage-requests.testing';
import { Live } from '../live';
import { Session } from '../session';

let list: jest.Mock;
let live: ReturnType<typeof fakeLive>;
let saved: ReturnType<typeof fakeSavedGarages>;

async function settle() {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await wait(0);
  }
}

async function start(answers: (SavedGaragesPageDto | Error)[]) {
  live = fakeLive();
  saved = fakeSavedGarages();
  let call = 0;
  list = jest.fn(async () => {
    const answer = answers[Math.min(call++, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const me = signal({
    capabilities: ['driver.saved_garages'],
    city: null,
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
      {
        provide: PlacesService,
        useValue: { placesControllerSearch: async () => ({ items: [] }) },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  const store = TestBed.inject(SavedGaragesList);
  store.open();
  await settle();
  return store;
}

afterEach(() => TestBed.resetTestingModule());

// @traces 291-FR-011
describe('the saved list store under attack: removals', () => {
  it('never counts below zero when every row is removed', async () => {
    const store = await start([pageOf([savedItem({ garageId: 'g-1' })])]);

    void store.remove('g-1');
    void store.remove('g-1');
    TestBed.tick();

    expect(store.rows()).toEqual([]);
    expect(store.total()).toBe(0);
    expect(store.workingCount()).toBe(0);
  });

  it('counts a double removal of one row once', async () => {
    const store = await start([pageOf(savedItems(3), { total: 3 })]);

    void store.remove('garage-1');
    void store.remove('garage-1');
    TestBed.tick();

    expect(store.total()).toBe(2);
    expect(store.workingCount()).toBe(2);
  });

  it('removes a row from a further page without touching the first page', async () => {
    const store = await start([
      pageOf(savedItems(2), { nextCursor: 'c', total: 4 }),
    ]);
    const rest = [
      savedItem({ garageId: 'far-1' }),
      savedItem({ garageId: 'far-2' }),
    ];

    void store.remove('far-1', rest[0]);
    TestBed.tick();

    expect(store.visible(rest).map((row) => row.garageId)).toEqual(['far-2']);
    expect(store.rows()).toHaveLength(2);
    expect(store.total()).toBe(3);
  });

  it('shows the row again and the old totals when the removal is refused', async () => {
    const store = await start([pageOf(savedItems(3), { total: 3 })]);
    saved.remove.mockImplementationOnce(async () => {
      throw new Error('offline');
    });

    await store.remove('garage-2').catch(() => undefined);
    saved.restore('garage-2');
    TestBed.tick();

    expect(store.rows()?.map((row) => row.garageId)).toEqual([
      'garage-1',
      'garage-2',
      'garage-3',
    ]);
    expect(store.total()).toBe(3);
  });
});

// @traces 291-FR-013
describe('the saved list store under attack: re-reads', () => {
  it('reads the first page once per live event, not twice, for an added and a removed event', async () => {
    await start([pageOf(savedItems(1))]);
    list.mockClear();

    live.emit('saved_garage.added');
    await wait(400);
    await settle();
    live.emit('saved_garage.removed');
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('ignores a live event of another kind', async () => {
    await start([pageOf(savedItems(1))]);
    list.mockClear();

    live.emit('garage_request.created' as never);
    await wait(400);
    await settle();

    expect(list).not.toHaveBeenCalled();
  });

  it('recovers from a failed first read when it is read again', async () => {
    const store = await start([new Error('offline'), pageOf(savedItems(2))]);
    expect(store.failed()).toBe(true);

    store.reload();
    await settle();

    expect(store.failed()).toBe(false);
    expect(store.rows()).toHaveLength(2);
  });

  it('keeps the rows it had when a re-read fails', async () => {
    const store = await start([pageOf(savedItems(2)), new Error('offline')]);

    live.emit('saved_garage.added');
    await wait(400);
    await settle();

    expect(store.rows()?.map((row) => row.garageId)).toEqual([
      'garage-1',
      'garage-2',
    ]);
  });

  it('hides a row removed here from a re-read that still lists it, until the server stops listing it', async () => {
    const store = await start([
      pageOf(savedItems(2), { total: 2 }),
      pageOf(savedItems(2), { total: 2 }),
    ]);

    void store.remove('garage-1');
    TestBed.tick();
    live.emit('saved_garage.removed');
    await wait(400);
    await settle();

    expect(store.rows()?.map((row) => row.garageId)).not.toContain('garage-1');
  });

  it('counts right once a removal answers after a re-read that already left the row out', async () => {
    const store = await start([
      pageOf(savedItems(2), { total: 2 }),
      pageOf(savedItems(2).slice(1), { total: 1 }),
    ]);
    let answer = () => {};
    saved.remove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );

    const removal = store.remove('garage-1');
    live.emit('saved_garage.removed');
    await wait(400);
    await settle();
    answer();
    await removal;
    await settle();

    expect(store.rows()?.map((row) => row.garageId)).toEqual(['garage-2']);
    expect(store.total()).toBe(1);
  });
});

// @traces 291-FR-006
describe('the saved list store under attack: empty answers', () => {
  it('holds an empty first page as no rows, a zero total and a zero working count', async () => {
    const store = await start([pageOf([])]);

    expect(store.rows()).toEqual([]);
    expect(store.total()).toBe(0);
    expect(store.workingCount()).toBe(0);
    expect(store.nextCursor()).toBeNull();
  });

  it('reports the server working count even when the page holds none of those rows', async () => {
    const store = await start([
      pageOf(savedItems(2, { brands: [] }), { total: 40, workingCount: 9 }),
    ]);

    expect(store.workingCount()).toBe(9);
  });
});
