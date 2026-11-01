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
      { detail: { latency_ms: 82 }, key: 'api' },
      { detail: { latency_ms: 140 }, key: 'search' },
      { detail: { latency_ms: 310 }, key: 'maps' },
      { detail: { failed_share: 0, latency_ms: 200 }, key: 'email' },
      {
        detail: { failed_share: 0, oldest_waiting_s: 3 },
        key: 'notifications',
      },
      { detail: { last_backup_at: '2026-10-17T00:00:00.000Z' }, key: 'backup' },
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
