import { randomUUID } from 'node:crypto';

import type { SendQuoteDto } from '@motor-fix/contracts';

import { QuotesService } from './quotes.service';
import type { AuditPort } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { addLocalDays } from '../../bucharest';
import { outbox } from '../../events/event.port';
import { garageActor } from '../quotes.testing';
import { quotesApp } from '../quotes-api.testing';

const { bearer, post, team, world } = quotesApp();
const { prisma } = world;

// The outbox hangs off none of the rows the world empties, and the log is
// append-only: each case reads the log from its own start, by the
// database's clock.
let since: Date;
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  [{ since }] = await prisma.$queryRaw<
    { since: Date }[]
  >`SELECT now() AS since`;
});

const MOVED = ['quote', 'request_recipient', 'quote_request'];
const logged = () =>
  prisma.activityLog.count({
    where: { at: { gte: since }, subjectType: { in: MOVED } },
  });

const HOUR = 3_600_000;
const NOTE = 'Piesele originale le comandăm noi';

const sendBody = (requestId: string, over: Record<string, unknown> = {}) => ({
  durationMinutes: 120,
  fromLei: 650,
  note: NOTE,
  requestId,
  slot: new Date(Date.now() + 48 * HOUR).toISOString(),
  toLei: 800,
  ...over,
});

// A driver's request sent to Atelier Dinamo, which has not answered yet.
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

const asOwner = (t: { owner: string }) => bearer(t.owner, 'garage');

async function nothingWritten(requestId: string) {
  expect(await prisma.quote.count({ where: { requestId } })).toBe(0);
  expect(await prisma.outboxEvent.count()).toBe(0);
  expect(await logged()).toBe(0);
}

// @traces 344-FR-003
// @traces 344-FR-006
describe('POST /quotes', () => {
  it('sends the quote: stored in bani, valid seven days, the recipient and the request moved to quoted', async () => {
    const { dinamo, recipient, request } = await open();
    const body = sendBody(request.id, { note: `  ${NOTE}  ` });
    const key = randomUUID();

    const res = await post('/quotes', body, asOwner(dinamo), key);

    expect(res.status).toBe(201);
    const [row] = await prisma.quote.findMany({
      where: { requestId: request.id },
    });
    expect(row).toMatchObject({
      durationMinutes: 120,
      fromBani: 65_000,
      garageId: dinamo.garage.id,
      idempotencyKey: key,
      note: NOTE,
      recipientId: recipient.id,
      status: 'waiting',
      toBani: 80_000,
    });
    expect(row.slot.toISOString()).toBe(body.slot);
    expect(Date.now() - row.sentAt.getTime()).toBeLessThan(60_000);
    expect(row.expiresAt).toEqual(addLocalDays(row.sentAt, 7));
    expect(res.body).toEqual({
      acceptedAt: null,
      changedAt: null,
      durationMinutes: 120,
      expiresAt: row.expiresAt.toISOString(),
      fromBani: 65_000,
      id: row.id,
      jobs: [expect.objectContaining({ included: false })],
      note: NOTE,
      sentAt: row.sentAt.toISOString(),
      slot: body.slot,
      status: 'waiting',
      toBani: 80_000,
      withdrawnAt: null,
    });
    const moved = await prisma.requestRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    });
    expect(moved.status).toBe('quoted');
    expect(moved.answeredAt).not.toBeNull();
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('quoted');
  });

  it('leaves a request another garage already quoted as quoted', async () => {
    const { dinamo, request } = await open({ status: 'quoted' });
    const militari = await team('Service Militari');
    await world.quote(request.id, militari.garage.id);

    const res = await post(
      '/quotes',
      sendBody(request.id),
      asOwner(dinamo),
      randomUUID(),
    );

    expect(res.status).toBe(201);
    const after = await prisma.quoteRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(after.status).toBe('quoted');
    expect(
      await prisma.activityLog.count({
        where: { subjectId: request.id, subjectType: 'quote_request' },
      }),
    ).toBe(0);
  });

  it('includes each asked job as the garage ticked it for the car’s brand', async () => {
    const { dinamo, request } = await open();
    const mini = await prisma.brand.create({
      data: { key: 'mini', name: 'Mini', slug: 'mini' },
    });
    const [oil] = await prisma.requestJob.findMany({
      where: { requestId: request.id },
    });
    const brakes = await world.jobType('Frâne față', 'Front brakes');
    const asked = await prisma.requestJob.create({
      data: { jobTypeId: brakes.id, position: 1, requestId: request.id },
    });
    await prisma.garageBrand.create({
      data: {
        brandId: mini.id,
        garageId: dinamo.garage.id,
        stance: 'works_on',
      },
    });
    await prisma.garageBrandJob.create({
      data: {
        brandId: mini.id,
        garageId: dinamo.garage.id,
        jobTypeId: oil.jobTypeId,
      },
    });

    const res = await post(
      '/quotes',
      sendBody(request.id),
      asOwner(dinamo),
      randomUUID(),
    );

    expect(res.status).toBe(201);
    expect(res.body.jobs).toHaveLength(2);
    expect(res.body.jobs).toEqual(
      expect.arrayContaining([
        { included: true, requestJobId: oil.id },
        { included: false, requestJobId: asked.id },
      ]),
    );
    expect(
      await prisma.quoteJob.count({ where: { quoteId: res.body.id } }),
    ).toBe(2);
  });

  it('writes no quote job for a request with no job', async () => {
    const { dinamo, request } = await open();
    await prisma.requestJob.deleteMany({ where: { requestId: request.id } });

    const res = await post(
      '/quotes',
      sendBody(request.id),
      asOwner(dinamo),
      randomUUID(),
    );

    expect(res.status).toBe(201);
    expect(res.body.jobs).toEqual([]);
    expect(await prisma.quoteJob.count()).toBe(0);
  });

  it('records one quote.sent event for the garage and the driver, and the entry without the note’s text', async () => {
    const { andrei, dinamo, request } = await open();
    const body = sendBody(request.id);

    const res = await post('/quotes', body, asOwner(dinamo), randomUUID());

    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'quote.sent',
      payload: {
        driverId: andrei,
        garageId: dinamo.garage.id,
        quoteId: res.body.id,
        requestId: request.id,
      },
      subjectId: res.body.id,
    });
    expect([...events[0].audience].sort()).toEqual(
      [`account:${andrei}`, `garage:${dinamo.garage.id}`].sort(),
    );
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { subjectId: res.body.id, subjectType: 'quote' },
    });
    expect(entry).toMatchObject({
      action: 'create',
      actorId: dinamo.owner,
      actorRole: 'owner',
      garageId: dinamo.garage.id,
      newValue: {
        durationMinutes: 120,
        fromLei: 650,
        noteSet: true,
        slot: body.slot,
        toLei: 800,
      },
      viaAssistant: false,
    });
    expect(JSON.stringify(entry)).not.toContain(NOTE);
    expect(
      await prisma.activityLog.count({
        where: {
          at: { gte: since },
          field: 'status',
          subjectType: 'request_recipient',
        },
      }),
    ).toBe(1);
  });

  it('marks the entry as the assistant’s when a grant sent the quote', async () => {
    const { dinamo, request } = await open();
    const service = new QuotesService(prisma, new AuditService(), outbox);
    const grant = randomUUID();

    const quote = await service.send(
      {
        ...garageActor(dinamo.owner, dinamo.garage.id),
        assistantGrantId: grant,
        via: 'assistant',
      },
      randomUUID(),
      sendBody(request.id) as SendQuoteDto,
    );

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { subjectId: quote.id, subjectType: 'quote' },
    });
    expect(entry).toMatchObject({
      assistantGrantId: grant,
      viaAssistant: true,
    });
  });

  it('writes nothing when a step of the send fails', async () => {
    const { dinamo, recipient, request } = await open();
    const real = new AuditService();
    const failing: AuditPort = {
      record: async (tx, entry) => {
        if (entry.subjectType === 'quote') throw new Error('audit down');
        await real.record(tx, entry);
      },
      recordChanges: (...args) => real.recordChanges(...args),
    };
    const service = new QuotesService(prisma, failing, outbox);

    await expect(
      service.send(
        garageActor(dinamo.owner, dinamo.garage.id),
        randomUUID(),
        sendBody(request.id) as SendQuoteDto,
      ),
    ).rejects.toThrow('audit down');

    await nothingWritten(request.id);
    expect(await prisma.quoteJob.count()).toBe(0);
    expect(
      (
        await prisma.requestRecipient.findUniqueOrThrow({
          where: { id: recipient.id },
        })
      ).status,
    ).toBe('waiting');
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('sent');
  });
});

// @traces 344-FR-004
// @traces 344-FR-005
describe('POST /quotes on a request the garage cannot answer', () => {
  it('answers 409 already_answered to a second quote from the garage', async () => {
    const { dinamo, request } = await open();
    await post('/quotes', sendBody(request.id), asOwner(dinamo), randomUUID());

    const res = await post(
      '/quotes',
      sendBody(request.id, { fromLei: 500 }),
      bearer(dinamo.receptionist, 'receptionist'),
      randomUUID(),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_answered');
    expect(await prisma.quote.count()).toBe(1);
  });

  it.each([
    ['quoted', 0],
    ['declined inside its undo window', 0],
    ['declined past its undo window', 10 * 60_000],
  ])(
    'answers 409 already_answered when the recipient is %s',
    async (state, declinedAgo) => {
      const status = state === 'quoted' ? 'quoted' : 'declined';
      const { dinamo, recipient, request } = await open({}, status);
      if (declinedAgo > 0) {
        const at = new Date(Date.now() - declinedAgo);
        await prisma.requestRecipient.update({
          data: { answeredAt: at, declinedAt: at },
          where: { id: recipient.id },
        });
      }

      const res = await post(
        '/quotes',
        sendBody(request.id),
        asOwner(dinamo),
        randomUUID(),
      );

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('already_answered');
      await nothingWritten(request.id);
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
            data: { closedReason: 'expired' },
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
      const { dinamo, request } = await open(
        { status: closing.request ?? 'sent' },
        closing.recipient ?? 'waiting',
      );
      await closing.after?.({
        garageId: dinamo.garage.id,
        requestId: request.id,
      });

      const res = await post(
        '/quotes',
        sendBody(request.id),
        asOwner(dinamo),
        randomUUID(),
      );

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('request_not_open');
      await nothingWritten(request.id);
    },
  );

  it('ends two sends at once with one quote and one 409 already_answered', async () => {
    const { dinamo, request } = await open();

    const answers = await Promise.all([
      post('/quotes', sendBody(request.id), asOwner(dinamo), randomUUID()),
      post(
        '/quotes',
        sendBody(request.id, { toLei: 900 }),
        bearer(dinamo.receptionist, 'receptionist'),
        randomUUID(),
      ),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(answers.find((a) => a.status === 409)?.body.code).toBe(
      'already_answered',
    );
    expect(await prisma.quote.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('answers a repeated key from the same garage with the first answer and writes nothing more', async () => {
    const { dinamo, request } = await open();
    const key = randomUUID();
    const first = await post(
      '/quotes',
      sendBody(request.id),
      asOwner(dinamo),
      key,
    );
    const before = await logged();

    const again = await post(
      '/quotes',
      sendBody(request.id, { fromLei: 100 }),
      bearer(dinamo.receptionist, 'receptionist'),
      key,
    );

    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await prisma.quote.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
    expect(await logged()).toBe(before);
  });

  it('keeps another garage’s use of the same key apart', async () => {
    const { dinamo, request } = await open();
    const militari = await team('Service Militari');
    await world.recipient(request.id, militari.garage.id);
    const key = randomUUID();

    const ours = await post(
      '/quotes',
      sendBody(request.id),
      asOwner(dinamo),
      key,
    );
    const theirs = await post(
      '/quotes',
      sendBody(request.id),
      asOwner(militari),
      key,
    );

    expect(ours.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(theirs.body.id).not.toBe(ours.body.id);
  });

  it('leaves the key of a refused send free for the next one', async () => {
    const { dinamo, request } = await open({ status: 'booked' });
    const other = await world.request(await world.account('Ioana Pop'));
    await world.recipient(other.id, dinamo.garage.id);
    const key = randomUUID();

    const refused = await post(
      '/quotes',
      sendBody(request.id),
      asOwner(dinamo),
      key,
    );
    const sent = await post(
      '/quotes',
      sendBody(other.id),
      asOwner(dinamo),
      key,
    );

    expect(refused.status).toBe(409);
    expect(sent.status).toBe(201);
    expect(sent.body.id).toBeDefined();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['over 200 characters', 'k'.repeat(201)],
  ])('answers 400 naming the key when it is %s', async (_, key) => {
    const { dinamo, request } = await open();

    const res = await post(
      '/quotes',
      sendBody(request.id),
      asOwner(dinamo),
      key,
    );

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'idempotency-key' }),
    ]);
    await nothingWritten(request.id);
  });

  it('takes a key of exactly 200 characters', async () => {
    const { dinamo, request } = await open();

    const res = await post(
      '/quotes',
      sendBody(request.id),
      asOwner(dinamo),
      'k'.repeat(200),
    );

    expect(res.status).toBe(201);
  });
});

// @traces 344-FR-001
// @traces 344-FR-002
describe('POST /quotes who may send and what', () => {
  it.each([
    ['owner', 'garage'],
    ['receptionist', 'receptionist'],
    ['answering', 'mechanic'],
  ] as const)('lets the %s send the quote', async (who, role) => {
    const { dinamo, request } = await open();

    const res = await post(
      '/quotes',
      sendBody(request.id),
      bearer(dinamo[who], role),
      randomUUID(),
    );

    expect(res.status).toBe(201);
  });

  it('answers 403 forbidden to a mechanic of the garage who may not answer quotes', async () => {
    const { dinamo, request } = await open();

    const res = await post(
      '/quotes',
      sendBody(request.id),
      bearer(dinamo.plain, 'mechanic'),
      randomUUID(),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    await nothingWritten(request.id);
  });

  it('answers 404 to another garage, to a driver and on a request not sent to the garage', async () => {
    const { andrei, dinamo, request } = await open();
    const militari = await team('Service Militari');
    const notSent = await world.request(andrei);

    const answers = await Promise.all([
      post('/quotes', sendBody(request.id), asOwner(militari), randomUUID()),
      post(
        '/quotes',
        sendBody(request.id),
        bearer(militari.answering, 'mechanic'),
        randomUUID(),
      ),
      post(
        '/quotes',
        sendBody(request.id),
        bearer(andrei, 'driver'),
        randomUUID(),
      ),
      post('/quotes', sendBody(notSent.id), asOwner(dinamo), randomUUID()),
    ]);

    expect(answers.map((a) => a.status)).toEqual([404, 404, 404, 404]);
    await nothingWritten(request.id);
    await nothingWritten(notSent.id);
  });

  it.each([
    ['requestId', { requestId: 'not-a-uuid' }],
    ['fromLei', { fromLei: undefined }],
    ['fromLei', { fromLei: 0 }],
    ['fromLei', { fromLei: 650.5 }],
    ['fromLei', { fromLei: '650' }],
    ['toLei', { toLei: 1_000_001 }],
    ['fromLei', { fromLei: 900, toLei: 800 }],
    ['durationMinutes', { durationMinutes: 0 }],
    ['durationMinutes', { durationMinutes: 7_215 }],
    ['durationMinutes', { durationMinutes: 125 }],
    ['slot', { slot: new Date(Date.now() - 60_000).toISOString() }],
    ['slot', { slot: '2030-01-01T09:00:00' }],
    ['slot', { slot: 'mâine' }],
    ['note', { note: 'a'.repeat(501) }],
  ])('answers 400 naming %s for %j', async (field, over) => {
    const { dinamo, request } = await open();

    const res = await post(
      '/quotes',
      sendBody(request.id, over),
      asOwner(dinamo),
      randomUUID(),
    );

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
    await nothingWritten(request.id);
  });

  it('takes the price bounds and the duration bounds themselves', async () => {
    const { dinamo, request } = await open();

    const res = await post(
      '/quotes',
      sendBody(request.id, {
        durationMinutes: 7_200,
        fromLei: 1,
        note: 'a'.repeat(500),
        toLei: 1_000_000,
      }),
      asOwner(dinamo),
      randomUUID(),
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ fromBani: 100, toBani: 100_000_000 });
  });

  it('stores a note of whitespace alone as no note', async () => {
    const { dinamo, request } = await open();

    const res = await post(
      '/quotes',
      sendBody(request.id, { note: '   ' }),
      asOwner(dinamo),
      randomUUID(),
    );

    expect(res.status).toBe(201);
    expect(res.body.note).toBeNull();
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { subjectId: res.body.id, subjectType: 'quote' },
    });
    expect(entry.newValue).toMatchObject({ noteSet: false });
  });
});
