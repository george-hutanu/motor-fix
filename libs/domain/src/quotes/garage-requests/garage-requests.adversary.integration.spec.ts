import { randomUUID } from 'node:crypto';

import { quotesApp } from '../quotes-api.testing';

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
  return { andrei, dinamo, maria, militari };
}

type World = Awaited<ReturnType<typeof setting>>;

async function sentTo(s: World, status: 'waiting' | 'accepted' = 'waiting') {
  const request = await world.request(s.andrei, {
    status: status === 'accepted' ? 'booked' : 'quoted',
  });
  const quote = await world.quote(request.id, s.dinamo.garage.id, status);
  return { quote, request };
}

const writes = async () => ({
  activity: await prisma.activityLog.count(),
  outbox: await prisma.outboxEvent.count(),
});

const ids = (res: { body: { items: { id: string }[] } }) =>
  res.body.items.map((i) => i.id);

// @traces 220-FR-012
// @traces 220-FR-015
describe('GET /garage/requests as each caller', () => {
  it('answers 401 sign_in_required to a visitor on the list and the detail', async () => {
    const s = await setting();
    const { request } = await sentTo(s);

    for (const path of ['/garage/requests', `/garage/requests/${request.id}`]) {
      const res = await get(path);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    }
  });

  it.each([
    ['owner', 'garage'],
    ['receptionist', 'receptionist'],
    ['answering', 'mechanic'],
  ] as const)(
    'gives the %s the request sent to the garage',
    async (who, role) => {
      const s = await setting();
      const { request } = await sentTo(s);

      const list = await get('/garage/requests', bearer(s.dinamo[who], role));
      const detail = await get(
        `/garage/requests/${request.id}`,
        bearer(s.dinamo[who], role),
      );

      expect(list.status).toBe(200);
      expect(ids(list)).toEqual([request.id]);
      expect(list.body.total).toBe(1);
      expect(detail.status).toBe(200);
      expect(detail.body.id).toBe(request.id);
    },
  );

  it('answers 404 never 403 to the mechanic without the permission', async () => {
    const s = await setting();
    const { request } = await sentTo(s);
    const auth = bearer(s.dinamo.plain, 'mechanic');

    for (const path of ['/garage/requests', `/garage/requests/${request.id}`]) {
      const res = await get(path, auth);
      expect(res.status).toBe(404);
      expect(res.body.items).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(DESCRIPTION);
    }
  });

  it('answers 404 to a mechanic whose permission was switched off after the token was issued', async () => {
    const s = await setting();
    const { request } = await sentTo(s);
    await prisma.mechanic.update({
      data: { canAnswerQuotes: false },
      where: { id: s.dinamo.answeringMechanic.id },
    });

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(s.dinamo.answering, 'mechanic'),
    );

    expect(res.status).toBe(404);
  });

  it('answers 404 to the owning driver and to another driver', async () => {
    const s = await setting();
    const { request } = await sentTo(s);

    for (const driver of [s.andrei, s.maria]) {
      for (const path of [
        '/garage/requests',
        `/garage/requests/${request.id}`,
      ]) {
        const res = await get(path, bearer(driver, 'driver'));
        expect(res.status).toBe(404);
      }
    }
  });

  it('shows another garage’s owner an empty list and 404 on the detail', async () => {
    const s = await setting();
    const { request } = await sentTo(s);
    const auth = bearer(s.militari.owner, 'garage');

    const list = await get('/garage/requests', auth);
    const detail = await get(`/garage/requests/${request.id}`, auth);

    expect(list.status).toBe(200);
    expect(list.body).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(detail.status).toBe(404);
    expect(JSON.stringify(detail.body)).not.toContain(DESCRIPTION);
  });

  it('answers a garage that was not a recipient exactly as a request that does not exist', async () => {
    const s = await setting();
    const { request } = await sentTo(s);
    const auth = bearer(s.militari.owner, 'garage');

    const other = await get(`/garage/requests/${request.id}`, auth);
    const none = await get(`/garage/requests/${randomUUID()}`, auth);

    expect(other.status).toBe(none.status);
    expect(other.body.code).toBe(none.body.code);
    expect(Object.keys(other.body).sort()).toEqual(
      Object.keys(none.body).sort(),
    );
  });

  it('answers a role the account does not hold as the role it holds', async () => {
    const s = await setting();
    await sentTo(s);

    for (const [account, claimed, held] of [
      [s.andrei, 'garage', 'driver'],
      [s.andrei, 'receptionist', 'driver'],
      [s.andrei, 'mechanic', 'driver'],
      [s.dinamo.plain, 'garage', 'mechanic'],
      [s.dinamo.plain, 'receptionist', 'mechanic'],
      [s.dinamo.receptionist, 'garage', 'receptionist'],
      [s.dinamo.owner, 'receptionist', 'garage'],
    ] as const) {
      const res = await get('/garage/requests', bearer(account, claimed));
      const own = await get('/garage/requests', bearer(account, held));
      expect(res.status).toBe(own.status);
      expect(res.body).toEqual(own.body);
    }
  });

  it('does not show a recipient row of a garage the caller does not work for', async () => {
    const s = await setting();
    const request = await world.request(s.andrei);
    await world.recipient(request.id, s.dinamo.garage.id);
    await world.recipient(request.id, s.militari.garage.id);
    await world.request(s.maria);

    const res = await get(
      '/garage/requests',
      bearer(s.militari.receptionist, 'receptionist'),
    );

    expect(ids(res)).toEqual([request.id]);
    expect(res.body.items[0].recipient.status).toBe('waiting');
  });
});

// @traces 220-FR-014
describe('GET /garage/requests cursor and query', () => {
  it('answers 400 invalid_cursor to a request the garage was not sent', async () => {
    const s = await setting();
    await sentTo(s);
    const elsewhere = await world.request(s.maria);
    await world.recipient(elsewhere.id, s.militari.garage.id);

    const res = await get(
      `/garage/requests?cursor=${elsewhere.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to a request of no garage at all and to an unknown id', async () => {
    const s = await setting();
    await sentTo(s);
    const lonely = await world.request(s.maria);

    for (const id of [lonely.id, randomUUID()]) {
      const res = await get(
        `/garage/requests?cursor=${id}`,
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
      `cursor=${randomUUID()}&garageId=${randomUUID()}`,
    ],
  ])('answers 400 to a cursor that is %s', async (_title, query) => {
    const s = await setting();
    await sentTo(s);

    const res = await get(
      `/garage/requests?${query}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(400);
    expect(res.body.items).toBeUndefined();
  });

  it('does not let a garageId parameter reach into another garage', async () => {
    const s = await setting();
    await sentTo(s);

    const res = await get(
      `/garage/requests?garageId=${s.dinamo.garage.id}`,
      bearer(s.militari.owner, 'garage'),
    );

    expect(res.status).toBe(400);
  });

  it('pages 20 at a time with the total of the garage', async () => {
    const s = await setting();
    for (let i = 0; i < 21; i++) {
      const r = await world.request(s.andrei, {
        createdAt: new Date(Date.now() - i * 1000),
      });
      await world.recipient(r.id, s.dinamo.garage.id);
    }
    const auth = bearer(s.dinamo.receptionist, 'receptionist');

    const first = await get('/garage/requests', auth);
    const again = await get('/garage/requests', auth);
    const last = await get(
      `/garage/requests?cursor=${first.body.nextCursor}`,
      auth,
    );

    expect(first.body.items).toHaveLength(20);
    expect(first.body.total).toBe(21);
    expect(again.body).toEqual(first.body);
    expect(last.body.items).toHaveLength(1);
    expect(last.body.nextCursor).toBeNull();
    expect(new Set([...ids(first), ...ids(last)]).size).toBe(21);
  });

  it('lists nothing for a garage that was sent nothing', async () => {
    const s = await setting();

    const res = await get('/garage/requests', bearer(s.dinamo.owner, 'garage'));

    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });
});

// @traces 220-FR-012
describe('GET /garage/requests/:id hostile ids', () => {
  it.each([
    ['not an id', 'not-an-id'],
    ['a number', '12345'],
    ['a uuid with a suffix', `${randomUUID()}x`],
    ['a traversal', '..%2F..%2Frequests'],
  ])('answers 400 to an id that is %s', async (_title, id) => {
    const s = await setting();

    const res = await get(
      `/garage/requests/${id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(400);
  });

  it('answers 404 to a nil uuid, an unknown uuid and the id of a quote', async () => {
    const s = await setting();
    const { quote } = await sentTo(s);

    for (const id of [
      '00000000-0000-0000-0000-000000000000',
      randomUUID(),
      quote.id,
    ]) {
      const res = await get(
        `/garage/requests/${id}`,
        bearer(s.dinamo.owner, 'garage'),
      );
      expect(res.status).toBe(404);
    }
  });
});

// @traces 220-FR-013
describe('GET /garage/requests the driver’s private data', () => {
  it('names the driver as first name and initial and carries the description', async () => {
    const s = await setting();
    const { request } = await sentTo(s);

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.body.driver).toEqual({ shortName: 'Andrei M.' });
    expect(res.body.description).toBe(DESCRIPTION);
    expect(JSON.stringify(res.body)).not.toContain('Marin');
  });

  it('carries no phone and no plate before the quote is accepted', async () => {
    const s = await setting();
    const { request } = await sentTo(s);

    for (const [who, role] of [
      ['owner', 'garage'],
      ['receptionist', 'receptionist'],
      ['answering', 'mechanic'],
    ] as const) {
      const auth = bearer(s.dinamo[who], role);
      for (const path of [
        '/garage/requests',
        `/garage/requests/${request.id}`,
      ]) {
        const text = JSON.stringify((await get(path, auth)).body);
        expect(text).not.toContain(PHONE);
        expect(text).not.toContain(PLATE);
        expect(text).not.toContain('"phone"');
        expect(text).not.toContain('"plate"');
      }
    }
  });

  it('carries no phone and no plate in the list even when the quote is accepted and the booking confirmed', async () => {
    const s = await setting();
    const chain = await world.chain(s.andrei, s.dinamo.garage.id);

    const res = await get('/garage/requests', bearer(s.dinamo.owner, 'garage'));
    const text = JSON.stringify(res.body);

    expect(ids(res)).toEqual([chain.request.id]);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(PLATE);
  });

  it('gives the owner and the receptionist the phone once the quote is accepted, and no plate until confirmation', async () => {
    const s = await setting();
    const { request } = await sentTo(s, 'accepted');
    const booking = await world.booking(
      (
        await prisma.quote.findFirstOrThrow({
          where: { requestId: request.id },
        })
      ).id,
      'awaiting_confirmation',
    );

    for (const [who, role] of [
      ['owner', 'garage'],
      ['receptionist', 'receptionist'],
    ] as const) {
      const res = await get(
        `/garage/requests/${request.id}`,
        bearer(s.dinamo[who], role),
      );
      expect(res.body.driver.phone).toBe(PHONE);
      expect(res.body.car.plate).toBeUndefined();
      expect(res.body.booking.id).toBe(booking.id);
    }
  });

  it('never gives a mechanic the phone, even once the quote is accepted and confirmed', async () => {
    const s = await setting();
    const chain = await world.chain(s.andrei, s.dinamo.garage.id);

    const res = await get(
      `/garage/requests/${chain.request.id}`,
      bearer(s.dinamo.answering, 'mechanic'),
    );

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(PHONE);
    expect(res.body.driver).toEqual({ shortName: 'Andrei M.' });
  });

  it('gives the plate on a confirmed booking to the owner and the receptionist', async () => {
    const s = await setting();
    const chain = await world.chain(s.andrei, s.dinamo.garage.id);

    for (const [who, role] of [
      ['owner', 'garage'],
      ['receptionist', 'receptionist'],
    ] as const) {
      const res = await get(
        `/garage/requests/${chain.request.id}`,
        bearer(s.dinamo[who], role),
      );
      expect(res.body.car.plate).toBe(PLATE);
      expect(res.body.driver.phone).toBe(PHONE);
    }
  });

  it('gives a mechanic the plate only when the booking is theirs', async () => {
    const s = await setting();
    const chain = await world.chain(s.andrei, s.dinamo.garage.id);
    const auth = bearer(s.dinamo.answering, 'mechanic');

    const noMechanic = await get(`/garage/requests/${chain.request.id}`, auth);
    await prisma.booking.update({
      data: { mechanicId: s.dinamo.plainMechanic.id },
      where: { id: chain.booking.id },
    });
    const otherMechanic = await get(
      `/garage/requests/${chain.request.id}`,
      auth,
    );
    await prisma.booking.update({
      data: { mechanicId: s.dinamo.answeringMechanic.id },
      where: { id: chain.booking.id },
    });
    const own = await get(`/garage/requests/${chain.request.id}`, auth);

    expect(JSON.stringify(noMechanic.body)).not.toContain(PLATE);
    expect(JSON.stringify(otherMechanic.body)).not.toContain(PLATE);
    expect(own.body.car.plate).toBe(PLATE);
    expect(JSON.stringify(own.body)).not.toContain(PHONE);
  });

  it('gives no plate to a car with none on a confirmed booking', async () => {
    const s = await setting();
    const car = await world.car(s.andrei, null);
    const request = await world.request(s.andrei, {
      carId: car.id,
      status: 'booked',
    });
    const quote = await world.quote(request.id, s.dinamo.garage.id, 'accepted');
    await world.booking(quote.id, 'confirmed');

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body.car.plate ?? null).toBeNull();
  });

  it('gives no phone or plate from a declined or withdrawn quote', async () => {
    const s = await setting();
    const request = await world.request(s.andrei);
    await world.quote(request.id, s.dinamo.garage.id, 'withdrawn');

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );
    const text = JSON.stringify(res.body);

    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(PLATE);
  });
});

// @traces 220-FR-013
describe('GET /garage/requests/:id keeps the garages apart', () => {
  it('shows each garage only its own quote, recipient and booking', async () => {
    const s = await setting();
    const request = await world.request(s.andrei, { status: 'booked' });
    const dinamoQuote = await world.quote(
      request.id,
      s.dinamo.garage.id,
      'accepted',
    );
    const dinamoBooking = await world.booking(dinamoQuote.id, 'confirmed');
    const militariQuote = await world.quote(
      request.id,
      s.militari.garage.id,
      'waiting',
    );

    const theirs = await get(
      `/garage/requests/${request.id}`,
      bearer(s.militari.owner, 'garage'),
    );
    const mine = await get(
      `/garage/requests/${request.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );
    const text = JSON.stringify(theirs.body);

    expect(theirs.body.quote.id).toBe(militariQuote.id);
    expect(theirs.body.booking).toBeNull();
    expect(text).not.toContain(dinamoQuote.id);
    expect(text).not.toContain(dinamoBooking.id);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(PLATE);
    expect(mine.body.quote.id).toBe(dinamoQuote.id);
    expect(mine.body.booking.id).toBe(dinamoBooking.id);
  });

  it('does not name the other garages the driver asked', async () => {
    const s = await setting();
    const { request } = await sentTo(s);
    await world.recipient(
      request.id,
      s.militari.garage.id,
      'declined',
      s.militari.owner,
    );

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );
    const text = JSON.stringify(res.body);

    expect(text).not.toContain(s.militari.garage.id);
    expect(text).not.toContain('Service Militari');
    expect(text).not.toContain(s.militari.owner);
    expect(res.body).not.toHaveProperty('recipients');
  });

  it('carries the garage’s own decline reason and no account id of the staff who declined', async () => {
    const s = await setting();
    const request = await world.request(s.andrei);
    await world.recipient(
      request.id,
      s.dinamo.garage.id,
      'declined',
      s.dinamo.owner,
    );

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(s.dinamo.receptionist, 'receptionist'),
    );

    expect(res.body.recipient).toMatchObject({
      declineReason: 'fully_booked',
      status: 'declined',
    });
    expect(JSON.stringify(res.body)).not.toContain(s.dinamo.owner);
    expect(res.body.recipient).not.toHaveProperty('declinedBy');
  });

  it('carries the driver’s id nowhere', async () => {
    const s = await setting();
    const { request } = await sentTo(s);

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(JSON.stringify(res.body)).not.toContain(s.andrei);
  });
});

// @traces 220-FR-013
describe('GET /garage/requests driver short names', () => {
  it.each([
    ['Andrei Marin', 'Andrei M.'],
    ['Maria', 'Maria'],
    ['Ion Popescu Ionescu', 'Ion I.'],
    ['Ștefan Țurcanu', 'Ștefan Ț.'],
  ])('shows %s as %s', async (name, short) => {
    const s = await setting();
    const driver = await world.account(name);
    const request = await world.request(driver);
    await world.recipient(request.id, s.dinamo.garage.id);

    const res = await get(
      `/garage/requests/${request.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.body.driver.shortName).toBe(short);
  });
});

// @traces 220-FR-012
describe('GET /garage/requests writes nothing', () => {
  it('leaves the activity log and the outbox as they were', async () => {
    const s = await setting();
    const chain = await world.chain(s.andrei, s.dinamo.garage.id);
    const before = await writes();
    const rows = await prisma.requestRecipient.findMany({
      orderBy: { id: 'asc' },
    });

    await get('/garage/requests', bearer(s.dinamo.owner, 'garage'));
    await get(
      `/garage/requests/${chain.request.id}`,
      bearer(s.dinamo.receptionist, 'receptionist'),
    );
    await get(
      `/garage/requests/${chain.request.id}`,
      bearer(s.dinamo.plain, 'mechanic'),
    );
    await get(
      `/garage/requests/${chain.request.id}`,
      bearer(s.militari.owner, 'garage'),
    );
    await get('/garage/requests?cursor=abc', bearer(s.dinamo.owner, 'garage'));
    await get('/garage/requests');

    expect(await writes()).toEqual(before);
    expect(
      await prisma.requestRecipient.findMany({ orderBy: { id: 'asc' } }),
    ).toEqual(rows);
  });
});

// @traces 343-live-quote-requests-FR-005
// @traces 343-live-quote-requests-FR-018
describe('GET /garage/requests?status= as each caller', () => {
  async function waitingAndClosed(s: World) {
    const waiting = await world.request(s.andrei);
    await world.recipient(waiting.id, s.dinamo.garage.id);
    const closed = await world.request(s.andrei);
    await world.recipient(closed.id, s.dinamo.garage.id, 'expired');
    return { closed, waiting };
  }

  it.each([
    ['owner', 'garage'],
    ['receptionist', 'receptionist'],
    ['answering', 'mechanic'],
  ] as const)('gives the %s both lists', async (who, role) => {
    const s = await setting();
    const rows = await waitingAndClosed(s);
    const auth = bearer(s.dinamo[who], role);

    const waiting = await get('/garage/requests?status=waiting', auth);
    const closed = await get('/garage/requests?status=closed', auth);

    expect(waiting.status).toBe(200);
    expect(ids(waiting)).toEqual([rows.waiting.id]);
    expect(closed.status).toBe(200);
    expect(ids(closed)).toEqual([rows.closed.id]);
  });

  it('answers 404 never 403 to the mechanic without the permission, an account with no garage and a driver', async () => {
    const s = await setting();
    await waitingAndClosed(s);
    const loner = await world.account('Ion Singur', ['garage']);

    for (const auth of [
      bearer(s.dinamo.plain, 'mechanic'),
      bearer(loner, 'garage'),
      bearer(s.andrei, 'driver'),
    ]) {
      for (const status of ['waiting', 'closed']) {
        const res = await get(`/garage/requests?status=${status}`, auth);
        expect(res.status).toBe(404);
        expect(res.body.items).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toContain(DESCRIPTION);
      }
    }
  });

  it('gives another garage’s owner none of this garage’s rows', async () => {
    const s = await setting();
    await waitingAndClosed(s);
    const auth = bearer(s.militari.owner, 'garage');

    for (const status of ['waiting', 'closed']) {
      const res = await get(`/garage/requests?status=${status}`, auth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
    }
  });

  it('answers 401 sign_in_required to a visitor on both lists', async () => {
    const s = await setting();
    await waitingAndClosed(s);

    for (const status of ['waiting', 'closed']) {
      const res = await get(`/garage/requests?status=${status}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    }
  });
});
