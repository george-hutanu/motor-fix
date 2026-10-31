import { noShowWorld } from './no-show.testing';
import { quotesApp } from '../quotes-api.testing';

const app = quotesApp();
const { bearer, send, world } = app;
const { prisma } = world;
const { due } = noShowWorld(app);

let since: Date;
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  [{ since }] = await prisma.$queryRaw<
    { since: Date }[]
  >`SELECT now() AS since`;
});

const path = (id: string) => `/bookings/${id}/no-show`;

type Volt = Awaited<ReturnType<typeof due>>['volt'];
const callers: [string, (volt: Volt) => [string, string]][] = [
  ['the owner', (volt) => [bearer(volt.owner, 'garage'), volt.owner]],
  [
    'a receptionist',
    (volt) => [bearer(volt.receptionist, 'receptionist'), volt.receptionist],
  ],
  [
    'the booking’s mechanic',
    (volt) => [bearer(volt.answering, 'mechanic'), volt.answering],
  ],
];

// A booking whose no-show the owner recorded a moment ago.
async function recorded(options: { job?: 'to_do' } = {}) {
  const made = await due(options);
  const res = await send(
    'post',
    path(made.booking.id),
    bearer(made.volt.owner, 'garage'),
  );
  expect(res.status).toBe(200);
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  return made;
}

// @traces 1259-FR-004
// @traces 1259-FR-006
// @traces 1259-FR-013
describe('DELETE /bookings/:id/no-show', () => {
  it.each(callers)(
    'lets %s withdraw it the same day, putting everything back',
    async (_who, caller) => {
      const { booking, volt } = await recorded({ job: 'to_do' });
      const [auth] = caller(volt);
      const confirmed = await prisma.booking.findUniqueOrThrow({
        select: { confirmedAt: true, confirmedBy: true },
        where: { id: booking.id },
      });

      const res = await send('delete', path(booking.id), auth);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: booking.id,
        noShowAt: null,
        noShowRecordedBy: null,
        status: 'confirmed',
      });
      expect(
        await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }),
      ).toMatchObject({
        ...confirmed,
        noShowAt: null,
        noShowRecordedBy: null,
        status: 'confirmed',
      });
      expect(
        (
          await prisma.job.findUniqueOrThrow({
            where: { bookingId: booking.id },
          })
        ).status,
      ).toBe('to_do');
      expect(
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: booking.requestId },
        }),
      ).toMatchObject({ closedAt: null, closedReason: null, status: 'booked' });
    },
  );

  it('puts the segment back where the confirmation placed it', async () => {
    const { booking, volt } = await recorded();

    await send('delete', path(booking.id), bearer(volt.owner, 'garage'));

    const segments = await prisma.bookingSegment.findMany({
      where: { bookingId: booking.id },
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      endsAt: new Date(
        booking.startsAt.getTime() + booking.durationMinutes * 60_000,
      ),
      garageId: volt.garage.id,
      lift: 1,
      mechanicId: volt.answeringMechanic.id,
      startsAt: booking.startsAt,
    });
  });

  it('keeps the slot on the booking’s mechanic even once her card is removed', async () => {
    const { booking, volt } = await recorded();
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: volt.answeringMechanic.id },
    });

    const res = await send(
      'delete',
      path(booking.id),
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    const [segment] = await prisma.bookingSegment.findMany({
      where: { bookingId: booking.id },
    });
    expect(segment.mechanicId).toBe(volt.answeringMechanic.id);
  });

  it('writes who withdrew it for the garage, the garage’s name for the driver, and one event', async () => {
    const { booking, volt } = await recorded();

    await send(
      'delete',
      path(booking.id),
      bearer(volt.receptionist, 'receptionist'),
    );

    const entries = await prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: { at: { gte: since }, subjectId: booking.id },
    });
    const moved = entries.filter(
      (e) => e.field === 'status' && e.oldValue === 'no_show',
    );
    expect(moved).toEqual([
      expect.objectContaining({
        actorId: volt.receptionist,
        newValue: 'confirmed',
      }),
    ]);
    expect(
      entries.filter(
        (e) => e.field === 'no_show' && e.newValue === 'withdrawn',
      ),
    ).toEqual([
      expect.objectContaining({ actorName: 'Volt Auto', isKeyChange: true }),
    ]);
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'booking.no_show_withdrawn',
      payload: {
        bookingId: booking.id,
        garageId: volt.garage.id,
        requestId: booking.requestId,
        withdrawnBy: volt.receptionist,
      },
      subjectId: booking.id,
    });
    expect(events[0].audience).toEqual(
      expect.arrayContaining([
        `account:${booking.driverId}`,
        `garage:${volt.garage.id}`,
        `mechanic:${volt.answeringMechanic.id}`,
      ]),
    );
  });
});
