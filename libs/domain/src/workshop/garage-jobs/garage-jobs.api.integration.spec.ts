import { randomUUID } from 'node:crypto';

import { atLocal, localDay } from '../../bucharest';
import type { JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const PHONE = '+40722111222';
const HOUR = 3_600_000;

// Two jobs at one garage, one of them the plain mechanic's, and one at
// another garage.
async function setting() {
  const andrei = await world.account('Andrei Marin');
  await prisma.account.update({
    data: { phone: PHONE },
    where: { id: andrei },
  });
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const theirs = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'in_work',
    { createdAt: new Date(Date.now() - 600_000) },
  );
  const handJob = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'to_do',
    { mechanicId: dinamo.plainMechanic.id },
  );
  // The hand's job is booked a day before the other one.
  const handStart = new Date(Date.now() + 24 * HOUR);
  await prisma.booking.update({
    data: { startsAt: handStart },
    where: { id: handJob.bookingId },
  });
  const elsewhere = await world.job(
    (await world.chain(andrei, militari.garage.id)).booking.id,
  );
  return { andrei, dinamo, elsewhere, handJob, handStart, militari, theirs };
}

// @traces 220-FR-007
// @traces 220-FR-013
// @traces 424-FR-011
describe('GET /garage/jobs', () => {
  it.each([
    ['owner', 'garage'],
    ['receptionist', 'receptionist'],
  ] as const)(
    'gives the %s every job of the garage, by booking start',
    async (who, role) => {
      const s = await setting();

      const res = await get('/garage/jobs', bearer(s.dinamo[who], role));

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.nextCursor).toBeNull();
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
        s.handJob.id,
        s.theirs.id,
      ]);
      expect(res.body.items[0]).toEqual({
        bookingId: s.handJob.bookingId,
        car: {
          brand: 'Mini',
          engine: '2.0 turbo',
          fuel: 'petrol',
          model: 'Cooper S',
          plate: 'B123ABC',
          year: 2019,
        },
        createdAt: s.handJob.createdAt.toISOString(),
        driver: { shortName: 'Andrei M.' },
        etaAt: null,
        finishedAt: null,
        handedOverAt: null,
        id: s.handJob.id,
        jobs: [
          {
            id: expect.any(String),
            jobTypeId: expect.any(String),
            nameEn: 'Oil change',
            nameRo: 'Schimb ulei',
            position: 0,
          },
        ],
        mechanicId: s.dinamo.plainMechanic.id,
        mechanicName: 'Hand',
        pausedAt: null,
        startedAt: null,
        startsAt: s.handStart.toISOString(),
        status: 'to_do',
        stepsDone: 0,
        stepsTotal: 0,
      });
    },
  );

  it('gives a mechanic only their own jobs', async () => {
    const s = await setting();

    const hand = await get('/garage/jobs', bearer(s.dinamo.plain, 'mechanic'));
    const fixer = await get(
      '/garage/jobs',
      bearer(s.dinamo.answering, 'mechanic'),
    );

    expect(hand.body.items.map((i: { id: string }) => i.id)).toEqual([
      s.handJob.id,
    ]);
    expect(hand.body.total).toBe(1);
    expect(fixer.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('never shows the phone or the description', async () => {
    const s = await setting();

    const text = JSON.stringify(
      (await get('/garage/jobs', bearer(s.dinamo.owner, 'garage'))).body,
    );

    expect(text).not.toContain(PHONE);
    expect(text).not.toContain('Scârțâie');
  });

  it('answers 404 to a driver', async () => {
    const s = await setting();

    expect((await get('/garage/jobs', bearer(s.andrei, 'driver'))).status).toBe(
      404,
    );
  });

  it('answers 400 invalid_cursor to a job outside the caller’s scope', async () => {
    const s = await setting();

    for (const [cursor, auth] of [
      [s.elsewhere.id, bearer(s.dinamo.owner, 'garage')],
      [s.theirs.id, bearer(s.dinamo.plain, 'mechanic')],
    ] as const) {
      const res = await get(`/garage/jobs?cursor=${cursor}`, auth);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    }
  });
});

// @traces 220-FR-007
// @traces 220-FR-013
describe('GET /garage/jobs/:id', () => {
  it('gives the job with its steps and its stage history', async () => {
    const s = await setting();
    await prisma.jobStep.createMany({
      data: [
        { jobId: s.theirs.id, label: 'Schimb plăcuțe', position: 1 },
        {
          customerLabel: 'Verificare frâne',
          jobId: s.theirs.id,
          label: 'Diagnoză frâne',
          position: 0,
        },
      ],
    });
    const stage = await prisma.jobStageEntry.create({
      data: {
        actorId: s.dinamo.owner,
        actorRole: 'owner',
        fromStatus: 'to_do',
        jobId: s.theirs.id,
        text: 'Am început',
        toStatus: 'in_work',
      },
    });

    const res = await get(
      `/garage/jobs/${s.theirs.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      finalPriceBani: null,
      id: s.theirs.id,
      status: 'in_work',
    });
    expect(res.body.steps).toEqual([
      {
        customerLabel: 'Verificare frâne',
        doneAt: null,
        doneBy: null,
        id: expect.any(String),
        label: 'Diagnoză frâne',
        position: 0,
      },
      {
        customerLabel: null,
        doneAt: null,
        doneBy: null,
        id: expect.any(String),
        label: 'Schimb plăcuțe',
        position: 1,
      },
    ]);
    expect(res.body.stages).toEqual([
      {
        actorRole: 'owner',
        at: stage.at.toISOString(),
        fromStatus: 'to_do',
        id: stage.id,
        text: 'Am început',
        toStatus: 'in_work',
      },
    ]);
  });

  it('gives the mechanic their own job with its plate', async () => {
    const s = await setting();

    const res = await get(
      `/garage/jobs/${s.handJob.id}`,
      bearer(s.dinamo.plain, 'mechanic'),
    );

    expect(res.status).toBe(200);
    expect(res.body.car.plate).toBe('B123ABC');
  });

  // @traces 424-FR-002
  it('answers 403 to a mechanic of the garage whose job it is not', async () => {
    const s = await setting();

    const res = await get(
      `/garage/jobs/${s.theirs.id}`,
      bearer(s.dinamo.plain, 'mechanic'),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('answers 404 outside the caller’s garage', async () => {
    const s = await setting();

    for (const [id, auth] of [
      [s.elsewhere.id, bearer(s.dinamo.plain, 'mechanic')],
      [s.elsewhere.id, bearer(s.dinamo.owner, 'garage')],
      [s.theirs.id, bearer(s.militari.owner, 'garage')],
      [s.theirs.id, bearer(s.andrei, 'driver')],
      [randomUUID(), bearer(s.dinamo.owner, 'garage')],
    ] as const) {
      expect((await get(`/garage/jobs/${id}`, auth)).status).toBe(404);
    }
  });
});

// Jobs booked yesterday, today and tomorrow, and one still in work from
// last week; the clock stays the real one, so the days are relative to now.
// @traces 424-FR-011
// @traces 424-FR-012
describe('GET /garage/jobs, from a day', () => {
  async function week() {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await team('Atelier Dinamo');
    const booked = async (hours: number, status: JobStatus = 'to_do') => {
      const job = await world.job(
        (await world.chain(andrei, dinamo.garage.id)).booking.id,
        status,
        { mechanicId: dinamo.plainMechanic.id },
      );
      await prisma.booking.update({
        data: { startsAt: new Date(Date.now() + hours * HOUR) },
        where: { id: job.bookingId },
      });
      return job.id;
    };
    const today = localDay(new Date());
    const yesterday = await booked(-30);
    const lastWeek = await booked(-24 * 7, 'in_work');
    const pausedLastWeek = await booked(-24 * 6, 'paused');
    const tomorrow = await booked(30);
    // Today's, at noon in Bucharest when that is still ahead, else now.
    const noon = atLocal(today, 12);
    const todays = await world.job(
      (await world.chain(andrei, dinamo.garage.id)).booking.id,
    );
    await prisma.booking.update({
      data: { startsAt: noon },
      where: { id: todays.bookingId },
    });
    const owner = bearer(dinamo.owner, 'garage');
    return {
      ids: { lastWeek, pausedLastWeek, todays: todays.id, tomorrow, yesterday },
      owner,
      today,
    };
  }

  const ids = (body: { items: { id: string }[] }) =>
    body.items.map((i) => i.id);

  it('starts today in Bucharest and keeps the jobs still in work', async () => {
    const w = await week();

    const res = await get('/garage/jobs', w.owner);

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([
      w.ids.lastWeek,
      w.ids.pausedLastWeek,
      w.ids.todays,
      w.ids.tomorrow,
    ]);
    expect(res.body.total).toBe(4);
  });

  it('takes another first day', async () => {
    const w = await week();
    const before = localDay(new Date(Date.now() - 2 * 24 * HOUR));

    const res = await get(`/garage/jobs?from=${before}`, w.owner);

    expect(ids(res.body)).toContain(w.ids.yesterday);
    expect(ids(res.body)).toHaveLength(5);
  });

  it.each(['yesterday', '2026-13-01', '09-10-2026'])(
    'refuses the day %s',
    async (from) => {
      const w = await week();

      const res = await get(`/garage/jobs?from=${from}`, w.owner);

      expect(res.status).toBe(400);
    },
  );

  it('pages through the same order', async () => {
    const w = await week();

    const first = await get('/garage/jobs', w.owner);
    const cursor = first.body.items[1].id;
    const rest = await get(`/garage/jobs?cursor=${cursor}`, w.owner);

    expect(ids(rest.body)).toEqual([w.ids.todays, w.ids.tomorrow]);
  });

  it('counts the steps and the ticked ones', async () => {
    const w = await week();
    await prisma.jobStep.createMany({
      data: [1, 2, 3].map((position) => ({
        doneAt: position === 2 ? new Date() : null,
        jobId: w.ids.lastWeek,
        label: `Pas ${position}`,
        position,
      })),
    });

    const res = await get('/garage/jobs', w.owner);

    expect(res.body.items[0]).toMatchObject({
      id: w.ids.lastWeek,
      stepsDone: 1,
      stepsTotal: 3,
    });
    expect(res.body.items[1]).toMatchObject({ stepsDone: 0, stepsTotal: 0 });
  });
});
