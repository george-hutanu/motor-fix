import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';

import { GarageReportsService } from './garage-reports.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { outbox } from '../../../events/event.port';
import type { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { VerificationService } from '../verification.service';

// @traces 312-FR-005 312-FR-006 312-FR-007 312-FR-008 312-FR-009 312-FR-010
// @traces 312-FR-011 312-FR-012 312-FR-013 312-FR-014 312-FR-015 312-FR-016

const reader = countedMetrics();
const reports = (outcome: string) =>
  counterTotal(reader, 'motorfix_garage_reports_total', { outcome });
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const WEB = 'https://motorfix.test';
const TEXT = 'Mi-au cerut bani pentru o piesă pe care nu au montat-o.';
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

type Notify = jest.Mock<
  Promise<number>,
  [Parameters<NotificationsService['notify']>[0]]
>;
let notify: Notify;

const service = () =>
  new GarageReportsService(
    prisma,
    new VerificationService(new AuditService(), outbox, {
      skipManualApproval: false,
    }),
    new AuditService(),
    outbox,
    { notify } as unknown as NotificationsService,
    { webUrl: WEB },
  );

const person = (
  accountId: string,
  role: Actor['role'],
  roles: Actor['roles'] = [role],
): Actor => ({ accountId, garageId: null, permissions: NONE, role, roles });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        code: (error.getResponse() as { code?: string }).code,
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

type FileStatus =
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'more_requested'
  | 'rejected';

const approvedAt = new Date('2026-01-15T09:00:00Z');

function fileAt(file: FileStatus) {
  const decided = ['approved', 'more_requested', 'rejected'].includes(file);
  const opened = file !== 'submitted';
  return {
    createdAt: approvedAt,
    decidedAt: decided ? approvedAt : null,
    decidedBy: decided ? ioana : null,
    openedAt: opened ? approvedAt : null,
    openedBy: opened ? ioana : null,
    status: file,
  };
}

async function garageWith(
  name: string,
  file: FileStatus | null = 'approved',
  status: 'approved' | 'draft' | 'suspended' = 'approved',
) {
  const garage = await prisma.garage.create({
    data: {
      approvedAt: status === 'draft' ? null : approvedAt,
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID()}`,
      status,
    },
  });
  const verification = file
    ? await prisma.verificationFile.create({
        data: { ...fileAt(file), garageId: garage.id },
      })
    : null;
  return { file: verification, id: garage.id };
}

const fileOf = (id: string) =>
  prisma.verificationFile.findUniqueOrThrow({ where: { id } });
const reopenings = (fileId: string) =>
  prisma.activityLog.findMany({
    where: { kind: 'verification_reopened', subjectId: fileId },
  });

let ioana: string;
let dan: string;
let ana: Actor;
let radu: Actor;
let dinamo: Awaited<ReturnType<typeof garageWith>>;

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  notify = jest.fn().mockResolvedValue(2);
  ioana = await account('Ioana Popa', ['admin']);
  dan = await account('Dan Ene', ['admin']);
  await account('Sorin Lazăr', ['admin'], { status: 'suspended' });
  ana = person(await account('Ana Pop', ['driver']), 'driver');
  radu = person(await account('Radu Ionescu', ['driver']), 'driver');
  dinamo = await garageWith('Atelier Dinamo');
});

afterAll(() => prisma.$disconnect());

describe('a driver reports an approved garage', () => {
  it('stores the report as written against the newest file, open', async () => {
    const text = `  ${TEXT}  `;

    const created = await service().report(ana, dinamo.id, { text });

    const row = await prisma.garageReport.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row).toMatchObject({
      garageId: dinamo.id,
      reporterId: ana.accountId,
      status: 'open',
      text,
      verificationFileId: dinamo.file?.id,
    });
    expect(created).toEqual({ createdAt: row.createdAt, id: row.id });
  });

  it('reopens the approved file as MotorFix and leaves the garage listed', async () => {
    await service().report(ana, dinamo.id, { text: TEXT });

    const file = await fileOf(dinamo.file?.id ?? '');
    expect(file).toMatchObject({
      reopenedBy: null,
      reopenReason: 'garage_report',
      status: 'in_review',
    });
    expect(file.reopenedAt).not.toBeNull();
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: dinamo.id },
    });
    expect(garage).toMatchObject({ approvedAt, status: 'approved' });
    const [reopening] = await reopenings(file.id);
    expect(reopening).toMatchObject({
      actorName: 'MotorFix',
      actorRole: 'system',
      text: 'garage_report',
    });
  });

  it('records who reported, and tells the admins with the garage only, never the text', async () => {
    const { id } = await service().report(ana, dinamo.id, { text: TEXT });

    const [entry] = await prisma.activityLog.findMany({
      where: { subjectId: id },
    });
    expect(entry).toMatchObject({
      action: 'create',
      actorId: ana.accountId,
      actorRole: 'driver',
      garageId: dinamo.id,
      subjectType: 'garage_report',
    });
    expect(entry?.newValue).toMatchObject({
      garageId: dinamo.id,
      reporterId: ana.accountId,
      status: 'open',
      text: TEXT,
      verificationFileId: dinamo.file?.id,
    });
    const reported = await prisma.outboxEvent.findMany({
      where: { kind: 'garage.reported' },
    });
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      audience: ['admin'],
      payload: { fileId: dinamo.file?.id, garageId: dinamo.id, reportId: id },
      subjectId: id,
    });
    const reopened = await prisma.outboxEvent.findMany({
      where: { kind: 'verification.reopened', subjectId: dinamo.file?.id },
    });
    expect(reopened.map((e) => e.payload)).toEqual([
      { fileId: dinamo.file?.id, garageId: dinamo.id, reason: 'garage_report' },
    ]);
    for (const event of [...reported, ...reopened]) {
      expect(JSON.stringify(event.payload)).not.toContain(ana.accountId);
      expect(JSON.stringify(event.payload)).not.toContain('piesă');
    }
  });

  it('alerts every active admin once, with the garage, the text and the dashboard', async () => {
    const { id } = await service().report(ana, dinamo.id, { text: TEXT });

    expect(notify).toHaveBeenCalledTimes(1);
    const call = notify.mock.calls[0][0];
    expect(call).toMatchObject({
      eventId: `garage.reported:${id}`,
      kind: 'ADMIN_GARAGE_REPORTED',
      params: {
        brief: TEXT,
        dashboard: `${WEB}/app/admin`,
        garage: 'Atelier Dinamo',
        text: TEXT,
      },
      subjectId: id,
    });
    expect([...call.recipients].sort()).toEqual([ioana, dan].sort());
  });

  it('cuts the push brief of a long text to 120 characters, whole letters only', async () => {
    const text = '🚗'.repeat(400);

    await service().report(ana, dinamo.id, { text });

    const { brief, text: full } = notify.mock.calls[0][0].params as {
      brief: string;
      text: string;
    };
    expect([...brief]).toHaveLength(120);
    expect(brief.endsWith('…')).toBe(true);
    expect(full).toBe(text);
  });

  it('keeps the report when the alert cannot be queued', async () => {
    notify.mockRejectedValue(new Error('queue down'));

    const { id } = await service().report(ana, dinamo.id, { text: TEXT });

    expect(await prisma.garageReport.count({ where: { id } })).toBe(1);
    expect((await fileOf(dinamo.file?.id ?? '')).status).toBe('in_review');
  });

  it('counts the report', async () => {
    const before = await reports('created');

    await service().report(ana, dinamo.id, { text: TEXT });

    expect(await reports('created')).toBe(before + 1);
  });

  it.each([
    [19, false],
    [20, true],
    [1000, true],
    [1001, false],
  ])('lets the database keep %i characters: %s', async (length, kept) => {
    const file = dinamo.file?.id ?? '';
    const insert = prisma.garageReport.create({
      data: {
        garageId: dinamo.id,
        reporterId: ana.accountId ?? '',
        text: 'ă'.repeat(length),
        verificationFileId: file,
      },
    });

    if (kept) await expect(insert).resolves.toBeDefined();
    else await expect(insert).rejects.toThrow();
  });
});

describe('a report on a file already being looked at', () => {
  it('attaches a second report to the reopened file with no second reopening or alert', async () => {
    await service().report(ana, dinamo.id, { text: TEXT });

    const second = await service().report(radu, dinamo.id, { text: TEXT });

    const row = await prisma.garageReport.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(row.verificationFileId).toBe(dinamo.file?.id);
    expect(await reopenings(dinamo.file?.id ?? '')).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(
      await prisma.outboxEvent.count({ where: { kind: 'garage.reported' } }),
    ).toBe(2);
  });

  it.each(['submitted', 'in_review', 'more_requested', 'rejected'] as const)(
    'attaches to a %s file without moving it, and alerts once for its first report',
    async (status) => {
      const garage = await garageWith('Service Dobre', status);

      await service().report(ana, garage.id, { text: TEXT });
      await service().report(radu, garage.id, { text: TEXT });

      const file = await fileOf(garage.file?.id ?? '');
      expect(file.status).toBe(status);
      expect(file.reopenReason).toBeNull();
      expect(await reopenings(file.id)).toHaveLength(0);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(
        await prisma.garageReport.count({
          where: { verificationFileId: file.id },
        }),
      ).toBe(2);
    },
  );

  it('ends two reports at once with both stored, one reopening and one alert', async () => {
    await Promise.all([
      service().report(ana, dinamo.id, { text: TEXT }),
      service().report(radu, dinamo.id, { text: TEXT }),
    ]);

    expect(
      await prisma.garageReport.count({ where: { garageId: dinamo.id } }),
    ).toBe(2);
    expect(await reopenings(dinamo.file?.id ?? '')).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('refusals', () => {
  it('refuses the same driver reporting the same garage again', async () => {
    await service().report(ana, dinamo.id, { text: TEXT });
    const before = await reports('already_reported');

    expect(
      await refusal(service().report(ana, dinamo.id, { text: TEXT })),
    ).toEqual({ code: 'garage_already_reported', status: 409 });
    expect(await reports('already_reported')).toBe(before + 1);
    expect(
      await prisma.garageReport.count({ where: { garageId: dinamo.id } }),
    ).toBe(1);
  });

  it('stores one report when the same driver sends twice at once', async () => {
    const results = await Promise.allSettled([
      service().report(ana, dinamo.id, { text: TEXT }),
      service().report(ana, dinamo.id, { text: TEXT }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const failed = results.find((r) => r.status === 'rejected');
    expect((failed as PromiseRejectedResult).reason.getStatus?.()).toBe(409);
    expect(
      await prisma.garageReport.count({ where: { garageId: dinamo.id } }),
    ).toBe(1);
  });

  describe('after five reports from one driver', () => {
    const fiveAt = async (at: Date) => {
      for (let n = 1; n <= 5; n += 1) {
        const garage = await garageWith(`Garaj ${n}`);
        await prisma.garageReport.create({
          data: {
            createdAt: at,
            garageId: garage.id,
            reporterId: ana.accountId ?? '',
            text: TEXT,
            verificationFileId: garage.file?.id ?? '',
          },
        });
      }
    };

    it('refuses a sixth within 24 hours', async () => {
      await fiveAt(new Date(Date.now() - 23 * 3_600_000));
      const before = await reports('too_many');

      expect(
        await refusal(service().report(ana, dinamo.id, { text: TEXT })),
      ).toEqual({ code: 'too_many_reports', status: 429 });
      expect(await reports('too_many')).toBe(before + 1);
      expect((await fileOf(dinamo.file?.id ?? '')).status).toBe('approved');
    });

    it('takes a sixth once the first five are older than 24 hours', async () => {
      await fiveAt(new Date(Date.now() - 25 * 3_600_000));

      await expect(
        service().report(ana, dinamo.id, { text: TEXT }),
      ).resolves.toBeDefined();
    });
  });

  it('answers 404 to an account that is not a driver', async () => {
    const admin = person(ioana, 'admin');

    expect(
      await refusal(service().report(admin, dinamo.id, { text: TEXT })),
    ).toEqual({ code: 'not_found', status: 404 });
  });

  it.each(['owner', 'receptionist'] as const)(
    "answers 404 to the garage's %s, even signed in as a driver",
    async (role) => {
      const staff = await account('Mihai Stan', ['garage', 'driver']);
      await prisma.garageMember.create({
        data: { accountId: staff, garageId: dinamo.id, role },
      });
      const before = await reports('not_found');

      expect(
        await refusal(
          service().report(
            person(staff, 'driver', ['garage', 'driver']),
            dinamo.id,
            {
              text: TEXT,
            },
          ),
        ),
      ).toEqual({ code: 'not_found', status: 404 });
      expect(await reports('not_found')).toBe(before + 1);
    },
  );

  it("answers 404 to the garage's mechanic, even signed in as a driver", async () => {
    const mechanic = await account('Vlad Marin', ['mechanic', 'driver']);
    await prisma.mechanic.create({
      data: { accountId: mechanic, garageId: dinamo.id, name: 'Vlad Marin' },
    });

    expect(
      await refusal(
        service().report(
          person(mechanic, 'driver', ['mechanic', 'driver']),
          dinamo.id,
          { text: TEXT },
        ),
      ),
    ).toEqual({ code: 'not_found', status: 404 });
  });

  it.each([
    ['a draft garage', 'draft'],
    ['a suspended garage', 'suspended'],
  ] as const)('answers 404 for %s', async (_, status) => {
    const garage = await garageWith('Service Dobre', 'approved', status);

    expect(
      await refusal(service().report(ana, garage.id, { text: TEXT })),
    ).toEqual({ code: 'not_found', status: 404 });
  });

  it.each([
    ['an unknown id', randomUUID()],
    ['a malformed id', 'not-a-garage'],
  ])('answers 404 for %s', async (_, id) => {
    expect(await refusal(service().report(ana, id, { text: TEXT }))).toEqual({
      code: 'not_found',
      status: 404,
    });
  });

  it('refuses a garage with no verification file and stores nothing', async () => {
    const garage = await garageWith('Service Dobre', null);
    const before = await reports('refused');

    expect(
      await refusal(service().report(ana, garage.id, { text: TEXT })),
    ).toEqual({ code: 'verification_transition_refused', status: 409 });
    expect(await prisma.garageReport.count()).toBe(0);
    expect(
      await prisma.activityLog.count({
        where: { garageId: garage.id, subjectType: 'garage_report' },
      }),
    ).toBe(0);
    expect(await reports('refused')).toBe(before + 1);
    expect(notify).not.toHaveBeenCalled();
  });
});
