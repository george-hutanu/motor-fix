import { readStatus } from './read';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { prisma } = fixtures();
serialDatabase(databaseUrl);

// 13:00 in Bucharest (summer time, UTC+3).
const NOW = new Date('2026-10-17T10:00:00Z');
const CHECKED = new Date('2026-10-17T09:59:40Z');
const SINCE = new Date('2026-10-17T06:00:00Z');

const seed = (over: Record<string, object> = {}) =>
  prisma.statusTile.createMany({
    data: [
      { detail: { latency_ms: 82 }, key: 'api' as const },
      { detail: { latency_ms: 140 }, key: 'search' as const },
      { detail: { latency_ms: 310 }, key: 'maps' as const },
      { detail: { failed_share: 0, latency_ms: 200 }, key: 'email' as const },
      {
        detail: { failed_share: 0, oldest_waiting_s: 3 },
        key: 'notifications' as const,
      },
      {
        detail: { last_backup_at: '2026-10-17T00:00:00.000Z' },
        key: 'backup' as const,
      },
    ].map((tile) => ({
      checkedAt: CHECKED,
      since: SINCE,
      state: 'green' as const,
      ...tile,
      ...over[tile.key],
    })),
  });

const rows = () => prisma.statusTile.findMany({ orderBy: { key: 'asc' } });

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE status_tile'));

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE status_tile');
  await prisma.$disconnect();
});

// @traces 295-FR-002 295-FR-003 295-FR-008
describe('reading the status from the database', () => {
  it('answers the seeded six tiles in panel order and no problems', async () => {
    await seed();

    const status = await readStatus(prisma, NOW);

    expect([
      status.tiles.map((t) => [t.key, t.state, t.detail, t.stale]),
      status.problems,
    ]).toEqual([
      [
        ['api', 'green', { latency_ms: 82 }, false],
        ['search', 'green', { latency_ms: 140 }, false],
        ['maps', 'green', { latency_ms: 310 }, false],
        ['email', 'green', { failed_share: 0, latency_ms: 200 }, false],
        [
          'notifications',
          'green',
          { failed_share: 0, oldest_waiting_s: 3 },
          false,
        ],
        [
          'backup',
          'green',
          { last_backup_at: '2026-10-17T00:00:00.000Z' },
          false,
        ],
      ],
      [],
    ]);
    expect(status.tiles[0]).toMatchObject({
      checkedAt: CHECKED.toISOString(),
      since: SINCE.toISOString(),
    });
  });

  it('answers maps amber since 10:40 at 1900 ms as the one problem', async () => {
    const since = new Date('2026-10-17T07:40:00Z');
    await seed({
      maps: { detail: { latency_ms: 1900 }, since, state: 'amber' },
    });

    const status = await readStatus(prisma, NOW);

    expect([status.tiles[2], status.problems]).toEqual([
      expect.objectContaining({
        detail: { latency_ms: 1900 },
        short: { en: 'slow · 1.9 s', ro: 'lent · 1,9 s' },
        since: since.toISOString(),
        state: 'amber',
      }),
      ['maps'],
    ]);
  });

  it('leaves every row as it was, a stale one included', async () => {
    await seed({
      email: { checkedAt: new Date('2026-10-17T09:50:00Z') },
      search: { pendingSince: CHECKED, pendingState: 'red' },
    });
    const before = await rows();

    const status = await readStatus(prisma, NOW);

    expect(status.problems).toEqual(['email']);
    expect(await rows()).toEqual(before);
  });
});

// @traces 295-FR-003 295-FR-008
describe('the stale rule on rows read from the database', () => {
  const at = (secondsAgo: number) =>
    new Date(NOW.getTime() - secondsAgo * 1000);

  it('turns a green tile checked exactly three minutes ago red and stale, since its last check', async () => {
    await seed({ email: { checkedAt: at(180), detail: { failed_share: 0 } } });

    const status = await readStatus(prisma, NOW);

    expect([status.tiles[3], status.problems]).toEqual([
      expect.objectContaining({
        checkedAt: at(180).toISOString(),
        detail: { failed_share: 0 },
        since: at(180).toISOString(),
        stale: true,
        state: 'red',
      }),
      ['email'],
    ]);
  });

  it('keeps the stored amber of a tile checked two minutes and fifty-nine seconds ago', async () => {
    await seed({ email: { checkedAt: at(179), state: 'amber' } });

    const status = await readStatus(prisma, NOW);

    expect([status.tiles[3]?.state, status.tiles[3]?.stale]).toEqual([
      'amber',
      false,
    ]);
  });

  it('keeps a tile whose last check is in the future green and not stale', async () => {
    await seed({ search: { checkedAt: at(-60) } });

    const status = await readStatus(prisma, NOW);

    expect([status.tiles[1]?.state, status.tiles[1]?.stale]).toEqual([
      'green',
      false,
    ]);
  });

  it('answers a tile with no row red and stale with nulls and an empty detail', async () => {
    await seed();
    await prisma.statusTile.delete({ where: { key: 'backup' } });

    const status = await readStatus(prisma, NOW);

    expect([status.tiles.length, status.tiles[5], status.problems]).toEqual([
      6,
      expect.objectContaining({
        checkedAt: null,
        detail: {},
        key: 'backup',
        since: null,
        stale: true,
        state: 'red',
      }),
      ['backup'],
    ]);
  });

  it('moves the since of a stored red tile checked ten minutes ago to its last check', async () => {
    await seed({ api: { checkedAt: at(600), since: at(7200), state: 'red' } });

    const status = await readStatus(prisma, NOW);

    expect([
      status.tiles[0]?.state,
      status.tiles[0]?.stale,
      status.tiles[0]?.since,
    ]).toEqual(['red', true, at(600).toISOString()]);
  });
});
