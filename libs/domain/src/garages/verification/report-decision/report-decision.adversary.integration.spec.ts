import { randomUUID } from 'node:crypto';

import type { ReportDecisionDto } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';

import { ReportDecisionService } from './report-decision.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { type EventPort, outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { SuspensionService } from '../suspension/suspension.service';
import { VerificationService } from '../verification.service';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const REASON = 'Prețuri false confirmate la telefon';
const NOTE = 'Am sunat service-ul; prețurile sunt corecte.';
const OPENED = new Date('2026-10-16T09:00:00Z');

const person = (accountId: string, role: Actor['role']): Actor => ({
  accountId,
  garageId: null,
  permissions: NONE,
  role,
  roles: [role],
});

const verification = () =>
  new VerificationService(new AuditService(), outbox, {
    skipManualApproval: false,
  });
const service = (events: EventPort = outbox) =>
  new ReportDecisionService(
    prisma,
    new VerificationService(new AuditService(), events, {
      skipManualApproval: false,
    }),
    new SuspensionService(prisma, new AuditService(), events),
    new AuditService(),
    events,
  );

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        body: error.getResponse() as Record<string, unknown>,
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

let ioana: Actor;
let elena: string;
let radu: string;
let garageId: string;
let fileId: string;

// An approved garage whose file two drivers' reports reopened: in review,
// opened by Ioana, with Elena's and Radu's reports open.
beforeEach(async () => {
  await reset();
  ioana = person(await account('Ioana Popa', ['admin']), 'admin');
  elena = await account('Elena Dumitru', ['driver']);
  radu = await account('Radu Ionescu', ['driver']);
  const garage = await prisma.garage.create({
    data: {
      approvedAt: OPENED,
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
  });
  garageId = garage.id;
  const file = await prisma.verificationFile.create({
    data: {
      decidedAt: OPENED,
      decidedBy: ioana.accountId,
      garageId,
      openedAt: OPENED,
      openedBy: ioana.accountId,
      reopenedAt: OPENED,
      reopenReason: 'garage_report',
      status: 'in_review',
    },
  });
  fileId = file.id;
  await prisma.garageReport.createMany({
    data: [
      {
        garageId,
        reporterId: elena,
        text: 'Prețuri false la manoperă, peste listă.',
        verificationFileId: fileId,
      },
      {
        garageId,
        reporterId: radu,
        text: 'Adresă greșită pe pagina service-ului.',
        verificationFileId: fileId,
      },
    ],
  });
});

afterAll(() => prisma.$disconnect());

const reportsOf = () =>
  prisma.garageReport.findMany({
    orderBy: { createdAt: 'asc' },
    where: { verificationFileId: fileId },
  });
const fileOf = () =>
  prisma.verificationFile.findUniqueOrThrow({ where: { id: fileId } });
const garageStatus = async () =>
  (await prisma.garage.findUniqueOrThrow({ where: { id: garageId } })).status;
const decidedEntries = () =>
  prisma.activityLog.findMany({
    where: { kind: 'report_decided', subjectId: fileId },
  });
// This file's and this garage's events only: other tests' rows stay in the
// shared outbox.
const eventsOf = (kind: string) =>
  prisma.outboxEvent.findMany({
    where: { kind, subjectId: { in: [fileId, garageId] } },
  });
const suspensionsOf = () =>
  prisma.garageSuspension.findMany({ where: { garageId } });

const LONG = 'Prețuri false la manoperă, peste lista afișată.';
const unfounded: ReportDecisionDto = { decision: 'unfounded', note: NOTE };
const confirmed: ReportDecisionDto = { decision: 'confirmed', reason: REASON };

describe('report decisions under hostile conditions', () => {
  // @traces 069-FR-002
  it('refuses a decision on a file that is not in review and leaves its open reports open', async () => {
    for (const status of ['submitted', 'more_requested', 'rejected'] as const) {
      await prisma.verificationFile.update({
        data: { status },
        where: { id: fileId },
      });

      const refused = await refusal(service().decide(ioana, fileId, unfounded));

      expect(refused.status).toBe(409);
      expect(refused.body['code']).toBe('verification_transition_refused');
      expect((await reportsOf()).every((r) => r.status === 'open')).toBe(true);
      expect((await fileOf()).status).toBe(status);
    }
    expect(await eventsOf('garage_report.decided')).toEqual([]);
  });

  // @traces 069-FR-002
  it('refuses the same decision sent twice and writes one history entry and one event', async () => {
    await service().decide(ioana, fileId, confirmed);

    const second = await refusal(service().decide(ioana, fileId, confirmed));

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ currentStatus: 'approved' });
    expect(await decidedEntries()).toHaveLength(1);
    expect(await eventsOf('garage_report.decided')).toHaveLength(1);
    expect(await suspensionsOf()).toHaveLength(1);
  });

  // @traces 069-FR-002
  it('lets exactly one of five simultaneous confirmations through and suspends once', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service().decide(ioana, fileId, confirmed),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect(
        (await refusal(Promise.reject((r as PromiseRejectedResult).reason)))
          .status,
      ).toBe(409);
    }
    expect(await suspensionsOf()).toHaveLength(1);
    expect(await eventsOf('garage.suspended')).toHaveLength(1);
    expect(await eventsOf('garage_report.decided')).toHaveLength(1);
  });

  // @traces 069-FR-003
  it('leaves an earlier decided report as it was and covers only the open ones', async () => {
    const earlier = new Date('2026-09-01T00:00:00Z');
    const old = await prisma.garageReport.create({
      data: {
        decidedAt: earlier,
        decidedBy: ioana.accountId,
        decisionNote: 'vechi',
        garageId,
        reporterId: elena,
        status: 'confirmed',
        text: LONG,
        verificationFileId: fileId,
      },
    });

    await service().decide(ioana, fileId, unfounded);

    const after = await prisma.garageReport.findUniqueOrThrow({
      where: { id: old.id },
    });
    expect(after).toMatchObject({ decisionNote: 'vechi', status: 'confirmed' });
    expect(after.decidedAt?.getTime()).toBe(earlier.getTime());
    const [event] = await eventsOf('garage_report.decided');
    const covered = ((event?.payload ?? {}) as { reportIds?: string[] })
      .reportIds;
    expect(covered).not.toContain(old.id);
  });

  // @traces 069-FR-003
  it('closes the reports of a hundred reporters in one decision', async () => {
    const many = await Promise.all(
      Array.from({ length: 100 }, (_, i) => account(`Driver ${i}`, ['driver'])),
    );
    await prisma.garageReport.createMany({
      data: many.map((reporterId) => ({
        garageId,
        reporterId,
        text: LONG,
        verificationFileId: fileId,
      })),
    });

    await service().decide(ioana, fileId, unfounded);

    const reports = await reportsOf();
    expect(reports).toHaveLength(102);
    expect(reports.every((r) => r.status === 'unfounded')).toBe(true);
    const [event] = await eventsOf('garage_report.decided');
    const named = ((event?.payload ?? {}) as { reporterIds?: string[] })
      .reporterIds;
    expect(named).toHaveLength(102);
  });

  // @traces 069-FR-003
  it('does not touch the open reports of the same garage on another file', async () => {
    const other = await prisma.verificationFile.create({
      data: { garageId, openedAt: OPENED, status: 'rejected' },
    });
    const elsewhere = await prisma.garageReport.create({
      data: {
        garageId,
        reporterId: await account('Mihai Pop', ['driver']),
        text: LONG,
        verificationFileId: other.id,
      },
    });

    await service().decide(ioana, fileId, confirmed);

    expect(
      (
        await prisma.garageReport.findUniqueOrThrow({
          where: { id: elsewhere.id },
        })
      ).status,
    ).toBe('open');
  });

  // @traces 069-FR-001
  it('stores a note that is blank after trimming as empty', async () => {
    await service().decide(ioana, fileId, {
      decision: 'unfounded',
      note: '   ',
    });

    for (const report of await reportsOf()) {
      expect(report.decisionNote).toBeNull();
    }
  });

  // @traces 069-FR-001
  it('refuses a confirmation whose reason is only spaces with 422', async () => {
    const refused = await refusal(
      service().decide(ioana, fileId, {
        decision: 'confirmed',
        reason: ' \t ',
      }),
    );

    expect(refused.status).toBe(422);
    expect((await fileOf()).status).toBe('in_review');
  });

  // @traces 069-FR-001
  it('keeps unicode and markup in a note as plain text', async () => {
    const text = '<b>Ș ț 🚗</b> \u202e';
    await service().decide(ioana, fileId, {
      decision: 'unfounded',
      note: text,
    });

    for (const report of await reportsOf()) {
      expect(report.decisionNote).toBe(text);
    }
  });

  // @traces 069-FR-001
  it.each([
    ['a driver', 'driver'],
    ['a mechanic', 'mechanic'],
  ] as const)(
    'refuses %s as no such file and changes nothing',
    async (_, role) => {
      const actor: Actor = person(elena, role);

      const refused = await refusal(service().decide(actor, fileId, confirmed));

      expect(refused.status).toBe(404);
      expect(JSON.stringify(refused.body)).not.toContain('Atelier Dinamo');
      expect(await garageStatus()).toBe('approved');
      expect((await reportsOf()).every((r) => r.status === 'open')).toBe(true);
    },
  );

  // @traces 069-FR-001
  it('answers an unknown file the same as a refused actor', async () => {
    const unknown = await refusal(
      service().decide(ioana, randomUUID(), unfounded),
    );
    const driver = await refusal(
      service().decide(person(elena, 'driver'), fileId, unfounded),
    );

    expect(unknown.status).toBe(driver.status);
    expect(unknown.body['code']).toBe(driver.body['code']);
  });

  // @traces 069-FR-003
  it('still closes the reports when a reporter’s account is deleted', async () => {
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: elena },
    });

    await service().decide(ioana, fileId, unfounded);

    expect((await reportsOf()).every((r) => r.status === 'unfounded')).toBe(
      true,
    );
  });

  // @traces 069-FR-004
  it('does not suspend the garage on an unfounded decision however the body is padded', async () => {
    await service().decide(ioana, fileId, {
      decision: 'unfounded',
      reason: REASON,
    } as ReportDecisionDto);

    expect(await garageStatus()).toBe('approved');
    expect(await suspensionsOf()).toEqual([]);
  });

  // @traces 069-FR-004
  it('closes the reports and keeps one suspension when the garage was already suspended through an expiring cause', async () => {
    await new SuspensionService(prisma, new AuditService(), outbox).suspend(
      ioana,
      garageId,
      'documents_overdue',
      'Expirat',
    );

    await service().decide(ioana, fileId, confirmed);
    const second = await refusal(service().decide(ioana, fileId, confirmed));

    expect(second.status).toBe(409);
    expect(await suspensionsOf()).toHaveLength(1);
    expect((await fileOf()).status).toBe('approved');
  });

  // @traces 069-FR-003
  it('rolls back the reports, the file and the suspension when the audit write fails', async () => {
    const audit = new AuditService();
    jest
      .spyOn(audit, 'record')
      .mockImplementation(async (...args: unknown[]) => {
        const entry = args[1] as { kind?: string } | undefined;
        if (entry?.kind === 'report_decided') throw new Error('audit down');
        return undefined as never;
      });
    const failing = new ReportDecisionService(
      prisma,
      verification(),
      new SuspensionService(prisma, new AuditService(), outbox),
      audit,
      outbox,
    );

    await expect(failing.decide(ioana, fileId, confirmed)).rejects.toThrow();

    expect((await reportsOf()).every((r) => r.status === 'open')).toBe(true);
    expect(await garageStatus()).toBe('approved');
    expect(await suspensionsOf()).toEqual([]);
    expect(await eventsOf('garage.suspended')).toEqual([]);
  });
});
