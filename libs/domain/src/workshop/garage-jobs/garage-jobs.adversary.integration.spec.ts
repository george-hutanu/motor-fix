import { randomUUID } from 'node:crypto';

import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const PHONE = '+40722111222';
const PLATE = 'B123ABC';
const DESCRIPTION = 'Scârțâie la frânare';

async function setting() {
  const andrei = await world.account('Andrei Marin');
  await prisma.account.update({
    data: { phone: PHONE },
    where: { id: andrei },
  });
  const maria = await world.account('Maria Ionescu');
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const unassigned = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'to_do',
    { createdAt: new Date(Date.now() - 600_000) },
  );
  const fixerJob = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'in_work',
    { mechanicId: dinamo.answeringMechanic.id },
  );
  const handJob = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'to_do',
    {
      createdAt: new Date(Date.now() - 300_000),
      mechanicId: dinamo.plainMechanic.id,
    },
  );
  const elsewhere = await world.job(
    (await world.chain(andrei, militari.garage.id)).booking.id,
  );
  return {
    andrei,
    dinamo,
    elsewhere,
    fixerJob,
    handJob,
    maria,
    militari,
    unassigned,
  };
}

const writes = async () => ({
  activity: await prisma.activityLog.count(),
  outbox: await prisma.outboxEvent.count(),
});

const ids = (res: { body: { items: { id: string }[] } }) =>
  res.body.items.map((i) => i.id);

// @traces 220-FR-012
// @traces 220-FR-015
describe('GET /garage/jobs as each caller', () => {
  it('answers 401 sign_in_required to a visitor on the list and the detail', async () => {
    const s = await setting();

    for (const path of ['/garage/jobs', `/garage/jobs/${s.handJob.id}`]) {
      const res = await get(path);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    }
  });

  it.each([
    ['owner', 'garage'],
    ['receptionist', 'receptionist'],
  ] as const)(
    'gives the %s every job of the garage and none of another',
    async (who, role) => {
      const s = await setting();

      const list = await get('/garage/jobs', bearer(s.dinamo[who], role));

      expect(list.status).toBe(200);
      expect(list.body.total).toBe(3);
      expect(ids(list).sort()).toEqual(
        [s.unassigned.id, s.fixerJob.id, s.handJob.id].sort(),
      );
      const detail = await get(
        `/garage/jobs/${s.unassigned.id}`,
        bearer(s.dinamo[who], role),
      );
      expect(detail.status).toBe(200);
    },
  );

  it('gives a mechanic with the permission only their own job', async () => {
    const s = await setting();
    const auth = bearer(s.dinamo.answering, 'mechanic');

    const list = await get('/garage/jobs', auth);

    expect(ids(list)).toEqual([s.fixerJob.id]);
    expect(list.body.total).toBe(1);
    expect((await get(`/garage/jobs/${s.fixerJob.id}`, auth)).status).toBe(200);
    for (const other of [s.handJob, s.unassigned]) {
      expect((await get(`/garage/jobs/${other.id}`, auth)).status).toBe(403);
    }
    expect((await get(`/garage/jobs/${s.elsewhere.id}`, auth)).status).toBe(
      404,
    );
  });

  it('gives a mechanic without the permission their own job too', async () => {
    const s = await setting();
    const auth = bearer(s.dinamo.plain, 'mechanic');

    const list = await get('/garage/jobs', auth);

    expect(ids(list)).toEqual([s.handJob.id]);
    expect((await get(`/garage/jobs/${s.handJob.id}`, auth)).status).toBe(200);
    expect((await get(`/garage/jobs/${s.fixerJob.id}`, auth)).status).toBe(403);
  });

  // 424-FR-002 (Architecture decision A34) turned the 404 into a 403.
  // @traces 424-FR-002
  it('answers 403, and nothing of the job, to a mechanic reading another mechanic’s job', async () => {
    const s = await setting();

    const res = await get(
      `/garage/jobs/${s.handJob.id}`,
      bearer(s.dinamo.answering, 'mechanic'),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    expect(JSON.stringify(res.body)).not.toContain(s.handJob.id);
    expect(JSON.stringify(res.body)).not.toContain(PLATE);
  });

  it('lists nothing for a mechanic with no job', async () => {
    const s = await setting();
    const idle = await world.account('Idle Hand', ['mechanic']);
    await prisma.mechanic.create({
      data: { accountId: idle, garageId: s.dinamo.garage.id, name: 'Idle' },
    });

    const res = await get('/garage/jobs', bearer(idle, 'mechanic'));

    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('answers 404 to the owning driver and to another driver', async () => {
    const s = await setting();

    for (const driver of [s.andrei, s.maria]) {
      for (const path of ['/garage/jobs', `/garage/jobs/${s.handJob.id}`]) {
        const res = await get(path, bearer(driver, 'driver'));
        expect(res.status).toBe(404);
      }
    }
  });

  it('shows another garage’s owner their own jobs only and 404 on the first garage’s', async () => {
    const s = await setting();
    const auth = bearer(s.militari.owner, 'garage');

    const list = await get('/garage/jobs', auth);

    expect(ids(list)).toEqual([s.elsewhere.id]);
    expect(list.body.total).toBe(1);
    for (const job of [s.unassigned, s.fixerJob, s.handJob]) {
      expect((await get(`/garage/jobs/${job.id}`, auth)).status).toBe(404);
    }
  });

  it('answers another garage’s job exactly as a job that does not exist', async () => {
    const s = await setting();
    const auth = bearer(s.militari.owner, 'garage');

    const other = await get(`/garage/jobs/${s.handJob.id}`, auth);
    const none = await get(`/garage/jobs/${randomUUID()}`, auth);

    expect(other.status).toBe(none.status);
    expect(other.body.code).toBe(none.body.code);
    expect(Object.keys(other.body).sort()).toEqual(
      Object.keys(none.body).sort(),
    );
  });

  it('answers a role the account does not hold as the role it holds', async () => {
    const s = await setting();

    for (const [account, claimed, held] of [
      [s.andrei, 'garage', 'driver'],
      [s.andrei, 'receptionist', 'driver'],
      [s.andrei, 'mechanic', 'driver'],
      [s.dinamo.plain, 'garage', 'mechanic'],
      [s.dinamo.plain, 'receptionist', 'mechanic'],
      [s.dinamo.receptionist, 'garage', 'receptionist'],
      [s.dinamo.owner, 'mechanic', 'garage'],
    ] as const) {
      const res = await get('/garage/jobs', bearer(account, claimed));
      const own = await get('/garage/jobs', bearer(account, held));
      expect(res.status).toBe(own.status);
      expect(res.body).toEqual(own.body);
    }
  });

  it('does not show a mechanic of another garage the first garage’s job', async () => {
    const s = await setting();
    const auth = bearer(s.militari.plain, 'mechanic');

    expect((await get(`/garage/jobs/${s.handJob.id}`, auth)).status).toBe(404);
    expect((await get('/garage/jobs', auth)).body.total).toBe(0);
  });
});

// @traces 220-FR-014
describe('GET /garage/jobs cursor and query', () => {
  it('answers 400 invalid_cursor to a job of another garage', async () => {
    const s = await setting();

    const res = await get(
      `/garage/jobs?cursor=${s.elsewhere.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to a job of another mechanic', async () => {
    const s = await setting();

    const res = await get(
      `/garage/jobs?cursor=${s.handJob.id}`,
      bearer(s.dinamo.answering, 'mechanic'),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to an unknown id and to a booking, quote or request id', async () => {
    const s = await setting();
    const chain = await world.chain(s.andrei, s.dinamo.garage.id);

    for (const id of [
      randomUUID(),
      chain.booking.id,
      chain.quote.id,
      chain.request.id,
    ]) {
      const res = await get(
        `/garage/jobs?cursor=${id}`,
        bearer(s.dinamo.owner, 'garage'),
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    }
  });

  it.each([
    ['empty', 'cursor='],
    ['not an id', 'cursor=abc'],
    ['an array', `cursor[]=${randomUUID()}`],
    ['a repeated cursor', `cursor=${randomUUID()}&cursor=${randomUUID()}`],
    ['an extra parameter', 'limit=100'],
    [
      'an extra parameter next to a cursor',
      `cursor=${randomUUID()}&mechanicId=${randomUUID()}`,
    ],
  ])('answers 400 to a cursor that is %s', async (_title, query) => {
    const s = await setting();

    const res = await get(
      `/garage/jobs?${query}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(400);
    expect(res.body.items).toBeUndefined();
  });

  it('does not let a mechanicId parameter widen a mechanic’s list', async () => {
    const s = await setting();

    const res = await get(
      `/garage/jobs?mechanicId=${s.dinamo.plainMechanic.id}`,
      bearer(s.dinamo.answering, 'mechanic'),
    );

    expect(res.status).toBe(400);
  });

  // @traces 424-FR-011
  it('pages 20 at a time, by booking start, and the last page has no next cursor', async () => {
    const s = await setting();
    const startsAt = (minutes: number) =>
      new Date(Date.now() + 48 * 3_600_000 + minutes * 60_000);
    const mine: string[] = [];
    for (let i = 0; i < 20; i++) {
      const chain = await world.chain(s.andrei, s.militari.garage.id);
      await prisma.booking.update({
        data: { startsAt: startsAt(i) },
        where: { id: chain.booking.id },
      });
      mine.push((await world.job(chain.booking.id, 'to_do')).id);
    }
    await prisma.booking.update({
      data: { startsAt: startsAt(60) },
      where: { id: s.elsewhere.bookingId },
    });
    const auth = bearer(s.militari.owner, 'garage');

    const first = await get('/garage/jobs', auth);
    const again = await get('/garage/jobs', auth);
    const last = await get(
      `/garage/jobs?cursor=${first.body.nextCursor}`,
      auth,
    );

    expect(first.body.total).toBe(21);
    expect(first.body.items).toHaveLength(20);
    expect(ids(first)).toEqual(mine);
    expect(again.body).toEqual(first.body);
    expect(first.body.nextCursor).toBe(mine[19]);
    expect(ids(last)).toEqual([s.elsewhere.id]);
    expect(last.body.nextCursor).toBeNull();
  });

  it('has no next cursor at exactly the page size', async () => {
    const s = await setting();
    for (let i = 0; i < 19; i++) {
      const chain = await world.chain(s.andrei, s.militari.garage.id);
      await world.job(chain.booking.id);
    }

    const res = await get('/garage/jobs', bearer(s.militari.owner, 'garage'));

    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.total).toBe(20);
  });
});

// @traces 220-FR-012
describe('GET /garage/jobs/:id hostile ids', () => {
  it.each([
    ['not an id', 'not-an-id'],
    ['a number', '12345'],
    ['a uuid with a suffix', `${randomUUID()}x`],
    ['a traversal', '..%2F..%2Frequests'],
  ])('answers 400 to an id that is %s', async (_title, id) => {
    const s = await setting();

    const res = await get(
      `/garage/jobs/${id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(400);
  });

  it('answers 404 to a nil uuid, an unknown uuid and the id of a booking', async () => {
    const s = await setting();

    for (const id of [
      '00000000-0000-0000-0000-000000000000',
      randomUUID(),
      s.handJob.bookingId,
    ]) {
      const res = await get(
        `/garage/jobs/${id}`,
        bearer(s.dinamo.owner, 'garage'),
      );
      expect(res.status).toBe(404);
    }
  });
});

// @traces 220-FR-013
describe('GET /garage/jobs the driver’s private data', () => {
  it('names the driver as first name and initial with the plate and no phone for the owner and receptionist', async () => {
    const s = await setting();

    for (const [who, role] of [
      ['owner', 'garage'],
      ['receptionist', 'receptionist'],
    ] as const) {
      const auth = bearer(s.dinamo[who], role);
      const list = await get('/garage/jobs', auth);
      const detail = await get(`/garage/jobs/${s.handJob.id}`, auth);

      for (const item of [...list.body.items, detail.body]) {
        expect(item.driver).toEqual({ shortName: 'Andrei M.' });
        expect(item.car.plate).toBe(PLATE);
      }
      for (const text of [
        JSON.stringify(list.body),
        JSON.stringify(detail.body),
      ]) {
        expect(text).not.toContain(PHONE);
        expect(text).not.toContain(DESCRIPTION);
        expect(text).not.toContain('"phone"');
        expect(text).not.toContain('"description"');
        expect(text).not.toContain(s.andrei);
      }
    }
  });

  it('gives a mechanic the plate of their own job and never the phone or the description', async () => {
    const s = await setting();
    const auth = bearer(s.dinamo.answering, 'mechanic');

    const list = await get('/garage/jobs', auth);
    const detail = await get(`/garage/jobs/${s.fixerJob.id}`, auth);

    expect(list.body.items[0].car.plate).toBe(PLATE);
    expect(detail.body.car.plate).toBe(PLATE);
    for (const text of [
      JSON.stringify(list.body),
      JSON.stringify(detail.body),
    ]) {
      expect(text).not.toContain(PHONE);
      expect(text).not.toContain(DESCRIPTION);
    }
  });

  it('carries no plate for a car that has none', async () => {
    const s = await setting();
    const car = await world.car(s.andrei, null);
    const request = await world.request(s.andrei, {
      carId: car.id,
      status: 'booked',
    });
    const quote = await world.quote(request.id, s.dinamo.garage.id, 'accepted');
    const booking = await world.booking(quote.id, 'confirmed');
    const job = await world.job(booking.id);

    const res = await get(
      `/garage/jobs/${job.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body.car.plate ?? null).toBeNull();
  });

  it('carries no staff account id in the steps or the stage entries', async () => {
    const s = await setting();

    const res = await get(
      `/garage/jobs/${s.handJob.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );
    const text = JSON.stringify(res.body);

    expect(res.body.steps).toEqual([]);
    expect(res.body.stages).toEqual([]);
    for (const staff of [
      s.dinamo.owner,
      s.dinamo.receptionist,
      s.dinamo.answering,
      s.dinamo.plain,
    ]) {
      expect(text).not.toContain(staff);
    }
  });
});

// @traces 220-FR-012
describe('GET /garage/jobs writes nothing', () => {
  it('leaves the activity log and the outbox as they were', async () => {
    const s = await setting();
    const before = await writes();
    const rows = await prisma.job.findMany({ orderBy: { id: 'asc' } });

    await get('/garage/jobs', bearer(s.dinamo.owner, 'garage'));
    await get(
      `/garage/jobs/${s.handJob.id}`,
      bearer(s.dinamo.receptionist, 'receptionist'),
    );
    await get(
      `/garage/jobs/${s.handJob.id}`,
      bearer(s.dinamo.answering, 'mechanic'),
    );
    await get(
      `/garage/jobs/${s.handJob.id}`,
      bearer(s.militari.owner, 'garage'),
    );
    await get('/garage/jobs?cursor=abc', bearer(s.dinamo.owner, 'garage'));
    await get('/garage/jobs');

    expect(await writes()).toEqual(before);
    expect(await prisma.job.findMany({ orderBy: { id: 'asc' } })).toEqual(rows);
  });
});
