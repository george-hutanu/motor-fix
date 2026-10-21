import { randomUUID } from 'node:crypto';

import { DeclineQuoteService } from './decline-quote.service';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { outbox } from '../../events/event.port';
import type { QuoteStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../quotes-api.testing';

const { bearer, post, team, world } = quotesApp();
const { prisma } = world;

let since: Date;
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  [{ since }] = await prisma.$queryRaw<
    { since: Date }[]
  >`SELECT now() AS since`;
});

// Andrei's request, quoted by Volt Auto and by Garaj Nordic.
async function quoted() {
  const andrei = await world.account('Andrei Ion Marin');
  const volt = await team('Volt Auto');
  const nordic = await team('Garaj Nordic');
  const request = await world.request(andrei, { status: 'quoted' });
  const quote = await world.quote(request.id, volt.garage.id);
  const other = await world.quote(request.id, nordic.garage.id);
  return { andrei, other, quote, request, volt };
}

const asDriver = (id: string) => bearer(id, 'driver');
const decline = (quoteId: string, auth?: string) =>
  post(`/quotes/${quoteId}/decline`, {}, auth);

const driverActor = (accountId: string, over: Partial<Actor> = {}): Actor => ({
  accountId,
  garageId: null,
  language: 'ro',
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
  ...over,
});

const entries = (quoteId: string) =>
  prisma.activityLog.findMany({
    where: { at: { gte: since }, subjectId: quoteId },
  });

// @traces 314-FR-011
// @traces 314-FR-013
describe('POST /quotes/:id/decline', () => {
  it('declines the waiting quote, stamped, leaving the request and the other quote as they were', async () => {
    const { andrei, other, quote, request } = await quoted();

    const res = await decline(quote.id, asDriver(andrei));

    expect(res.status).toBe(200);
    const row = await prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
    });
    expect(row.status).toBe('declined_by_driver');
    expect(row.declinedAt).toBeInstanceOf(Date);
    expect(res.body).toEqual({
      declinedAt: row.declinedAt?.toISOString(),
      id: quote.id,
      status: 'declined_by_driver',
    });
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('quoted');
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: other.id } }))
        .status,
    ).toBe('waiting');
  });

  it('files the move with its old and new status, and one event both sides hear', async () => {
    const { andrei, quote, request, volt } = await quoted();

    await decline(quote.id, asDriver(andrei));

    expect(await entries(quote.id)).toEqual([
      expect.objectContaining({
        actorId: andrei,
        field: 'status',
        newValue: 'declined_by_driver',
        oldValue: 'waiting',
      }),
    ]);
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'quote.declined_by_driver',
      payload: expect.objectContaining({
        garageId: volt.garage.id,
        quoteId: quote.id,
        requestId: request.id,
      }),
      subjectId: quote.id,
    });
    expect([...events[0].audience].sort()).toEqual(
      [`account:${andrei}`, `garage:${volt.garage.id}`].sort(),
    );
  });

  it('declines a quote held while a booking waits for another garage', async () => {
    const { andrei, other, quote } = await quoted();
    await post(
      `/quotes/${other.id}/accept`,
      {},
      asDriver(andrei),
      randomUUID(),
    );

    const res = await decline(quote.id, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('declined_by_driver');
  });

  // @traces 314-FR-020
  it('marks the entry as the assistant’s when a grant declined the quote', async () => {
    const { andrei, quote } = await quoted();
    const service = new DeclineQuoteService(prisma, new AuditService(), outbox);
    const grant = randomUUID();

    await service.decline(
      driverActor(andrei, { assistantGrantId: grant, via: 'assistant' }),
      quote.id,
    );

    expect(await entries(quote.id)).toEqual([
      expect.objectContaining({ assistantGrantId: grant, viaAssistant: true }),
    ]);
  });
});

// @traces 314-FR-012
describe('POST /quotes/:id/decline refused', () => {
  it.each([
    [
      'accepted',
      'Oferta a fost deja acceptată',
      'The quote was already accepted',
    ],
    ['expired', 'Oferta a expirat', 'The quote has expired'],
    [
      'withdrawn',
      'Service‑ul a retras oferta',
      'The garage withdrew the quote',
    ],
    [
      'lost',
      'Oferta nu mai este disponibilă',
      'The quote is no longer available',
    ],
    [
      'declined_by_driver',
      'Ai refuzat deja această ofertă',
      'You already declined this quote',
    ],
  ] as const)(
    'answers 409 naming a %s quote, in the driver’s language, changing nothing',
    async (status: QuoteStatus, ro, en) => {
      const { andrei, quote } = await quoted();
      await prisma.quote.update({ data: { status }, where: { id: quote.id } });

      const res = await decline(quote.id, asDriver(andrei));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: status,
        entity: 'quote',
        message: ro,
        to: 'declined_by_driver',
      });
      expect(await prisma.outboxEvent.count()).toBe(0);
      await prisma.account.update({
        data: { language: 'en' },
        where: { id: andrei },
      });
      expect((await decline(quote.id, asDriver(andrei))).body.message).toBe(en);
    },
  );

  it('reads a waiting quote of a suspended garage as withdrawn', async () => {
    const { andrei, quote, volt } = await quoted();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: volt.garage.id },
    });

    const res = await decline(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.currentStatus).toBe('withdrawn');
  });

  it('answers 404 to another driver, and to a quote that does not exist', async () => {
    const { quote } = await quoted();
    const vlad = await world.account('Vlad Popescu');

    expect((await decline(quote.id, asDriver(vlad))).status).toBe(404);
    expect((await decline(randomUUID(), asDriver(vlad))).status).toBe(404);
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('waiting');
  });

  it('answers 404 to the garage that sent the quote', async () => {
    const { quote, volt } = await quoted();

    const res = await decline(quote.id, bearer(volt.owner, 'garage'));

    expect([403, 404]).toContain(res.status);
  });

  it('answers 400 to an id that is not a uuid, and 401 without a session', async () => {
    const { andrei, quote } = await quoted();

    expect((await decline('not-an-id', asDriver(andrei))).status).toBe(400);
    const anonymous = await decline(quote.id);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('sign_in_required');
  });
});
