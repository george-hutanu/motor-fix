import { randomUUID } from 'node:crypto';

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

// @traces 312-FR-006 312-FR-007 312-FR-008 312-FR-009 312-FR-010
// @traces 312-FR-011 312-FR-012 312-FR-013 312-FR-014

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const TEXT = 'Mi-au cerut bani pentru o piesă pe care nu au montat-o.';
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const approvedAt = new Date('2026-01-15T09:00:00Z');

let notify: jest.Mock;
let admin: string;

const service = () =>
  new GarageReportsService(
    prisma,
    new VerificationService(new AuditService(), outbox, {
      skipManualApproval: false,
    }),
    new AuditService(),
    outbox,
    { notify } as unknown as NotificationsService,
    { webUrl: 'https://motorfix.test' },
  );

const driver = async (name: string): Promise<Actor> => ({
  accountId: await account(name, ['driver']),
  garageId: null,
  permissions: NONE,
  role: 'driver',
  roles: ['driver'],
});

async function status(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  }
  return 201;
}

async function garage(
  name: string,
  files: Array<'approved' | 'in_review' | 'rejected' | 'more_requested'> = [
    'approved',
  ],
) {
  const g = await prisma.garage.create({
    data: {
      approvedAt,
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID()}`,
      status: 'approved',
    },
  });
  const ids: string[] = [];
  for (const [n, fileStatus] of files.entries()) {
    const f = await prisma.verificationFile.create({
      data: {
        createdAt: new Date(approvedAt.getTime() + n * 86_400_000),
        decidedAt: fileStatus === 'in_review' ? null : approvedAt,
        decidedBy: fileStatus === 'in_review' ? null : admin,
        garageId: g.id,
        openedAt: approvedAt,
        openedBy: admin,
        status: fileStatus,
      },
    });
    ids.push(f.id);
  }
  return { fileIds: ids, id: g.id };
}

const stored = (where: object = {}) => prisma.garageReport.count({ where });
const outboxKinds = async (kind: string) =>
  prisma.outboxEvent.count({ where: { kind } });

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  notify = jest.fn().mockResolvedValue(1);
  admin = await account('Ioana Popa', ['admin']);
});

afterAll(() => prisma.$disconnect());

describe('the daily limit', () => {
  const garagesFor = async (count: number) => {
    const out = [];
    for (let n = 0; n < count; n += 1) out.push(await garage(`Garaj ${n}`));
    return out;
  };

  it('takes the fifth report in a row and refuses the sixth', async () => {
    const ana = await driver('Ana Pop');
    const garages = await garagesFor(6);

    const answers = [];
    for (const g of garages)
      answers.push(await status(service().report(ana, g.id, { text: TEXT })));

    expect(answers).toEqual([201, 201, 201, 201, 201, 429]);
    expect(await stored({ reporterId: ana.accountId })).toBe(5);
  });

  it('stores, audits, queues and alerts nothing for a refused sixth', async () => {
    const ana = await driver('Ana Pop');
    const garages = await garagesFor(6);
    for (const g of garages.slice(0, 5))
      await service().report(ana, g.id, { text: TEXT });
    const [audits, events, alerts] = [
      await prisma.activityLog.count(),
      await prisma.outboxEvent.count(),
      notify.mock.calls.length,
    ];

    await status(service().report(ana, garages[5].id, { text: TEXT }));

    expect(await prisma.activityLog.count()).toBe(audits);
    expect(await prisma.outboxEvent.count()).toBe(events);
    expect(notify).toHaveBeenCalledTimes(alerts);
    expect(
      (
        await prisma.verificationFile.findFirstOrThrow({
          where: { garageId: garages[5].id },
        })
      ).status,
    ).toBe('approved');
  });

  it("does not count another driver's reports", async () => {
    const ana = await driver('Ana Pop');
    const radu = await driver('Radu Ionescu');
    const garages = await garagesFor(6);
    for (const g of garages.slice(0, 5))
      await service().report(radu, g.id, { text: TEXT });

    expect(
      await status(service().report(ana, garages[5].id, { text: TEXT })),
    ).toBe(201);
  });

  it('never stores more than five when one driver fires seven at once', async () => {
    const ana = await driver('Ana Pop');
    const garages = await garagesFor(7);

    await Promise.allSettled(
      garages.map((g) => service().report(ana, g.id, { text: TEXT })),
    );

    expect(await stored({ reporterId: ana.accountId })).toBeLessThanOrEqual(5);
  });
});

describe('repeat and concurrent reports', () => {
  it('leaves rows, audit entries and alerts as they were after a refused repeat', async () => {
    const ana = await driver('Ana Pop');
    const g = await garage('Atelier Dinamo');
    await service().report(ana, g.id, { text: TEXT });
    const audits = await prisma.activityLog.count();
    const events = await prisma.outboxEvent.count();

    expect(
      await status(service().report(ana, g.id, { text: `${TEXT} again` })),
    ).toBe(409);

    expect(await stored({ garageId: g.id })).toBe(1);
    expect(await prisma.activityLog.count()).toBe(audits);
    expect(await prisma.outboxEvent.count()).toBe(events);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('lets the same driver report a second garage while the first is open', async () => {
    const ana = await driver('Ana Pop');
    const [a, b] = [await garage('Garaj A'), await garage('Garaj B')];
    await service().report(ana, a.id, { text: TEXT });

    expect(await status(service().report(ana, b.id, { text: TEXT }))).toBe(201);
  });

  it('keeps one reopening, one alert and every row when eight drivers report at once', async () => {
    const g = await garage('Atelier Dinamo');
    const drivers = await Promise.all(
      Array.from({ length: 8 }, (_, n) => driver(`Sofer ${n}`)),
    );

    const results = await Promise.allSettled(
      drivers.map((d) => service().report(d, g.id, { text: TEXT })),
    );

    expect(results.map((r) => r.status)).toEqual(Array(8).fill('fulfilled'));
    expect(await stored({ garageId: g.id })).toBe(8);
    expect(await outboxKinds('verification.reopened')).toBe(1);
    expect(await outboxKinds('garage.reported')).toBe(8);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('stores one row when the same driver double-taps three times at once', async () => {
    const ana = await driver('Ana Pop');
    const g = await garage('Atelier Dinamo');

    const answers = await Promise.all(
      [1, 2, 3].map(() => status(service().report(ana, g.id, { text: TEXT }))),
    );

    expect(answers.sort()).toEqual([201, 409, 409]);
    expect(await stored({ garageId: g.id })).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('what a report must not touch', () => {
  it('keeps the garage approved with its approval time', async () => {
    const ana = await driver('Ana Pop');
    const g = await garage('Atelier Dinamo');

    await service().report(ana, g.id, { text: TEXT });

    const row = await prisma.garage.findUniqueOrThrow({ where: { id: g.id } });
    expect(row.status).toBe('approved');
    expect(row.approvedAt).toEqual(approvedAt);
  });

  it('attaches to the newest file and leaves an older approved one alone', async () => {
    const ana = await driver('Ana Pop');
    const g = await garage('Atelier Dinamo', ['approved', 'rejected']);

    await service().report(ana, g.id, { text: TEXT });

    const [older, newest] = await Promise.all(
      g.fileIds.map((id) =>
        prisma.verificationFile.findUniqueOrThrow({ where: { id } }),
      ),
    );
    expect(older.status).toBe('approved');
    expect(newest.status).toBe('rejected');
    expect(
      (await prisma.garageReport.findFirstOrThrow()).verificationFileId,
    ).toBe(g.fileIds[1]);
    expect(await outboxKinds('verification.reopened')).toBe(0);
  });

  it('reopens nothing and alerts once for a file already under review', async () => {
    const ana = await driver('Ana Pop');
    const g = await garage('Atelier Dinamo', ['in_review']);

    await service().report(ana, g.id, { text: TEXT });

    expect(await outboxKinds('verification.reopened')).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it.each(['rejected', 'more_requested'] as const)(
    'attaches to a %s file without moving it and alerts once',
    async (fileStatus) => {
      const ana = await driver('Ana Pop');
      const g = await garage('Atelier Dinamo', [fileStatus]);

      await service().report(ana, g.id, { text: TEXT });

      const file = await prisma.verificationFile.findUniqueOrThrow({
        where: { id: g.fileIds[0] },
      });
      expect(file.status).toBe(fileStatus);
      expect(file.reopenReason).toBeNull();
      expect(notify).toHaveBeenCalledTimes(1);
    },
  );

  it('stores markup, a link and whitespace exactly as sent', async () => {
    const ana = await driver('Ana Pop');
    const g = await garage('Atelier Dinamo');
    const text = '  <script>alert(1)</script> https://x.test\n\t  ';

    const { id } = await service().report(ana, g.id, { text });

    expect(
      (await prisma.garageReport.findUniqueOrThrow({ where: { id } })).text,
    ).toBe(text);
  });

  it('writes exactly one audit entry for the report by a driver', async () => {
    const ana = await driver('Ana Pop');
    const g = await garage('Atelier Dinamo');

    const { id } = await service().report(ana, g.id, { text: TEXT });

    const entries = await prisma.activityLog.findMany({
      where: { subjectId: id, subjectType: 'garage_report' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].actorRole).toBe('driver');
    expect(entries[0].garageId).toBe(g.id);
  });
});

describe('who may not report', () => {
  it.each([
    ['an unknown id', () => randomUUID()],
    ['an empty id', () => ''],
    ['an id with a quote and a semicolon', () => "x'; DROP TABLE garage;--"],
  ])('answers 404 and stores nothing for %s', async (_, id) => {
    const ana = await driver('Ana Pop');

    expect(await status(service().report(ana, id(), { text: TEXT }))).toBe(404);
    expect(await stored()).toBe(0);
    expect(await outboxKinds('garage.reported')).toBe(0);
  });

  it('answers 404 to a mechanic of the garage who holds only the mechanic role', async () => {
    const g = await garage('Atelier Dinamo');
    const accountId = await account('Vlad Marin', ['mechanic']);
    await prisma.mechanic.create({
      data: { accountId, garageId: g.id, name: 'Vlad Marin' },
    });
    const vlad: Actor = {
      accountId,
      garageId: g.id,
      permissions: NONE,
      role: 'mechanic',
      roles: ['mechanic'],
    };

    expect(await status(service().report(vlad, g.id, { text: TEXT }))).toBe(
      404,
    );
    expect(await stored()).toBe(0);
  });

  it('answers 404 to the owner even when the session carries no garage id', async () => {
    const g = await garage('Atelier Dinamo');
    const accountId = await account('Mihai Stan', ['garage', 'driver']);
    await prisma.garageMember.create({
      data: { accountId, garageId: g.id, role: 'owner' },
    });
    const mihai: Actor = {
      accountId,
      garageId: null,
      permissions: NONE,
      role: 'driver',
      roles: ['driver'],
    };

    expect(await status(service().report(mihai, g.id, { text: TEXT }))).toBe(
      404,
    );
  });

  it('lets the staff of another garage report this one', async () => {
    const g = await garage('Atelier Dinamo');
    const other = await garage('Garaj Vecin');
    const accountId = await account('Mihai Stan', ['garage', 'driver']);
    await prisma.garageMember.create({
      data: { accountId, garageId: other.id, role: 'owner' },
    });
    const mihai: Actor = {
      accountId,
      garageId: other.id,
      permissions: NONE,
      role: 'driver',
      roles: ['garage', 'driver'],
    };

    expect(await status(service().report(mihai, g.id, { text: TEXT }))).toBe(
      201,
    );
  });

  it('answers 404 and stores nothing for a suspended garage', async () => {
    const ana = await driver('Ana Pop');
    const g = await garage('Atelier Dinamo');
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: g.id },
    });

    expect(await status(service().report(ana, g.id, { text: TEXT }))).toBe(404);
    expect(await stored()).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('answers 404 to an actor with no account id', async () => {
    const g = await garage('Atelier Dinamo');
    const ghost: Actor = {
      accountId: null,
      garageId: null,
      permissions: NONE,
      role: 'driver',
      roles: ['driver'],
    } as unknown as Actor;

    expect(await status(service().report(ghost, g.id, { text: TEXT }))).toBe(
      404,
    );
    expect(await stored()).toBe(0);
  });
});
