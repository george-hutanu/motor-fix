import type {
  BookingStatus,
  QuoteStatus,
  RequestClosedReason,
} from '@motor-fix/contracts';

import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const PHONE = '+40722111222';
const MINUTE = 60_000;
const DAY = 86_400_000;

type Seed = {
  quote: QuoteStatus;
  booking?: BookingStatus;
  closedReason?: RequestClosedReason;
  request?: 'quoted' | 'booked' | 'closed';
  sentAt?: Date;
};

async function driver(phone: string | null = PHONE) {
  const id = await world.account('Andrei Ion Marin');
  await prisma.account.updateMany({ data: { phone: null }, where: { phone } });
  await prisma.account.update({ data: { phone }, where: { id } });
  return id;
}

async function seed(garageId: string, owner: string, s: Seed, at: Date) {
  const r = await world.request(owner, {
    status: s.request ?? (s.closedReason ? 'closed' : 'quoted'),
  });
  if (s.closedReason) {
    await prisma.quoteRequest.update({
      data: { closedReason: s.closedReason },
      where: { id: r.id },
    });
  }
  const q = await world.quote(r.id, garageId, s.quote);
  await prisma.quote.update({
    data: { sentAt: s.sentAt ?? at },
    where: { id: q.id },
  });
  if (s.booking) await world.booking(q.id, s.booking);
  return r.id;
}

const ids = (res: { body: { items: { id: string }[] } }) =>
  res.body.items.map((i) => i.id);

// @traces 346-FR-002
describe('GET /garage/requests?status=quoted under hostile data', () => {
  it('answers an empty list with a zero total and no cursor for a garage that sent nothing', async () => {
    const dinamo = await team('Atelier Dinamo');

    const res = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it.each([
    [20, 20, 0],
    [21, 20, 1],
    [40, 20, 20],
    [41, 20, 20],
  ])('pages %i quotes as %i then %i', async (count, first, second) => {
    const dinamo = await team('Atelier Dinamo');
    const owner = await driver();
    const all: string[] = [];
    for (let i = 0; i < count; i++) {
      all.push(
        await seed(
          dinamo.garage.id,
          owner,
          { quote: 'waiting' },
          new Date(Date.now() - (i + 1) * MINUTE),
        ),
      );
    }
    const auth = bearer(dinamo.owner, 'garage');

    const one = await get('/garage/requests?status=quoted', auth);
    const two = one.body.nextCursor
      ? await get(
          `/garage/requests?status=quoted&cursor=${one.body.nextCursor}`,
          auth,
        )
      : null;

    expect(ids(one)).toEqual(all.slice(0, first));
    expect(two ? ids(two) : []).toEqual(all.slice(first, first + second));
    expect(one.body.total).toBe(count);
    expect(one.body.nextCursor === null).toBe(count === 20);
  });

  it('pages 45 quotes sent in the same instant with none repeated and none lost', async () => {
    const dinamo = await team('Atelier Dinamo');
    const owner = await driver();
    const at = new Date(Date.now() - 5 * MINUTE);
    const all = new Set<string>();
    for (let i = 0; i < 45; i++) {
      all.add(await seed(dinamo.garage.id, owner, { quote: 'waiting' }, at));
    }
    const auth = bearer(dinamo.owner, 'garage');

    const seen: string[] = [];
    let path = '/garage/requests?status=quoted';
    for (let guard = 0; guard < 5; guard++) {
      const res = await get(path, auth);
      seen.push(...ids(res));
      if (!res.body.nextCursor) break;
      path = `/garage/requests?status=quoted&cursor=${res.body.nextCursor}`;
    }

    expect(seen).toHaveLength(45);
    expect(new Set(seen)).toEqual(all);
  });

  it('keeps a quote sent over a year ago, however long it has ended', async () => {
    const dinamo = await team('Atelier Dinamo');
    const owner = await driver();
    const old = await seed(
      dinamo.garage.id,
      owner,
      { closedReason: 'expired', quote: 'expired' },
      new Date(Date.now() - 400 * DAY),
    );

    const res = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.owner, 'garage'),
    );

    expect(
      res.body.items.map((i: { id: string; outcome: string }) => [
        i.id,
        i.outcome,
      ]),
    ).toEqual([[old, 'expired']]);
    expect(res.body.total).toBe(1);
  });

  it('leaves out the requests the garage only received or declined', async () => {
    const dinamo = await team('Atelier Dinamo');
    const owner = await driver();
    const received = await world.request(owner);
    await world.recipient(received.id, dinamo.garage.id);
    const declined = await world.request(owner);
    await world.recipient(
      declined.id,
      dinamo.garage.id,
      'declined',
      dinamo.owner,
    );

    const res = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('sends an accepted quote’s row without a phone when the driver has none', async () => {
    const dinamo = await team('Atelier Dinamo');
    const owner = await driver(null);
    const id = await seed(
      dinamo.garage.id,
      owner,
      {
        booking: 'awaiting_confirmation',
        quote: 'accepted',
        request: 'booked',
      },
      new Date(Date.now() - MINUTE),
    );

    const res = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body.items[0].id).toBe(id);
    expect(res.body.items[0].outcome).toBe('accepted');
    expect(res.body.items[0].driver.phone ?? null).toBeNull();
  });

  it('reads an expired quote with its own cancelled booking as expired', async () => {
    const dinamo = await team('Atelier Dinamo');
    const owner = await driver();
    await seed(
      dinamo.garage.id,
      owner,
      {
        booking: 'cancelled',
        closedReason: 'booking_cancelled',
        quote: 'expired',
      },
      new Date(Date.now() - MINUTE),
    );

    const res = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.body.items[0].outcome).toBe('expired');
  });

  it('prefers the account closing over a cancelled own booking and a cancelled own booking over a cancelled request', async () => {
    const dinamo = await team('Atelier Dinamo');
    const owner = await driver();
    const closed = await seed(
      dinamo.garage.id,
      owner,
      { booking: 'cancelled', closedReason: 'account_closed', quote: 'lost' },
      new Date(Date.now() - MINUTE),
    );
    const cancelled = await seed(
      dinamo.garage.id,
      owner,
      { booking: 'cancelled', closedReason: 'cancelled', quote: 'lost' },
      new Date(Date.now() - 2 * MINUTE),
    );

    const res = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.owner, 'garage'),
    );

    expect(
      res.body.items.map((i: { id: string; outcome: string }) => [
        i.id,
        i.outcome,
      ]),
    ).toEqual([
      [closed, 'account_closed'],
      [cancelled, 'booking_cancelled'],
    ]);
  });

  it('shows each of two garages quoting one request its own outcome and the phone to the accepted one only', async () => {
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const owner = await driver();
    const r = await world.request(owner, { status: 'booked' });
    const won = await world.quote(r.id, dinamo.garage.id, 'accepted');
    await world.booking(won.id, 'confirmed');
    await world.quote(r.id, militari.garage.id, 'lost');

    const a = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.owner, 'garage'),
    );
    const b = await get(
      '/garage/requests?status=quoted',
      bearer(militari.owner, 'garage'),
    );

    expect([a.body.items[0].outcome, b.body.items[0].outcome]).toEqual([
      'booked',
      'chose_other',
    ]);
    expect(a.body.items[0].driver.phone).toBe(PHONE);
    expect(JSON.stringify(b.body)).not.toContain(PHONE);
    expect(b.body.items[0].booking ?? null).toBeNull();
  });

  it('answers the same twice and writes nothing', async () => {
    const dinamo = await team('Atelier Dinamo');
    const owner = await driver();
    await seed(
      dinamo.garage.id,
      owner,
      { quote: 'waiting' },
      new Date(Date.now() - MINUTE),
    );
    const auth = bearer(dinamo.owner, 'garage');
    const before = await prisma.quote.findMany({ orderBy: { id: 'asc' } });

    const one = await get('/garage/requests?status=quoted', auth);
    const two = await get('/garage/requests?status=quoted', auth);

    expect(two.body).toEqual(one.body);
    expect(await prisma.quote.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before,
    );
  });

  it('answers 401 with no token and 400 to a repeated or unknown status', async () => {
    const dinamo = await team('Atelier Dinamo');
    const auth = bearer(dinamo.owner, 'garage');

    expect((await get('/garage/requests?status=quoted')).status).toBe(401);
    expect(
      (await get('/garage/requests?status=quoted&status=waiting', auth)).status,
    ).toBe(400);
    expect((await get('/garage/requests?status=QUOTED', auth)).status).toBe(
      400,
    );
  });
});
