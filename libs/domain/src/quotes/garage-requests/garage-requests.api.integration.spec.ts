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
      closedAt: null,
      closedReason: null,
      createdAt: older.createdAt.toISOString(),
      descriptionLine: 'Scârțâie la frânare',
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

  it('never shows the phone, the plate or the description past its first line in the list', async () => {
    const andrei = await driver();
    const { garage, owner } = await team('Atelier Dinamo');
    const { request } = await world.chain(andrei, garage.id);
    await prisma.quoteRequest.update({
      data: { description: 'Scârțâie la frânare\nSunați după ora 18' },
      where: { id: request.id },
    });

    const res = await get('/garage/requests', bearer(owner, 'garage'));
    const text = JSON.stringify(res.body);

    expect(text).not.toContain(PHONE);
    expect(text).not.toContain('B123ABC');
    expect(text).not.toContain('ora 18');
    expect(res.body.items[0].descriptionLine).toBe('Scârțâie la frânare');
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

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

const ids = (res: { body: { items: { id: string }[] } }) =>
  res.body.items.map((i) => i.id);

// A status move as the transitions record it, at a given time.
const moved = (
  subjectType: 'request_recipient' | 'quote_request',
  subjectId: string,
  at: Date,
  to: string,
) =>
  prisma.activityLog.create({
    data: {
      action: 'update',
      actorName: 'Sistem',
      actorRole: 'system',
      at,
      field: 'status',
      newValue: to,
      subjectId,
      subjectType,
    },
  });

async function closedRequest(
  driverId: string,
  closedReason:
    | 'expired'
    | 'cancelled'
    | 'booking_lapsed'
    | 'booking_cancelled'
    | 'no_show'
    | 'account_closed',
) {
  const r = await world.request(driverId, { status: 'closed' });
  return prisma.quoteRequest.update({
    data: { closedReason },
    where: { id: r.id },
  });
}

// @traces 343-FR-001
// @traces 343-FR-002
// @traces 343-FR-018
describe('GET /garage/requests?status=waiting', () => {
  async function mixed() {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const newest = await world.request(andrei);
    const quoted = await world.request(andrei, {
      createdAt: ago(60_000),
      status: 'quoted',
    });
    const declined = await world.request(andrei);
    const answered = await world.request(andrei);
    const booked = await world.request(andrei, { status: 'booked' });
    const elsewhere = await world.request(andrei);
    await world.recipient(newest.id, dinamo.garage.id);
    await world.recipient(quoted.id, dinamo.garage.id);
    await world.recipient(
      declined.id,
      dinamo.garage.id,
      'declined',
      dinamo.owner,
    );
    await world.quote(answered.id, dinamo.garage.id);
    await world.recipient(booked.id, dinamo.garage.id);
    await world.recipient(elsewhere.id, militari.garage.id);
    return { andrei, answered, booked, declined, dinamo, newest, quoted };
  }

  it('lists only the garage’s waiting recipients on sent or quoted requests, newest first, with their count', async () => {
    const m = await mixed();

    const res = await get(
      '/garage/requests?status=waiting',
      bearer(m.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([m.newest.id, m.quoted.id]);
    expect(res.body.total).toBe(2);
    expect(res.body.nextCursor).toBeNull();
    for (const item of res.body.items) {
      expect(item.recipient.status).toBe('waiting');
      expect(item.closedReason).toBeNull();
      expect(item.closedAt).toBeNull();
    }
  });

  it('breaks a tie on the creation time by id, newest id first', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const at = ago(5_000);
    const a = await world.request(andrei, { createdAt: at });
    const b = await world.request(andrei, { createdAt: at });
    await world.recipient(a.id, dinamo.garage.id);
    await world.recipient(b.id, dinamo.garage.id);

    const res = await get(
      '/garage/requests?status=waiting',
      bearer(dinamo.owner, 'garage'),
    );

    expect(ids(res)).toEqual([a.id, b.id].sort().reverse());
  });

  it('keeps the read without a status as it was: every request sent to the garage', async () => {
    const m = await mixed();

    const res = await get('/garage/requests', bearer(m.dinamo.owner, 'garage'));

    expect(res.body.total).toBe(5);
    expect(new Set(ids(res))).toEqual(
      new Set([
        m.newest.id,
        m.quoted.id,
        m.declined.id,
        m.answered.id,
        m.booked.id,
      ]),
    );
  });

  it('pages 20 at a time with the count of the waiting rows only', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    for (let i = 0; i < 21; i++) {
      const r = await world.request(andrei, { createdAt: ago(i * 1000) });
      await world.recipient(r.id, dinamo.garage.id);
    }
    const other = await world.request(andrei, { createdAt: ago(30_000) });
    await world.recipient(other.id, dinamo.garage.id, 'expired');
    const auth = bearer(dinamo.receptionist, 'receptionist');

    const first = await get('/garage/requests?status=waiting', auth);
    const last = await get(
      `/garage/requests?status=waiting&cursor=${first.body.nextCursor}`,
      auth,
    );

    expect(first.body.items).toHaveLength(20);
    expect(first.body.total).toBe(21);
    expect(last.body.items).toHaveLength(1);
    expect(last.body.nextCursor).toBeNull();
    expect(last.body.total).toBe(21);
    expect(new Set([...ids(first), ...ids(last)]).size).toBe(21);
    expect([...ids(first), ...ids(last)]).not.toContain(other.id);
  });

  it('answers 400 invalid_cursor to a request of the garage that is not waiting', async () => {
    const m = await mixed();

    const res = await get(
      `/garage/requests?status=waiting&cursor=${m.declined.id}`,
      bearer(m.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it.each(['other', 'WAITING', ''])(
    'answers 400 naming status to status=%s',
    async (value) => {
      const dinamo = await team('Atelier Dinamo');

      const res = await get(
        `/garage/requests?status=${value}`,
        bearer(dinamo.owner, 'garage'),
      );

      expect(res.status).toBe(400);
      expect(res.body.items).toBeUndefined();
      expect(JSON.stringify(res.body.message)).toMatch(/status/);
    },
  );

  it('carries no phone, e-mail or plate in any row, waiting or closed', async () => {
    const andrei = await driver();
    await prisma.account.update({
      data: { email: 'andrei.marin@example.test' },
      where: { id: andrei },
    });
    const dinamo = await team('Atelier Dinamo');
    const waiting = await world.request(andrei);
    await world.recipient(waiting.id, dinamo.garage.id);
    const expired = await world.request(andrei);
    await world.recipient(expired.id, dinamo.garage.id, 'expired');

    for (const status of ['waiting', 'closed']) {
      const res = await get(
        `/garage/requests?status=${status}`,
        bearer(dinamo.owner, 'garage'),
      );
      const text = JSON.stringify(res.body);
      expect(res.body.items).toHaveLength(1);
      expect(text).not.toContain(PHONE);
      expect(text).not.toContain('andrei.marin@example.test');
      expect(text).not.toContain('B123ABC');
      expect(text).not.toContain('"phone"');
      expect(text).not.toContain('"plate"');
      expect(text).not.toContain('"email"');
    }
  });
});

// @traces 343-FR-003
// @traces 343-FR-005
describe('GET /garage/requests the offered mark and the description line', () => {
  it('marks a job offered only when the garage ticked it for the request’s brand', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const mini = await prisma.brand.create({
      data: { key: 'mini', name: 'Mini', slug: 'mini' },
    });
    const dacia = await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    });
    const request = await world.request(andrei);
    await world.recipient(request.id, dinamo.garage.id);
    const [oil] = await prisma.requestJob.findMany({
      where: { requestId: request.id },
    });
    const brakes = await world.jobType('Frâne față', 'Front brakes');
    await prisma.requestJob.create({
      data: { jobTypeId: brakes.id, position: 1, requestId: request.id },
    });
    await prisma.garageBrand.createMany({
      data: [
        { brandId: mini.id, garageId: dinamo.garage.id, stance: 'works_on' },
        { brandId: dacia.id, garageId: dinamo.garage.id, stance: 'works_on' },
      ],
    });
    await prisma.garageBrandJob.createMany({
      data: [
        {
          brandId: mini.id,
          garageId: dinamo.garage.id,
          jobTypeId: oil.jobTypeId,
        },
        { brandId: dacia.id, garageId: dinamo.garage.id, jobTypeId: brakes.id },
      ],
    });

    for (const path of [
      '/garage/requests',
      '/garage/requests?status=waiting',
    ]) {
      const res = await get(path, bearer(dinamo.owner, 'garage'));
      expect(
        res.body.items[0].jobs.map(
          (j: { nameRo: string; offered: boolean }) => [j.nameRo, j.offered],
        ),
      ).toEqual([
        ['Schimb ulei', true],
        ['Frâne față', false],
      ]);
    }
  });

  it('marks nothing offered on a garage that ticked nothing, and nothing at all on a request with no job', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const withJob = await world.request(andrei, { createdAt: ago(1000) });
    const noJob = await world.request(andrei);
    await prisma.requestJob.deleteMany({ where: { requestId: noJob.id } });
    await world.recipient(withJob.id, dinamo.garage.id);
    await world.recipient(noJob.id, dinamo.garage.id);

    const res = await get(
      '/garage/requests?status=waiting',
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.body.items[0].jobs).toEqual([]);
    expect(res.body.items[1].jobs).toEqual([
      expect.objectContaining({ offered: false }),
    ]);
  });

  it('carries the description’s first line, and none for no description', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const lines = await world.request(andrei, {
      createdAt: ago(1000),
      description: 'Bate ceva în față\r\nmai ales la viteze mici',
    });
    const none = await world.request(andrei, { description: null });
    await world.recipient(lines.id, dinamo.garage.id);
    await world.recipient(none.id, dinamo.garage.id);

    const res = await get(
      '/garage/requests?status=waiting',
      bearer(dinamo.owner, 'garage'),
    );

    expect(
      res.body.items.map(
        (i: { descriptionLine: string | null }) => i.descriptionLine,
      ),
    ).toEqual([null, 'Bate ceva în față']);
    expect(JSON.stringify(res.body)).not.toContain('viteze mici');
  });
});

// @traces 343-FR-002
// @traces 343-FR-004
// @traces 343-FR-018
describe('GET /garage/requests?status=closed', () => {
  it('gives each closed row its reason, tried in order, and its close time', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');

    const expired = await world.request(andrei);
    const expiredTo = await world.recipient(
      expired.id,
      dinamo.garage.id,
      'expired',
    );
    await moved('request_recipient', expiredTo.id, ago(1 * HOUR), 'expired');

    const cancelled = await closedRequest(andrei, 'cancelled');
    const cancelledTo = await world.recipient(
      cancelled.id,
      dinamo.garage.id,
      'closed',
    );
    await moved('request_recipient', cancelledTo.id, ago(2 * HOUR), 'closed');

    const gone = await closedRequest(andrei, 'account_closed');
    const goneTo = await world.recipient(gone.id, dinamo.garage.id, 'closed');
    await moved('request_recipient', goneTo.id, ago(3 * HOUR), 'closed');

    const booked = await world.request(andrei, { status: 'booked' });
    await world.recipient(booked.id, dinamo.garage.id);
    await world.quote(booked.id, militari.garage.id, 'accepted');
    await moved('quote_request', booked.id, ago(4 * HOUR), 'booked');

    const odd = await closedRequest(andrei, 'expired');
    const oddTo = await world.recipient(odd.id, dinamo.garage.id);

    const res = await get(
      '/garage/requests?status=closed',
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    const by = Object.fromEntries(
      res.body.items.map(
        (i: { id: string; closedReason: string; closedAt: string }) => [
          i.id,
          [i.closedReason, i.closedAt],
        ],
      ),
    );
    const at = async (subject: string) =>
      (
        await prisma.activityLog.findFirstOrThrow({
          where: { subjectId: subject },
        })
      ).at.toISOString();
    expect(by).toEqual({
      [booked.id]: ['accepted_elsewhere', await at(booked.id)],
      [cancelled.id]: ['cancelled', await at(cancelledTo.id)],
      [expired.id]: ['expired', await at(expiredTo.id)],
      [gone.id]: ['account_closed', await at(goneTo.id)],
      [odd.id]: ['account_closed', oddTo.createdAt.toISOString()],
    });
    expect(res.body.total).toBe(5);
    expect(res.body.nextCursor).toBeNull();
  });

  it('lists the closed rows newest first by when they were sent, with no waiting or answered row', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const older = await world.request(andrei, { createdAt: ago(10 * HOUR) });
    const olderTo = await world.recipient(
      older.id,
      dinamo.garage.id,
      'expired',
    );
    await moved('request_recipient', olderTo.id, ago(1 * HOUR), 'expired');
    // Sent last, closed first.
    const later = await world.request(andrei, { createdAt: ago(2 * HOUR) });
    const laterTo = await world.recipient(
      later.id,
      dinamo.garage.id,
      'expired',
    );
    await moved('request_recipient', laterTo.id, ago(90 * 60_000), 'expired');
    const waiting = await world.request(andrei);
    await world.recipient(waiting.id, dinamo.garage.id);
    const declined = await world.request(andrei);
    await world.recipient(
      declined.id,
      dinamo.garage.id,
      'declined',
      dinamo.owner,
    );
    const answered = await world.request(andrei);
    await world.quote(answered.id, dinamo.garage.id);

    const res = await get(
      '/garage/requests?status=closed',
      bearer(dinamo.owner, 'garage'),
    );

    expect(ids(res)).toEqual([later.id, older.id]);
    expect(res.body.total).toBe(2);
  });

  it('takes the recipient’s newest move over the request’s', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const r = await closedRequest(andrei, 'cancelled');
    const to = await world.recipient(r.id, dinamo.garage.id, 'closed');
    await moved('request_recipient', to.id, ago(6 * HOUR), 'waiting');
    const newest = await moved(
      'request_recipient',
      to.id,
      ago(3 * HOUR),
      'closed',
    );
    await moved('quote_request', r.id, ago(1 * HOUR), 'closed');

    const res = await get(
      '/garage/requests?status=closed',
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.body.items[0].closedAt).toBe(newest.at.toISOString());
  });

  it('leaves out a row closed 24 hours and a minute ago, and another garage’s rows', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const stale = await world.request(andrei);
    const staleTo = await world.recipient(
      stale.id,
      dinamo.garage.id,
      'expired',
    );
    await moved(
      'request_recipient',
      staleTo.id,
      ago(24 * HOUR + 60_000),
      'expired',
    );
    const fresh = await world.request(andrei);
    const freshTo = await world.recipient(
      fresh.id,
      dinamo.garage.id,
      'expired',
    );
    await moved('request_recipient', freshTo.id, ago(23 * HOUR), 'expired');
    const theirs = await world.request(andrei);
    await world.recipient(theirs.id, militari.garage.id, 'expired');

    const res = await get(
      '/garage/requests?status=closed',
      bearer(dinamo.owner, 'garage'),
    );

    expect(ids(res)).toEqual([fresh.id]);
    expect(res.body.total).toBe(1);
  });

  it('shows a suspended garage’s closed rows as garage_suspended, an expired one still as expired', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const shut = await world.request(andrei);
    await world.recipient(shut.id, dinamo.garage.id, 'closed');
    const cancelled = await closedRequest(andrei, 'cancelled');
    await world.recipient(cancelled.id, dinamo.garage.id, 'closed');
    const expired = await world.request(andrei);
    await world.recipient(expired.id, dinamo.garage.id, 'expired');
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: dinamo.garage.id },
    });

    const res = await get(
      '/garage/requests?status=closed',
      bearer(dinamo.owner, 'garage'),
    );

    const by = Object.fromEntries(
      res.body.items.map((i: { id: string; closedReason: string }) => [
        i.id,
        i.closedReason,
      ]),
    );
    expect(by).toEqual({
      [cancelled.id]: 'garage_suspended',
      [expired.id]: 'expired',
      [shut.id]: 'garage_suspended',
    });
  });

  it.each(['booking_lapsed', 'booking_cancelled', 'no_show'] as const)(
    'keeps accepted_elsewhere once the other garage’s booking ends as %s',
    async (reason) => {
      const andrei = await driver();
      const dinamo = await team('Atelier Dinamo');
      const militari = await team('Service Militari');
      const r = await closedRequest(andrei, reason);
      await world.recipient(r.id, dinamo.garage.id);
      await world.quote(r.id, militari.garage.id, 'accepted');

      const res = await get(
        '/garage/requests?status=closed',
        bearer(dinamo.owner, 'garage'),
      );

      expect(
        res.body.items.map((i: { closedReason: string }) => i.closedReason),
      ).toEqual(['accepted_elsewhere']);
    },
  );

  it('answers the closed read without a cursor into a second page', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    for (let i = 0; i < 21; i++) {
      const r = await world.request(andrei);
      await world.recipient(r.id, dinamo.garage.id, 'expired');
    }

    const res = await get(
      '/garage/requests?status=closed',
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.body.items).toHaveLength(20);
    expect(res.body.total).toBe(21);
    expect(res.body.nextCursor).toBeNull();
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

  it('keeps the plate once a confirmed booking is cancelled, as the job does', async () => {
    const andrei = await driver();
    const t = await team('Atelier Dinamo');
    const { booking, request } = await world.chain(andrei, t.garage.id, {
      booking: 'confirmed',
    });
    await prisma.booking.update({
      data: {
        cancelledAt: new Date(),
        cancelledBy: t.owner,
        cancelledBySide: 'garage',
        cancelReason: 'parts_not_available',
        status: 'cancelled',
      },
      where: { id: booking.id },
    });

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(t.owner, 'garage'),
    );

    expect(res.body.booking).toMatchObject({ status: 'cancelled' });
    expect(res.body.car.plate).toBe('B123ABC');
  });

  it('shows no plate for a booking cancelled before confirmation', async () => {
    const andrei = await driver();
    const t = await team('Atelier Dinamo');
    const { request } = await world.chain(andrei, t.garage.id, {
      booking: 'cancelled',
    });

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(t.owner, 'garage'),
    );

    expect(res.body.booking).toMatchObject({ status: 'cancelled' });
    expect(res.body.car.plate).toBeUndefined();
  });

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
