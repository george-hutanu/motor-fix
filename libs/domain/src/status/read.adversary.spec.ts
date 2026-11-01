import type { TileKey, TileState } from '@motor-fix/contracts';

import { readStatus } from './read';
import type { TileRow } from './tiles';
import type { PrismaClient } from '../generated/prisma/client';

// 13:00 in Bucharest (summer time, UTC+3).
const NOW = new Date('2026-10-17T10:00:00Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);
const PANEL: TileKey[] = [
  'api',
  'search',
  'maps',
  'email',
  'notifications',
  'backup',
];

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

const fake = (rows: unknown[] | Error) => {
  const findMany = jest.fn(async () => {
    if (rows instanceof Error) {
      throw rows;
    }
    return rows;
  });
  const write = jest.fn();
  const prisma = {
    statusTile: {
      create: write,
      delete: write,
      deleteMany: write,
      findMany,
      update: write,
      updateMany: write,
      upsert: write,
    },
  } as unknown as PrismaClient;
  return { findMany, prisma, write };
};

const read = (rows: unknown[]) => readStatus(fake(rows).prisma, NOW);

describe('readStatus under attack', () => {
  // @traces 295-FR-003
  it('answers six red stale tiles with nulls and empty detail for an empty table', async () => {
    const out = await read([]);
    expect(out.tiles.map((t) => t.key)).toEqual(PANEL);
    for (const t of out.tiles) {
      expect(t).toMatchObject({
        checkedAt: null,
        detail: {},
        since: null,
        stale: true,
        state: 'red',
      });
    }
    expect(out.problems).toEqual(PANEL);
    expect(out.sentences.ro).toHaveLength(6);
    expect(out.sentences.en[0]).toBe('There is no data on API yet.');
  });

  // @traces 295-FR-002
  it('answers six tiles when only one row exists', async () => {
    const out = await read([row('maps', 'green')]);
    expect(out.tiles.map((t) => [t.key, t.stale])).toEqual([
      ['api', true],
      ['search', true],
      ['maps', false],
      ['email', true],
      ['notifications', true],
      ['backup', true],
    ]);
  });

  // @traces 295-FR-002
  it('keeps panel order whatever order the store returns the rows in', async () => {
    const rows = [...PANEL].reverse().map((k) => row(k));
    const out = await read(rows);
    expect(out.tiles.map((t) => t.key)).toEqual(PANEL);
    expect(out.problems).toEqual([]);
  });

  // @traces 295-FR-002
  it('ignores a row whose key is not one of the six', async () => {
    const out = await read([
      ...PANEL.map((k) => row(k)),
      { ...row('api'), key: 'database' },
    ]);
    expect(out.tiles).toHaveLength(6);
    expect(out.tiles.map((t) => t.key)).toEqual(PANEL);
  });

  // @traces 295-FR-002
  it('answers the first row when the store returns a key twice, without adding a tile', async () => {
    const out = await read([...PANEL.map((k) => row(k)), row('api', 'red')]);
    expect(out.tiles).toHaveLength(6);
  });

  describe('the stale boundary', () => {
    // @traces 295-FR-003
    it('is stale at exactly three minutes', async () => {
      const out = await read([row('email', 'green', { checkedAt: ago(180) })]);
      const email = out.tiles[3];
      expect(email).toMatchObject({
        checkedAt: ago(180).toISOString(),
        since: ago(180).toISOString(),
        stale: true,
        state: 'red',
      });
    });

    // @traces 295-FR-003
    it('is stale one millisecond past three minutes', async () => {
      const checkedAt = new Date(NOW.getTime() - 180_001);
      const out = await read([row('email', 'green', { checkedAt })]);
      expect(out.tiles[3].stale).toBe(true);
    });

    // @traces 295-FR-003
    it('is not stale one millisecond inside three minutes', async () => {
      const checkedAt = new Date(NOW.getTime() - 179_999);
      const out = await read([row('email', 'green', { checkedAt })]);
      expect(out.tiles[3]).toMatchObject({ stale: false, state: 'green' });
    });

    // @traces 295-FR-003
    it('is not stale at 2 minutes 59 seconds', async () => {
      const out = await read([row('email', 'green', { checkedAt: ago(179) })]);
      expect(out.tiles[3]).toMatchObject({ stale: false, state: 'green' });
    });

    // @traces 295-FR-003
    it('is not stale for a check in the future', async () => {
      const out = await read([
        row('email', 'green', { checkedAt: ago(-3600) }),
      ]);
      expect(out.tiles[3]).toMatchObject({ stale: false, state: 'green' });
    });

    // @traces 295-FR-003
    it('is not stale for a check at exactly now', async () => {
      const out = await read([row('email', 'green', { checkedAt: NOW })]);
      expect(out.tiles[3].stale).toBe(false);
    });

    // @traces 295-FR-003
    it('is stale for a check from years ago', async () => {
      const out = await read([
        row('email', 'amber', { checkedAt: new Date('2001-01-01T00:00:00Z') }),
      ]);
      expect(out.tiles[3]).toMatchObject({
        since: '2001-01-01T00:00:00.000Z',
        stale: true,
        state: 'red',
      });
    });

    // @traces 295-FR-003
    it('keeps the stored detail of a stale tile and moves since to checkedAt', async () => {
      const out = await read([
        row('maps', 'red', {
          checkedAt: ago(600),
          detail: { latency_ms: 1900, reason: 'timeout' },
          since: ago(7200),
        }),
      ]);
      expect(out.tiles[2]).toMatchObject({
        detail: { latency_ms: 1900, reason: 'timeout' },
        since: ago(600).toISOString(),
        stale: true,
        state: 'red',
      });
    });

    // @traces 295-FR-003
    it('judges staleness on checkedAt, not on last_backup_at', async () => {
      const out = await read([
        row('backup', 'green', {
          checkedAt: ago(10),
          detail: { last_backup_at: '2020-01-01T00:00:00.000Z' },
        }),
      ]);
      expect(out.tiles[5]).toMatchObject({ stale: false, state: 'green' });
    });
  });

  describe('problems', () => {
    // @traces 295-FR-004
    it('lists red before amber and the oldest first', async () => {
      const out = await read([
        row('maps', 'amber', { since: new Date('2026-10-17T07:40:00Z') }),
        row('api', 'red', { since: new Date('2026-10-17T08:02:00Z') }),
        row('search', 'red', { since: new Date('2026-10-17T07:55:00Z') }),
      ]);
      expect(
        out.problems.filter((k) => ['search', 'api', 'maps'].includes(k)),
      ).toEqual(['search', 'api', 'maps']);
    });

    // @traces 295-FR-004
    it('puts an older amber after a newer red', async () => {
      const out = await read([
        row('search'),
        row('maps'),
        row('email'),
        row('notifications'),
        row('api', 'amber', { since: ago(9000) }),
        row('backup', 'red', { since: ago(10) }),
      ]);
      expect(out.problems).toEqual(['backup', 'api']);
    });

    // @traces 295-FR-004
    it('breaks a tie on state and since by panel order', async () => {
      const since = ago(500);
      const out = await read([
        ...PANEL.filter(
          (k) => !['backup', 'maps', 'api', 'email'].includes(k),
        ).map((k) => row(k)),
        row('backup', 'amber', { since }),
        row('email', 'amber', { since }),
        row('api', 'amber', { since }),
        row('maps', 'amber', { since }),
      ]);
      expect(out.problems).toEqual(['api', 'maps', 'email', 'backup']);
    });

    // @traces 295-FR-004
    it('puts a null since last among tiles of the same state', async () => {
      const out = await read([
        row('search', 'red', { since: ago(100) }),
        row('maps', 'red', { since: ago(90_000) }),
      ]);
      expect(out.problems.slice(0, 2)).toEqual(['maps', 'search']);
      expect(out.problems.slice(2)).toEqual([
        'api',
        'email',
        'notifications',
        'backup',
      ]);
    });

    // @traces 295-FR-004
    it('orders a stale tile among reds by its last check', async () => {
      const out = await read([
        row('api', 'red', { since: ago(7200) }),
        row('search', 'green', { checkedAt: ago(600) }),
        row('maps', 'red', { since: ago(300) }),
        row('email'),
        row('notifications'),
        row('backup'),
      ]);
      expect(out.problems).toEqual(['api', 'search', 'maps']);
    });

    // @traces 295-FR-004
    it('gives an empty list and the all-clear sentence for six greens', async () => {
      const out = await read(PANEL.map((k) => row(k)));
      expect(out.problems).toEqual([]);
      expect(out.sentences).toEqual({
        en: ['All services are running normally.'],
        ro: ['Toate serviciile merg normal.'],
      });
    });

    // @traces 295-FR-002
    it('gives one sentence per problem in the same order, in both languages', async () => {
      const out = await read([
        ...PANEL.filter((k) => k !== 'maps' && k !== 'search').map((k) =>
          row(k),
        ),
        row('maps', 'amber', { since: new Date('2026-10-17T07:40:00Z') }),
        row('search', 'red', { since: new Date('2026-10-17T07:55:00Z') }),
      ]);
      expect(out.problems).toEqual(['search', 'maps']);
      expect(out.sentences.en).toEqual([
        'Search has not worked since 10:55. Drivers cannot find garages.',
        'Maps have been slow since 10:40. Distance sorting may lag.',
      ]);
      expect(out.sentences.ro).toEqual([
        'Căutarea nu merge din 10:55. Șoferii nu găsesc service-uri.',
        'Hărțile răspund lent din 10:40. Căutarea după distanță poate întârzia.',
      ]);
    });
  });

  describe('the answer', () => {
    // @traces 295-FR-002
    it('answers exactly the documented keys and no pending state', async () => {
      const out = await read([
        row('api', 'green', {
          pendingSince: ago(5),
          pendingState: 'red',
        }),
      ]);
      expect(Object.keys(out).sort()).toEqual([
        'problems',
        'sentences',
        'tiles',
      ]);
      for (const t of out.tiles) {
        expect(Object.keys(t).sort()).toEqual([
          'checkedAt',
          'detail',
          'key',
          'short',
          'since',
          'stale',
          'state',
        ]);
      }
      expect(JSON.stringify(out)).not.toMatch(/pending/i);
      expect(out.tiles[0].state).toBe('green');
    });

    // @traces 295-FR-005
    it('answers instants as UTC ISO strings and detail unrounded', async () => {
      const out = await read([
        row('api', 'green', {
          checkedAt: new Date('2026-10-17T09:59:30.123Z'),
          detail: { latency_ms: 82.4567 },
          since: new Date('2026-10-17T07:40:00Z'),
        }),
      ]);
      expect(out.tiles[0]).toMatchObject({
        checkedAt: '2026-10-17T09:59:30.123Z',
        detail: { latency_ms: 82.4567 },
        since: '2026-10-17T07:40:00.000Z',
      });
      expect(out.tiles[0].short).toEqual({
        en: 'normal · 82 ms',
        ro: 'normal · 82 ms',
      });
    });

    // @traces 295-FR-005
    it('writes the stale short state and Bucharest time into the answer', async () => {
      const out = await read([row('email', 'green', { checkedAt: ago(240) })]);
      expect(out.tiles[3].short).toEqual({
        en: 'no data since 12:56',
        ro: 'fără date din 12:56',
      });
    });

    // @traces 295-FR-002
    it('passes detail through verbatim, reason included', async () => {
      const detail = { failed_share: 0.4, latency_ms: 12, reason: 'smtp 421' };
      const out = await read([row('email', 'amber', { detail })]);
      expect(out.tiles[3].detail).toEqual(detail);
    });

    // @traces 295-FR-005
    it('words the brief seed: all green with the backup at 03:00 today', async () => {
      const out = await read([
        row('api', 'green', { detail: { latency_ms: 82 } }),
        row('search', 'green', { detail: { latency_ms: 140 } }),
        row('maps', 'green', { detail: { latency_ms: 310 } }),
        row('email'),
        row('notifications'),
        row('backup', 'green', {
          detail: { last_backup_at: '2026-10-17T00:00:00.000Z' },
        }),
      ]);
      expect(out.tiles.map((t) => t.short.en)).toEqual([
        'normal · 82 ms',
        'normal · 140 ms',
        'normal · 310 ms',
        'normal',
        'normal',
        'last: 03:00',
      ]);
      expect(out.tiles.map((t) => t.short.ro)[5]).toBe('ultimul: 03:00');
      expect(out.problems).toEqual([]);
    });
  });

  describe('purity and failure', () => {
    // @traces 295-FR-002
    it('reads once and writes nothing', async () => {
      const { findMany, prisma, write } = fake(PANEL.map((k) => row(k, 'red')));
      await readStatus(prisma, NOW);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
    });

    // @traces 295-FR-003
    it('leaves the rows it read unchanged, even frozen ones', async () => {
      const rows = PANEL.map((k) =>
        Object.freeze(
          row(k, 'amber', {
            checkedAt: ago(900),
            detail: Object.freeze({ latency_ms: 1 }) as Record<string, number>,
          }),
        ),
      );
      const before = JSON.stringify(rows);
      await read(rows);
      expect(JSON.stringify(rows)).toBe(before);
    });

    // @traces 295-FR-002
    it('answers the same twice for the same rows and clock', async () => {
      const rows = [row('api', 'red'), row('maps', 'amber')];
      expect(await read(rows)).toEqual(await read(rows));
    });

    // @traces 295-FR-002
    it('answers a mutation of the returned detail without touching the stored row', async () => {
      const rows = [row('api', 'green', { detail: { latency_ms: 5 } })];
      const out = await read(rows);
      Object.assign(out.tiles[0].detail, { latency_ms: 999 });
      expect(rows[0].detail).toEqual({ latency_ms: 5 });
    });

    // @traces 295-FR-002
    it('lets a database failure reach the caller unchanged', async () => {
      const boom = new Error('connection refused');
      await expect(readStatus(fake(boom).prisma, NOW)).rejects.toBe(boom);
    });
  });
});
