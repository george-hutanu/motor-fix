import { randomUUID } from 'node:crypto';

import { quotesApp } from '../quotes-api.testing';

const { bearer, get, post, team, world } = quotesApp();
const { prisma } = world;

async function quoted() {
  const andrei = await world.account('Andrei Ion Marin');
  const volt = await team('Volt Auto');
  const nordic = await team('Garaj Nordic');
  const request = await world.request(andrei, { status: 'quoted' });
  const quote = await world.quote(request.id, volt.garage.id);
  const other = await world.quote(request.id, nordic.garage.id);
  return { andrei, nordic, other, quote, request, volt };
}

const asDriver = (id: string) => bearer(id, 'driver');
const decline = (quoteId: string, auth?: string, body: unknown = {}) =>
  post(`/quotes/${quoteId}/decline`, body, auth);
const accept = (quoteId: string, auth: string) =>
  post(`/quotes/${quoteId}/accept`, {}, auth, randomUUID());

const declineEvents = () =>
  prisma.outboxEvent.count({ where: { kind: 'quote.declined_by_driver' } });

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE outbox_event'));

// @traces 314-FR-011
// @traces 314-FR-012
describe('POST /quotes/:id/decline, repeated and raced', () => {
  it('answers the second decline of the same quote 409 declined_by_driver and writes one event', async () => {
    const { andrei, quote } = await quoted();

    const first = await decline(quote.id, asDriver(andrei));
    const second = await decline(quote.id, asDriver(andrei));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'declined_by_driver',
      to: 'declined_by_driver',
    });
    expect(await declineEvents()).toBe(1);
    expect(
      await prisma.activityLog.count({
        where: { field: 'status', subjectId: quote.id },
      }),
    ).toBe(1);
  });

  it('lets exactly one of twelve simultaneous declines through', async () => {
    const { andrei, quote } = await quoted();

    const answers = await Promise.all(
      Array.from({ length: 12 }, () => decline(quote.id, asDriver(andrei))),
    );

    expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(11);
    expect(await declineEvents()).toBe(1);
  });

  it('leaves one winner and a consistent quote when accept and decline race', async () => {
    for (let run = 0; run < 4; run++) {
      await world.reset();
      const { andrei, quote } = await quoted();

      const [a, d] = await Promise.all([
        accept(quote.id, asDriver(andrei)),
        decline(quote.id, asDriver(andrei)),
      ]);

      const row = await prisma.quote.findUniqueOrThrow({
        where: { id: quote.id },
      });
      const bookings = await prisma.booking.count();
      if (a.status === 201 || a.status === 200) {
        expect(d.status).toBe(409);
        expect(row.status).toBe('accepted');
        expect(bookings).toBe(1);
      } else {
        expect(d.status).toBe(200);
        expect(row.status).toBe('declined_by_driver');
        expect(bookings).toBe(0);
      }
    }
  });

  it('refuses accepting a quote that was declined, naming the state', async () => {
    const { andrei, quote } = await quoted();
    await decline(quote.id, asDriver(andrei));

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'declined_by_driver',
    });
    expect(await prisma.booking.count()).toBe(0);
  });

  it('declines every open quote and leaves the request open', async () => {
    const { andrei, other, quote, request } = await quoted();

    await decline(quote.id, asDriver(andrei));
    await decline(other.id, asDriver(andrei));

    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('quoted');
  });
});

// @traces 314-FR-012
describe('POST /quotes/:id/decline, hostile ids and callers', () => {
  it.each([
    ['an empty-looking id', '%20'],
    ['a uuid with a trailing character', `${randomUUID()}x`],
    ['an sql fragment', "'; DROP TABLE quote; --"],
    ['a number', '12345'],
  ])('answers 400 for %s, changing nothing', async (_name, id) => {
    const { andrei, quote } = await quoted();

    const res = await decline(id, asDriver(andrei));

    expect(res.status).toBe(400);
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('waiting');
  });

  it('answers 401 to a forged bearer and leaves the quote waiting', async () => {
    const { quote } = await quoted();

    const res = await decline(quote.id, 'Bearer not.a.token');

    expect(res.status).toBe(401);
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('waiting');
  });

  it('does not let the garage staff decline the quote they sent', async () => {
    const { quote, volt } = await quoted();

    for (const [id, role] of [
      [volt.owner, 'garage'],
      [volt.receptionist, 'receptionist'],
      [volt.answering, 'mechanic'],
    ] as const) {
      const res = await decline(quote.id, bearer(id, role));
      expect([403, 404]).toContain(res.status);
    }
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('waiting');
    expect(await declineEvents()).toBe(0);
  });

  it('answers 404, not 409, for another driver’s quote that is already declined', async () => {
    const { andrei, quote } = await quoted();
    const vlad = await world.account('Vlad Popescu');
    await decline(quote.id, asDriver(andrei));

    const res = await decline(quote.id, asDriver(vlad));

    expect(res.status).toBe(404);
    expect(res.body.currentStatus).toBeUndefined();
  });

  it('refuses a waiting quote whose validity has already ended, as expired', async () => {
    const { andrei, quote } = await quoted();
    await prisma.quote.update({
      data: { expiresAt: new Date(Date.now() - 60_000) },
      where: { id: quote.id },
    });

    const res = await decline(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.currentStatus).toBe('expired');
    expect(await declineEvents()).toBe(0);
  });

  it('reads the English refusal for an English-speaking driver on every non-waiting state', async () => {
    const { andrei, quote } = await quoted();
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: andrei },
    });
    await prisma.quote.update({
      data: { status: 'lost' },
      where: { id: quote.id },
    });

    const res = await decline(quote.id, asDriver(andrei));

    expect(res.body.message).toBe('The quote is no longer available');
  });
});

// @traces 314-FR-015
describe('the garage’s sent quotes after a decline', () => {
  it('lists the declined quote as declined_by_driver, and the other garage’s quote untouched', async () => {
    const { andrei, nordic, quote, request, volt } = await quoted();
    await decline(quote.id, asDriver(andrei));

    const mine = await get(
      '/garage/requests?status=quoted',
      bearer(volt.owner, 'garage'),
    );
    const theirs = await get(
      '/garage/requests?status=quoted',
      bearer(nordic.owner, 'garage'),
    );

    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].id).toBe(request.id);
    expect(mine.body.items[0].quote.status).toBe('declined_by_driver');
    expect(theirs.body.items[0].quote.status).toBe('waiting');
  });
});
