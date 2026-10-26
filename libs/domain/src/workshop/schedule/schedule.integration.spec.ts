import { ScheduleService } from './schedule.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { atLocal } from '../../bucharest';
import type { Prisma } from '../../generated/prisma/client';
import { heldOpen } from '../../held-open.testing';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const service = new ScheduleService();
const DAY = '2026-11-12';
const at = (hour: number, minute = 0) =>
  new Date(atLocal(DAY, hour).getTime() + minute * 60_000);

let garageId: string;
let mechanicId: string;

beforeEach(async () => {
  await world.reset();
  garageId = (await world.garage('Atelier Dinamo')).id;
  mechanicId = (
    await prisma.mechanic.create({ data: { garageId, name: 'Elena Stan' } })
  ).id;
});

const place = (
  client: Prisma.TransactionClient,
  extra: {
    lift?: number | null;
    mechanicId?: string | null;
    startsAt?: Date;
  } = {},
) =>
  service.assertPlaceable(client, {
    durationMinutes: 90,
    garageId,
    language: 'ro',
    lift: null,
    mechanicId,
    startsAt: at(10),
    ...extra,
  });

// What a confirm writes after the placement, onto an awaiting booking.
async function write(
  client: Prisma.TransactionClient,
  segments: Awaited<ReturnType<typeof place>>,
) {
  const booking = await world.booked(
    garageId,
    segments[0].startsAt.toISOString(),
    'awaiting_confirmation',
  );
  await client.bookingSegment.createMany({
    data: segments.map((segment) => ({
      ...segment,
      bookingId: booking.id,
      garageId,
    })),
  });
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { getResponse: () => unknown }) => error.getResponse(),
  );

// @traces 150-FR-002
// @traces 150-FR-005
describe('placing a booking on PostgreSQL', () => {
  it('returns the segments and writes nothing', async () => {
    const segments = await prisma.$transaction((tx) => place(tx, { lift: 1 }));

    expect(segments).toEqual([
      { endsAt: at(11, 30), lift: 1, mechanicId, startsAt: at(10) },
    ]);
    expect(await prisma.bookingSegment.count()).toBe(0);
  });

  it('names the mechanic busy on a stored segment', async () => {
    await world.booked(garageId, at(11).toISOString(), 'confirmed', {
      mechanicId,
    });

    expect(await refusal(prisma.$transaction((tx) => place(tx)))).toEqual({
      code: 'mechanic_busy',
      message: 'Elena Stan are o programare 11:00–12:30',
    });
  });

  it('names the lift busy on a stored segment, with its car', async () => {
    await world.booked(garageId, at(9).toISOString(), 'confirmed', { lift: 2 });

    expect(
      await refusal(prisma.$transaction((tx) => place(tx, { lift: 2 }))),
    ).toEqual({
      code: 'lift_busy',
      message: 'Elevatorul 2 e ocupat 09:00–10:30 (Mini Cooper S)',
    });
  });

  it('places a booking where the other ends', async () => {
    await world.booked(garageId, at(8, 30).toISOString(), 'confirmed', {
      lift: 2,
      mechanicId,
    });

    await expect(
      prisma.$transaction((tx) => place(tx, { lift: 2 })),
    ).resolves.toHaveLength(1);
  });

  it('lets two bookings without a mechanic overlap unless they share a lift', async () => {
    await world.booked(garageId, at(10).toISOString(), 'confirmed', {
      lift: 1,
    });

    await expect(
      prisma.$transaction((tx) => place(tx, { mechanicId: null })),
    ).resolves.toHaveLength(1);
    await expect(
      prisma.$transaction((tx) => place(tx, { lift: 2, mechanicId: null })),
    ).resolves.toHaveLength(1);
    expect(
      await refusal(
        prisma.$transaction((tx) => place(tx, { lift: 1, mechanicId: null })),
      ),
    ).toMatchObject({ code: 'lift_busy' });
  });

  it("leaves another garage's lift alone", async () => {
    const other = (await world.garage('Service Militari')).id;
    await world.booked(other, at(10).toISOString(), 'confirmed', { lift: 1 });

    await expect(
      prisma.$transaction((tx) => place(tx, { lift: 1 })),
    ).resolves.toHaveLength(1);
  });

  it.each([
    ['one lift', { lift: 1, mechanicId: null }, /booking_segment_lift_excl/],
    ['one mechanic', {}, /booking_segment_mechanic_excl/],
  ] as const)(
    'ends two transactions placing on %s with one commit',
    async (_, extra, constraint) => {
      const first = heldOpen(prisma, async (tx) => {
        await write(tx, await place(tx, extra));
      });
      await first.ready;

      const second = prisma.$transaction(async (tx) => {
        await write(tx, await place(tx, { ...extra, startsAt: at(10, 30) }));
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      first.release();
      await first.done;

      await expect(second).rejects.toThrow(constraint);
      expect(await prisma.bookingSegment.count()).toBe(1);
    },
  );
});
