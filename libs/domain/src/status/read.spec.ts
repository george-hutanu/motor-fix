import type { TileKey, TileState } from '@motor-fix/contracts';

import { readStatus } from './read';
import type { TileRow } from './tiles';
import type { PrismaClient } from '../generated/prisma/client';

// 13:00 in Bucharest (summer time, UTC+3).
const NOW = new Date('2026-10-17T10:00:00Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

const row = (
  key: TileKey,
  state: TileState = 'green',
  over: Partial<TileRow> = {},
): TileRow => ({
  checkedAt: ago(20),
  detail: {},
  key,
  pendingSince: null,
  pendingState: null,
  since: ago(3600),
  state,
  ...over,
});

const greens = () => [
  row('api', 'green', { detail: { latency_ms: 82 } }),
  row('search', 'green', { detail: { latency_ms: 140 } }),
  row('maps', 'green', { detail: { latency_ms: 310 } }),
  row('email', 'green', { detail: { failed_share: 0, latency_ms: 200 } }),
  row('notifications', 'green', {
    detail: { failed_share: 0, oldest_waiting_s: 4 },
  }),
  row('backup', 'green', {
    detail: { last_backup_at: '2026-10-17T00:00:00.000Z' },
  }),
];

const fake = (rows: TileRow[]) => {
  const findMany = jest.fn(async () => rows);
  const prisma = {
    statusTile: {
      create: jest.fn(),
      findMany,
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
  } as unknown as PrismaClient;
  return { findMany, prisma };
};

const read = (rows: TileRow[]) => readStatus(fake(rows).prisma, NOW);

const replace = (rows: TileRow[], next: TileRow) =>
  rows.map((r) => (r.key === next.key ? next : r));

// @traces 295-FR-002
describe('reading the six tiles', () => {
  it('answers the six tiles in panel order with their stored state, since, detail and last check', async () => {
    const status = await read(greens().reverse());

    expect(
      status.tiles.map(({ key, state, since, detail, checkedAt, stale }) => ({
        checkedAt,
        detail,
        key,
        since,
        stale,
        state,
      })),
    ).toEqual(
      greens().map((r) => ({
        checkedAt: r.checkedAt.toISOString(),
        detail: r.detail,
        key: r.key,
        since: r.since.toISOString(),
        stale: false,
        state: 'green',
      })),
    );
  });

  it('leaves the unconfirmed check out of the answer', async () => {
    const rows = replace(
      greens(),
      row('maps', 'green', { pendingSince: ago(30), pendingState: 'red' }),
    );

    const status = await read(rows);

    for (const tile of status.tiles) {
      expect(Object.keys(tile).sort()).toEqual([
        'checkedAt',
        'detail',
        'key',
        'short',
        'since',
        'stale',
        'state',
      ]);
    }
  });

  it('answers no problems and the all-clear sentence on six greens', async () => {
    const status = await read(greens());

    expect([status.problems, status.sentences]).toEqual([
      [],
      {
        en: ['All services are running normally.'],
        ro: ['Toate serviciile merg normal.'],
      },
    ]);
  });

  it('puts the short state on every tile', async () => {
    const status = await read(greens());

    expect(status.tiles.map((t) => t.short.en)).toEqual([
      'normal · 82 ms',
      'normal · 140 ms',
      'normal · 310 ms',
      'normal',
      'normal',
      'last: 03:00',
    ]);
  });

  it('reads the rows once and writes nothing', async () => {
    const { findMany, prisma } = fake(greens());

    await readStatus(prisma, NOW);

    const store = (
      prisma as unknown as { statusTile: Record<string, jest.Mock> }
    ).statusTile;
    expect([
      findMany.mock.calls.length,
      store['create']?.mock.calls.length,
      store['update']?.mock.calls.length,
      store['updateMany']?.mock.calls.length,
      store['upsert']?.mock.calls.length,
    ]).toEqual([1, 0, 0, 0, 0]);
  });
});

// @traces 295-FR-003
describe('a tile nobody has checked lately', () => {
  it('is red and stale at exactly three minutes, since its last check, its detail kept', async () => {
    const checkedAt = ago(180);
    const rows = replace(
      greens(),
      row('email', 'green', { checkedAt, detail: { failed_share: 0 } }),
    );

    const email = (await read(rows)).tiles[3];

    expect(email).toMatchObject({
      checkedAt: checkedAt.toISOString(),
      detail: { failed_share: 0 },
      key: 'email',
      since: checkedAt.toISOString(),
      stale: true,
      state: 'red',
    });
  });

  it('keeps its stored state at two minutes and fifty-nine seconds', async () => {
    const rows = replace(
      greens(),
      row('email', 'amber', { checkedAt: ago(179) }),
    );

    const email = (await read(rows)).tiles[3];

    expect([email?.state, email?.stale]).toEqual(['amber', false]);
  });

  it('is not stale when its last check is in the future', async () => {
    const rows = replace(
      greens(),
      row('search', 'green', { checkedAt: new Date(NOW.getTime() + 60_000) }),
    );

    const search = (await read(rows)).tiles[1];

    expect([search?.state, search?.stale]).toEqual(['green', false]);
  });

  it('is red and stale with nulls and an empty detail when it has no row', async () => {
    const rows = greens().filter((r) => r.key !== 'backup');

    const status = await read(rows);

    expect(status.tiles).toHaveLength(6);
    expect(status.tiles[5]).toMatchObject({
      checkedAt: null,
      detail: {},
      key: 'backup',
      since: null,
      stale: true,
      state: 'red',
    });
    expect(status.problems).toEqual(['backup']);
  });

  it('answers six red stale tiles when the checks never ran', async () => {
    const status = await read([]);

    expect(status.tiles.map((t) => [t.key, t.state, t.stale])).toEqual([
      ['api', 'red', true],
      ['search', 'red', true],
      ['maps', 'red', true],
      ['email', 'red', true],
      ['notifications', 'red', true],
      ['backup', 'red', true],
    ]);
  });

  it('moves the since of a stored red tile to its last check', async () => {
    const checkedAt = ago(600);
    const rows = replace(
      greens(),
      row('api', 'red', { checkedAt, since: ago(7200) }),
    );

    const api = (await read(rows)).tiles[0];

    expect([api?.state, api?.stale, api?.since]).toEqual([
      'red',
      true,
      checkedAt.toISOString(),
    ]);
  });

  it('reads the stale short state and sentence', async () => {
    // 10:41 in Bucharest.
    const checkedAt = new Date('2026-10-17T07:41:00Z');
    const rows = replace(
      greens(),
      row('notifications', 'green', { checkedAt }),
    );

    const status = await read(rows);

    expect([status.tiles[4]?.short, status.sentences]).toEqual([
      { en: 'no data since 10:41', ro: 'fără date din 10:41' },
      {
        en: [
          'No data on Notifications since 10:41. The service may be in another state.',
        ],
        ro: [
          'Nu avem date despre Notificări din 10:41. Starea serviciului poate fi alta.',
        ],
      },
    ]);
  });
});

// @traces 295-FR-004
describe('the order of the problems', () => {
  it('puts red before amber, the oldest first, a null since last, and the panel order on a tie', async () => {
    const tie = ago(1800);
    const rows = [
      row('api', 'amber', { since: tie }),
      row('search', 'amber', { since: tie }),
      row('maps', 'amber', { since: ago(3600) }),
      row('email', 'red', { since: ago(600) }),
      row('notifications', 'red', { since: ago(1200) }),
    ];

    const status = await read(rows);

    expect(status.problems).toEqual([
      'notifications',
      'email',
      'backup',
      'maps',
      'api',
      'search',
    ]);
  });

  it('gives one sentence per problem in that order, in each language', async () => {
    const rows = replace(
      replace(
        greens(),
        row('maps', 'amber', {
          detail: { latency_ms: 1900 },
          // 10:40 in Bucharest.
          since: new Date('2026-10-17T07:40:00Z'),
        }),
      ),
      // 11:05 in Bucharest.
      row('search', 'red', { since: new Date('2026-10-17T08:05:00Z') }),
    );

    const status = await read(rows);

    expect([status.problems, status.sentences]).toEqual([
      ['search', 'maps'],
      {
        en: [
          'Search has not worked since 11:05. Drivers cannot find garages.',
          'Maps have been slow since 10:40. Distance sorting may lag.',
        ],
        ro: [
          'Căutarea nu merge din 11:05. Șoferii nu găsesc service-uri.',
          'Hărțile răspund lent din 10:40. Căutarea după distanță poate întârzia.',
        ],
      },
    ]);
  });
});
