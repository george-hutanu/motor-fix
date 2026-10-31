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

const record = (bookingId: string, auth: string) =>
  send('post', `/bookings/${bookingId}/no-show`, auth);

type Volt = Awaited<ReturnType<typeof due>>['volt'];
const callers: [string, (volt: Volt) => string][] = [
  ['the owner', (volt) => bearer(volt.owner, 'garage')],
  ['a receptionist', (volt) => bearer(volt.receptionist, 'receptionist')],
  ['the booking’s mechanic', (volt) => bearer(volt.answering, 'mechanic')],
];
const recorder: Record<string, (volt: Volt) => string> = {
  'a receptionist': (volt) => volt.receptionist,
  'the booking’s mechanic': (volt) => volt.answering,
  'the owner': (volt) => volt.owner,
};

// @traces 1259-FR-001
// @traces 1259-FR-003
// @traces 1259-FR-013
describe('POST /bookings/:id/no-show', () => {
  it.each(callers)(
    'lets %s record that the driver did not come, in one go',
    async (who, auth) => {
      const { booking, volt } = await due({ job: 'to_do' });
      const by = recorder[who](volt);

      const res = await record(booking.id, auth(volt));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: booking.id,
        noShowRecordedBy: by,
        status: 'no_show',
      });
      expect(Date.parse(res.body.noShowAt)).not.toBeNaN();

      const row = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(row).toMatchObject({ noShowRecordedBy: by, status: 'no_show' });
      expect(row.noShowAt).toBeInstanceOf(Date);
      expect(
        (
          await prisma.job.findUniqueOrThrow({
            where: { bookingId: booking.id },
          })
        ).status,
      ).toBe('cancelled');
      const request = await prisma.quoteRequest.findUniqueOrThrow({
        where: { id: booking.requestId },
      });
      expect(request).toMatchObject({
        closedReason: 'no_show',
        status: 'closed',
      });
      expect(request.closedAt).toBeInstanceOf(Date);
      expect(
        (
          await prisma.quote.findUniqueOrThrow({
            where: { id: booking.quoteId },
          })
        ).status,
      ).toBe('accepted');
      expect(
        await prisma.bookingSegment.count({ where: { bookingId: booking.id } }),
      ).toBe(0);
    },
  );

  it('records without a job too', async () => {
    const { booking, volt } = await due();

    const res = await record(booking.id, bearer(volt.owner, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_show');
  });

  it('writes the status entries and one entry for the driver signed by the garage', async () => {
    const { booking, volt } = await due({ job: 'to_do' });

    await record(booking.id, bearer(volt.receptionist, 'receptionist'));

    const entries = await prisma.activityLog.findMany({
      where: { at: { gte: since } },
    });
    const status = (type: string) =>
      entries.find((e) => e.subjectType === type && e.field === 'status');
    expect(status('booking')?.newValue).toBe('no_show');
    expect(status('job')?.newValue).toBe('cancelled');
    expect(status('quote_request')?.newValue).toBe('closed');
    const told = entries.filter(
      (e) => e.subjectType === 'booking' && e.field === 'no_show',
    );
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      actorName: 'Volt Auto',
      isKeyChange: true,
      newValue: 'recorded',
      subjectId: booking.id,
    });
  });

  it('records one event for the driver, the garage and the mechanic, and no money', async () => {
    const { booking, volt } = await due();

    await record(booking.id, bearer(volt.owner, 'garage'));

    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('booking.no_show_recorded');
    expect(events[0].subjectId).toBe(booking.id);
    expect(events[0].payload).toEqual({
      bookingId: booking.id,
      garageId: volt.garage.id,
      recordedBy: volt.owner,
      requestId: booking.requestId,
    });
    expect(events[0].audience).toEqual(
      expect.arrayContaining([
        `account:${booking.driverId}`,
        `garage:${volt.garage.id}`,
        `mechanic:${volt.answeringMechanic.id}`,
      ]),
    );
  });

  it('may be recorded again after a withdrawal', async () => {
    const { booking, volt } = await due();
    const owner = bearer(volt.owner, 'garage');

    expect((await record(booking.id, owner)).status).toBe(200);
    expect(
      (await send('delete', `/bookings/${booking.id}/no-show`, owner)).status,
    ).toBe(200);
    const again = await record(booking.id, owner);

    expect(again.status).toBe(200);
    expect(again.body.status).toBe('no_show');
  });
});
