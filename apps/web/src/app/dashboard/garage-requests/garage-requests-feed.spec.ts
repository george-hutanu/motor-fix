import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind } from '@motor-fix/contracts';
import {
  type GarageRequestListDto,
  GarageRequestsService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import {
  fakeLive,
  listOf,
  quotedRow,
  requestRow,
  wait,
} from './garage-requests.testing';
import { GarageRequestsFeed } from './garage-requests-feed';
import { Live } from '../live';
import { Session } from '../session';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const OWNER = ['garage.requests', 'garage.schedule', 'garage.team'];

type Answer = GarageRequestListDto | Error | HttpErrorResponse;

let live: ReturnType<typeof fakeLive>;
let list: jest.Mock;
let me: ReturnType<typeof signal<MeDto | null>>;

const account = (capabilities: string[]) =>
  ({ capabilities, garageId: 'garage-1' }) as unknown as MeDto;

async function settle() {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await wait(0);
  }
}

// Each filter answers in turn, the last answer repeating.
async function start(
  {
    capabilities = OWNER,
    closed = [listOf([])],
    quoted = [listOf([])],
    waiting = [listOf([requestRow()])],
  }: {
    capabilities?: string[];
    closed?: Answer[];
    quoted?: Answer[];
    waiting?: Answer[];
  } = {},
  language: 'ro' | 'en' = 'ro',
) {
  live = fakeLive();
  me = signal<MeDto | null>(account(capabilities));
  const answers = { closed, quoted, waiting };
  const calls = { closed: 0, quoted: 0, waiting: 0 };
  list = jest.fn(
    async ({ cursor, status }: { cursor?: string; status: Filter }) => {
      if (cursor) return listOf([quotedRow({ id: `after-${cursor}` })]);
      const answer =
        answers[status][Math.min(calls[status]++, answers[status].length - 1)];
      if (answer instanceof Error || answer instanceof HttpErrorResponse)
        throw answer;
      return answer;
    },
  );
  TestBed.configureTestingModule({
    providers: [
      GarageRequestsFeed,
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerList: list },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const feed = TestBed.inject(GarageRequestsFeed);
  await settle();
  return feed;
}

type Filter = 'waiting' | 'closed' | 'quoted';

const reads = (status: Filter) =>
  list.mock.calls.filter(
    ([params]) => params?.status === status && !params.cursor,
  );

const created = async (id: string) => {
  live.emit('request.created', id);
  await wait(400);
  await settle();
};

const visibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });

beforeEach(() => {
  (toast as unknown as jest.Mock).mockClear();
  visibility('visible');
});
afterEach(() => TestBed.resetTestingModule());

// @traces 343-FR-001
// @traces 343-FR-009
describe('GarageRequestsFeed: the waiting list', () => {
  it('reads the waiting rows with the waiting filter, and the counter is the server’s total', async () => {
    const feed = await start({
      waiting: [listOf([requestRow()], { nextCursor: 'c-2', total: 23 })],
    });

    expect(reads('waiting')).toHaveLength(1);
    expect(reads('waiting')[0][0]).toEqual({ status: 'waiting' });
    expect(feed.rows()?.map((r) => r.id)).toEqual(['req-1']);
    expect(feed.total()).toBe(23);
    expect(feed.nextCursor()).toBe('c-2');
  });

  it.each<EventKind>([
    'request.created',
    'quote.sent',
    'request.declined',
    'request.decline_undone',
    'request.cancelled',
    'request.expired',
    'quote.accepted',
  ])('reads the list again on %s', async (kind) => {
    const feed = await start({
      waiting: [listOf([]), listOf([requestRow()])],
    });
    expect(feed.total()).toBe(0);

    live.emit(kind, 'req-1');
    await wait(400);
    await settle();

    expect(reads('waiting')).toHaveLength(2);
    expect(feed.total()).toBe(1);
  });

  it('reads the list again when the stream resyncs, and not on other kinds', async () => {
    await start();

    live.emit('booking.confirmed' as EventKind);
    await wait(400);
    await settle();
    expect(reads('waiting')).toHaveLength(1);

    live.resync.next();
    await settle();
    expect(reads('waiting')).toHaveLength(2);
  });
});

// @traces 343-FR-010
describe('GarageRequestsFeed: the new-request toast', () => {
  it('raises one toast with the car and the first job when a request arrives', async () => {
    await start({
      waiting: [
        listOf([]),
        listOf([
          requestRow({
            car: {
              brand: 'BMW',
              engine: null,
              fuel: 'diesel',
              model: '330i',
              year: 2021,
            },
            id: 'req-9',
            jobs: [
              {
                id: 'rj-1',
                jobTypeId: 'job-brakes',
                nameEn: 'Front brakes',
                nameRo: 'Frâne față',
                offered: true,
                position: 0,
              },
              {
                id: 'rj-2',
                jobTypeId: 'job-oil',
                nameEn: 'Oil change',
                nameRo: 'Schimb ulei',
                offered: true,
                position: 1,
              },
            ],
          }),
        ]),
      ],
    });

    await created('req-9');

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Cerere nouă: BMW 330i · Frâne față');
  });

  it('writes the toast in English for an English reader', async () => {
    await start(
      { waiting: [listOf([]), listOf([requestRow({ id: 'req-9' })])] },
      'en',
    );

    await created('req-9');

    expect(toast).toHaveBeenCalledWith(
      'New request: Dacia Logan · Oil and filter change',
    );
  });

  it('uses the description’s first line, cut at 40 characters, when there is no job', async () => {
    const line = 'Scârțâie ceva în față la frânare, mai ales dimineața';
    await start({
      waiting: [
        listOf([]),
        listOf([requestRow({ descriptionLine: line, id: 'req-9', jobs: [] })]),
      ],
    });

    await created('req-9');

    expect(toast).toHaveBeenCalledWith(
      `Cerere nouă: Dacia Logan · ${line.slice(0, 40)}`,
    );
  });

  it('raises it once per request, however often the event or a re-read comes', async () => {
    await start({
      waiting: [listOf([]), listOf([requestRow({ id: 'req-9' })])],
    });

    await created('req-9');
    await created('req-9');
    live.emit('quote.sent', 'req-9');
    await wait(400);
    await settle();

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('raises none while the tab is hidden', async () => {
    await start({
      waiting: [listOf([]), listOf([requestRow({ id: 'req-9' })])],
    });
    visibility('hidden');

    await created('req-9');

    expect(toast).not.toHaveBeenCalled();
  });

  it('raises none for the rows already there, nor for the other kinds', async () => {
    await start({
      waiting: [listOf([requestRow({ id: 'req-1' })])],
    });

    live.emit('request.declined', 'req-1');
    await wait(400);
    await settle();

    expect(toast).not.toHaveBeenCalled();
  });
});

// @traces 343-FR-007
// @traces 343-FR-009
describe('GarageRequestsFeed: the closed rows', () => {
  it('reads the closed rows once with the waiting ones, first page only', async () => {
    const feed = await start({
      closed: [
        listOf([requestRow({ closedReason: 'cancelled', id: 'req-0' })], {
          nextCursor: 'more',
        }),
      ],
    });

    expect(reads('closed')).toHaveLength(1);
    expect(reads('closed')[0][0]).toEqual({ status: 'closed' });
    expect(feed.closed()?.map((r) => r.id)).toEqual(['req-0']);
  });

  it('reads them again on the same events as the waiting rows', async () => {
    const feed = await start({
      closed: [
        listOf([]),
        listOf([requestRow({ closedReason: 'cancelled', id: 'req-1' })]),
      ],
      waiting: [listOf([requestRow()]), listOf([])],
    });

    live.emit('request.cancelled', 'req-1');
    await wait(400);
    await settle();

    expect(reads('closed')).toHaveLength(2);
    expect(feed.rows()).toEqual([]);
    expect(feed.closed()?.map((r) => r.closedReason)).toEqual(['cancelled']);
  });
});

// @traces 343-FR-015
describe('GarageRequestsFeed: who may see the requests', () => {
  it('makes no call for a session without the requests capability', async () => {
    const feed = await start({ capabilities: ['garage.own_jobs'] });

    live.emit('request.created', 'req-1');
    await wait(400);
    live.resync.next();
    await settle();

    expect(list).not.toHaveBeenCalled();
    expect(feed.visible()).toBe(false);
    expect(feed.total()).toBeUndefined();
    expect(toast).not.toHaveBeenCalled();
  });

  it('makes no call for an account with no garage capability at all', async () => {
    const feed = await start({ capabilities: [] });

    expect(list).not.toHaveBeenCalled();
    expect(feed.visible()).toBe(false);
  });

  it('treats a 404 as not allowed: nothing shown and no error', async () => {
    const feed = await start({
      waiting: [new HttpErrorResponse({ status: 404 })],
    });

    expect(feed.visible()).toBe(false);
    expect(feed.failed()).toBe(false);
    expect(feed.total()).toBeUndefined();
  });

  it('reads once the capability arrives with a reloaded session', async () => {
    const feed = await start({ capabilities: ['garage.own_jobs'] });

    me.set(account(OWNER));
    await settle();

    expect(reads('waiting')).toHaveLength(1);
    expect(feed.visible()).toBe(true);
    expect(feed.total()).toBe(1);
  });
});

// @traces 344-FR-014
// @traces 344-FR-015
describe('GarageRequestsFeed: the quotes sent', () => {
  it('reads the quoted rows with the quoted filter, newest sent first as the server sends them', async () => {
    const feed = await start({
      quoted: [
        listOf([quotedRow({ id: 'req-q2' }), quotedRow({ id: 'req-q1' })], {
          nextCursor: 'q-2',
          total: 25,
        }),
      ],
    });

    expect(reads('quoted')).toHaveLength(1);
    expect(reads('quoted')[0][0]).toEqual({ status: 'quoted' });
    expect(feed.quoted()?.map((r) => r.id)).toEqual(['req-q2', 'req-q1']);
    expect(feed.quotedNextCursor()).toBe('q-2');
    expect(feed.quotedLoading()).toBe(false);
  });

  it('says it is loading until the first quoted read answers', async () => {
    const feed = await start({
      quoted: [new Promise<GarageRequestListDto>(() => undefined) as never],
    });

    expect(feed.quotedLoading()).toBe(true);
    expect(feed.quoted()).toBeUndefined();
  });

  it('moves a sent request from the waiting rows to the quoted ones on quote.sent, counters included', async () => {
    const feed = await start({
      quoted: [listOf([]), listOf([quotedRow({ id: 'req-1' })])],
      waiting: [listOf([requestRow()], { total: 1 }), listOf([])],
    });
    expect(feed.total()).toBe(1);

    live.emit('quote.sent', 'quote-1');
    await wait(400);
    await settle();

    expect(reads('waiting')).toHaveLength(2);
    expect(reads('closed')).toHaveLength(2);
    expect(reads('quoted')).toHaveLength(2);
    expect(feed.rows()).toEqual([]);
    expect(feed.total()).toBe(0);
    expect(feed.quoted()?.map((r) => r.id)).toEqual(['req-1']);
  });

  it('reads them again with the other lists on reload', async () => {
    const feed = await start();

    feed.reload();
    await settle();

    expect(reads('quoted')).toHaveLength(2);
  });

  it('reads a further page of quoted rows from a cursor', async () => {
    const feed = await start();

    const page = await feed.page('q-2', 'quoted');

    expect(list).toHaveBeenLastCalledWith({ cursor: 'q-2', status: 'quoted' });
    expect(page.items.map((r) => r.id)).toEqual(['after-q-2']);
  });

  it('still reads further waiting pages by default', async () => {
    const feed = await start();

    await feed.page('c-2');

    expect(list).toHaveBeenLastCalledWith({ cursor: 'c-2', status: 'waiting' });
  });

  it('makes no quoted call for a session without the requests capability', async () => {
    const feed = await start({ capabilities: ['garage.own_jobs'] });

    expect(list).not.toHaveBeenCalled();
    expect(feed.quoted()).toBeUndefined();
    expect(feed.quotedLoading()).toBe(false);
  });
});
