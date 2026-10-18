import type { SuspensionCause } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';

import { SuspensionService } from './suspension.service';
import { staffedGarage } from './suspension.testing';
import type { AuditPort } from '../../../audit/audit.port';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { type EventPort, outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { quotesWorld } from '../../../quotes/quotes.testing';

// @traces 049-FR-001 049-FR-002 049-FR-003 049-FR-004 049-FR-014 049-FR-015
// @traces 069-report-decision-FR-004

const reader = countedMetrics();
const suspensions = (cause: string) =>
  counterTotal(reader, 'motorfix_garage_suspensions_total', { cause });
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const CAUSES: SuspensionCause[] = [
  'recheck_failed',
  'documents_overdue',
  'admin',
  'report_confirmed',
];
const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';
const SYSTEM = { accountId: null, role: 'system' } as const;
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const service = (
  events: EventPort = outbox,
  audit: AuditPort = new AuditService(),
) => new SuspensionService(prisma, audit, events);

const person = (
  accountId: string,
  role: Actor['role'],
  garageId: string | null = null,
): Actor => ({ accountId, garageId, permissions: NONE, role, roles: [role] });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        body: error.getResponse() as { code?: string; message?: string },
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

const history = (garageId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId: garageId, subjectType: 'garage' },
  });
const events = (garageId: string) =>
  prisma.outboxEvent.findMany({ where: { subjectId: garageId } });
const rows = (garageId: string) =>
  prisma.garageSuspension.findMany({ where: { garageId } });
const status = async (garageId: string) =>
  (await prisma.garage.findUniqueOrThrow({ where: { id: garageId } })).status;

let admin: Actor;
let garage: Awaited<ReturnType<typeof staffedGarage>>;

beforeEach(async () => {
  await reset();
  garage = await staffedGarage(prisma, account);
  admin = person(await account('Ioana Popa', ['admin']), 'admin');
});

afterAll(() => prisma.$disconnect());

describe('suspending an approved garage', () => {
  it.each(CAUSES)(
    'writes the suspension, the status, one history entry and one event for %s',
    async (cause) => {
      const before = await suspensions(cause);

      const created = await service().suspend(admin, garage.id, cause, REASON);

      const [row] = await rows(garage.id);
      expect(await rows(garage.id)).toHaveLength(1);
      expect(row).toMatchObject({
        cause,
        garageId: garage.id,
        id: created.id,
        reason: REASON,
        suspendedBy: admin.accountId,
        untilTime: null,
      });
      expect(row?.fromTime).toBeInstanceOf(Date);
      expect(await status(garage.id)).toBe('suspended');

      const entries = await history(garage.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action: 'update',
        actorId: admin.accountId,
        actorName: 'Ioana',
        actorRole: 'admin',
        field: 'status',
        garageId: garage.id,
        kind: 'garage_suspended',
        newValue: 'suspended',
        oldValue: 'approved',
        text: `${cause}: ${REASON}`,
      });

      const written = await events(garage.id);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        kind: 'garage.suspended',
        payload: { cause, garageId: garage.id },
      });
      expect(written[0]?.audience).toEqual(
        expect.arrayContaining([
          'admin',
          `garage:${garage.id}`,
          `public:garage:${garage.id}`,
          'public:search',
        ]),
      );
      expect(await suspensions(cause)).toBe(before + 1);
    },
  );

  it('answers the created suspension', async () => {
    const created = await service().suspend(admin, garage.id, 'admin', REASON);

    expect(created).toEqual({
      cause: 'admin',
      fromTime: expect.any(Date),
      garageId: garage.id,
      id: expect.any(String),
      reason: REASON,
    });
  });

  it('accepts the system actor and writes it as MotorFix', async () => {
    await service().suspend(SYSTEM, garage.id, 'documents_overdue', REASON);

    const [entry] = await history(garage.id);
    expect(entry).toMatchObject({
      actorId: null,
      actorName: 'MotorFix',
      actorRole: 'system',
    });
    const [row] = await rows(garage.id);
    expect(row?.suspendedBy).toBeNull();
  });

  it('keeps the members, the mechanics and the rating', async () => {
    await prisma.garage.update({
      data: { rating: '4.5', reviewCount: 12 },
      where: { id: garage.id },
    });

    await service().suspend(admin, garage.id, 'admin', REASON);

    const after = await prisma.garage.findUniqueOrThrow({
      include: { mechanics: true, members: true },
      where: { id: garage.id },
    });
    expect(after.members).toHaveLength(2);
    expect(after.mechanics).toHaveLength(1);
    expect(after.reviewCount).toBe(12);
    expect(after.rating?.toString()).toBe('4.5');
    expect(after.approvedAt).not.toBeNull();
  });
});

describe('a failed write undoes the whole suspension', () => {
  const nothingChanged = async () => {
    expect(await status(garage.id)).toBe('approved');
    expect(await rows(garage.id)).toHaveLength(0);
    expect(await history(garage.id)).toHaveLength(0);
    expect(await events(garage.id)).toHaveLength(0);
  };

  it('rolls back when the event cannot be written', async () => {
    const broken: EventPort = {
      record: () => Promise.reject(new Error('outbox down')),
    };

    await expect(
      service(broken).suspend(admin, garage.id, 'admin', REASON),
    ).rejects.toThrow('outbox down');

    await nothingChanged();
  });

  it('rolls back when the history entry cannot be written', async () => {
    const audit = new AuditService();
    audit.record = () => Promise.reject(new Error('audit down'));

    await expect(
      service(outbox, audit).suspend(admin, garage.id, 'admin', REASON),
    ).rejects.toThrow('audit down');

    await nothingChanged();
  });
});

describe('suspending inside the caller’s transaction', () => {
  it('commits with the caller and counts nothing itself', async () => {
    const before = await suspensions('report_confirmed');

    await prisma.$transaction((tx) =>
      service().suspendIn(tx, admin, garage.id, 'report_confirmed', REASON),
    );

    expect(await status(garage.id)).toBe('suspended');
    expect(await rows(garage.id)).toHaveLength(1);
    expect(await suspensions('report_confirmed')).toBe(before);
  });

  it('leaves no suspension when the caller’s transaction rolls back', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await service().suspendIn(tx, admin, garage.id, 'admin', REASON);
        throw new Error('caller failed');
      }),
    ).rejects.toThrow('caller failed');

    expect(await status(garage.id)).toBe('approved');
    expect(await rows(garage.id)).toHaveLength(0);
    expect(await history(garage.id)).toHaveLength(0);
    expect(await events(garage.id)).toHaveLength(0);
  });

  it('reads the open suspension’s cause, and none once it is lifted', async () => {
    expect(
      await prisma.$transaction((tx) =>
        service().openSuspension(tx, garage.id),
      ),
    ).toBeNull();

    await service().suspend(admin, garage.id, 'recheck_failed', REASON);
    expect(
      await prisma.$transaction((tx) =>
        service().openSuspension(tx, garage.id),
      ),
    ).toEqual({ cause: 'recheck_failed' });

    await prisma.garageSuspension.updateMany({
      data: { untilTime: new Date() },
      where: { garageId: garage.id },
    });
    expect(
      await prisma.$transaction((tx) =>
        service().openSuspension(tx, garage.id),
      ),
    ).toBeNull();
  });
});

describe('a garage that cannot be suspended', () => {
  it('refuses an already suspended garage and records only the attempt', async () => {
    await service().suspend(admin, garage.id, 'recheck_failed', REASON);
    const dan = person(await account('Dan Ene', ['admin']), 'admin');

    const res = await refusal(
      service().suspend(dan, garage.id, 'report_confirmed', 'Raport confirmat'),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('garage_already_suspended');
    const all = await rows(garage.id);
    expect(all).toHaveLength(1);
    expect(all[0]?.cause).toBe('recheck_failed');
    expect(await events(garage.id)).toHaveLength(1);
    const entries = await history(garage.id);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      actorId: dan.accountId,
      actorName: 'Dan',
      actorRole: 'admin',
      field: 'status',
      kind: 'garage_suspension_refused',
      newValue: 'suspended',
      oldValue: 'suspended',
      text: 'report_confirmed: Raport confirmat',
    });
  });

  it('still answers 409 when the refused attempt cannot be written', async () => {
    await service().suspend(admin, garage.id, 'recheck_failed', REASON);
    const audit = new AuditService();
    audit.record = () => Promise.reject(new Error('audit down'));

    const res = await refusal(
      service(outbox, audit).suspend(admin, garage.id, 'admin', REASON),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('garage_already_suspended');
    expect(await rows(garage.id)).toHaveLength(1);
    expect(await history(garage.id)).toHaveLength(1);
  });

  it('refuses a draft garage and writes nothing', async () => {
    await prisma.garage.update({
      data: { approvedAt: null, status: 'draft' },
      where: { id: garage.id },
    });

    const res = await refusal(
      service().suspend(admin, garage.id, 'admin', REASON),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('garage_not_approved');
    expect(await status(garage.id)).toBe('draft');
    expect(await rows(garage.id)).toHaveLength(0);
    expect(await history(garage.id)).toHaveLength(0);
    expect(await events(garage.id)).toHaveLength(0);
  });

  it.each([
    ['an unknown id', '7d3c1a52-8d6e-4f0b-9d5e-2f7f3c8b1a90'],
    ['a malformed id', 'not-a-uuid'],
  ])('answers 404 not_found for %s', async (_, id) => {
    const res = await refusal(service().suspend(admin, id, 'admin', REASON));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it.each([
    ['a driver', 'driver'],
    ['the owner', 'garage'],
    ['a receptionist', 'receptionist'],
    ['a mechanic', 'mechanic'],
  ] as const)('refuses %s with 404 and changes nothing', async (_, role) => {
    const accountId = {
      driver: garage.driverId,
      garage: garage.ownerId,
      mechanic: garage.mechanicId,
      receptionist: garage.receptionistId,
    }[role];
    const actor = person(accountId, role, role === 'driver' ? null : garage.id);

    const res = await refusal(
      service().suspend(actor, garage.id, 'admin', REASON),
    );

    expect(res.status).toBe(404);
    expect(await status(garage.id)).toBe('approved');
    expect(await history(garage.id)).toHaveLength(0);
  });
});

describe('two admins at once', () => {
  it('leaves exactly one suspension, one event and one refusal', async () => {
    const dan = person(await account('Dan Ene', ['admin']), 'admin');

    const results = await Promise.allSettled([
      service().suspend(admin, garage.id, 'admin', REASON),
      service().suspend(dan, garage.id, 'recheck_failed', REASON),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [lost] = results.filter((r) => r.status === 'rejected');
    expect(
      ((lost as PromiseRejectedResult).reason as HttpException).getStatus(),
    ).toBe(409);
    expect(await rows(garage.id)).toHaveLength(1);
    expect(await events(garage.id)).toHaveLength(1);
    const kinds = (await history(garage.id)).map((e) => e.kind).sort();
    expect(kinds).toEqual(['garage_suspended', 'garage_suspension_refused']);
  });

  it('refuses a second open suspension written outside the use case', async () => {
    await service().suspend(admin, garage.id, 'admin', REASON);

    await expect(
      prisma.garageSuspension.create({
        data: {
          cause: 'admin',
          fromTime: new Date(),
          garageId: garage.id,
          reason: REASON,
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses a blank or overlong reason in the database', async () => {
    for (const reason of ['   ', 'x'.repeat(201)]) {
      await expect(
        prisma.garageSuspension.create({
          data: {
            cause: 'admin',
            fromTime: new Date(),
            garageId: garage.id,
            reason,
          },
        }),
      ).rejects.toThrow();
    }
  });
});

// @traces 313-FR-010
// @traces 313-FR-017
describe('suspending a garage with quotes still waiting', () => {
  const world = () => quotesWorld(prisma);
  const withdrawals = () =>
    prisma.outboxEvent.findMany({ where: { kind: 'quote.withdrawn' } });

  // The outbox hangs off none of the rows the reset empties.
  beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE outbox_event'));

  async function quotes() {
    const w = world();
    const andrei = await account('Andrei Marin');
    const maria = await account('Maria Ionescu');
    const first = await w.request(andrei, { status: 'quoted' });
    const second = await w.request(maria, { status: 'quoted' });
    const waiting = await w.quote(first.id, garage.id);
    const alsoWaiting = await w.quote(second.id, garage.id);
    const other = await w.request(andrei, { status: 'quoted' });
    await w.quote(other.id, garage.id, 'expired');
    const done = await w.request(maria, { status: 'quoted' });
    await w.quote(done.id, garage.id, 'withdrawn');
    return { alsoWaiting, andrei, first, maria, second, waiting };
  }

  it('tells each waiting quote’s driver the quote is withdrawn because of the suspension', async () => {
    const { alsoWaiting, andrei, first, maria, second, waiting } =
      await quotes();

    await service().suspend(admin, garage.id, 'admin', REASON);

    const events = await withdrawals();
    expect(events).toHaveLength(2);
    const byQuote = new Map(events.map((e) => [e.subjectId, e] as const));
    expect(byQuote.get(waiting.id)?.payload).toEqual({
      quoteId: waiting.id,
      reason: 'suspended',
      requestId: first.id,
    });
    expect(byQuote.get(alsoWaiting.id)?.payload).toEqual({
      quoteId: alsoWaiting.id,
      reason: 'suspended',
      requestId: second.id,
    });
    expect([...(byQuote.get(waiting.id)?.audience ?? [])].sort()).toEqual(
      [`account:${andrei}`, `garage:${garage.id}`].sort(),
    );
    expect([...(byQuote.get(alsoWaiting.id)?.audience ?? [])].sort()).toEqual(
      [`account:${maria}`, `garage:${garage.id}`].sort(),
    );
  });

  it('records none when the suspension rolls back', async () => {
    await quotes();
    const audit = new AuditService();
    audit.record = () => Promise.reject(new Error('audit down'));

    await expect(
      service(outbox, audit).suspend(admin, garage.id, 'admin', REASON),
    ).rejects.toThrow('audit down');

    expect(await withdrawals()).toHaveLength(0);
  });

  it('records none for a garage with no waiting quote', async () => {
    await service().suspend(admin, garage.id, 'admin', REASON);

    expect(await withdrawals()).toHaveLength(0);
  });
});
