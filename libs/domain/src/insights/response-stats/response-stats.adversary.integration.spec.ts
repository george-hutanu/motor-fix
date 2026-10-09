import { responseRateOf, writeResponseStats } from './response-stats';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { RecipientStatus } from '../../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const NOW = new Date('2026-10-09T07:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let driverId: string;
let carId: string;

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  driverId = await world.account('Andrei Ion Marin');
  carId = (await world.car(driverId)).id;
});

afterAll(() => prisma.$disconnect());

async function arrived(
  garageId: string,
  at: Date,
  status: RecipientStatus = 'waiting',
  answeredAt: Date | null = null,
) {
  const request = await world.request(driverId, {
    carId,
    createdAt: at,
    status: status === 'closed' ? 'closed' : 'sent',
  });
  const { id } = await world.recipient(request.id, garageId, status);
  await prisma.requestRecipient.update({
    data: { answeredAt, createdAt: at },
    where: { id },
  });
}

const stats = (garageId: string) =>
  prisma.garageResponseStats.findUnique({ where: { garageId } });

const events = () =>
  prisma.outboxEvent.findMany({ where: { kind: 'response_stats.updated' } });

// @traces 384-FR-001 384-FR-002 384-FR-003
describe('the edges of the counting rule', () => {
  it('counts an answer exactly 24 hours after arrival and not one a millisecond later', async () => {
    const g = await world.garage('Atelier Dinamo');
    const a = ago(48 * HOUR);
    const b = ago(49 * HOUR);
    await arrived(g.id, a, 'quoted', new Date(a.getTime() + DAY));
    await arrived(g.id, b, 'quoted', new Date(b.getTime() + DAY + 1));

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 1,
      rate: 50,
      requests30d: 2,
    });
  });

  it('leaves out a request that arrived exactly 30 days before now and takes one a millisecond newer', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, ago(30 * DAY), 'quoted', ago(30 * DAY - HOUR));
    await arrived(g.id, ago(30 * DAY - 1), 'quoted', ago(30 * DAY - HOUR));

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 1,
      lifetimeRequests: 2,
      requests30d: 1,
    });
  });

  it('counts a request still waiting after exactly a day and skips one a millisecond younger', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, ago(DAY), 'waiting');
    await arrived(g.id, ago(DAY - 1), 'waiting');

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 0,
      lifetimeRequests: 2,
      rate: 0,
      requests30d: 1,
    });
  });

  it('counts an expired request as asked and not answered', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, ago(5 * DAY), 'expired');
    await arrived(g.id, ago(6 * DAY), 'quoted', ago(6 * DAY - HOUR));

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 1,
      rate: 50,
      requests30d: 2,
    });
  });

  it('counts a decline with no answer time as not answered', async () => {
    const g = await world.garage('Atelier Dinamo');
    await arrived(g.id, ago(5 * DAY), 'declined');
    await prisma.requestRecipient.updateMany({
      data: { answeredAt: null },
      where: { garageId: g.id },
    });

    await writeResponseStats(prisma, NOW);

    expect(await stats(g.id)).toMatchObject({
      answeredWithinDay30d: 0,
      rate: 0,
      requests30d: 1,
    });
  });

  it('keeps the rate within 0 and 100 when an answer is stamped before the request arrived', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 3; i++) {
      await arrived(g.id, ago((3 + i) * DAY), 'quoted', ago((4 + i) * DAY));
    }

    await writeResponseStats(prisma, NOW);

    const row = await stats(g.id);
    expect(row?.answeredWithinDay30d).toBeLessThanOrEqual(
      row?.requests30d ?? 0,
    );
    expect(row?.rate).toBe(100);
  });

  it('writes an empty row for an approved garage that has never been asked', async () => {
    const g = await world.garage('Atelier Dinamo');

    const result = await writeResponseStats(prisma, NOW);

    expect(result).toEqual({ computed: 1, written: 1 });
    expect(await stats(g.id)).toEqual({
      answeredWithinDay30d: 0,
      computedAt: NOW,
      garageId: g.id,
      lifetimeRequests: 0,
      rate: null,
      requests30d: 0,
    });
    expect(await events()).toEqual([]);
  });

  it('computes nothing when there is no approved garage', async () => {
    await prisma.garage.create({
      data: { name: 'Atelier Ciornă', slug: 'atelier-ciorna', status: 'draft' },
    });

    expect(await writeResponseStats(prisma, NOW)).toEqual({
      computed: 0,
      written: 0,
    });
    expect(await prisma.garageResponseStats.count()).toBe(0);
  });
});

// @traces 384-FR-004 384-FR-005
describe('the figures of a garage that leaves or arrives', () => {
  it('leaves the row of a suspended garage as it was and still computes the others', async () => {
    const gone = await world.garage('Atelier Dinamo');
    const kept = await world.garage('Service Titan');
    await arrived(gone.id, ago(2 * DAY), 'quoted', ago(2 * DAY - HOUR));
    await writeResponseStats(prisma, NOW);
    const before = await stats(gone.id);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: gone.id },
    });
    await arrived(gone.id, ago(DAY * 3), 'quoted', ago(DAY * 3 - HOUR));
    const later = new Date(NOW.getTime() + DAY);

    const result = await writeResponseStats(prisma, later);

    // The kept garage's figures did not move, so its row is not rewritten.
    expect(result).toEqual({ computed: 1, written: 0 });
    expect(await stats(gone.id)).toEqual(before);
    expect(await stats(kept.id)).not.toBeNull();
  });

  it('removes the row with its garage', async () => {
    const g = await world.garage('Atelier Dinamo');
    await writeResponseStats(prisma, NOW);

    await prisma.garage.delete({ where: { id: g.id } });

    expect(await prisma.garageResponseStats.count()).toBe(0);
  });

  it('refuses a rate outside 0 and 100 at the database', async () => {
    const g = await world.garage('Atelier Dinamo');
    const write = (rate: number) =>
      prisma.garageResponseStats.create({
        data: {
          answeredWithinDay30d: 0,
          computedAt: NOW,
          garageId: g.id,
          lifetimeRequests: 0,
          rate,
          requests30d: 0,
        },
      });

    await expect(write(101)).rejects.toThrow();
    await expect(write(-1)).rejects.toThrow();
  });
});

// @traces 384-FR-006 384-FR-011
describe('the threshold of ten requests', () => {
  it('shows the rate at exactly ten lifetime requests when the tenth is closed', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 9; i++) {
      await arrived(
        g.id,
        ago((2 + i) * DAY),
        'quoted',
        ago((2 + i) * DAY - HOUR),
      );
    }
    await arrived(g.id, ago(DAY * 12), 'closed');

    await writeResponseStats(prisma, NOW);

    const row = await stats(g.id);
    expect(row).toMatchObject({ lifetimeRequests: 10, requests30d: 9 });
    expect(responseRateOf(row)).toEqual({ rate: 100, state: 'rate' });
  });

  it('shows nothing for ten requests that are all closed', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 10; i++)
      await arrived(g.id, ago((2 + i) * DAY), 'closed');

    await writeResponseStats(prisma, NOW);

    const row = await stats(g.id);
    expect(row).toMatchObject({
      lifetimeRequests: 10,
      rate: null,
      requests30d: 0,
    });
    expect(responseRateOf(row)).toEqual({ state: 'none' });
  });

  it('keeps the garage new at nine requests of which every one is old', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 9; i++) {
      await arrived(
        g.id,
        ago((40 + i) * DAY),
        'quoted',
        ago((40 + i) * DAY - HOUR),
      );
    }

    await writeResponseStats(prisma, NOW);

    expect(responseRateOf(await stats(g.id))).toEqual({ state: 'new' });
  });

  it('maps stored rows to the shown value at every edge', () => {
    const row = (
      lifetimeRequests: number,
      requests30d: number,
      rate: number | null,
    ) => ({
      answeredWithinDay30d: 0,
      computedAt: NOW,
      garageId: 'g',
      lifetimeRequests,
      rate,
      requests30d,
    });

    expect([
      responseRateOf(row(0, 0, null)),
      responseRateOf(row(9, 9, 100)),
      responseRateOf(row(10, 0, null)),
      responseRateOf(row(10, 1, 0)),
      responseRateOf(row(10_000, 500, 99)),
    ]).toEqual([
      { state: 'new' },
      { state: 'new' },
      { state: 'none' },
      { rate: 0, state: 'rate' },
      { rate: 99, state: 'rate' },
    ]);
  });
});

// @traces 384-FR-007 384-FR-011
describe('events and repeated runs', () => {
  it('records one event when the shown value moves from a rate to nothing', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 10; i++) {
      await arrived(
        g.id,
        ago((20 + i) * DAY),
        'quoted',
        ago((20 + i) * DAY - HOUR),
      );
    }
    await writeResponseStats(prisma, NOW);

    await writeResponseStats(prisma, new Date(NOW.getTime() + 25 * DAY));

    const row = await stats(g.id);
    expect(responseRateOf(row)).toEqual({ state: 'none' });
    expect(await events()).toHaveLength(2);
  });

  it('records an event when the rate changes while the garage stays over ten', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 10; i++) {
      await arrived(
        g.id,
        ago((2 + i) * DAY),
        'quoted',
        ago((2 + i) * DAY - HOUR),
      );
    }
    await writeResponseStats(prisma, NOW);
    await arrived(g.id, ago(3 * DAY), 'expired');

    await writeResponseStats(prisma, new Date(NOW.getTime() + HOUR));

    expect((await stats(g.id))?.rate).toBe(90);
    expect(await events()).toHaveLength(2);
  });

  it('records no event when only the lifetime count moves above ten', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 10; i++) {
      await arrived(
        g.id,
        ago((2 + i) * DAY),
        'quoted',
        ago((2 + i) * DAY - HOUR),
      );
    }
    await writeResponseStats(prisma, NOW);
    await arrived(g.id, ago(DAY * 90), 'quoted', ago(DAY * 90 - HOUR));

    const result = await writeResponseStats(
      prisma,
      new Date(NOW.getTime() + HOUR),
    );

    expect(result).toEqual({ computed: 1, written: 1 });
    expect((await stats(g.id))?.lifetimeRequests).toBe(11);
    expect(await events()).toHaveLength(1);
  });

  it('leaves one row and one event when two runs start at the same instant', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 10; i++) {
      await arrived(
        g.id,
        ago((2 + i) * DAY),
        'quoted',
        ago((2 + i) * DAY - HOUR),
      );
    }

    const settled = await Promise.allSettled([
      writeResponseStats(prisma, NOW),
      writeResponseStats(prisma, NOW),
    ]);

    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await prisma.garageResponseStats.count()).toBe(1);
    expect(await events()).toHaveLength(1);
  });

  it('gives the same row when run again at the same instant after an interleaved change elsewhere', async () => {
    const a = await world.garage('Atelier Dinamo');
    const b = await world.garage('Service Titan');
    await arrived(a.id, ago(2 * DAY), 'quoted', ago(2 * DAY - HOUR));
    await writeResponseStats(prisma, NOW);
    const first = await stats(a.id);
    await arrived(b.id, ago(2 * DAY), 'expired');

    const second = await writeResponseStats(prisma, NOW);

    expect(second).toEqual({ computed: 2, written: 1 });
    expect(await stats(a.id)).toEqual(first);
  });
});
