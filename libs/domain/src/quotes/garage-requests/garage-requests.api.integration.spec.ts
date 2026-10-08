import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const PHONE = '+40722111222';

async function driver(name = 'Andrei Ion Marin') {
  const id = await world.account(name);
  await prisma.account.update({ data: { phone: PHONE }, where: { id } });
  return id;
}

// @traces 220-FR-013
describe('GET /garage/requests', () => {
  it('lists the requests sent to the garage, newest first, with their count', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const older = await world.request(andrei, {
      createdAt: new Date(Date.now() - 600_000),
    });
    const newer = await world.request(andrei);
    const elsewhere = await world.request(andrei);
    await world.recipient(older.id, dinamo.garage.id);
    await world.quote(newer.id, dinamo.garage.id);
    await world.recipient(elsewhere.id, militari.garage.id);

    const res = await get('/garage/requests', bearer(dinamo.owner, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(res.body.items[1]).toEqual({
      car: {
        brand: 'Mini',
        engine: '2.0 turbo',
        fuel: 'petrol',
        model: 'Cooper S',
        year: 2019,
      },
      createdAt: older.createdAt.toISOString(),
      driver: { shortName: 'Andrei M.' },
      expiresAt: older.expiresAt.toISOString(),
      id: older.id,
      jobs: [expect.objectContaining({ nameRo: 'Schimb ulei', position: 0 })],
      quote: null,
      recipient: {
        answeredAt: null,
        declinedAt: null,
        declineReason: null,
        source: 'search',
        status: 'waiting',
      },
      status: 'sent',
    });
    expect(res.body.items[0].quote).toMatchObject({
      fromBani: 45_000,
      status: 'waiting',
      toBani: 60_000,
    });
    expect(res.body.items[0].quote.garage).toBeUndefined();
  });

  it('never shows the phone, the plate or the description in the list', async () => {
    const andrei = await driver();
    const { garage, owner } = await team('Atelier Dinamo');
    await world.chain(andrei, garage.id);

    const res = await get('/garage/requests', bearer(owner, 'garage'));
    const text = JSON.stringify(res.body);

    expect(text).not.toContain(PHONE);
    expect(text).not.toContain('B123ABC');
    expect(text).not.toContain('Scârțâie');
  });

  it.each(['owner', 'receptionist', 'answering'] as const)(
    'lets the %s see the garage’s requests',
    async (who) => {
      const andrei = await driver();
      const t = await team('Atelier Dinamo');
      const request = await world.request(andrei);
      await world.recipient(request.id, t.garage.id);
      const role =
        who === 'owner' ? 'garage' : who === 'answering' ? 'mechanic' : who;

      const res = await get('/garage/requests', bearer(t[who], role));

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    },
  );

  it('answers 404 to a mechanic who may not answer quotes, and to a driver', async () => {
    const andrei = await driver();
    const t = await team('Atelier Dinamo');

    expect(
      (await get('/garage/requests', bearer(t.plain, 'mechanic'))).status,
    ).toBe(404);
    expect(
      (await get('/garage/requests', bearer(andrei, 'driver'))).status,
    ).toBe(404);
  });

  it('answers 400 invalid_cursor to another garage’s request as cursor', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const theirs = await world.request(andrei);
    await world.recipient(theirs.id, militari.garage.id);

    const res = await get(
      `/garage/requests?cursor=${theirs.id}`,
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });
});

// @traces 220-FR-013
// @traces 220-FR-015
describe('GET /garage/requests/:id', () => {
  it('shows the driver’s phone once the garage’s quote is accepted', async () => {
    const andrei = await driver();
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei, { status: 'quoted' });
    const quote = await world.quote(request.id, t.garage.id);

    const before = await get(
      `/garage/requests/${request.id}`,
      bearer(t.owner, 'garage'),
    );
    await prisma.quote.update({
      data: { acceptedAt: new Date(), status: 'accepted' },
      where: { id: quote.id },
    });
    const after = await get(
      `/garage/requests/${request.id}`,
      bearer(t.owner, 'garage'),
    );
    const desk = await get(
      `/garage/requests/${request.id}`,
      bearer(t.receptionist, 'receptionist'),
    );
    const mechanic = await get(
      `/garage/requests/${request.id}`,
      bearer(t.answering, 'mechanic'),
    );

    expect(before.body.driver).toEqual({ shortName: 'Andrei M.' });
    expect(before.body.description).toBe('Scârțâie la frânare');
    expect(after.body.driver).toEqual({ phone: PHONE, shortName: 'Andrei M.' });
    expect(desk.body.driver).toEqual({ phone: PHONE, shortName: 'Andrei M.' });
    expect(mechanic.body.driver).toEqual({ shortName: 'Andrei M.' });
  });

  it('shows the plate only once the booking is confirmed', async () => {
    const andrei = await driver();
    const t = await team('Atelier Dinamo');
    const { booking, request } = await world.chain(andrei, t.garage.id, {
      booking: 'awaiting_confirmation',
    });
    const read = (who: 'owner' | 'receptionist' | 'answering') =>
      get(
        `/garage/requests/${request.id}`,
        bearer(
          t[who],
          who === 'owner' ? 'garage' : who === 'answering' ? 'mechanic' : who,
        ),
      );

    const waiting = await read('owner');
    await prisma.booking.update({
      data: {
        confirmedAt: new Date(),
        confirmedBy: t.owner,
        status: 'confirmed',
      },
      where: { id: booking.id },
    });

    expect(waiting.body.car.plate).toBeUndefined();
    expect(waiting.body.booking).toMatchObject({
      id: booking.id,
      status: 'awaiting_confirmation',
    });
    for (const who of ['owner', 'receptionist', 'answering'] as const) {
      const res = await read(who);
      // The booking has no mechanic yet, so it is no mechanic's own.
      expect(res.body.car.plate).toBe(
        who === 'answering' ? undefined : 'B123ABC',
      );
      expect(res.body.booking).toMatchObject({
        confirmedBy: t.owner,
        mechanicId: null,
        moveCount: 0,
        status: 'confirmed',
      });
    }
  });

  it.each(['completed', 'no_show'] as const)(
    'keeps the plate once a confirmed booking is %s',
    async (status) => {
      const andrei = await driver();
      const t = await team('Atelier Dinamo');
      const { request } = await world.chain(andrei, t.garage.id, {
        booking: status,
      });

      const res = await get(
        `/garage/requests/${request.id}`,
        bearer(t.owner, 'garage'),
      );

      expect(res.body.booking).toMatchObject({ status });
      expect(res.body.car.plate).toBe('B123ABC');
    },
  );

  it('shortens a one-word name to itself', async () => {
    const solo = await driver('Andrei');
    const t = await team('Atelier Dinamo');
    const request = await world.request(solo);
    await world.recipient(request.id, t.garage.id);

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(t.owner, 'garage'),
    );

    expect(res.body.driver.shortName).toBe('Andrei');
  });

  it('gives the driver and the garage the same status and times', async () => {
    const andrei = await driver();
    const t = await team('Atelier Dinamo');
    const { request } = await world.chain(andrei, t.garage.id);

    const mine = (
      await get(`/requests/${request.id}`, bearer(andrei, 'driver'))
    ).body;
    const theirs = (
      await get(`/garage/requests/${request.id}`, bearer(t.owner, 'garage'))
    ).body;

    const times = (body: typeof mine) => ({
      booking: {
        confirmedAt: body.booking.confirmedAt,
        startsAt: body.booking.startsAt,
        status: body.booking.status,
      },
      createdAt: body.createdAt,
      expiresAt: body.expiresAt,
      status: body.status,
    });
    expect(times(theirs)).toEqual(times(mine));
    expect(theirs.quote).toMatchObject({
      acceptedAt: mine.quotes[0].acceptedAt,
      sentAt: mine.quotes[0].sentAt,
      status: mine.quotes[0].status,
    });
  });

  it('answers 404 to another garage, to a driver and when the garage was not asked', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const request = await world.request(andrei);
    await world.recipient(request.id, dinamo.garage.id);

    for (const auth of [
      bearer(militari.owner, 'garage'),
      bearer(militari.answering, 'mechanic'),
      bearer(dinamo.plain, 'mechanic'),
      bearer(andrei, 'driver'),
    ]) {
      expect((await get(`/garage/requests/${request.id}`, auth)).status).toBe(
        404,
      );
    }
  });
});
