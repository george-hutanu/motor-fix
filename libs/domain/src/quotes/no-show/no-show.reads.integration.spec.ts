import { noShowWorld } from './no-show.testing';
import { localDay } from '../../bucharest';
import { quotesApp } from '../quotes-api.testing';

const app = quotesApp();
const { bearer, get, send, world } = app;
const { prisma } = world;
const { due } = noShowWorld(app);

const DAY = 24 * 3_600_000;

type Volt = Awaited<ReturnType<typeof due>>['volt'];
const owner = (volt: Volt) => bearer(volt.owner, 'garage');
const desk = (volt: Volt) => bearer(volt.receptionist, 'receptionist');
const fixer = (volt: Volt) => bearer(volt.answering, 'mechanic');

// The booking on the garage's sent-quotes row for this request.
async function rowBooking(auth: string, requestId: string) {
  const res = await get('/garage/requests?status=quoted', auth);
  expect(res.status).toBe(200);
  return res.body.items.find((item: { id: string }) => item.id === requestId)
    ?.booking;
}

// The list starts at a Bucharest day, today by default: a booking due 30
// minutes ago started yesterday when the test runs just after midnight, so
// the list is asked from that day.
async function jobSummary(auth: string, bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });
  const res = await get(
    `/garage/jobs?from=${localDay(booking.startsAt)}`,
    auth,
  );
  expect(res.status).toBe(200);
  return res.body.items.find(
    (item: { bookingId: string }) => item.bookingId === bookingId,
  );
}

const recordNoShow = (bookingId: string, auth: string) =>
  send('post', `/bookings/${bookingId}/no-show`, auth);

// @traces 1259-FR-011
describe('what the reads say a no-show allows', () => {
  it('offers the no-show to the owner, the desk and the booking’s mechanic once the time has come', async () => {
    const { booking, volt } = await due({ job: 'to_do' });

    for (const auth of [owner(volt), desk(volt), fixer(volt)]) {
      expect(await rowBooking(auth, booking.requestId)).toMatchObject({
        canRecordNoShow: true,
        canWithdrawNoShow: false,
        noShowAt: null,
      });
    }
    expect(await jobSummary(fixer(volt), booking.id)).toMatchObject({
      canRecordNoShow: true,
      canWithdrawNoShow: false,
      noShowAt: null,
    });
  });

  it('does not offer it before the time, nor once the job has started', async () => {
    const early = await due({ minutes: 60 });
    const started = await due({ garage: 'Garaj Nordic', job: 'in_work' });

    expect(
      (await rowBooking(owner(early.volt), early.booking.requestId))
        .canRecordNoShow,
    ).toBe(false);
    expect(
      (await jobSummary(owner(started.volt), started.booking.id))
        .canRecordNoShow,
    ).toBe(false);
  });

  it('offers the withdrawal the same day, then shows the no-show only', async () => {
    const { booking, volt } = await due({ job: 'to_do' });
    expect((await recordNoShow(booking.id, owner(volt))).status).toBe(200);

    const row = await rowBooking(desk(volt), booking.requestId);
    expect(row).toMatchObject({
      canRecordNoShow: false,
      canWithdrawNoShow: true,
      status: 'no_show',
    });
    expect(Date.parse(row.noShowAt)).not.toBeNaN();
    expect(await jobSummary(fixer(volt), booking.id)).toMatchObject({
      canWithdrawNoShow: true,
      status: 'cancelled',
    });

    await prisma.booking.update({
      data: { noShowAt: new Date(Date.now() - DAY - 60_000) },
      where: { id: booking.id },
    });
    expect(await rowBooking(owner(volt), booking.requestId)).toMatchObject({
      canRecordNoShow: false,
      canWithdrawNoShow: false,
    });
    expect(await jobSummary(fixer(volt), booking.id)).toBeUndefined();
  });

  it('keeps yesterday’s booking with a no-show recorded today in the jobs while it may be withdrawn', async () => {
    const { booking, volt } = await due({ job: 'to_do', minutes: -26 * 60 });
    expect((await recordNoShow(booking.id, owner(volt))).status).toBe(200);

    expect(await jobSummary(fixer(volt), booking.id)).toMatchObject({
      canWithdrawNoShow: true,
      status: 'cancelled',
    });
  });

  it('never offers either to a mechanic who is not the booking’s', async () => {
    const { booking, volt } = await due({ job: 'to_do' });
    await prisma.mechanic.update({
      data: { canAnswerQuotes: true },
      where: { id: volt.plainMechanic.id },
    });
    const plain = bearer(volt.plain, 'mechanic');

    expect(await rowBooking(plain, booking.requestId)).toMatchObject({
      canRecordNoShow: false,
      canWithdrawNoShow: false,
    });
    await recordNoShow(booking.id, owner(volt));
    expect((await rowBooking(plain, booking.requestId)).canWithdrawNoShow).toBe(
      false,
    );
  });

  it('tells the driver when the no-show was recorded on their request', async () => {
    const { booking, volt } = await due();
    await recordNoShow(booking.id, owner(volt));

    const res = await get('/requests', bearer(booking.driverId, 'driver'));

    expect(res.status).toBe(200);
    const mine = res.body.items.find(
      (item: { id: string }) => item.id === booking.requestId,
    );
    expect(mine.closedReason).toBe('no_show');
    expect(Date.parse(mine.booking.noShowAt)).not.toBeNaN();
  });
});
