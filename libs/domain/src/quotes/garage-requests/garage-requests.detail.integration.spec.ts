import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const firstSeen = async (requestId: string, garageId: string) =>
  (
    await prisma.requestRecipient.findUniqueOrThrow({
      where: { requestId_garageId: { garageId, requestId } },
    })
  ).firstSeenAt;

// @traces 347-FR-005 347-FR-014
describe('GET /garage/requests/:id, the whole request', () => {
  it('carries the car, the jobs, the description and the expiry, never an e-mail', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei);
    await world.recipient(request.id, t.garage.id);

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(t.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      car: {
        brand: 'Mini',
        engine: '2.0 turbo',
        model: 'Cooper S',
        year: 2019,
      },
      description: 'Scârțâie la frânare',
      driver: { shortName: 'Andrei M.' },
      expiresAt: request.expiresAt.toISOString(),
      jobs: [
        expect.objectContaining({ nameRo: 'Schimb ulei', offered: false }),
      ],
    });
    expect(res.body.driver.phone).toBeUndefined();
    expect(res.body.car.plate).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('@');
  });
});

// @traces 347-FR-009
describe('GET /garage/requests/:id, the first time the garage saw it', () => {
  it('is set by the first read and kept by the next', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei);
    await world.recipient(request.id, t.garage.id);
    expect(await firstSeen(request.id, t.garage.id)).toBeNull();

    const before = Date.now();
    await get(`/garage/requests/${request.id}`, bearer(t.owner, 'garage'));
    const first = await firstSeen(request.id, t.garage.id);
    await get(
      `/garage/requests/${request.id}`,
      bearer(t.receptionist, 'receptionist'),
    );

    expect(first?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await firstSeen(request.id, t.garage.id)).toEqual(first);
  });

  it('keeps one time when two first reads arrive together', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei);
    await world.recipient(request.id, t.garage.id);

    await Promise.all([
      get(`/garage/requests/${request.id}`, bearer(t.owner, 'garage')),
      get(`/garage/requests/${request.id}`, bearer(t.answering, 'mechanic')),
    ]);
    const first = await firstSeen(request.id, t.garage.id);
    await get(`/garage/requests/${request.id}`, bearer(t.owner, 'garage'));

    expect(first).not.toBeNull();
    expect(await firstSeen(request.id, t.garage.id)).toEqual(first);
  });

  it('is written by no refused read', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const request = await world.request(andrei);
    await world.recipient(request.id, dinamo.garage.id);

    const plain = await get(
      `/garage/requests/${request.id}`,
      bearer(dinamo.plain, 'mechanic'),
    );
    const other = await get(
      `/garage/requests/${request.id}`,
      bearer(militari.owner, 'garage'),
    );

    expect(plain.status).toBe(403);
    expect(other.status).toBe(404);
    expect(await firstSeen(request.id, dinamo.garage.id)).toBeNull();
  });
});

// @traces 347-FR-008
describe('GET /garage/requests/:id, who may read it', () => {
  it('answers 403 to a mechanic who may not answer quotes, 404 to the rest', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const request = await world.request(andrei);
    const elsewhere = await world.request(andrei);
    await world.recipient(request.id, dinamo.garage.id);
    await world.recipient(elsewhere.id, militari.garage.id);

    const plain = await get(
      `/garage/requests/${request.id}`,
      bearer(dinamo.plain, 'mechanic'),
    );
    const other = await get(
      `/garage/requests/${request.id}`,
      bearer(militari.owner, 'garage'),
    );
    const notSent = await get(
      `/garage/requests/${elsewhere.id}`,
      bearer(dinamo.owner, 'garage'),
    );
    const malformed = await get(
      '/garage/requests/not-a-uuid',
      bearer(dinamo.owner, 'garage'),
    );

    expect(plain.status).toBe(403);
    expect(plain.body).toMatchObject({
      code: 'forbidden',
      message: 'Nu ai dreptul să citești cererile',
    });
    expect(other.status).toBe(404);
    expect(notSent.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});

// @traces 347-FR-011 347-FR-014
describe('GET /garage/requests/:id, why it closed', () => {
  const read = async (requestId: string, owner: string) =>
    (await get(`/garage/requests/${requestId}`, bearer(owner, 'garage'))).body;

  it('is null while the request waits for the garage', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei);
    await world.recipient(request.id, t.garage.id);

    expect((await read(request.id, t.owner)).closedReason).toBeNull();
  });

  it('names a cancel by the driver', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei, { status: 'closed' });
    await world.recipient(request.id, t.garage.id, 'closed');

    expect((await read(request.id, t.owner)).closedReason).toBe('cancelled');
  });

  it('names a request that expired for the garage', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei);
    await world.recipient(request.id, t.garage.id, 'expired');

    expect((await read(request.id, t.owner)).closedReason).toBe('expired');
  });

  it('names the garage’s own decline', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei);
    await world.recipient(request.id, t.garage.id, 'declined', t.owner);

    expect((await read(request.id, t.owner)).closedReason).toBe('declined');
  });

  it('names another garage’s accepted quote', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei, { status: 'booked' });
    await world.recipient(request.id, t.garage.id, 'closed');

    expect((await read(request.id, t.owner)).closedReason).toBe(
      'accepted_elsewhere',
    );
  });

  it('names a driver who closed the account', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const request = await world.request(andrei, { status: 'closed' });
    await prisma.quoteRequest.update({
      data: { closedReason: 'account_closed' },
      where: { id: request.id },
    });
    await world.recipient(request.id, t.garage.id, 'closed');

    expect((await read(request.id, t.owner)).closedReason).toBe(
      'account_closed',
    );
  });

  it.each(['closed', 'waiting'] as const)(
    'names the garage’s suspension on a %s recipient',
    async (status) => {
      const andrei = await world.account('Andrei Ion Marin');
      const t = await team('Atelier Dinamo');
      const request = await world.request(andrei);
      await world.recipient(request.id, t.garage.id, status);
      await prisma.garage.update({
        data: { status: 'suspended' },
        where: { id: t.garage.id },
      });

      expect((await read(request.id, t.owner)).closedReason).toBe(
        'garage_suspended',
      );
    },
  );

  it('is null once the garage quoted, and when its own quote is accepted', async () => {
    const andrei = await world.account('Andrei Ion Marin');
    const t = await team('Atelier Dinamo');
    const quoted = await world.request(andrei, { status: 'quoted' });
    await world.quote(quoted.id, t.garage.id);
    const won = await world.request(andrei, { status: 'booked' });
    await world.quote(won.id, t.garage.id, 'accepted');

    const colleague = await read(quoted.id, t.owner);
    const own = await read(won.id, t.owner);

    expect(colleague.recipient.status).toBe('quoted');
    expect(colleague.closedReason).toBeNull();
    expect(own.quote.status).toBe('accepted');
    expect(own.closedReason).toBeNull();
  });
});
