import { randomUUID } from 'node:crypto';

import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const car = {
  brand: 'Mini',
  engine: '2.0 turbo',
  fuel: 'petrol',
  model: 'Cooper S',
  year: 2019,
};

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

// @traces 220-FR-012
// @traces 220-FR-014
describe('GET /requests', () => {
  it('answers 401 sign_in_required without a token', async () => {
    const res = await get('/requests');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('lists the driver’s own requests, newest first, with their count', async () => {
    const andrei = await world.account('Andrei Marin');
    const maria = await world.account('Maria Ionescu');
    const older = await world.request(andrei, { createdAt: minutesAgo(10) });
    const newer = await world.request(andrei, {
      createdAt: minutesAgo(1),
      status: 'closed',
    });
    await world.request(maria);
    const { garage } = await team('Atelier Dinamo');
    await world.quote(older.id, garage.id);

    const res = await get('/requests', bearer(andrei, 'driver'));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      newer.id,
      older.id,
    ]);
    const [closed, open] = res.body.items;
    expect(closed).toMatchObject({
      closedReason: 'cancelled',
      quotesCount: 0,
      status: 'closed',
    });
    expect(open).toEqual({
      car,
      closedAt: null,
      closedReason: null,
      createdAt: older.createdAt.toISOString(),
      expiresAt: older.expiresAt.toISOString(),
      id: older.id,
      jobs: [
        {
          id: expect.any(String),
          jobTypeId: expect.any(String),
          nameEn: 'Oil change',
          nameRo: 'Schimb ulei',
          position: 0,
        },
      ],
      quotesCount: 1,
      status: 'sent',
    });
  });

  it('pages 20 at a time and carries on from the cursor', async () => {
    const andrei = await world.account('Andrei Marin');
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) {
      ids.push(
        (await world.request(andrei, { createdAt: minutesAgo(100 - i) })).id,
      );
    }
    const newestFirst = [...ids].reverse();

    const first = await get('/requests', bearer(andrei, 'driver'));
    const second = await get(
      `/requests?cursor=${first.body.nextCursor}`,
      bearer(andrei, 'driver'),
    );

    expect(first.body.items.map((i: { id: string }) => i.id)).toEqual(
      newestFirst.slice(0, 20),
    );
    expect(first.body.nextCursor).toBe(newestFirst[19]);
    expect(first.body.total).toBe(23);
    expect(second.body.items.map((i: { id: string }) => i.id)).toEqual(
      newestFirst.slice(20),
    );
    expect(second.body.nextCursor).toBeNull();
    expect(second.body.total).toBe(23);
  });

  it('orders requests made in the same instant by id', async () => {
    const andrei = await world.account('Andrei Marin');
    const at = minutesAgo(5);
    const a = await world.request(andrei, { createdAt: at });
    const b = await world.request(andrei, { createdAt: at });

    const res = await get('/requests', bearer(andrei, 'driver'));

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(
      [a.id, b.id].sort().reverse(),
    );
  });

  it('answers 400 invalid_cursor to another driver’s request as cursor', async () => {
    const andrei = await world.account('Andrei Marin');
    const maria = await world.account('Maria Ionescu');
    await world.request(andrei);
    const hers = await world.request(maria);

    const res = await get(
      `/requests?cursor=${hers.id}`,
      bearer(andrei, 'driver'),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 to a cursor that is not an id', async () => {
    const andrei = await world.account('Andrei Marin');

    const res = await get('/requests?cursor=abc', bearer(andrei, 'driver'));

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('cursor');
  });

  it('answers 404 to a garage owner', async () => {
    const { owner } = await team('Atelier Dinamo');

    expect((await get('/requests', bearer(owner, 'garage'))).status).toBe(404);
  });
});

// @traces 220-FR-012
// @traces 220-FR-015
describe('GET /requests/:id', () => {
  it('gives the driver the request with its recipients, quotes and booking', async () => {
    const andrei = await world.account('Andrei Marin');
    const { garage } = await team('Atelier Dinamo');
    const { booking, quote, request } = await world.chain(andrei, garage.id);

    const res = await get(`/requests/${request.id}`, bearer(andrei, 'driver'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      car,
      description: 'Scârțâie la frânare',
      id: request.id,
      quotesCount: 1,
      status: 'booked',
    });
    const garageRef = { id: garage.id, name: garage.name, slug: garage.slug };
    expect(res.body.recipients).toEqual([
      {
        answeredAt: null,
        createdAt: expect.any(String),
        garage: garageRef,
        id: expect.any(String),
        status: 'quoted',
      },
    ]);
    expect(res.body.quotes).toEqual([
      {
        acceptedAt: quote.acceptedAt?.toISOString(),
        changedAt: null,
        durationMinutes: 90,
        expiresAt: quote.expiresAt.toISOString(),
        fromBani: 45_000,
        garage: garageRef,
        id: quote.id,
        jobs: [],
        note: null,
        sentAt: quote.sentAt.toISOString(),
        slot: quote.slot.toISOString(),
        status: 'accepted',
        toBani: 60_000,
        withdrawnAt: null,
      },
    ]);
    expect(res.body.booking).toEqual({
      cancelledAt: null,
      cancelledBySide: null,
      cancelReason: null,
      completedAt: null,
      confirmBy: booking.confirmBy.toISOString(),
      confirmedAt: booking.confirmedAt?.toISOString(),
      createdAt: booking.createdAt.toISOString(),
      durationMinutes: 90,
      garage: garageRef,
      id: booking.id,
      noShowAt: null,
      quoteId: quote.id,
      startsAt: booking.startsAt.toISOString(),
      status: 'confirmed',
    });
  });

  it('shows no decline reason on a recipient that declined', async () => {
    const andrei = await world.account('Andrei Marin');
    const { garage, owner } = await team('Atelier Dinamo');
    const request = await world.request(andrei);
    await world.recipient(request.id, garage.id, 'declined', owner);

    const res = await get(`/requests/${request.id}`, bearer(andrei, 'driver'));

    expect(res.body.recipients).toEqual([
      expect.objectContaining({ status: 'declined' }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('fully_booked');
    expect(JSON.stringify(res.body)).not.toContain(owner);
    expect(res.body.booking).toBeNull();
  });

  it('answers 404 to another driver and to an id that does not exist', async () => {
    const andrei = await world.account('Andrei Marin');
    const maria = await world.account('Maria Ionescu');
    const hers = await world.request(maria);

    for (const id of [hers.id, randomUUID()]) {
      const res = await get(`/requests/${id}`, bearer(andrei, 'driver'));
      expect(res.status).toBe(404);
    }
    expect(await prisma.quoteRequest.count()).toBe(1);
  });

  it('answers 400 to an id that is not a uuid', async () => {
    const andrei = await world.account('Andrei Marin');

    expect(
      (await get('/requests/not-an-id', bearer(andrei, 'driver'))).status,
    ).toBe(400);
  });
});
