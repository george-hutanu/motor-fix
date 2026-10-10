import { randomUUID } from 'node:crypto';

import { DeclineService } from './decline.service';
import type { AuditPort } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { outbox } from '../../events/event.port';
import { writeResponseStats } from '../../insights/response-stats/response-stats';
import { garageActor } from '../quotes.testing';
import { quotesApp } from '../quotes-api.testing';

const { bearer, post, team, world } = quotesApp();
const { prisma } = world;

// The outbox hangs off none of the rows the world empties, and the log is
// append-only: each case reads both from its own start.
let since: Date;
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  [{ since }] = await prisma.$queryRaw<
    { since: Date }[]
  >`SELECT now() AS since`;
});

const logged = () =>
  prisma.activityLog.count({
    where: {
      at: { gte: since },
      subjectType: { in: ['request_recipient', 'quote_request'] },
    },
  });

// A driver's request sent to Atelier Dinamo, which has not answered yet.
async function open() {
  const andrei = await world.account('Andrei Ion Marin');
  const dinamo = await team('Atelier Dinamo');
  const request = await world.request(andrei);
  const recipient = await world.recipient(request.id, dinamo.garage.id);
  return { andrei, dinamo, recipient, request };
}

const decline = (requestId: string, body: unknown, auth: string) =>
  post(`/garage/requests/${requestId}/decline`, body, auth);

const asOwner = (t: { owner: string }) => bearer(t.owner, 'garage');

async function stillWaiting(recipientId: string) {
  const row = await prisma.requestRecipient.findUniqueOrThrow({
    where: { id: recipientId },
  });
  expect(row).toMatchObject({
    answeredAt: null,
    declinedAt: null,
    declinedBy: null,
    declineReason: null,
    status: 'waiting',
  });
  expect(await prisma.outboxEvent.count()).toBe(0);
  expect(await logged()).toBe(0);
}

// @traces 345-FR-001
describe('POST /garage/requests/:id/decline, the body', () => {
  it.each([
    ['missing', {}],
    ['empty', { reason: '' }],
    ['unknown', { reason: 'too_far' }],
    ['not a string', { reason: 3 }],
  ])(
    'answers 400 validation_failed naming reason when it is %s',
    async (_, body) => {
      const { dinamo, recipient, request } = await open();

      const res = await decline(request.id, body, asOwner(dinamo));

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('reason');
      await stillWaiting(recipient.id);
    },
  );

  it('answers 400 to a request id that is not a uuid', async () => {
    const { dinamo } = await open();

    const res = await decline(
      'not-a-uuid',
      { reason: 'fully_booked' },
      asOwner(dinamo),
    );

    expect(res.status).toBe(400);
  });

  it('answers 401 without a session', async () => {
    const { recipient, request } = await open();

    const res = await post(`/garage/requests/${request.id}/decline`, {
      reason: 'fully_booked',
    });

    expect(res.status).toBe(401);
    await stillWaiting(recipient.id);
  });
});

// @traces 345-FR-002
// @traces 345-FR-003
// @traces 345-FR-005
describe('POST /garage/requests/:id/decline', () => {
  it.each([
    ['owner', 'garage'],
    ['receptionist', 'receptionist'],
    ['answering', 'mechanic'],
  ] as const)(
    'lets the %s decline, filed under their account',
    async (who, role) => {
      const { dinamo, recipient, request } = await open();

      const res = await decline(
        request.id,
        { reason: 'need_to_see_car' },
        bearer(dinamo[who], role),
      );

      expect(res.status).toBe(200);
      const row = await prisma.requestRecipient.findUniqueOrThrow({
        where: { id: recipient.id },
      });
      expect(row.declinedBy).toBe(dinamo[who]);
    },
  );

  it('moves the recipient to declined with every column and answers it as the garage reads it', async () => {
    const { dinamo, recipient, request } = await open();

    const res = await decline(
      request.id,
      { reason: 'make_model_engine_not_done' },
      asOwner(dinamo),
    );

    expect(res.status).toBe(200);
    const row = await prisma.requestRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    });
    expect(row).toMatchObject({
      declinedBy: dinamo.owner,
      declineReason: 'make_model_engine_not_done',
      declineToldAt: null,
      status: 'declined',
    });
    expect(row.declinedAt).not.toBeNull();
    expect(row.answeredAt).toEqual(row.declinedAt);
    expect(Date.now() - (row.declinedAt as Date).getTime()).toBeLessThan(
      60_000,
    );
    expect(res.body).toEqual({
      answeredAt: (row.answeredAt as Date).toISOString(),
      declinedAt: (row.declinedAt as Date).toISOString(),
      declineReason: 'make_model_engine_not_done',
      source: row.source,
      status: 'declined',
    });
    const after = await prisma.quoteRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.status).toBe('sent');
  });

  it('files one status entry with the reason and records one request.declined for the garage only', async () => {
    const { andrei, dinamo, recipient, request } = await open();

    await decline(request.id, { reason: 'fully_booked' }, asOwner(dinamo));

    const entries = await prisma.activityLog.findMany({
      where: { at: { gte: since }, subjectId: recipient.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: dinamo.owner,
      actorRole: 'owner',
      field: 'status',
      garageId: dinamo.garage.id,
      newValue: { reason: 'fully_booked', status: 'declined' },
      oldValue: 'waiting',
      subjectType: 'request_recipient',
      viaAssistant: false,
    });
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'request.declined',
      payload: {
        driverId: andrei,
        garageId: dinamo.garage.id,
        reason: 'fully_booked',
        recipientId: recipient.id,
        requestId: request.id,
      },
      subjectId: recipient.id,
    });
    expect([...events[0].audience]).toEqual([`garage:${dinamo.garage.id}`]);
  });

  it('marks the entry as the assistant’s when a grant declined', async () => {
    const { dinamo, recipient, request } = await open();
    const service = new DeclineService(prisma, new AuditService(), outbox);
    const grant = randomUUID();

    const answer = await service.decline(
      {
        ...garageActor(dinamo.owner, dinamo.garage.id),
        assistantGrantId: grant,
        via: 'assistant',
      },
      request.id,
      'job_not_done',
    );

    expect(answer.status).toBe('declined');
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { subjectId: recipient.id, subjectType: 'request_recipient' },
    });
    expect(entry).toMatchObject({
      assistantGrantId: grant,
      viaAssistant: true,
    });
  });

  it('writes nothing when a step of the decline fails', async () => {
    const { dinamo, recipient, request } = await open();
    const real = new AuditService();
    const failing: AuditPort = {
      record: async (tx, entry) => {
        await real.record(tx, entry);
        throw new Error('audit down');
      },
      recordChanges: (...args) => real.recordChanges(...args),
      recordMany: (...args) => real.recordMany(...args),
    };
    const service = new DeclineService(prisma, failing, outbox);

    await expect(
      service.decline(
        garageActor(dinamo.owner, dinamo.garage.id),
        request.id,
        'fully_booked',
      ),
    ).rejects.toThrow('audit down');

    await stillWaiting(recipient.id);
  });
});

// @traces 345-FR-020
describe('the response rate after a decline', () => {
  it('counts a declined recipient as answered', async () => {
    const { dinamo, request } = await open();
    await prisma.garage.update({
      data: { status: 'approved' },
      where: { id: dinamo.garage.id },
    });
    await decline(request.id, { reason: 'fully_booked' }, asOwner(dinamo));

    await writeResponseStats(prisma, new Date());

    const stats = await prisma.garageResponseStats.findUniqueOrThrow({
      where: { garageId: dinamo.garage.id },
    });
    expect(stats).toMatchObject({
      answeredWithinDay30d: 1,
      rate: 100,
      requests30d: 1,
    });
  });
});
