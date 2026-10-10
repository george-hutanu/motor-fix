import { randomUUID } from 'node:crypto';

import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const PHONE = '+40722111222';

async function setting() {
  const andrei = await world.account('Andrei Marin');
  await prisma.account.update({
    data: { phone: PHONE },
    where: { id: andrei },
  });
  const maria = await world.account('Maria Ionescu');
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const mine = await world.chain(andrei, dinamo.garage.id);
  const hers = await world.request(maria);
  return { andrei, dinamo, hers, maria, militari, mine };
}

const writes = async () => ({
  activity: await prisma.activityLog.count(),
  outbox: await prisma.outboxEvent.count(),
});

// @traces 220-FR-012
// @traces 220-FR-015
describe('GET /requests as each caller', () => {
  it('answers 401 sign_in_required to a visitor on the list and the detail', async () => {
    const s = await setting();

    for (const path of ['/requests', `/requests/${s.mine.request.id}`]) {
      const res = await get(path);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    }
  });

  it('answers 401 to a token that is not a token', async () => {
    const res = await get('/requests', 'Bearer not.a.token');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 404 never 403 to every caller that is not a driver', async () => {
    const s = await setting();
    const callers = [
      bearer(s.dinamo.owner, 'garage'),
      bearer(s.dinamo.receptionist, 'receptionist'),
      bearer(s.dinamo.answering, 'mechanic'),
      bearer(s.dinamo.plain, 'mechanic'),
      bearer(s.militari.owner, 'garage'),
    ];

    for (const auth of callers) {
      for (const path of ['/requests', `/requests/${s.mine.request.id}`]) {
        const res = await get(path, auth);
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain(s.mine.request.id);
      }
    }
  });

  it('answers 404 to another driver and lists only their own', async () => {
    const s = await setting();

    const detail = await get(
      `/requests/${s.mine.request.id}`,
      bearer(s.maria, 'driver'),
    );
    const list = await get('/requests', bearer(s.maria, 'driver'));

    expect(detail.status).toBe(404);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([
      s.hers.id,
    ]);
  });

  it('does not accept a role the account does not hold', async () => {
    const s = await setting();

    const res = await get('/requests', bearer(s.dinamo.owner, 'driver'));

    expect([401, 404]).toContain(res.status);
    expect(res.body.items).toBeUndefined();
  });

  it('does not accept a driver token naming the garage role', async () => {
    const s = await setting();

    const res = await get('/garage/requests', bearer(s.andrei, 'garage'));

    expect([401, 404]).toContain(res.status);
    expect(res.body.items).toBeUndefined();
  });
});

// @traces 220-FR-014
describe('GET /requests cursor and query', () => {
  it('answers 400 invalid_cursor to the id of a request of a garage-side scope', async () => {
    const s = await setting();

    const res = await get(
      `/requests?cursor=${s.hers.id}`,
      bearer(s.andrei, 'driver'),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to a well-formed id that is no request', async () => {
    const s = await setting();

    const res = await get(
      `/requests?cursor=${randomUUID()}`,
      bearer(s.andrei, 'driver'),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to a job id or a quote id as the cursor', async () => {
    const s = await setting();
    const job = await world.job(s.mine.booking.id);

    for (const id of [job.id, s.mine.quote.id, s.mine.booking.id]) {
      const res = await get(
        `/requests?cursor=${id}`,
        bearer(s.andrei, 'driver'),
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    }
  });

  it.each([
    ['empty', 'cursor='],
    ['not an id', 'cursor=abc'],
    ['an id with a suffix', `cursor=${randomUUID()}x`],
    ['an id in a quote', `cursor=%22${randomUUID()}%22`],
    ['a sql fragment', "cursor=1'%20OR%20'1'='1"],
    ['an array', `cursor[]=${randomUUID()}`],
    ['a repeated cursor', `cursor=${randomUUID()}&cursor=${randomUUID()}`],
    ['an extra parameter', 'limit=100'],
    ['an extra parameter next to a cursor', `cursor=${randomUUID()}&page=2`],
  ])('answers 400 to a cursor that is %s', async (_title, query) => {
    const s = await setting();

    const res = await get(`/requests?${query}`, bearer(s.andrei, 'driver'));

    expect(res.status).toBe(400);
    expect(res.body.items).toBeUndefined();
  });

  it('answers 400 naming the cursor field', async () => {
    const s = await setting();

    const res = await get('/requests?cursor=abc', bearer(s.andrei, 'driver'));

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual([expect.stringContaining('cursor')]);
  });

  it('answers the same page twice and the last page has no next cursor', async () => {
    const andrei = await world.account('Andrei Marin');
    for (let i = 0; i < 21; i++) {
      await world.request(andrei, {
        createdAt: new Date(Date.now() - i * 1000),
      });
    }

    const a = await get('/requests', bearer(andrei, 'driver'));
    const b = await get('/requests', bearer(andrei, 'driver'));
    const last = await get(
      `/requests?cursor=${a.body.nextCursor}`,
      bearer(andrei, 'driver'),
    );

    expect(a.body.items).toHaveLength(20);
    expect(b.body).toEqual(a.body);
    expect(last.body.items).toHaveLength(1);
    expect(last.body.nextCursor).toBeNull();
  });

  it('lists nothing for a driver with no request', async () => {
    const andrei = await world.account('Andrei Marin');

    const res = await get('/requests', bearer(andrei, 'driver'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('exactly at the page size has no next cursor', async () => {
    const andrei = await world.account('Andrei Marin');
    for (let i = 0; i < 20; i++) {
      await world.request(andrei, {
        createdAt: new Date(Date.now() - i * 1000),
      });
    }

    const res = await get('/requests', bearer(andrei, 'driver'));

    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.total).toBe(20);
  });
});

// @traces 220-FR-012
// @traces 220-FR-013
describe('GET /requests/:id hostile ids', () => {
  it.each([
    ['not an id', 'not-an-id'],
    ['a number', '12345'],
    ['a uuid with a suffix', `${randomUUID()}x`],
    ['an encoded space', '%20'],
    ['a traversal', '..%2F..%2Fgarage'],
  ])('answers 400 to an id that is %s', async (_title, id) => {
    const s = await setting();

    const res = await get(`/requests/${id}`, bearer(s.andrei, 'driver'));

    expect(res.status).toBe(400);
  });

  it('answers 404 to a nil uuid and to an unknown uuid', async () => {
    const s = await setting();

    for (const id of ['00000000-0000-0000-0000-000000000000', randomUUID()]) {
      const res = await get(`/requests/${id}`, bearer(s.andrei, 'driver'));
      expect(res.status).toBe(404);
    }
  });

  it('answers a request that belongs to another driver exactly as one that does not exist', async () => {
    const s = await setting();

    const theirs = await get(
      `/requests/${s.hers.id}`,
      bearer(s.andrei, 'driver'),
    );
    const none = await get(
      `/requests/${randomUUID()}`,
      bearer(s.andrei, 'driver'),
    );

    expect(theirs.status).toBe(none.status);
    expect(Object.keys(theirs.body).sort()).toEqual(
      Object.keys(none.body).sort(),
    );
    expect(theirs.body.code).toBe(none.body.code);
  });

  it('answers 404 to an id of a quote, booking or job in place of a request', async () => {
    const s = await setting();
    const job = await world.job(s.mine.booking.id);

    for (const id of [s.mine.quote.id, s.mine.booking.id, job.id]) {
      const res = await get(`/requests/${id}`, bearer(s.andrei, 'driver'));
      expect(res.status).toBe(404);
    }
  });

  it('ignores extra query parameters on the detail or refuses them', async () => {
    const s = await setting();

    const res = await get(
      `/requests/${s.mine.request.id}?cursor=${randomUUID()}`,
      bearer(s.andrei, 'driver'),
    );

    expect([200, 400]).toContain(res.status);
  });
});

// @traces 220-FR-013
describe('GET /requests/:id leaks nothing of others', () => {
  it('carries no phone, plate, staff account id or decline reason', async () => {
    const s = await setting();
    const request = await world.request(s.andrei);
    await world.recipient(
      request.id,
      s.dinamo.garage.id,
      'declined',
      s.dinamo.owner,
    );
    await world.recipient(
      request.id,
      s.militari.garage.id,
      'declined',
      s.militari.receptionist,
    );
    const car = await prisma.car.findUniqueOrThrow({
      where: { id: request.carId },
    });

    const res = await get(
      `/requests/${request.id}`,
      bearer(s.andrei, 'driver'),
    );
    const text = JSON.stringify(res.body);

    expect(res.status).toBe(200);
    expect(res.body.recipients).toHaveLength(2);
    for (const secret of [
      s.dinamo.owner,
      s.dinamo.receptionist,
      s.dinamo.answering,
      s.dinamo.plain,
      s.militari.receptionist,
      // A decline under 5 minutes old reads as waiting.
      'fully_booked',
      'declinedBy',
      'declinedAt',
      car.plate ?? 'B123ABC',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('carries no staff account id or mechanic on a confirmed booking', async () => {
    const s = await setting();
    await prisma.booking.update({
      data: {
        confirmedBy: s.dinamo.receptionist,
        mechanicId: s.dinamo.answeringMechanic.id,
      },
      where: { id: s.mine.booking.id },
    });

    const res = await get(
      `/requests/${s.mine.request.id}`,
      bearer(s.andrei, 'driver'),
    );
    const text = JSON.stringify(res.body);

    expect(res.status).toBe(200);
    expect(text).not.toContain(s.dinamo.receptionist);
    expect(text).not.toContain(s.dinamo.answeringMechanic.id);
    expect(res.body.booking).not.toHaveProperty('confirmedBy');
    expect(res.body.booking).not.toHaveProperty('mechanicId');
  });

  it('never carries the driver phone back to the driver as a recipient field', async () => {
    const s = await setting();

    const res = await get(
      `/requests/${s.mine.request.id}`,
      bearer(s.andrei, 'driver'),
    );

    expect(JSON.stringify(res.body.recipients)).not.toContain(PHONE);
    expect(JSON.stringify(res.body.quotes)).not.toContain(PHONE);
  });

  it('keeps another driver’s request out of the list even when it shares a garage', async () => {
    const s = await setting();
    await world.recipient(s.hers.id, s.dinamo.garage.id);

    const res = await get('/requests', bearer(s.andrei, 'driver'));

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      s.mine.request.id,
    ]);
    expect(JSON.stringify(res.body)).not.toContain(s.hers.id);
  });
});

// @traces 220-FR-012
describe('GET /requests writes nothing', () => {
  it('leaves the activity log and the outbox as they were', async () => {
    const s = await setting();
    const before = await writes();
    const rows = await prisma.quoteRequest.findMany({ orderBy: { id: 'asc' } });

    await get('/requests', bearer(s.andrei, 'driver'));
    await get(`/requests/${s.mine.request.id}`, bearer(s.andrei, 'driver'));
    await get(`/requests/${s.hers.id}`, bearer(s.andrei, 'driver'));
    await get('/requests?cursor=abc', bearer(s.andrei, 'driver'));
    await get('/requests');

    expect(await writes()).toEqual(before);
    expect(
      await prisma.quoteRequest.findMany({ orderBy: { id: 'asc' } }),
    ).toEqual(rows);
  });
});
