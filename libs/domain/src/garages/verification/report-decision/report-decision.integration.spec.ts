import { randomUUID } from 'node:crypto';

import type { ReportDecisionDto } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';

import { ReportDecisionService } from './report-decision.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { type EventPort, outbox } from '../../../events/event.port';
import type { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { GarageReportsService } from '../garage-reports/garage-reports.service';
import { SuspensionService } from '../suspension/suspension.service';
import { VerificationService } from '../verification.service';

// @traces 069-FR-002 069-FR-003
// @traces 069-FR-004 069-FR-005
// @traces 069-FR-006 069-FR-011
// @traces 069-FR-012

const reader = countedMetrics();
const decisions = (outcome: string) =>
  counterTotal(reader, 'motorfix_report_decisions_total', { outcome });
const refusals = (reason: string) =>
  counterTotal(reader, 'motorfix_verification_decision_refusals_total', {
    reason,
  });
const suspensions = () =>
  counterTotal(reader, 'motorfix_garage_suspensions_total', {
    cause: 'report_confirmed',
  });
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
const reporting = () =>
  new GarageReportsService(
    prisma,
    verification(),
    new AuditService(),
    outbox,
    { notify: jest.fn() } as unknown as NotificationsService,
    {},
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

const unfounded: ReportDecisionDto = { decision: 'unfounded', note: NOTE };
const confirmed: ReportDecisionDto = { decision: 'confirmed', reason: REASON };

describe('deciding the reports unfounded', () => {
  it('closes every open report, approves the file and leaves the garage listed', async () => {
    const before = await decisions('unfounded');

    await service().decide(ioana, fileId, unfounded);

    const reports = await reportsOf();
    expect(reports).toHaveLength(2);
    for (const report of reports) {
      expect(report).toMatchObject({
        decidedBy: ioana.accountId,
        decisionNote: NOTE,
        status: 'unfounded',
      });
      expect(report.decidedAt).toBeInstanceOf(Date);
    }
    const file = await fileOf();
    expect(file).toMatchObject({
      decidedBy: ioana.accountId,
      reasonCode: null,
      reasonNote: null,
      status: 'approved',
    });
    expect(file.decidedAt?.getTime()).toBeGreaterThan(OPENED.getTime());
    expect(await garageStatus()).toBe('approved');
    expect(await suspensionsOf()).toEqual([]);
    expect(await eventsOf('garage.suspended')).toEqual([]);
    expect(await decisions('unfounded')).toBe(before + 1);
  });

  it('writes one history entry with the decision, the reports and the note', async () => {
    await service().decide(ioana, fileId, unfounded);

    const ids = (await reportsOf()).map((r) => r.id).sort();
    const [entry, ...more] = await decidedEntries();
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      action: 'update',
      actorId: ioana.accountId,
      actorRole: 'admin',
      field: 'reports',
      garageId,
      oldValue: 'open',
      subjectType: 'verification_file',
    });
    const value = entry?.newValue as { reportIds: string[] };
    expect({ ...value, reportIds: [...value.reportIds].sort() }).toEqual({
      decision: 'unfounded',
      note: NOTE,
      reportIds: ids,
    });
  });

  it('records one event for the admins and each reporter, without the note', async () => {
    await service().decide(ioana, fileId, unfounded);

    const [event, ...more] = await eventsOf('garage_report.decided');
    expect(more).toEqual([]);
    expect(event?.subjectId).toBe(fileId);
    const payload = event?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'decision',
      'fileId',
      'garageId',
      'reportIds',
      'reporterIds',
    ]);
    expect(payload).toMatchObject({ decision: 'unfounded', fileId, garageId });
    expect([...(payload['reporterIds'] as string[])].sort()).toEqual(
      [elena, radu].sort(),
    );
    expect([...(event?.audience ?? [])].sort()).toEqual(
      ['admin', `account:${elena}`, `account:${radu}`].sort(),
    );
  });

  it('stores no note when none is given', async () => {
    await service().decide(ioana, fileId, { decision: 'unfounded' });

    for (const report of await reportsOf()) {
      expect(report.decisionNote).toBeNull();
    }
    const [entry] = await decidedEntries();
    expect(entry?.newValue).not.toHaveProperty('note');
  });

  it('reads no reason with an unfounded decision', async () => {
    await service().decide(ioana, fileId, {
      decision: 'unfounded',
      reason: REASON,
    });

    const [entry] = await decidedEntries();
    expect(entry?.newValue).not.toHaveProperty('reason');
    expect(await garageStatus()).toBe('approved');
  });
});

describe('confirming the reports', () => {
  it('refuses a confirmation with no reason, writing nothing', async () => {
    const before = await refusals('reason_required');

    for (const body of [
      { decision: 'confirmed' },
      { decision: 'confirmed', reason: '' },
    ] as ReportDecisionDto[]) {
      const refused = await refusal(service().decide(ioana, fileId, body));
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({
        code: 'reason_required',
        errors: [{ code: 'required', field: 'reason' }],
      });
    }

    expect((await reportsOf()).every((r) => r.status === 'open')).toBe(true);
    expect((await fileOf()).status).toBe('in_review');
    expect(await refusals('reason_required')).toBe(before + 2);
  });

  it('suspends the garage with the reason in the same commit', async () => {
    const before = {
      decided: await decisions('confirmed'),
      suspended: await suspensions(),
    };

    await service().decide(ioana, fileId, confirmed);

    expect((await reportsOf()).every((r) => r.status === 'confirmed')).toBe(
      true,
    );
    expect((await fileOf()).status).toBe('approved');
    expect(await garageStatus()).toBe('suspended');
    const [row, ...more] = await suspensionsOf();
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      cause: 'report_confirmed',
      reason: REASON,
      suspendedBy: ioana.accountId,
      untilTime: null,
    });
    expect(await eventsOf('garage.suspended')).toHaveLength(1);
    const [entry] = await decidedEntries();
    expect(entry?.newValue).toMatchObject({
      decision: 'confirmed',
      reason: REASON,
    });
    expect(entry?.newValue).not.toHaveProperty('alreadySuspended');
    expect(entry?.newValue).not.toHaveProperty('note');
    const [event] = await eventsOf('garage_report.decided');
    expect(event?.payload).not.toHaveProperty('reason');
    expect(await decisions('confirmed')).toBe(before.decided + 1);
    expect(await suspensions()).toBe(before.suspended + 1);
  });

  it('leaves everything as it was when the commit fails', async () => {
    const failing: EventPort = {
      record: async (tx, event) => {
        if (event.kind === 'garage_report.decided')
          throw new Error('outbox down');
        return outbox.record(tx, event);
      },
    } as EventPort;

    await expect(
      service(failing).decide(ioana, fileId, confirmed),
    ).rejects.toThrow('outbox down');

    expect((await reportsOf()).every((r) => r.status === 'open')).toBe(true);
    expect((await fileOf()).status).toBe('in_review');
    expect(await garageStatus()).toBe('approved');
    expect(await suspensionsOf()).toEqual([]);
  });

  it('closes the reports of a garage already suspended with no second suspension', async () => {
    await new SuspensionService(prisma, new AuditService(), outbox).suspend(
      ioana,
      garageId,
      'documents_overdue',
      'Certificat expirat',
    );
    const before = {
      decided: await decisions('confirmed_already_suspended'),
      suspended: await suspensions(),
    };
    const events = (await eventsOf('garage.suspended')).length;

    await service().decide(ioana, fileId, confirmed);

    expect((await reportsOf()).every((r) => r.status === 'confirmed')).toBe(
      true,
    );
    expect(await suspensionsOf()).toHaveLength(1);
    expect(await eventsOf('garage.suspended')).toHaveLength(events);
    const [entry] = await decidedEntries();
    expect(entry?.newValue).toMatchObject({
      alreadySuspended: true,
      cause: 'documents_overdue',
      decision: 'confirmed',
    });
    expect(await decisions('confirmed_already_suspended')).toBe(
      before.decided + 1,
    );
    expect(await suspensions()).toBe(before.suspended);
  });
});

describe('refusing a decision', () => {
  it('refuses any actor without the admins’ capability as no such file', async () => {
    const driver = person(elena, 'driver');

    const refused = await refusal(service().decide(driver, fileId, unfounded));

    expect(refused.status).toBe(404);
    expect((await reportsOf()).every((r) => r.status === 'open')).toBe(true);
  });

  it('refuses an unknown or malformed file id as no such file', async () => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      expect(
        (await refusal(service().decide(ioana, id, unfounded))).status,
      ).toBe(404);
    }
  });

  it('refuses a second decision, naming the first', async () => {
    await service().decide(ioana, fileId, unfounded);
    const before = await refusals('already_decided');

    const refused = await refusal(service().decide(ioana, fileId, confirmed));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: 'verification_transition_refused',
      currentStatus: 'approved',
      decidedBy: 'Ioana',
    });
    expect(typeof refused.body['decidedAt']).toBe('string');
    expect(await garageStatus()).toBe('approved');
    expect(await eventsOf('garage_report.decided')).toHaveLength(1);
    expect(await refusals('already_decided')).toBe(before + 1);
  });

  it('refuses a file in review with no open report as already under review', async () => {
    await prisma.garageReport.updateMany({
      data: { status: 'unfounded' },
      where: { verificationFileId: fileId },
    });
    const before = await refusals('no_open_report');

    const refused = await refusal(service().decide(ioana, fileId, unfounded));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: 'verification_transition_refused',
      message: 'already under review, opened by Ioana',
    });
    expect((await fileOf()).status).toBe('in_review');
    expect(await refusals('no_open_report')).toBe(before + 1);
  });

  it('lets exactly one of two decisions sent together through', async () => {
    const results = await Promise.allSettled([
      service().decide(ioana, fileId, confirmed),
      service().decide(ioana, fileId, unfounded),
    ]);

    const statuses = await Promise.all(
      results.map(async (result) =>
        result.status === 'fulfilled'
          ? 200
          : (await refusal(Promise.reject(result.reason))).status,
      ),
    );
    expect(statuses.sort()).toEqual([200, 409]);
    expect(await eventsOf('garage_report.decided')).toHaveLength(1);
    expect((await suspensionsOf()).length).toBeLessThanOrEqual(1);
    const outcomes = new Set((await reportsOf()).map((r) => r.status));
    expect(outcomes.size).toBe(1);
  });
});

describe('reporting again after a decision', () => {
  it('lets the same driver report again on the reopened file, the earlier report kept', async () => {
    await service().decide(ioana, fileId, unfounded);

    await reporting().report(person(elena, 'driver'), garageId, {
      text: 'Tot prețuri false la manoperă, din nou.',
    });

    const reports = await prisma.garageReport.findMany({
      where: { garageId, reporterId: elena },
    });
    expect(reports.map((r) => r.status).sort()).toEqual(['open', 'unfounded']);
    expect((await fileOf()).status).toBe('in_review');
    // The garage stays listed while the new report waits.
    expect(await garageStatus()).toBe('approved');
  });
});
