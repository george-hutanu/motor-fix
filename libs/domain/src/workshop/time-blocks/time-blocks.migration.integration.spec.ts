import { serialDatabase } from '../../auth/serial-db.testing';
import { atLocal } from '../../bucharest';
import { heldOpen, lockWaited } from '../../held-open.testing';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';
import { ScheduleService } from '../schedule/schedule.service';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const DAY = '2026-11-12';
const at = (hour: number, minute = 0) =>
  new Date(atLocal(DAY, hour).getTime() + minute * 60_000);

let garageId: string;
let mechanicId: string;
let accountId: string;

beforeEach(async () => {
  await world.reset();
  garageId = (await world.garage('Atelier Dinamo')).id;
  mechanicId = (
    await prisma.mechanic.create({ data: { garageId, name: 'Mihai Pop' } })
  ).id;
  accountId = await world.account('Ana Recepție');
});

const block = (
  data: {
    lift?: number | null;
    mechanicId?: string | null;
    note?: string | null;
    startsAt?: Date;
    endsAt?: Date;
  } = {},
) =>
  prisma.timeBlock.create({
    data: {
      createdBy: accountId,
      endsAt: at(11, 30),
      garageId,
      lift: 2,
      mechanicId,
      startsAt: at(10),
      updatedBy: accountId,
      ...data,
    },
  });

// @traces 427-FR-001
describe('the time_block table', () => {
  it('stores a block on a mechanic, a lift or both', async () => {
    await expect(block()).resolves.toMatchObject({ lift: 2, mechanicId });
    await expect(block({ mechanicId: null })).resolves.toMatchObject({
      mechanicId: null,
    });
    await expect(block({ lift: null })).resolves.toMatchObject({ lift: null });
  });

  it.each([
    ['neither a mechanic nor a lift', { lift: null, mechanicId: null }],
    ['an end not after its start', { endsAt: at(10) }],
    ['a note over 200 characters', { note: 'x'.repeat(201) }],
  ])('refuses %s', async (_, data) => {
    await expect(block(data)).rejects.toThrow();
    expect(await prisma.timeBlock.count()).toBe(0);
  });

  it('keeps a note of exactly 200 characters', async () => {
    await expect(block({ note: 'x'.repeat(200) })).resolves.toBeDefined();
  });

  it('goes with its garage', async () => {
    await block();
    await prisma.garage.delete({ where: { id: garageId } });
    expect(await prisma.timeBlock.count()).toBe(0);
  });

  it('keeps its time when the card row goes, with no mechanic', async () => {
    const { id } = await block();
    await prisma.mechanic.delete({ where: { id: mechanicId } });
    expect(await prisma.timeBlock.findUnique({ where: { id } })).toMatchObject({
      lift: 2,
      mechanicId: null,
    });
  });
});

// @traces 427-FR-002
describe('a segment held by a booking or a block', () => {
  const segment = (holder: { bookingId?: string; timeBlockId?: string }) =>
    prisma.bookingSegment.create({
      data: { endsAt: at(11), garageId, lift: 1, startsAt: at(10), ...holder },
    });

  it('belongs to exactly one of a booking and a block', async () => {
    const booking = await world.booked(
      garageId,
      at(8).toISOString(),
      'awaiting_confirmation',
    );
    const { id: timeBlockId } = await block();

    await expect(segment({ timeBlockId })).resolves.toBeDefined();
    await expect(segment({})).rejects.toThrow(/booking_segment_holder_check/);
    await expect(
      segment({ bookingId: booking.id, timeBlockId }),
    ).rejects.toThrow(/booking_segment_holder_check/);
  });

  it('goes with its block', async () => {
    const { id: timeBlockId } = await block();
    await segment({ timeBlockId });
    await prisma.timeBlock.delete({ where: { id: timeBlockId } });
    expect(await prisma.bookingSegment.count()).toBe(0);
  });

  it.each([
    ['a mechanic', { lift: null, mechanicId: 'card' }, /mechanic_excl/],
    ['a lift', { lift: 2, mechanicId: null }, /lift_excl/],
  ] as const)(
    'keeps a block and a booking apart on %s',
    async (_, holder, constraint) => {
      const placed = holder.mechanicId ? mechanicId : null;
      await world.booked(garageId, at(10).toISOString(), 'confirmed', {
        lift: holder.lift ?? undefined,
        mechanicId: placed ?? undefined,
      });
      const { id: timeBlockId } = await block({
        lift: holder.lift,
        mechanicId: placed,
      });

      await expect(
        prisma.bookingSegment.create({
          data: {
            endsAt: at(10, 30),
            garageId,
            lift: holder.lift,
            mechanicId: placed,
            startsAt: at(10),
            timeBlockId,
          },
        }),
      ).rejects.toThrow(constraint);
    },
  );

  it('ends two blocks saved at once on one lift with one', async () => {
    const write = (timeBlockId: string, startsAt: Date) =>
      heldOpen(prisma, (tx) =>
        tx.bookingSegment.create({
          data: { endsAt: at(12), garageId, lift: 2, startsAt, timeBlockId },
        }),
      );
    const [a, b] = await Promise.all([block(), block()]);
    const first = write(a.id, at(10));
    await first.ready;
    const second = prisma.bookingSegment.create({
      data: {
        endsAt: at(12),
        garageId,
        lift: 2,
        startsAt: at(11),
        timeBlockId: b.id,
      },
    });
    await lockWaited(prisma);
    first.release();
    await first.done;

    await expect(second).rejects.toThrow(/booking_segment_lift_excl/);
    expect(await prisma.bookingSegment.count()).toBe(1);
  });

  it('leaves the readers of booking segments working with block rows present', async () => {
    const booking = await world.booked(
      garageId,
      at(8).toISOString(),
      'confirmed',
      { lift: 1, mechanicId },
    );
    const { id: timeBlockId } = await block();
    await prisma.bookingSegment.create({
      data: {
        endsAt: at(11, 30),
        garageId,
        lift: 2,
        mechanicId,
        startsAt: at(10),
        timeBlockId,
      },
    });

    // The schedule read and the move read a booking's own segments.
    const read = await prisma.booking.findUniqueOrThrow({
      include: { segments: true },
      where: { id: booking.id },
    });
    expect(read.segments).toHaveLength(1);
    // The placement check reads every holder and names the block.
    await expect(
      prisma.$transaction((tx) =>
        new ScheduleService().assertPlaceable(tx, {
          durationMinutes: 60,
          garageId,
          language: 'ro',
          lift: 3,
          mechanicId,
          startsAt: at(11),
        }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'mechanic_busy', reason: 'time_block' },
    });
  });
});
