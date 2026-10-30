import type {
  BookingStatus,
  JobStatus,
  QuoteRequestStatus,
} from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, send, team, world } = quotesApp();
const { prisma } = world;

const HOUR = 3_600_000;

// The request's status that goes with a job's.
const REQUEST_OF: Record<JobStatus, QuoteRequestStatus> = {
  cancelled: 'booked',
  done: 'done',
  in_work: 'in_work',
  paused: 'in_work',
  to_do: 'booked',
};

// A job of the plain mechanic at Atelier Dinamo, and a second garage.
async function setting(
  status: JobStatus = 'done',
  booking: BookingStatus = 'confirmed',
) {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const chain = await world.chain(andrei, dinamo.garage.id, {
    booking,
    request: REQUEST_OF[status],
  });
  const created = await world.job(chain.booking.id, status);
  const job = await prisma.job.update({
    data: { mechanicId: dinamo.plainMechanic.id, receivedAt: new Date() },
    where: { id: created.id },
  });
  return {
    andrei,
    bookingId: chain.booking.id,
    desk: bearer(dinamo.receptionist, 'receptionist'),
    dinamo,
    hand: bearer(dinamo.plain, 'mechanic'),
    job,
    other: bearer(dinamo.answering, 'mechanic'),
    owner: bearer(dinamo.owner, 'garage'),
    requestId: chain.request.id,
    stranger: bearer(militari.owner, 'garage'),
  };
}

type Setting = Awaited<ReturnType<typeof setting>>;

const handover = (jobId: string, auth: string, body: object) =>
  send('post', `/garage/jobs/${jobId}/handover`, auth, body);

const correct = (jobId: string, auth: string, body: object) =>
  send('patch', `/garage/jobs/${jobId}/final-price`, auth, body);

const reread = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

const bookingOf = (s: Setting) =>
  prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } });

const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({ orderBy: { id: 'asc' }, where: { subjectId } });

const audits = (jobId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId: jobId },
  });

// What a refused call must leave as it found.
async function snapshot(s: Setting) {
  const job = await reread(s.job.id);
  const booking = await bookingOf(s);
  return {
    audits: (await audits(s.job.id)).length,
    booking: [booking.status, booking.completedAt],
    bookingEvents: (await events(s.bookingId)).length,
    events: (await events(s.job.id)).length,
    job: [
      job.finalPriceBani,
      job.handedOverAt,
      job.finalPriceRecordedById,
      job.finalPriceCorrectedAt,
    ],
  };
}

// A job handed over at the given price, `hoursAgo` hours back.
async function handedOver(s: Setting, price = 125_000, hoursAgo = 0) {
  const res = await handover(s.job.id, s.owner, { finalPriceBani: price });
  expect(res.status).toBe(200);
  if (hoursAgo > 0) {
    await prisma.job.update({
      data: { handedOverAt: new Date(Date.now() - hoursAgo * HOUR) },
      where: { id: s.job.id },
    });
  }
}

const flag = (s: Setting, canRecordFinalPrice: boolean) =>
  prisma.mechanic.update({
    data: { canRecordFinalPrice },
    where: { id: s.dinamo.plainMechanic.id },
  });

// @traces 406-FR-001 406-FR-002 406-FR-003 406-FR-011
describe('recording the final price at handover', () => {
  it.each([
    ['owner', 'owner'],
    ['receptionist', 'desk'],
  ] as const)(
    'lets the %s record it, completing the booking',
    async (_, who) => {
      const s = await setting();
      const actor = who === 'owner' ? s.dinamo.owner : s.dinamo.receptionist;

      const res = await handover(s.job.id, s[who], { finalPriceBani: 115_000 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        finalPriceBani: 115_000,
        handedOverAt: expect.any(String),
        id: s.job.id,
        status: 'done',
      });
      expect(await reread(s.job.id)).toMatchObject({
        finalPriceBani: 115_000,
        finalPriceCorrectedAt: null,
        finalPriceRecordedById: actor,
        handedOverAt: expect.any(Date),
        status: 'done',
      });
      expect(await bookingOf(s)).toMatchObject({
        completedAt: expect.any(Date),
        status: 'completed',
      });
      expect(
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: s.requestId },
        }),
      ).toMatchObject({ status: 'done' });
      expect(await audits(s.job.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorId: actor,
            field: 'final_price_bani',
            newValue: 115_000,
            oldValue: null,
          }),
          expect.objectContaining({
            actorId: actor,
            field: 'handed_over_at',
            newValue: expect.any(String),
            oldValue: null,
          }),
        ]),
      );
      expect(await events(s.job.id)).toEqual([
        expect.objectContaining({
          kind: 'job.handed_over',
          payload: { by: actor, finalPriceBani: 115_000 },
        }),
      ]);
      expect(await events(s.bookingId)).toEqual([
        expect.objectContaining({ kind: 'booking.completed' }),
      ]);
    },
  );

  it('leaves a booking already completed as it is', async () => {
    const s = await setting('done', 'completed');
    const { completedAt } = await bookingOf(s);

    const res = await handover(s.job.id, s.owner, { finalPriceBani: 90_000 });

    expect(res.status).toBe(200);
    expect(await bookingOf(s)).toMatchObject({
      completedAt,
      status: 'completed',
    });
    expect(await events(s.bookingId)).toEqual([]);
    expect(await reread(s.job.id)).toMatchObject({ finalPriceBani: 90_000 });
  });

  it.each([[true], [false]])(
    'refuses the job’s mechanic whose final-price flag is %s',
    async (on) => {
      const s = await setting();
      await flag(s, on);
      const before = await snapshot(s);

      const res = await handover(s.job.id, s.hand, { finalPriceBani: 1 });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'forbidden' });
      expect(await snapshot(s)).toEqual(before);
    },
  );

  it('refuses another mechanic and hides the job from another garage', async () => {
    const s = await setting();
    const before = await snapshot(s);

    const other = await handover(s.job.id, s.other, { finalPriceBani: 1 });
    const stranger = await handover(s.job.id, s.stranger, {
      finalPriceBani: 1,
    });

    expect(other.status).toBe(403);
    expect(other.body).toMatchObject({ code: 'forbidden' });
    expect(stranger.status).toBe(404);
    expect(await snapshot(s)).toEqual(before);
  });

  it.each([['to_do'], ['in_work'], ['paused'], ['cancelled']] as const)(
    'refuses a %s job, writing nothing',
    async (status) => {
      const s = await setting(status);
      const before = await snapshot(s);

      const res = await handover(s.job.id, s.owner, { finalPriceBani: 1 });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'job_not_done',
        message: 'Marchează întâi lucrarea ca gata',
      });
      expect(await snapshot(s)).toEqual(before);
    },
  );

  it('refuses a second handover, naming the price recorded', async () => {
    const s = await setting();
    await handedOver(s, 115_000);
    const before = await snapshot(s);

    const res = await handover(s.job.id, s.desk, { finalPriceBani: 120_000 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'already_handed_over',
      finalPriceBani: 115_000,
    });
    expect(await snapshot(s)).toEqual(before);
  });

  it.each([['cancelled'], ['lapsed']] as const)(
    'refuses a done job whose booking is %s, writing nothing',
    async (booking) => {
      const s = await setting('done', booking);
      const before = await snapshot(s);

      const res = await handover(s.job.id, s.owner, { finalPriceBani: 1 });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'invalid_transition' });
      expect(await snapshot(s)).toEqual(before);
    },
  );

  it.each([[0], [-1], [1.5], [100_000_001], ['115000'], [null]])(
    'refuses the price %j, writing nothing',
    async (finalPriceBani) => {
      const s = await setting();
      const before = await snapshot(s);

      const res = await handover(s.job.id, s.owner, { finalPriceBani });

      expect(res.status).toBe(400);
      expect(await snapshot(s)).toEqual(before);
    },
  );

  it('refuses a body without a price, or with another field', async () => {
    const s = await setting();
    const before = await snapshot(s);

    const empty = await handover(s.job.id, s.owner, {});
    const extra = await handover(s.job.id, s.owner, {
      finalPriceBani: 1,
      note: 'x',
    });

    expect(empty.status).toBe(400);
    expect(extra.status).toBe(400);
    expect(await snapshot(s)).toEqual(before);
  });

  it('takes the highest price allowed', async () => {
    const s = await setting();

    const res = await handover(s.job.id, s.owner, {
      finalPriceBani: 100_000_000,
    });

    expect(res.status).toBe(200);
  });

  it('records one of two simultaneous handovers', async () => {
    const s = await setting();

    const answers = await Promise.all([
      handover(s.job.id, s.owner, { finalPriceBani: 100_000 }),
      handover(s.job.id, s.desk, { finalPriceBani: 110_000 }),
    ]);

    const statuses = answers.map((a) => a.status).sort();
    expect(statuses).toEqual([200, 409]);
    const refused = answers.find((a) => a.status === 409);
    const recorded = await reread(s.job.id);
    expect(refused?.body).toMatchObject({
      code: 'already_handed_over',
      finalPriceBani: recorded.finalPriceBani,
    });
    expect(await events(s.job.id)).toHaveLength(1);
    expect(await events(s.bookingId)).toHaveLength(1);
  });

  it('checks the garage, then the role, then the stage, then the booking', async () => {
    const s = await setting('to_do', 'cancelled');

    // Another garage: hidden whatever else is wrong.
    expect(
      (await handover(s.job.id, s.stranger, { finalPriceBani: 1 })).status,
    ).toBe(404);
    // A mechanic: refused before the stage is read.
    expect(
      (await handover(s.job.id, s.hand, { finalPriceBani: 1 })).body,
    ).toMatchObject({ code: 'forbidden' });
    // The stage before the booking.
    expect(
      (await handover(s.job.id, s.owner, { finalPriceBani: 1 })).body,
    ).toMatchObject({ code: 'job_not_done' });
  });

  it('refuses a handed-over job before reading its booking', async () => {
    const s = await setting();
    await handedOver(s);
    await prisma.booking.update({
      data: {
        cancelledAt: new Date(),
        cancelledBySide: 'driver',
        cancelReason: 'plans_changed',
        completedAt: null,
        status: 'cancelled',
      },
      where: { id: s.bookingId },
    });

    const res = await handover(s.job.id, s.owner, { finalPriceBani: 1 });

    expect(res.body).toMatchObject({ code: 'already_handed_over' });
  });
});

// @traces 406-FR-005 406-FR-006 406-FR-011
describe('correcting the final price', () => {
  it.each([
    ['owner', 'owner'],
    ['receptionist', 'desk'],
  ] as const)('lets the %s correct it within 48 hours', async (_, who) => {
    const s = await setting();
    await handedOver(s, 125_000, 20);
    const actor = who === 'owner' ? s.dinamo.owner : s.dinamo.receptionist;
    // The audit names the owner's garage role.
    const role = who === 'owner' ? 'owner' : 'receptionist';
    const handed = (await reread(s.job.id)).handedOverAt;

    const res = await correct(s.job.id, s[who], { finalPriceBani: 115_000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ finalPriceBani: 115_000, id: s.job.id });
    expect(await reread(s.job.id)).toMatchObject({
      finalPriceBani: 115_000,
      finalPriceCorrectedAt: expect.any(Date),
      finalPriceRecordedById: s.dinamo.owner,
      handedOverAt: handed,
    });
    expect((await audits(s.job.id)).at(-1)).toMatchObject({
      actorId: actor,
      actorRole: role,
      field: 'final_price_bani',
      newValue: 115_000,
      oldValue: 125_000,
    });
    expect((await events(s.job.id)).at(-1)).toMatchObject({
      kind: 'job.final_price_corrected',
      payload: { by: actor, newBani: 115_000, oldBani: 125_000 },
    });
  });

  it('keeps every correction in the window, each with its own record', async () => {
    const s = await setting();
    await handedOver(s, 125_000, 2);

    await correct(s.job.id, s.owner, { finalPriceBani: 115_000 });
    const res = await correct(s.job.id, s.desk, { finalPriceBani: 118_000 });

    expect(res.status).toBe(200);
    expect(
      (await audits(s.job.id))
        .filter((a) => a.field === 'final_price_bani')
        .map((a) => [a.oldValue, a.newValue]),
    ).toEqual([
      [null, 125_000],
      [125_000, 115_000],
      [115_000, 118_000],
    ]);
    expect(
      (await events(s.job.id))
        .filter((e) => e.kind === 'job.final_price_corrected')
        .map((e) => e.payload),
    ).toEqual([
      { by: s.dinamo.owner, newBani: 115_000, oldBani: 125_000 },
      { by: s.dinamo.receptionist, newBani: 118_000, oldBani: 115_000 },
    ]);
  });

  it('answers the same price without writing anything', async () => {
    const s = await setting();
    await handedOver(s, 125_000, 1);
    const before = await snapshot(s);

    const res = await correct(s.job.id, s.owner, { finalPriceBani: 125_000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ finalPriceBani: 125_000 });
    expect(await snapshot(s)).toEqual(before);
  });

  it.each([[true], [false]])(
    'refuses the job’s mechanic whose final-price flag is %s',
    async (on) => {
      const s = await setting();
      await handedOver(s);
      await flag(s, on);
      const before = await snapshot(s);

      const res = await correct(s.job.id, s.hand, { finalPriceBani: 1 });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'forbidden' });
      expect(await snapshot(s)).toEqual(before);
    },
  );

  it('hides the job from another garage', async () => {
    const s = await setting();
    await handedOver(s);
    const before = await snapshot(s);

    const res = await correct(s.job.id, s.stranger, { finalPriceBani: 1 });

    expect(res.status).toBe(404);
    expect(await snapshot(s)).toEqual(before);
  });

  it.each([[125_000], [99_000]])(
    'refuses a price of %d before the handover',
    async (finalPriceBani) => {
      const s = await setting();
      const before = await snapshot(s);

      const res = await correct(s.job.id, s.owner, { finalPriceBani });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'not_handed_over' });
      expect(await snapshot(s)).toEqual(before);
    },
  );

  it.each([
    [48, 115_000],
    [49, 115_000],
    [49, 125_000],
  ])(
    'refuses a correction %d hours after the handover (price %d)',
    async (hours, finalPriceBani) => {
      const s = await setting();
      await handedOver(s, 125_000, hours);
      const before = await snapshot(s);

      const res = await correct(s.job.id, s.owner, { finalPriceBani });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'correction_window_closed',
        message: 'Prețul final nu mai poate fi corectat',
      });
      expect(await snapshot(s)).toEqual(before);
    },
  );

  it.each([[0], [-1], [1.5], [100_000_001], [null]])(
    'refuses the price %j, writing nothing',
    async (finalPriceBani) => {
      const s = await setting();
      await handedOver(s);
      const before = await snapshot(s);

      const res = await correct(s.job.id, s.owner, { finalPriceBani });

      expect(res.status).toBe(400);
      expect(await snapshot(s)).toEqual(before);
    },
  );
});
