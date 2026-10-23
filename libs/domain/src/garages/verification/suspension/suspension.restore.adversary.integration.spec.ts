import type { SuspensionCause } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';

import { SuspensionService } from './suspension.service';
import { staffedGarage } from './suspension.testing';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { addDays, localDay } from '../../../bucharest';
import { outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';

// @traces 067-FR-002 067-FR-003 067-FR-004

const reader = countedMetrics();
const restoresCounted = (cause: string) =>
  counterTotal(reader, 'motorfix_garage_restores_total', { cause });
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';
const NOTE = 'Rezolvat, verificat pe loc.';
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const service = () => new SuspensionService(prisma, new AuditService(), outbox);
const person = (accountId: string, role: Actor['role']): Actor => ({
  accountId,
  garageId: null,
  permissions: NONE,
  role,
  roles: [role],
});
const today = () => localDay(new Date());
const ago = (days: number) => addDays(today(), -days);

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

const rows = (garageId: string) =>
  prisma.garageSuspension.findMany({
    orderBy: { fromTime: 'asc' },
    where: { garageId },
  });
const garageRow = (garageId: string) =>
  prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
const restoredEntries = (garageId: string) =>
  prisma.activityLog.findMany({
    where: { kind: 'garage_restored', subjectId: garageId },
  });
const restoredEvents = (garageId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'garage.restored', subjectId: garageId },
  });

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

async function suspended(cause: SuspensionCause) {
  await service().suspend(admin, garage.id, cause, REASON);
  const [row] = await rows(garage.id);
  if (!row) throw new Error('no suspension');
  return row;
}

async function nothingWritten() {
  expect((await garageRow(garage.id)).status).toBe('suspended');
  const all = await rows(garage.id);
  expect(all.map((r) => [r.untilTime, r.liftedBy, r.liftNote])).toEqual(
    all.map(() => [null, null, null]),
  );
  expect(await restoredEntries(garage.id)).toEqual([]);
  expect(await restoredEvents(garage.id)).toEqual([]);
}

describe('who may restore', () => {
  it('refuses the system actor with 404: there is no system restore', async () => {
    await suspended('admin');
    const system = { accountId: null, role: 'system' } as unknown as Actor;

    const res = await refusal(
      service().restore(system, garage.id, { note: NOTE }),
    );

    expect(res.status).toBe(404);
    await nothingWritten();
  });
});

describe('the evidence of a garage suspended for overdue documents', () => {
  it('refuses with 409 documents_not_valid when the garage has no cycle at all', async () => {
    await suspended('documents_overdue');

    const res = await refusal(service().restore(admin, garage.id, {}));

    expect([res.status, res.body.code]).toEqual([409, 'documents_not_valid']);
    await nothingWritten();
  });

  it('refuses with 409 documents_not_valid while the cycle is overdue', async () => {
    await suspended('documents_overdue');
    await prisma.documentCycle.create({
      data: {
        dueOn: new Date(ago(3)),
        garageId: garage.id,
        state: 'overdue',
      },
    });

    const res = await refusal(
      service().restore(admin, garage.id, { note: NOTE }),
    );

    expect([res.status, res.body.code]).toEqual([409, 'documents_not_valid']);
    await nothingWritten();
  });
});

describe('the evidence of a garage suspended for a failed re-check', () => {
  it('does not take a failed re-check recorded after the suspension as the valid one', async () => {
    const open = await suspended('recheck_failed');
    await prisma.recheck.create({
      data: {
        checkedOn: new Date(today()),
        detail: 'Nu apare în registru',
        failure: 'expired',
        garageId: garage.id,
        rarActivities: [],
        recordedAt: new Date(open.fromTime.getTime() + 1000),
        result: 'failed',
      },
    });

    const res = await refusal(service().restore(admin, garage.id, {}));

    expect([res.status, res.body.code]).toEqual([409, 'recheck_missing']);
    await nothingWritten();
  });

  it('takes a valid re-check recorded at the very instant the suspension began', async () => {
    const open = await suspended('recheck_failed');
    await prisma.recheck.create({
      data: {
        checkedOn: new Date(today()),
        garageId: garage.id,
        rarActivities: ['mechanics'],
        recordedAt: open.fromTime,
        result: 'ok',
      },
    });

    await expect(
      service().restore(admin, garage.id, {}),
    ).resolves.toMatchObject({ cause: 'recheck_failed' });
  });

  it('records a re-check for a garage that was never checked before', async () => {
    await prisma.garage.update({
      data: { lastCheckedOn: null },
      where: { id: garage.id },
    });
    await suspended('recheck_failed');

    const res = await service().restore(admin, garage.id, {
      recheck: { activities: ['brakes'], checkedOn: today() },
    });

    expect(res.lastCheckedOn).toBe(today());
  });

  it('keeps each authorised activity once when the re-check names one twice', async () => {
    await suspended('recheck_failed');

    await Promise.allSettled([
      service().restore(admin, garage.id, {
        recheck: {
          activities: ['mechanics', 'mechanics'],
          checkedOn: today(),
        },
      }),
    ]);

    const after = await garageRow(garage.id);
    expect(after.rarActivities.filter((a) => a === 'mechanics')).toHaveLength(
      after.rarActivities.length === 0 ? 0 : 1,
    );
  });
});

describe('a note that is blank', () => {
  it.each([
    ['spaces', '    '],
    ['a tab and line breaks', '\t\r\n \n'],
  ])(
    'is refused with 400 for a garage suspended by an admin: %s',
    async (_, note) => {
      await suspended('admin');

      const res = await refusal(service().restore(admin, garage.id, { note }));

      expect([res.status, res.body.code, res.body.field]).toEqual([
        400,
        'validation_failed',
        'note',
      ]);
      await nothingWritten();
    },
  );

  it('is refused for a confirmed report too', async () => {
    await suspended('report_confirmed');

    const res = await refusal(service().restore(admin, garage.id, {}));

    expect([res.status, res.body.code, res.body.field]).toEqual([
      400,
      'validation_failed',
      'note',
    ]);
    await nothingWritten();
  });
});

describe('a note kept as written', () => {
  it('stores 1,000 characters beyond the basic plane whole', async () => {
    await suspended('admin');
    const note = '🚗'.repeat(1000);

    const res = await service().restore(admin, garage.id, { note });

    expect(res.note).toBe(note);
    const [row] = await rows(garage.id);
    expect([...(row?.liftNote ?? '')]).toHaveLength(1000);
  });

  it('stores markup and line breaks as plain text', async () => {
    await suspended('admin');
    const note = '<img src=x onerror=alert(1)>\r\n\tgata; \'"--';

    const res = await service().restore(admin, garage.id, { note });

    expect(res.note).toBe(note);
    const [entry] = await restoredEntries(garage.id);
    expect(entry?.newValue).toMatchObject({ note });
  });
});

describe('the name of the admin who lifted it', () => {
  it.each([
    ['Ana-Maria Popescu', 'Ana-Maria P.'],
    ['Ștefan Țurcanu', 'Ștefan Ț.'],
    ['Madonna', 'Madonna'],
  ])('reads %s as %s', async (name, short) => {
    await suspended('admin');
    const lifter = person(await account(name, ['admin']), 'admin');

    const res = await service().restore(lifter, garage.id, { note: NOTE });

    expect(res.liftedBy).toEqual({ name: short });
  });
});

describe('a garage whose status and suspension disagree', () => {
  it('answers 409 garage_not_suspended for a suspended status with no suspension row', async () => {
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garage.id },
    });

    const res = await refusal(
      service().restore(admin, garage.id, { note: NOTE }),
    );

    expect([res.status, res.body.code]).toEqual([409, 'garage_not_suspended']);
    expect(await restoredEvents(garage.id)).toEqual([]);
  });

  it('answers 409 for a suspended status whose only suspension already ended', async () => {
    await suspended('admin');
    await service().restore(admin, garage.id, { note: NOTE });
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garage.id },
    });

    const res = await refusal(
      service().restore(admin, garage.id, { note: NOTE }),
    );

    expect(res.status).toBe(409);
    expect(await restoredEntries(garage.id)).toHaveLength(1);
  });
});

describe('the same call twice', () => {
  it('tells the admin who retries that they already did it, by name', async () => {
    await suspended('admin');
    await service().restore(admin, garage.id, { note: NOTE });

    const res = await refusal(
      service().restore(admin, garage.id, { note: NOTE }),
    );

    expect([res.status, res.body.code, res.body.message]).toEqual([
      409,
      'garage_already_restored',
      'Deja repus pe hartă de Ioana P.',
    ]);
    expect(await restoredEntries(garage.id)).toHaveLength(1);
    expect(await restoredEvents(garage.id)).toHaveLength(1);
  });

  it('counts the restore once, and not at all for a refused one', async () => {
    await suspended('admin');
    const before = await restoresCounted('admin');
    await refusal(service().restore(admin, garage.id, {}));
    expect(await restoresCounted('admin')).toBe(before);

    await service().restore(admin, garage.id, { note: NOTE });
    await refusal(service().restore(admin, garage.id, { note: NOTE }));

    expect(await restoresCounted('admin')).toBe(before + 1);
  });
});

describe('many admins at once', () => {
  it('commit exactly one restore and the rest all name the winner', async () => {
    await suspended('admin');
    const others = await Promise.all(
      ['Dan Ene', 'Eva Rus', 'Fane Ion', 'Gina Pop', 'Hari Vlad'].map(
        async (name) => person(await account(name, ['admin']), 'admin'),
      ),
    );

    const results = await Promise.allSettled(
      [admin, ...others].map((who) =>
        service().restore(who, garage.id, { note: NOTE }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const [row] = await rows(garage.id);
    const winner = [admin, ...others].find(
      (a) => a.accountId === row?.liftedBy,
    );
    const winnerName = (
      await prisma.account.findUniqueOrThrow({
        where: { id: winner?.accountId ?? '' },
      })
    ).name;
    const short = `${winnerName.split(' ')[0]} ${winnerName.split(' ')[1]?.[0]}.`;
    for (const lost of results.filter((r) => r.status === 'rejected')) {
      const res = await refusal(Promise.reject(lost.reason));
      expect([res.status, res.body.code, res.body.message]).toEqual([
        409,
        'garage_already_restored',
        `Deja repus pe hartă de ${short}`,
      ]);
    }
    expect(await restoredEntries(garage.id)).toHaveLength(1);
    expect(await restoredEvents(garage.id)).toHaveLength(1);
  });

  it('record one re-check, not one per admin, when each sends its own', async () => {
    await suspended('recheck_failed');
    const dan = person(await account('Dan Ene', ['admin']), 'admin');
    const recheck = { activities: ['mechanics'], checkedOn: today() };

    const results = await Promise.allSettled([
      service().restore(admin, garage.id, { recheck }),
      service().restore(dan, garage.id, { recheck }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.recheck.findMany({ where: { garageId: garage.id } }),
    ).toHaveLength(1);
    expect(
      await prisma.outboxEvent.findMany({
        where: { kind: 'recheck.recorded', subjectId: garage.id },
      }),
    ).toHaveLength(1);
  });
});

describe('the time it ended', () => {
  it('is the time of the commit and never before the time it began', async () => {
    const open = await suspended('admin');
    const before = Date.now();

    const res = await service().restore(admin, garage.id, { note: NOTE });

    const until = Date.parse(res.untilTime);
    expect(until).toBeGreaterThanOrEqual(open.fromTime.getTime());
    expect(until).toBeGreaterThanOrEqual(before - 2000);
    expect(until).toBeLessThanOrEqual(Date.now() + 2000);
  });
});
