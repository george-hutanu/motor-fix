// @traces 384-FR-001 384-FR-002 384-FR-003 384-FR-004 384-FR-005 384-FR-006 384-FR-011
import {
  RESPONSE_RATE_MIN_REQUESTS,
  RESPONSE_RATE_PERIOD_DAYS,
  RESPONSE_RATE_WINDOW_HOURS,
  responseRateOf,
  writeResponseStats,
} from './response-stats';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { RecipientStatus } from '../../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

// Friday 9 October 2026, 10:00 in Bucharest.
const NOW = new Date('2026-10-09T07:00:00Z');
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

let driverId: string;
let carId: string;

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  driverId = await world.account('Andrei Ion Marin');
  carId = (await world.car(driverId)).id;
});

afterAll(() => prisma.$disconnect());

// A request reaching the garage at `at`, left in `status`, answered
// `answeredAfter` hours later when given.
async function arrived(
  garageId: string,
  at: Date,
  status: RecipientStatus = 'waiting',
  answeredAfter?: number,
) {
  const request = await world.request(driverId, {
    carId,
    createdAt: at,
    status: status === 'closed' ? 'closed' : 'sent',
  });
  const { id } = await world.recipient(request.id, garageId, status);
  await prisma.requestRecipient.update({
    data: {
      answeredAt:
        answeredAfter === undefined
          ? null
          : new Date(at.getTime() + answeredAfter * HOUR),
      createdAt: at,
    },
    where: { id },
  });
}

// `answered` requests quoted two hours after they arrived and the rest left
// waiting past the day, all within the last ten days.
async function answeredOf(garageId: string, answered: number, total: number) {
  for (let i = 0; i < total; i++) {
    const at = hoursAgo(30 + i * 3);
    if (i < answered) await arrived(garageId, at, 'quoted', 2);
    else await arrived(garageId, at);
  }
}

const stats = (garageId: string) =>
  prisma.garageResponseStats.findUnique({ where: { garageId } });

const events = () =>
  prisma.outboxEvent.findMany({ where: { kind: 'response_stats.updated' } });

describe('the response figures of a night', () => {
  it('reads its period, window and threshold from one module', () => {
    expect([
      RESPONSE_RATE_PERIOD_DAYS,
      RESPONSE_RATE_WINDOW_HOURS,
      RESPONSE_RATE_MIN_REQUESTS,
    ]).toEqual([30, 24, 10]);
  });

  it('counts an answer 23 hours later as within a day and one 25 hours later across a Sunday as not', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, new Date('2026-10-03T10:00:00Z'), 'quoted', 23);
    await arrived(g.id, new Date('2026-10-03T12:00:00Z'), 'quoted', 25);

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toEqual({
      answeredWithinDay30d: 1,
      computedAt: NOW,
      garageId: g.id,
      lifetimeRequests: 2,
      rate: 50,
      requests30d: 2,
    });
  });

  it('counts a decline within a day as answered', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, hoursAgo(48), 'declined', 3);
    await arrived(g.id, hoursAgo(72), 'quoted', 30);

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 1,
      rate: 50,
      requests30d: 2,
    });
  });

  it('counts a quote with no answer time as not answered', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, hoursAgo(48), 'quoted');

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 0,
      rate: 0,
      requests30d: 1,
    });
  });

  it('rounds the rate down to a whole percent', async () => {
    const cases: [answered: number, total: number][] = [
      [11, 12],
      [46, 50],
      [0, 5],
      [5, 5],
    ];
    const garages = [];
    for (const [answered, total] of cases) {
      const g = await world.garage('Atelier Dinamo');
      await answeredOf(g.id, answered, total);
      garages.push(g.id);
    }

    await writeResponseStats(prisma, NOW);

    const rates = [];
    for (const id of garages) rates.push((await stats(id))?.rate);
    expect(rates).toEqual([91, 92, 0, 100]);
  });

  it('counts every request of the garage toward the lifetime figure, closed and older ones too', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, hoursAgo(48), 'quoted', 1);
    await arrived(g.id, hoursAgo(72), 'closed');
    await arrived(g.id, hoursAgo(24 * 40), 'quoted', 1);
    await arrived(g.id, hoursAgo(2));

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 1,
      lifetimeRequests: 4,
      requests30d: 1,
    });
  });

  it('stores no rate when no request of the last 30 days counts', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, hoursAgo(24 * 31), 'quoted', 1);
    await arrived(g.id, hoursAgo(2));

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 0,
      lifetimeRequests: 2,
      rate: null,
      requests30d: 0,
    });
  });

  it('computes approved garages only', async () => {
    const draft = await prisma.garage.create({
      data: { name: 'Atelier Ciornă', slug: 'atelier-ciorna', status: 'draft' },
    });
    await arrived(draft.id, hoursAgo(48), 'quoted', 1);

    await writeResponseStats(prisma, NOW);

    expect(await stats(draft.id)).toBeNull();
  });

  it('writes a row of zeros for an approved garage with no request, and no event', async () => {
    const g = await world.garage('Atelier Dinamo');

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 0,
      lifetimeRequests: 0,
      rate: null,
      requests30d: 0,
    });
    expect(await events()).toEqual([]);
  });
});

describe('which requests count', () => {
  it('leaves out a request waiting for less than a day and counts one waiting 30 hours against', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, hoursAgo(23));
    await arrived(g.id, hoursAgo(30));
    await arrived(g.id, hoursAgo(40), 'quoted', 1);

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 1,
      lifetimeRequests: 3,
      rate: 50,
      requests30d: 2,
    });
  });

  it('counts an undone decline, back to waiting, as not answered', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, hoursAgo(72));
    await arrived(g.id, hoursAgo(96), 'quoted', 1);

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 1,
      requests30d: 2,
    });
  });

  it('counts a request that expired at day 7 as not answered', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, hoursAgo(24 * 8), 'expired');

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 0,
      rate: 0,
      requests30d: 1,
    });
  });

  it('leaves out a request the driver cancelled before the garage answered', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, hoursAgo(48), 'closed');

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      lifetimeRequests: 1,
      rate: null,
      requests30d: 0,
    });
  });

  it('leaves out a request a suspension closed while the request stayed open', async () => {
    const g = await world.garage('Atelier Dinamo');
    const request = await world.request(driverId, {
      carId,
      createdAt: hoursAgo(48),
    });
    const { id } = await world.recipient(request.id, g.id, 'closed');
    await prisma.requestRecipient.update({
      data: { createdAt: hoursAgo(48) },
      where: { id },
    });

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      lifetimeRequests: 1,
      requests30d: 0,
    });
  });
});

describe('the value a profile shows', () => {
  it('is new for a garage the night has not counted yet', () => {
    expect(responseRateOf(null)).toEqual({ state: 'new' });
  });

  it('is new at 9 lifetime requests and the rate at the 10th', async () => {
    const g = await world.garage('Atelier Dinamo');
    await answeredOf(g.id, 9, 9);
    await writeResponseStats(prisma, NOW);
    const nine = responseRateOf(await stats(g.id));

    await arrived(g.id, hoursAgo(60), 'quoted', 2);
    await writeResponseStats(prisma, NOW);

    expect([nine, responseRateOf(await stats(g.id))]).toEqual([
      { state: 'new' },
      { rate: 100, state: 'rate' },
    ]);
  });

  it('is none for a garage of 10 or more requests with none in the last 30 days', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 10; i++) {
      await arrived(g.id, hoursAgo(24 * (31 + i)), 'quoted', 1);
    }

    await writeResponseStats(prisma, NOW);

    expect(responseRateOf(await stats(g.id))).toEqual({ state: 'none' });
  });

  it('is the rate, 0 included, for a garage of 10 or more requests', async () => {
    const g = await world.garage('Atelier Dinamo');
    await answeredOf(g.id, 0, 10);

    await writeResponseStats(prisma, NOW);

    expect(responseRateOf(await stats(g.id))).toEqual({
      rate: 0,
      state: 'rate',
    });
  });
});

describe('writing only what changed', () => {
  it('records one public event for a garage whose shown value changed', async () => {
    const g = await world.garage('Atelier Dinamo');
    await answeredOf(g.id, 11, 12);

    await writeResponseStats(prisma, NOW);

    expect(await events()).toEqual([
      expect.objectContaining({
        audience: expect.arrayContaining([`public:garage:${g.id}`]),
        kind: 'response_stats.updated',
        payload: {},
        subjectId: g.id,
      }),
    ]);
  });

  it('writes nothing and records nothing when the next night finds the same figures', async () => {
    const g = await world.garage('Atelier Dinamo');
    await answeredOf(g.id, 11, 12);
    await writeResponseStats(prisma, NOW);

    const again = await writeResponseStats(prisma, NOW);

    expect(again).toEqual({ computed: 1, written: 0 });
    expect((await stats(g.id))?.computedAt).toEqual(NOW);
    expect(await events()).toHaveLength(1);
  });

  it('writes a changed figure without an event while the garage stays new', async () => {
    const g = await world.garage('Atelier Dinamo');
    await answeredOf(g.id, 3, 3);
    await writeResponseStats(prisma, NOW);
    await arrived(g.id, hoursAgo(60), 'quoted', 2);

    const later = new Date(NOW.getTime() + HOUR);
    const result = await writeResponseStats(prisma, later);

    expect(result).toEqual({ computed: 1, written: 1 });
    expect(await stats(g.id)).toMatchObject({
      computedAt: later,
      lifetimeRequests: 4,
    });
    expect(await events()).toEqual([]);
  });

  it('says how many approved garages it computed and how many it wrote', async () => {
    await world.garage('Atelier Dinamo');
    await world.garage('Service Titan');
    await prisma.garage.create({
      data: { name: 'Atelier Ciornă', slug: 'atelier-ciorna', status: 'draft' },
    });

    expect(await writeResponseStats(prisma, NOW)).toEqual({
      computed: 2,
      written: 2,
    });
  });

  it('keeps each garage whole when a write fails, and the retry writes only what still differs', async () => {
    const kept = await world.garage('Atelier Dinamo');
    const refused = await world.garage('Service Titan');
    await answeredOf(kept.id, 10, 10);
    await answeredOf(refused.id, 10, 10);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION refuse_event() RETURNS trigger AS $$
       BEGIN
         IF NEW.subject_id = '${refused.id}' THEN RAISE EXCEPTION 'refused'; END IF;
         RETURN NEW;
       END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER refuse_event BEFORE INSERT ON outbox_event FOR EACH ROW EXECUTE FUNCTION refuse_event()',
    );
    try {
      await expect(writeResponseStats(prisma, NOW)).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS refuse_event ON outbox_event',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS refuse_event()');
    }
    const keptRow = await stats(kept.id);
    const keptEvents = (await events()).filter((e) => e.subjectId === kept.id);
    expect(await stats(refused.id)).toBeNull();
    expect(keptEvents).toHaveLength(keptRow ? 1 : 0);

    const retry = await writeResponseStats(prisma, NOW);

    expect(retry).toEqual({ computed: 2, written: keptRow ? 1 : 2 });
    expect((await events()).map((e) => e.subjectId).sort()).toEqual(
      [kept.id, refused.id].sort(),
    );
  });
});
