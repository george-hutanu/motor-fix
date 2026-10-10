import { randomUUID } from 'node:crypto';

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

const HOUR = 3_600_000;

// A driver's request sent to Atelier Dinamo.
async function open(
  options: Parameters<typeof world.request>[1] = {},
  status: Parameters<typeof world.recipient>[2] = 'waiting',
) {
  const andrei = await world.account('Andrei Ion Marin');
  const dinamo = await team('Atelier Dinamo');
  const request = await world.request(andrei, options);
  const recipient = await world.recipient(
    request.id,
    dinamo.garage.id,
    status,
    dinamo.owner,
  );
  return { andrei, dinamo, recipient, request };
}

const decline = (requestId: string, auth: string, reason = 'fully_booked') =>
  post(`/garage/requests/${requestId}/decline`, { reason }, auth);

const asOwner = (t: { owner: string }) => bearer(t.owner, 'garage');

async function nothingWritten(recipientId: string) {
  expect(await prisma.outboxEvent.count()).toBe(0);
  expect(
    await prisma.activityLog.count({
      where: { at: { gte: since }, subjectId: recipientId },
    }),
  ).toBe(0);
}

// @traces 345-FR-002
// @traces 345-FR-020
describe('POST /garage/requests/:id/decline who may decline', () => {
  it('answers 403 forbidden to a mechanic of the garage who may not answer quotes', async () => {
    const { dinamo, recipient, request } = await open();

    const res = await decline(request.id, bearer(dinamo.plain, 'mechanic'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    expect(res.body.message).toBe('Nu ai dreptul să răspunzi la cereri');
    await nothingWritten(recipient.id);
  });

  it('answers 404 to another garage, a driver, an admin and on a request not sent to the garage', async () => {
    const { andrei, dinamo, recipient, request } = await open();
    const militari = await team('Service Militari');
    const notSent = await world.request(andrei);
    const admin = await world.account('Ana Admin');

    const answers = await Promise.all([
      decline(request.id, asOwner(militari)),
      decline(request.id, bearer(militari.answering, 'mechanic')),
      decline(request.id, bearer(andrei, 'driver')),
      decline(request.id, bearer(admin, 'admin')),
      decline(notSent.id, asOwner(dinamo)),
      decline(randomUUID(), asOwner(dinamo)),
    ]);

    expect(answers.map((a) => a.status)).toEqual([
      404, 404, 404, 404, 404, 404,
    ]);
    await nothingWritten(recipient.id);
  });
});

// @traces 345-FR-004
// @traces 345-FR-020
describe('POST /garage/requests/:id/decline on a request the garage cannot answer', () => {
  it.each([
    ['quoted', 'quoted'],
    ['declined', 'declined'],
  ] as const)(
    'answers 409 already_answered when the recipient is %s',
    async (_, status) => {
      const { dinamo, recipient, request } = await open({}, status);

      const res = await decline(request.id, asOwner(dinamo));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('already_answered');
      expect(res.body.message).toBe(
        'Altcineva a răspuns deja la această cerere',
      );
      await nothingWritten(recipient.id);
    },
  );

  type Closing = {
    request?: 'booked' | 'closed';
    recipient?: 'expired' | 'closed';
    after?: (ids: { garageId: string; requestId: string }) => Promise<unknown>;
  };
  const CLOSINGS: [string, Closing][] = [
    ['cancelled request', { request: 'closed' }],
    [
      'expired request',
      {
        after: ({ requestId }) =>
          prisma.quoteRequest.update({
            data: {
              closedReason: 'expired',
              expiresAt: new Date(Date.now() - HOUR),
            },
            where: { id: requestId },
          }),
        request: 'closed',
      },
    ],
    ['booked request', { request: 'booked' }],
    ['expired recipient', { recipient: 'expired' }],
    ['closed recipient', { recipient: 'closed' }],
    [
      'suspended garage',
      {
        after: ({ garageId }) =>
          prisma.garage.update({
            data: { status: 'suspended' },
            where: { id: garageId },
          }),
      },
    ],
  ];

  it.each(CLOSINGS)(
    'answers 409 request_not_open to a %s and writes nothing',
    async (_, closing) => {
      const { dinamo, recipient, request } = await open(
        { status: closing.request ?? 'sent' },
        closing.recipient ?? 'waiting',
      );
      await closing.after?.({
        garageId: dinamo.garage.id,
        requestId: request.id,
      });

      const res = await decline(request.id, asOwner(dinamo));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('request_not_open');
      expect(res.body.message).toBe('Cererea nu mai este deschisă');
      await nothingWritten(recipient.id);
    },
  );

  it('ends two declines at once with one decline and one 409 already_answered', async () => {
    const { dinamo, recipient, request } = await open();

    const answers = await Promise.all([
      decline(request.id, asOwner(dinamo), 'fully_booked'),
      decline(
        request.id,
        bearer(dinamo.receptionist, 'receptionist'),
        'job_not_done',
      ),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect(answers.find((a) => a.status === 409)?.body.code).toBe(
      'already_answered',
    );
    expect(await prisma.outboxEvent.count()).toBe(1);
    const row = await prisma.requestRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    });
    expect(row.declineReason).toBe(
      answers[0].status === 200 ? 'fully_booked' : 'job_not_done',
    );
  });

  it('ends a decline beside a send with one answer and no 500', async () => {
    const { dinamo, request } = await open();

    const answers = await Promise.all([
      decline(request.id, asOwner(dinamo)),
      post(
        '/quotes',
        {
          durationMinutes: 120,
          fromLei: 650,
          requestId: request.id,
          slot: new Date(Date.now() + 48 * HOUR).toISOString(),
          toLei: 800,
        },
        bearer(dinamo.receptionist, 'receptionist'),
        randomUUID(),
      ),
    ]);

    const statuses = answers.map((a) => a.status);
    expect(statuses).toContain(409);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);
    expect(statuses.some((s) => s === 200 || s === 201)).toBe(true);
    expect(answers.find((a) => a.status === 409)?.body.code).toBe(
      'already_answered',
    );
  });
});
