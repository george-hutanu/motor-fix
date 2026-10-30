import type {
  BookingStatus,
  QuoteOutcome,
  QuoteStatus,
  RequestClosedReason,
} from '@motor-fix/contracts';

import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const PHONE = '+40722111222';
const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);

type Seed = {
  quote: QuoteStatus;
  booking?: BookingStatus;
  request?: 'quoted' | 'booked' | 'closed';
  closedReason?: RequestClosedReason;
  quoteExpired?: boolean;
};

// One quoted request per seed, sent a minute apart, the first seed newest.
async function seedAll(garageId: string, seeds: Seed[]) {
  const andrei = await world.account('Andrei Ion Marin');
  await prisma.account.updateMany({
    data: { phone: null },
    where: { phone: PHONE },
  });
  await prisma.account.update({
    data: { phone: PHONE },
    where: { id: andrei },
  });
  const ids: string[] = [];
  for (const [i, seed] of seeds.entries()) {
    const r = await world.request(andrei, {
      status: seed.request ?? (seed.closedReason ? 'closed' : 'quoted'),
    });
    if (seed.closedReason) {
      await prisma.quoteRequest.update({
        data: { closedReason: seed.closedReason },
        where: { id: r.id },
      });
    }
    const q = await world.quote(r.id, garageId, seed.quote);
    await prisma.quote.update({
      data: {
        sentAt: ago((i + 1) * MINUTE),
        ...(seed.quoteExpired && { expiresAt: ago(MINUTE) }),
      },
      where: { id: q.id },
    });
    if (seed.booking) await world.booking(q.id, seed.booking);
    ids.push(r.id);
  }
  return ids;
}

const EVERY: [Seed, QuoteOutcome][] = [
  [{ quote: 'waiting' }, 'waiting'],
  [{ quote: 'waiting', quoteExpired: true, request: 'booked' }, 'waiting'],
  [
    { booking: 'awaiting_confirmation', quote: 'accepted', request: 'booked' },
    'accepted',
  ],
  [{ booking: 'confirmed', quote: 'accepted', request: 'booked' }, 'booked'],
  [{ booking: 'completed', quote: 'accepted', request: 'booked' }, 'booked'],
  [
    { booking: 'no_show', closedReason: 'no_show', quote: 'accepted' },
    'no_show',
  ],
  [
    { booking: 'lapsed', closedReason: 'booking_lapsed', quote: 'expired' },
    'lapsed',
  ],
  [{ closedReason: 'expired', quote: 'expired' }, 'expired'],
  [{ quote: 'withdrawn' }, 'withdrawn'],
  [{ quote: 'declined_by_driver', quoteExpired: true }, 'declined'],
  [{ closedReason: 'account_closed', quote: 'lost' }, 'account_closed'],
  [{ booking: 'cancelled', quote: 'lost' }, 'booking_cancelled'],
  [{ closedReason: 'cancelled', quote: 'lost' }, 'request_cancelled'],
  [{ quote: 'lost', request: 'booked' }, 'chose_other'],
];

const rows = (res: { body: { items: { id: string; outcome: string }[] } }) =>
  res.body.items.map((item) => [item.id, item.outcome]);

// @traces 346-FR-002
describe('GET /garage/requests?status=quoted with what became of each quote', () => {
  it('lists every quote of the garage in every state, newest first, each with its outcome and counted in the total', async () => {
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const ids = await seedAll(
      dinamo.garage.id,
      EVERY.map(([seed]) => seed),
    );
    await seedAll(militari.garage.id, [{ quote: 'waiting' }]);

    const res = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(rows(res)).toEqual(ids.map((id, i) => [id, EVERY[i][1]]));
    expect(res.body.total).toBe(EVERY.length);
    expect(res.body.nextCursor).toBeNull();
  });

  it('pages 20 at a time across every state, the rest by the cursor', async () => {
    const dinamo = await team('Atelier Dinamo');
    const seeds = [...EVERY, ...EVERY].map(([seed]) => seed);
    const ids = await seedAll(dinamo.garage.id, seeds);
    const auth = bearer(dinamo.owner, 'garage');

    const first = await get('/garage/requests?status=quoted', auth);
    const second = await get(
      `/garage/requests?status=quoted&cursor=${first.body.nextCursor}`,
      auth,
    );

    expect(first.body.total).toBe(seeds.length);
    expect(first.body.items.map((i: { id: string }) => i.id)).toEqual(
      ids.slice(0, 20),
    );
    expect(second.body.items.map((i: { id: string }) => i.id)).toEqual(
      ids.slice(20),
    );
    expect(second.body.nextCursor).toBeNull();
  });

  it.each([
    ['owner', 'garage'],
    ['receptionist', 'receptionist'],
  ] as const)(
    'shows the %s the phone on accepted and confirmed rows only, and the plate from confirmation only',
    async (who, role) => {
      const dinamo = await team('Atelier Dinamo');
      const ids = await seedAll(
        dinamo.garage.id,
        EVERY.map(([seed]) => seed),
      );

      const res = await get(
        '/garage/requests?status=quoted',
        bearer(dinamo[who], role),
      );

      const accepted = ids[2];
      const confirmed = ids[3];
      for (const item of res.body.items) {
        expect([item.id, item.driver.phone]).toEqual([
          item.id,
          item.id === accepted || item.id === confirmed ? PHONE : undefined,
        ]);
        expect([item.id, item.car.plate]).toEqual([
          item.id,
          item.id === confirmed ? 'B123ABC' : undefined,
        ]);
      }
    },
  );

  it('never shows a mechanic the phone or the plate, whatever the outcome', async () => {
    const dinamo = await team('Atelier Dinamo');
    await seedAll(
      dinamo.garage.id,
      EVERY.map(([seed]) => seed),
    );

    const res = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.answering, 'mechanic'),
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(EVERY.length);
    expect(JSON.stringify(res.body)).not.toContain(PHONE);
    expect(JSON.stringify(res.body)).not.toContain('B123ABC');
  });

  it('answers 403 to a mechanic who may not answer quotes and 404 to a driver', async () => {
    const dinamo = await team('Atelier Dinamo');
    await seedAll(dinamo.garage.id, [{ quote: 'waiting' }]);

    const plain = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.plain, 'mechanic'),
    );
    const driver = await world.account('Ioana Pop');

    expect([plain.status, plain.body.code]).toEqual([403, 'forbidden']);
    expect(
      (await get('/garage/requests?status=quoted', bearer(driver, 'driver')))
        .status,
    ).toBe(404);
  });

  it('reads a suspended garage’s waiting quote as withdrawn for the suspension and keeps its accepted and booked ones', async () => {
    const dinamo = await team('Atelier Dinamo');
    const ids = await seedAll(dinamo.garage.id, [
      { quote: 'waiting' },
      {
        booking: 'awaiting_confirmation',
        quote: 'accepted',
        request: 'booked',
      },
      { booking: 'confirmed', quote: 'accepted', request: 'booked' },
    ]);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: dinamo.garage.id },
    });

    const res = await get(
      '/garage/requests?status=quoted',
      bearer(dinamo.owner, 'garage'),
    );

    expect(rows(res)).toEqual([
      [ids[0], 'withdrawn_suspended'],
      [ids[1], 'accepted'],
      [ids[2], 'booked'],
    ]);
    expect(res.body.items[0].quote.status).toBe('withdrawn');
  });

  it('carries no outcome on the waiting and closed reads nor on the single request', async () => {
    const dinamo = await team('Atelier Dinamo');
    const andrei = await world.account('Andrei Ion Marin');
    const waiting = await world.request(andrei);
    await world.recipient(waiting.id, dinamo.garage.id);
    const closed = await world.request(andrei, { status: 'closed' });
    await world.recipient(closed.id, dinamo.garage.id);
    const [quoted] = await seedAll(dinamo.garage.id, [{ quote: 'waiting' }]);
    const auth = bearer(dinamo.owner, 'garage');

    const open = await get('/garage/requests?status=waiting', auth);
    const shut = await get('/garage/requests?status=closed', auth);
    const one = await get(`/garage/requests/${quoted}`, auth);

    expect(open.body.items.map((i: { outcome: unknown }) => i.outcome)).toEqual(
      [null],
    );
    expect(shut.body.items.map((i: { outcome: unknown }) => i.outcome)).toEqual(
      [null],
    );
    expect(one.status).toBe(200);
    expect(one.body.outcome).toBeNull();
  });
});
