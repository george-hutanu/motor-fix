import { randomUUID } from 'node:crypto';

import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const PHONE = '+40722111222';

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
  const elsewhere = await world.job(
    (await world.chain(andrei, militari.garage.id)).booking.id,
  );
  return { andrei, dinamo, elsewhere, handJob, militari, theirs };
}

// @traces 220-FR-007
// @traces 220-FR-013
describe('GET /garage/jobs', () => {
  it.each([
    ['owner', 'garage'],
    ['receptionist', 'receptionist'],
  ] as const)(
    'gives the %s every job of the garage, newest first',
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
        mechanicId: s.dinamo.plainMechanic.id,
        pausedAt: null,
        startedAt: null,
        status: 'to_do',
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
        id: expect.any(String),
        label: 'Diagnoză frâne',
        position: 0,
      },
      {
        customerLabel: null,
        doneAt: null,
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

  it('answers 404 outside the caller’s scope', async () => {
    const s = await setting();

    for (const [id, auth] of [
      [s.theirs.id, bearer(s.dinamo.plain, 'mechanic')],
      [s.elsewhere.id, bearer(s.dinamo.owner, 'garage')],
      [s.theirs.id, bearer(s.militari.owner, 'garage')],
      [s.theirs.id, bearer(s.andrei, 'driver')],
      [randomUUID(), bearer(s.dinamo.owner, 'garage')],
    ] as const) {
      expect((await get(`/garage/jobs/${id}`, auth)).status).toBe(404);
    }
  });
});
