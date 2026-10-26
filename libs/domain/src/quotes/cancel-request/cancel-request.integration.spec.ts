import { randomUUID } from 'node:crypto';

import type { QuoteRequestStatus } from '../../generated/prisma/enums';
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

const asDriver = (id: string) => bearer(id, 'driver');
const cancel = (requestId: string, auth?: string) =>
  post(`/quote-requests/${requestId}/cancel`, {}, auth);

// Andrei's request, sent to Volt Auto and Garaj Nordic, neither answering.
async function sent() {
  const andrei = await world.account('Andrei Ion Marin');
  const volt = await team('Volt Auto');
  const nordic = await team('Garaj Nordic');
  const request = await world.request(andrei, { status: 'sent' });
  const toNordic = await world.recipient(request.id, nordic.garage.id);
  const toVolt = await world.recipient(request.id, volt.garage.id);
  return { andrei, nordic, request, toNordic, toVolt, volt };
}

// The same request once Volt Auto has answered with a waiting quote.
async function quoted() {
  const andrei = await world.account('Andrei Ion Marin');
  const volt = await team('Volt Auto');
  const nordic = await team('Garaj Nordic');
  const request = await world.request(andrei, { status: 'quoted' });
  const toNordic = await world.recipient(request.id, nordic.garage.id);
  const quote = await world.quote(request.id, volt.garage.id);
  return { andrei, nordic, quote, request, toNordic, volt };
}

const entries = (subjectId: string) =>
  prisma.activityLog.findMany({
    where: { at: { gte: since }, field: 'status', subjectId },
  });

// @traces 1258-driver-cancel-FR-001
// @traces 1258-driver-cancel-FR-012
describe('POST /quote-requests/:id/cancel', () => {
  it('closes a sent request as cancelled, closing every waiting recipient', async () => {
    const { andrei, request, toNordic, toVolt } = await sent();

    const res = await cancel(request.id, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      closedReason: 'cancelled',
      id: request.id,
      status: 'closed',
    });
    const row = await prisma.quoteRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(row.status).toBe('closed');
    expect(row.closedReason).toBe('cancelled');
    expect(row.closedAt).toBeInstanceOf(Date);
    for (const recipient of [toNordic, toVolt]) {
      expect(
        (
          await prisma.requestRecipient.findUniqueOrThrow({
            where: { id: recipient.id },
          })
        ).status,
      ).toBe('closed');
    }
  });

  it('closes a quoted request, losing the waiting quote, with every move filed and one event', async () => {
    const { andrei, nordic, quote, request, toNordic, volt } = await quoted();

    const res = await cancel(request.id, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('lost');
    expect(
      (
        await prisma.requestRecipient.findUniqueOrThrow({
          where: { id: toNordic.id },
        })
      ).status,
    ).toBe('closed');
    expect(await entries(request.id)).toEqual([
      expect.objectContaining({
        actorId: andrei,
        newValue: 'closed',
        oldValue: 'quoted',
      }),
    ]);
    expect(await entries(quote.id)).toEqual([
      expect.objectContaining({ newValue: 'lost', oldValue: 'waiting' }),
    ]);
    expect(await entries(toNordic.id)).toEqual([
      expect.objectContaining({ newValue: 'closed', oldValue: 'waiting' }),
    ]);
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'request.cancelled',
      subjectId: request.id,
    });
    expect(events[0].payload).toEqual({
      garageIds: expect.arrayContaining([volt.garage.id, nordic.garage.id]),
      reason: 'driver',
      requestId: request.id,
    });
    expect(
      (events[0].payload as { garageIds: string[] }).garageIds,
    ).toHaveLength(2);
    expect([...events[0].audience].sort()).toEqual(
      [
        `account:${andrei}`,
        `garage:${volt.garage.id}`,
        `garage:${nordic.garage.id}`,
      ].sort(),
    );
  });

  it('leaves a recipient that declined as it was', async () => {
    const { andrei, request, volt } = await sent();
    const declined = await prisma.requestRecipient.update({
      data: {
        answeredAt: new Date(),
        declinedAt: new Date(),
        declinedBy: volt.owner,
        declineReason: 'fully_booked',
        status: 'declined',
      },
      where: {
        requestId_garageId: { garageId: volt.garage.id, requestId: request.id },
      },
    });

    expect((await cancel(request.id, asDriver(andrei))).status).toBe(200);

    expect(
      (
        await prisma.requestRecipient.findUniqueOrThrow({
          where: { id: declined.id },
        })
      ).status,
    ).toBe('declined');
  });

  it('answers 404 to another driver, to a missing request and to a garage session, changing nothing', async () => {
    const { request, volt } = await sent();
    const vlad = await world.account('Vlad Popescu');

    expect((await cancel(request.id, asDriver(vlad))).status).toBe(404);
    expect((await cancel(randomUUID(), asDriver(vlad))).status).toBe(404);
    expect(
      (await cancel(request.id, bearer(volt.owner, 'garage'))).status,
    ).toBe(404);
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('sent');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('answers 401 without a session and 400 to an id that is not a uuid', async () => {
    const { andrei, request } = await sent();

    const anonymous = await cancel(request.id);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('sign_in_required');
    expect((await cancel('not-an-id', asDriver(andrei))).status).toBe(400);
  });
});

// @traces 1258-driver-cancel-FR-001
describe('POST /quote-requests/:id/cancel refused', () => {
  it.each(['booked', 'in_work', 'done', 'closed'] as const)(
    'answers 409 naming a %s request, writing nothing',
    async (status: QuoteRequestStatus) => {
      const { andrei, request } = await sent();
      await prisma.quoteRequest.update({
        data: {
          status,
          ...(status === 'closed' && {
            closedAt: new Date(),
            closedReason: 'expired',
          }),
        },
        where: { id: request.id },
      });

      const res = await cancel(request.id, asDriver(andrei));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: status,
        to: 'closed',
      });
      expect(
        (
          await prisma.quoteRequest.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).status,
      ).toBe(status);
      expect(
        await prisma.requestRecipient.count({
          where: { requestId: request.id, status: 'closed' },
        }),
      ).toBe(0);
      expect(await prisma.outboxEvent.count()).toBe(0);
    },
  );
});
