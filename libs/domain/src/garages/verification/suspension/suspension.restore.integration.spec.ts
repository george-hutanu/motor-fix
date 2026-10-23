import type { SuspensionCause } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';

import { SuspensionService } from './suspension.service';
import { staffedGarage } from './suspension.testing';
import type { AuditPort } from '../../../audit/audit.port';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { addDays, localDay } from '../../../bucharest';
import { type EventPort, outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { quotesWorld } from '../../../quotes/quotes.testing';

// @traces 067-FR-001 067-FR-002 067-FR-003 067-FR-004 067-FR-007 067-FR-011
// @traces 067-FR-013 067-FR-014

const reader = countedMetrics();
const restoresCounted = (cause: string) =>
  counterTotal(reader, 'motorfix_garage_restores_total', { cause });
const okRechecksCounted = () =>
  counterTotal(reader, 'motorfix_rechecks_total', { result: 'ok' });
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';
const NOTE = 'A trimis autorizația reînnoită, verificată în registru.';
const MISSING_RO = 'Lipsește o reverificare RAR valabilă';
const MISSING_EN = 'A valid RAR re-check is missing';
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
        body: error.getResponse() as {
          code?: string;
          field?: string;
          message?: string;
        },
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

const today = () => localDay(new Date());
const ago = (days: number) => addDays(today(), -days);
const dayOf = (at: Date | null) => at?.toISOString().slice(0, 10) ?? null;

// The history is append-only: the suspension the setup wrote stays, and is
// left out of what a restore is judged by.
const history = (garageId: string, kind?: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: {
      kind: kind ?? { not: 'garage_suspended' },
      subjectId: garageId,
      subjectType: 'garage',
    },
  });
const eventsOf = (garageId: string, kind?: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { createdAt: 'asc' },
    where: { kind, subjectId: garageId },
  });
const rows = (garageId: string) =>
  prisma.garageSuspension.findMany({
    orderBy: { fromTime: 'asc' },
    where: { garageId },
  });
const garageRow = (garageId: string) =>
  prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
const rechecks = (garageId: string) =>
  prisma.recheck.findMany({ where: { garageId } });

let admin: Actor;
let garage: Awaited<ReturnType<typeof staffedGarage>>;

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  garage = await staffedGarage(prisma, account);
  await prisma.garage.update({
    data: {
      lastCheckedOn: new Date(ago(40)),
      rarActivities: ['mechanics', 'brakes'],
    },
    where: { id: garage.id },
  });
  admin = person(await account('Ioana Popa', ['admin']), 'admin');
});

afterAll(() => prisma.$disconnect());

// The garage suspended through the use case; what it wrote is not under test.
async function suspended(cause: SuspensionCause) {
  await service().suspend(admin, garage.id, cause, REASON);
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  const [row] = await rows(garage.id);
  if (!row) throw new Error('no suspension');
  return row;
}

async function englishAdmin() {
  return person(
    await account('Jane Doe', ['admin'], { language: 'en' }),
    'admin',
  );
}

// Nothing a refused restore may touch moved.
async function untouched(before: { untilTime: Date | null }) {
  expect((await garageRow(garage.id)).status).toBe('suspended');
  const [row] = await rows(garage.id);
  expect(row).toMatchObject({
    liftedBy: null,
    liftNote: null,
    untilTime: null,
  });
  expect(before.untilTime).toBeNull();
  expect(await history(garage.id)).toEqual([]);
  expect(await eventsOf(garage.id)).toEqual([]);
}

describe('the lift columns of a suspension', () => {
  it('exist, may be empty, and leave a suspension written without them open', async () => {
    const columns = await prisma.$queryRaw<
      { column_name: string; is_nullable: string; data_type: string }[]
    >`
      SELECT column_name, is_nullable, data_type FROM information_schema.columns
      WHERE table_name = 'garage_suspension' AND column_name IN ('lifted_by', 'lift_note')
      ORDER BY column_name`;
    expect(columns).toEqual([
      { column_name: 'lift_note', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'lifted_by', data_type: 'uuid', is_nullable: 'YES' },
    ]);

    await prisma.$executeRaw`
      INSERT INTO garage_suspension (garage_id, cause, reason, from_time)
      VALUES (${garage.id}::uuid, 'admin', ${REASON}, now())`;

    const [row] = await rows(garage.id);
    expect(row).toMatchObject({
      liftedBy: null,
      liftNote: null,
      untilTime: null,
    });
  });
});

describe('restoring a garage suspended for a failed re-check', () => {
  it('records the valid re-check sent with it and puts the garage back on the map', async () => {
    const open = await suspended('recheck_failed');
    const restoresBefore = await restoresCounted('recheck_failed');
    const okBefore = await okRechecksCounted();
    const checkedOn = ago(1);

    const restored = await service().restore(admin, garage.id, {
      note: NOTE,
      recheck: { activities: ['mechanics', 'brakes'], checkedOn },
    });

    expect(restored).toEqual({
      cause: 'recheck_failed',
      fromTime: open.fromTime.toISOString(),
      garageId: garage.id,
      id: open.id,
      lastCheckedOn: checkedOn,
      liftedBy: { name: 'Ioana P.' },
      note: NOTE,
      untilTime: expect.any(String),
    });
    expect(Date.parse(restored.untilTime)).toBeGreaterThanOrEqual(
      open.fromTime.getTime(),
    );

    const [row] = await rows(garage.id);
    expect(row).toMatchObject({ liftedBy: admin.accountId, liftNote: NOTE });
    expect(row?.untilTime?.toISOString()).toBe(restored.untilTime);

    const after = await garageRow(garage.id);
    expect(after.status).toBe('approved');
    expect(dayOf(after.lastCheckedOn)).toBe(checkedOn);
    expect(after.rarActivities).toEqual(['mechanics', 'brakes']);

    const [recheck] = await rechecks(garage.id);
    expect(recheck).toMatchObject({
      rarActivities: ['mechanics', 'brakes'],
      recordedBy: admin.accountId,
      result: 'ok',
    });
    expect(dayOf(recheck?.checkedOn ?? null)).toBe(checkedOn);

    expect(
      (await history(garage.id)).map((entry) => entry.kind).sort(),
    ).toEqual(['garage_restored', 'recheck_recorded']);
    const [entry] = await history(garage.id, 'garage_restored');
    expect(entry).toMatchObject({
      action: 'update',
      actorId: admin.accountId,
      actorName: 'Ioana',
      actorRole: 'admin',
      field: 'status',
      garageId: garage.id,
      oldValue: 'suspended',
      text: NOTE,
    });
    expect(entry?.newValue).toEqual({
      cause: 'recheck_failed',
      evidence: { checkedOn, recheckId: recheck?.id },
      note: NOTE,
      status: 'approved',
    });

    expect((await eventsOf(garage.id)).map((e) => e.kind).sort()).toEqual([
      'garage.restored',
      'recheck.recorded',
    ]);
    const [event] = await eventsOf(garage.id, 'garage.restored');
    expect(event?.payload).toEqual({
      cause: 'recheck_failed',
      garageId: garage.id,
    });
    expect([...(event?.audience ?? [])].sort()).toEqual(
      [
        'admin',
        `garage:${garage.id}`,
        `public:garage:${garage.id}`,
        'public:search',
      ].sort(),
    );

    expect(await restoresCounted('recheck_failed')).toBe(restoresBefore + 1);
    expect(await okRechecksCounted()).toBe(okBefore + 1);
  });

  it('tells the price list when the re-check narrowed the activities', async () => {
    await suspended('recheck_failed');

    await service().restore(admin, garage.id, {
      recheck: { activities: ['mechanics'], checkedOn: today() },
    });

    expect((await garageRow(garage.id)).rarActivities).toEqual(['mechanics']);
    expect(await eventsOf(garage.id, 'price_list.updated')).toHaveLength(1);
  });

  it('accepts a re-check dated on the day the suspension began', async () => {
    await suspended('recheck_failed');

    const restored = await service().restore(admin, garage.id, {
      recheck: { activities: ['brakes'], checkedOn: today() },
    });

    expect(restored.lastCheckedOn).toBe(today());
  });

  it('takes a valid re-check already recorded since the suspension began', async () => {
    const open = await suspended('recheck_failed');
    const before = await garageRow(garage.id);
    const existing = await prisma.recheck.create({
      data: {
        checkedOn: new Date(today()),
        garageId: garage.id,
        rarActivities: ['mechanics'],
        recordedAt: new Date(open.fromTime.getTime() + 1000),
        result: 'ok',
      },
    });

    const restored = await service().restore(admin, garage.id, {});

    expect(restored.lastCheckedOn).toBe(dayOf(before.lastCheckedOn));
    expect(await rechecks(garage.id)).toHaveLength(1);
    expect(dayOf((await garageRow(garage.id)).lastCheckedOn)).toBe(
      dayOf(before.lastCheckedOn),
    );
    const [entry] = await history(garage.id, 'garage_restored');
    expect(entry?.newValue).toMatchObject({
      evidence: { recheckId: existing.id },
    });
    expect(await eventsOf(garage.id, 'recheck.recorded')).toEqual([]);
  });

  it.each([
    ['no re-check at all', null],
    ['only a valid re-check recorded before the suspension', -60_000],
  ])('refuses with 409 recheck_missing when there is %s', async (_, offset) => {
    const open = await suspended('recheck_failed');
    if (offset !== null) {
      await prisma.recheck.create({
        data: {
          checkedOn: new Date(ago(2)),
          garageId: garage.id,
          rarActivities: ['mechanics'],
          recordedAt: new Date(open.fromTime.getTime() + offset),
          result: 'ok',
        },
      });
    }

    const res = await refusal(service().restore(admin, garage.id, {}));

    expect([res.status, res.body.code, res.body.message]).toEqual([
      409,
      'recheck_missing',
      MISSING_RO,
    ]);
    await untouched(open);
  });

  it("answers in the admin's language", async () => {
    await suspended('recheck_failed');

    const res = await refusal(
      service().restore(await englishAdmin(), garage.id, {}),
    );

    expect(res.body.message).toBe(MISSING_EN);
  });

  it.each([
    ['on the day of the last check', () => ago(40)],
    ['before the last check', () => ago(41)],
    ['after today', () => addDays(today(), 1)],
  ])('refuses a re-check dated %s with 422 naming the date', async (_, day) => {
    const open = await suspended('recheck_failed');

    const res = await refusal(
      service().restore(admin, garage.id, {
        recheck: { activities: ['mechanics'], checkedOn: day() },
      }),
    );

    expect([res.status, res.body.code, res.body.field]).toEqual([
      422,
      'recheck_date_invalid',
      'checkedOn',
    ]);
    await untouched(open);
    expect(await rechecks(garage.id)).toEqual([]);
  });

  it.each([
    ['an unknown activity', ['flying'], 'recheck_activity_unknown'],
    [
      'an activity the garage does not hold',
      ['steering'],
      'recheck_activities_wider',
    ],
  ])(
    'refuses %s with 422 naming the activities',
    async (_, activities, code) => {
      const open = await suspended('recheck_failed');

      const res = await refusal(
        service().restore(admin, garage.id, {
          recheck: { activities, checkedOn: today() },
        }),
      );

      expect([res.status, res.body.code, res.body.field]).toEqual([
        422,
        code,
        'activities',
      ]);
      await untouched(open);
      expect(await rechecks(garage.id)).toEqual([]);
    },
  );
});

describe('restoring a garage suspended for overdue yearly documents', () => {
  const cycle = (state: 'due' | 'overdue') =>
    prisma.documentCycle.create({
      data: {
        dueOn: new Date(addDays(today(), 300)),
        garageId: garage.id,
        state,
      },
    });

  it('puts it back on the map once both documents were accepted', async () => {
    await suspended('documents_overdue');
    await cycle('due');

    const restored = await service().restore(admin, garage.id, {});

    expect(restored).toMatchObject({ cause: 'documents_overdue', note: null });
    expect((await garageRow(garage.id)).status).toBe('approved');
    const [entry] = await history(garage.id, 'garage_restored');
    expect(entry?.newValue).toEqual({
      cause: 'documents_overdue',
      evidence: { documents: 'due' },
      note: null,
      status: 'approved',
    });
    expect((await eventsOf(garage.id)).map((e) => e.kind)).toEqual([
      'garage.restored',
    ]);
  });

  it('keeps an optional note', async () => {
    await suspended('documents_overdue');
    await cycle('due');

    await service().restore(admin, garage.id, { note: NOTE });

    const [row] = await rows(garage.id);
    expect(row?.liftNote).toBe(NOTE);
  });

  it.each([
    ['still overdue', 'overdue' as const],
    ['with no cycle at all', null],
  ])(
    'refuses with 409 documents_not_valid when the cycle is %s',
    async (_, state) => {
      const open = await suspended('documents_overdue');
      if (state) await cycle(state);

      const res = await refusal(service().restore(admin, garage.id, {}));

      expect([res.status, res.body.code, res.body.message]).toEqual([
        409,
        'documents_not_valid',
        'Documentele anuale nu sunt toate valabile',
      ]);
      await untouched(open);
    },
  );
});

describe.each(['admin', 'report_confirmed'] as const)(
  'restoring a garage suspended for %s',
  (cause) => {
    it('puts it back on the map with the note of what was fixed', async () => {
      await suspended(cause);

      const restored = await service().restore(admin, garage.id, {
        note: NOTE,
      });

      expect(restored).toMatchObject({ cause, note: NOTE });
      const [entry] = await history(garage.id, 'garage_restored');
      expect(entry?.newValue).toEqual({
        cause,
        evidence: { note: true },
        note: NOTE,
        status: 'approved',
      });
      expect(entry?.text).toBe(NOTE);
    });

    it('refuses without a note with 400 naming the note', async () => {
      const open = await suspended(cause);

      const res = await refusal(service().restore(admin, garage.id, {}));

      expect([res.status, res.body.code, res.body.field]).toEqual([
        400,
        'validation_failed',
        'note',
      ]);
      await untouched(open);
    });
  },
);

describe.each(['documents_overdue', 'admin', 'report_confirmed'] as const)(
  'a re-check sent for a garage suspended for %s',
  (cause) => {
    it('is refused with 422 recheck_not_expected', async () => {
      const open = await suspended(cause);
      await prisma.documentCycle.create({
        data: {
          dueOn: new Date(addDays(today(), 300)),
          garageId: garage.id,
          state: 'due',
        },
      });

      const res = await refusal(
        service().restore(admin, garage.id, {
          note: NOTE,
          recheck: { activities: ['mechanics'], checkedOn: today() },
        }),
      );

      expect([res.status, res.body.code, res.body.field]).toEqual([
        422,
        'recheck_not_expected',
        'recheck',
      ]);
      await untouched(open);
      expect(await rechecks(garage.id)).toEqual([]);
    });
  },
);

describe('a garage that cannot be restored', () => {
  it('refuses an approved garage never suspended with 409 garage_not_suspended', async () => {
    const res = await refusal(
      service().restore(admin, garage.id, { note: NOTE }),
    );

    expect([res.status, res.body.code]).toEqual([409, 'garage_not_suspended']);
    expect(await history(garage.id)).toEqual([]);
    expect(await eventsOf(garage.id)).toEqual([]);
  });

  it('refuses a draft garage with 409 garage_not_suspended', async () => {
    await prisma.garage.update({
      data: { status: 'draft' },
      where: { id: garage.id },
    });

    const res = await refusal(
      service().restore(admin, garage.id, { note: NOTE }),
    );

    expect([res.status, res.body.code]).toEqual([409, 'garage_not_suspended']);
    expect((await garageRow(garage.id)).status).toBe('draft');
  });

  it('names the admin who already restored it, however long ago', async () => {
    await suspended('admin');
    await service().restore(admin, garage.id, { note: NOTE });
    await prisma.garageSuspension.updateMany({
      data: { untilTime: new Date(Date.now() - 90 * 86_400_000) },
      where: { garageId: garage.id },
    });
    const second = person(await account('Dan Ene', ['admin']), 'admin');

    const res = await refusal(
      service().restore(second, garage.id, { note: NOTE }),
    );

    expect([res.status, res.body.code, res.body.message]).toEqual([
      409,
      'garage_already_restored',
      'Deja repus pe hartă de Ioana P.',
    ]);
    expect(await history(garage.id, 'garage_restored')).toHaveLength(1);
  });

  it.each([
    ['an unknown id', '7d3c1a52-8d6e-4f0b-9d5e-2f7f3c8b1a90'],
    ['a malformed id', 'not-a-uuid'],
  ])('answers 404 not_found for %s', async (_, id) => {
    const res = await refusal(service().restore(admin, id, { note: NOTE }));

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });

  it.each([
    ['a driver', 'driver'],
    ['the owner', 'garage'],
    ['a receptionist', 'receptionist'],
    ['a mechanic', 'mechanic'],
  ] as const)('refuses %s with 404 and changes nothing', async (_, role) => {
    const open = await suspended('admin');
    const accountId = {
      driver: garage.driverId,
      garage: garage.ownerId,
      mechanic: garage.mechanicId,
      receptionist: garage.receptionistId,
    }[role];
    const actor = person(accountId, role, role === 'driver' ? null : garage.id);

    const res = await refusal(
      service().restore(actor, garage.id, { note: NOTE }),
    );

    expect(res.status).toBe(404);
    expect(res.body.message).not.toContain(garage.name);
    await untouched(open);
  });
});

describe('a failed write undoes the whole restore', () => {
  it('rolls back the inline re-check too when the event cannot be written', async () => {
    const open = await suspended('recheck_failed');
    const before = await garageRow(garage.id);
    const failing: EventPort = {
      record: () => Promise.reject(new Error('outbox down')),
    };

    await expect(
      service(failing).restore(admin, garage.id, {
        recheck: { activities: ['mechanics'], checkedOn: today() },
      }),
    ).rejects.toThrow('outbox down');

    await untouched(open);
    expect(await rechecks(garage.id)).toEqual([]);
    const after = await garageRow(garage.id);
    expect(after.lastCheckedOn).toEqual(before.lastCheckedOn);
    expect(after.rarActivities).toEqual(before.rarActivities);
  });

  it('rolls back when the history entry cannot be written', async () => {
    const open = await suspended('admin');
    const audit = new AuditService();
    audit.record = () => Promise.reject(new Error('audit down'));

    await expect(
      service(outbox, audit).restore(admin, garage.id, { note: NOTE }),
    ).rejects.toThrow('audit down');

    await untouched(open);
  });
});

describe('two admins at once', () => {
  it('commit exactly one restore; the other learns who did it', async () => {
    await suspended('admin');
    const dan = person(await account('Dan Ene', ['admin']), 'admin');

    const results = await Promise.allSettled([
      service().restore(admin, garage.id, { note: NOTE }),
      service().restore(dan, garage.id, { note: NOTE }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [lost] = results.filter((r) => r.status === 'rejected');
    const res = await refusal(Promise.reject(lost?.reason));
    const [row] = await rows(garage.id);
    const winner = row?.liftedBy === admin.accountId ? 'Ioana P.' : 'Dan E.';
    expect([res.status, res.body.code, res.body.message]).toEqual([
      409,
      'garage_already_restored',
      `Deja repus pe hartă de ${winner}`,
    ]);
    expect(await history(garage.id, 'garage_restored')).toHaveLength(1);
    expect(await eventsOf(garage.id, 'garage.restored')).toHaveLength(1);
    expect(row?.untilTime?.getTime()).toBeGreaterThanOrEqual(
      row?.fromTime.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });
});

describe('a garage suspended more than once', () => {
  it('lifts only the open suspension and leaves the ended one as it was', async () => {
    await suspended('admin');
    await service().restore(admin, garage.id, { note: NOTE });
    const [first] = await rows(garage.id);
    const dan = person(await account('Dan Ene', ['admin']), 'admin');
    await service().suspend(dan, garage.id, 'report_confirmed', REASON);

    await service().restore(dan, garage.id, {
      note: 'Raportul a fost lămurit.',
    });

    const [earlier, latest] = await rows(garage.id);
    expect(earlier).toEqual(first);
    expect(latest).toMatchObject({
      cause: 'report_confirmed',
      liftedBy: dan.accountId,
      liftNote: 'Raportul a fost lămurit.',
    });
    expect(latest?.untilTime).not.toBeNull();
  });
});

describe('what the suspension cancelled', () => {
  it('stays cancelled, closed and withdrawn, and its drivers are told nothing', async () => {
    const w = quotesWorld(prisma);
    const andrei = await account('Andrei Marin');
    const request = await w.request(andrei, { status: 'quoted' });
    const quote = await w.quote(request.id, garage.id, 'withdrawn');
    const booked = await w.request(andrei, { status: 'quoted' });
    const accepted = await w.quote(booked.id, garage.id, 'accepted');
    await w.booking(accepted.id, 'cancelled');
    await suspended('admin');
    const snapshot = async () => ({
      bookings: await prisma.booking.findMany({
        where: { garageId: garage.id },
      }),
      quotes: await prisma.quote.findMany({ where: { garageId: garage.id } }),
      requests: await prisma.quoteRequest.findMany({
        where: { id: { in: [request.id, booked.id] } },
      }),
    });
    const before = await snapshot();

    await service().restore(admin, garage.id, { note: NOTE });

    expect(await snapshot()).toEqual(before);
    expect(before.quotes.map((q) => q.id)).toContain(quote.id);
    const written = await prisma.outboxEvent.findMany();
    expect(written.map((e) => e.kind)).toEqual(['garage.restored']);
    expect(
      written
        .flatMap((e) => e.audience)
        .filter((a) => a.startsWith('account:')),
    ).toEqual([]);
  });
});
