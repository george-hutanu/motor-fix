import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentCycleService } from './document-cycle.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { addDays, addMonths, localDay } from '../../../bucharest';
import { outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { VerificationService } from '../../verification/verification.service';

// @traces 068-FR-001
// @traces 068-FR-002

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20261023090000_document_cycle/migration.sql',
);
const CHECK_KINDS = [
  'company',
  'caen',
  'rar',
  'activities',
  'representative',
  'address',
  'photos',
  'documents',
] as const;
const KINDS = ['onrc_certificate', 'rar_authorisation'] as const;
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const cycles = new DocumentCycleService(prisma);
const day = (at: Date | null | undefined) =>
  at ? at.toISOString().slice(0, 10) : null;

afterAll(() => prisma.$disconnect());
beforeEach(() => reset());

const garage = (
  status: 'draft' | 'approved' | 'suspended',
  approvedAt: string | null,
) =>
  prisma.garage.create({
    data: {
      approvedAt: approvedAt === null ? null : new Date(approvedAt),
      name: 'Atelier',
      slug: `cycle-${randomUUID()}`,
      status,
    },
  });

// The submitted file an admin approves, every check ok and both documents held.
const submittedFile = (garageId: string) =>
  prisma.verificationFile.create({
    data: {
      checks: { create: CHECK_KINDS.map((kind) => ({ kind, result: 'ok' })) },
      documents: { create: KINDS.map((kind) => ({ kind, pages: ['p1'] })) },
      garageId,
      status: 'submitted',
    },
  });

async function approve(fileId: string) {
  const id = await account('Ioana Popa', ['admin']);
  const admin: Actor = {
    accountId: id,
    garageId: null,
    permissions: NONE,
    role: 'admin',
    roles: ['admin'],
  };
  const verification = new VerificationService(new AuditService(), outbox, {
    skipManualApproval: false,
  });
  await prisma.$transaction((tx) =>
    verification.decide(tx, admin, fileId, { outcome: 'approved' }),
  );
}

// The migration's backfill, as it ran: every garage already approved or
// suspended gets its cycle.
async function backfill() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const statement = /INSERT INTO "garage_document_cycle"[\s\S]*?;/.exec(sql);
  if (!statement) throw new Error('the migration holds no backfill');
  await prisma.$executeRawUnsafe(statement[0]);
}

describe('the yearly document cycle', () => {
  it('starts at approval, due on the acceptance day plus 12 months', async () => {
    const { id } = await garage('draft', null);
    const file = await submittedFile(id);

    await approve(file.id);

    const cycle = await prisma.documentCycle.findUniqueOrThrow({
      where: { garageId: id },
    });
    expect({
      dueOn: day(cycle.dueOn),
      graceUntil: cycle.graceUntil,
      reminded0At: cycle.reminded0At,
      reminded7At: cycle.reminded7At,
      reminded30At: cycle.reminded30At,
      state: cycle.state,
    }).toEqual({
      dueOn: addMonths(localDay(new Date()), 12),
      graceUntil: null,
      reminded0At: null,
      reminded7At: null,
      reminded30At: null,
      state: 'due',
    });
  });

  it('keeps its due date when a reopened file is approved again', async () => {
    const { id } = await garage('approved', '2026-01-10T10:00:00Z');
    await prisma.documentCycle.create({
      data: { dueOn: new Date('2027-01-10'), garageId: id },
    });
    const file = await submittedFile(id);

    await approve(file.id);

    const cycle = await prisma.documentCycle.findUniqueOrThrow({
      where: { garageId: id },
    });
    expect(day(cycle.dueOn)).toBe('2027-01-10');
  });

  it('is created by the migration for approved and suspended garages, never sooner than in 30 days', async () => {
    const soon = addDays(localDay(new Date()), 30);
    const leap = await garage('approved', '2028-02-29T10:00:00Z');
    const late = await garage('suspended', '2025-03-01T10:00:00Z');
    // 23:30 UTC on 31 December is already 1 January in Bucharest.
    const night = await garage('approved', '2027-12-31T23:30:00Z');
    const draft = await garage('draft', null);
    // A garage whose approval was later withdrawn keeps no cycle.
    const withdrawn = await garage('draft', '2026-01-10T10:00:00Z');

    await backfill();

    const rows = await prisma.documentCycle.findMany();
    const dueOf = (garageId: string) =>
      day(rows.find((row) => row.garageId === garageId)?.dueOn);
    expect(dueOf(leap.id)).toBe('2029-02-28');
    expect(dueOf(late.id)).toBe(soon);
    expect(dueOf(night.id)).toBe('2029-01-01');
    expect(dueOf(draft.id)).toBeNull();
    expect(dueOf(withdrawn.id)).toBeNull();
    expect(rows.every((row) => row.state === 'due')).toBe(true);
  });

  it('answers the due date, state, grace and whether a document is in review', async () => {
    const { id } = await garage('approved', '2025-10-01T10:00:00Z');
    await prisma.documentCycle.create({
      data: {
        dueOn: new Date('2026-10-01'),
        garageId: id,
        graceUntil: new Date('2026-10-15'),
        state: 'overdue',
      },
    });

    expect(await cycles.documentCycleOf(id)).toEqual({
      canUpload: true,
      dueOn: '2026-10-01',
      graceUntil: '2026-10-15',
      inReview: false,
      refusal: null,
      row: 'overdue',
      state: 'overdue',
    });

    await prisma.verificationFile.create({
      data: {
        documents: {
          create: [
            { kind: 'onrc_certificate', pages: ['p1'] },
            { kind: 'onrc_certificate', pages: ['p2'], status: 'in_review' },
          ],
        },
        garageId: id,
        status: 'approved',
      },
    });
    expect(await cycles.documentCycleOf(id)).toMatchObject({ inReview: true });
  });

  // @traces 068-FR-005
  // @traces 068-FR-010
  it('answers the row to show, whether an upload is open and the newest refusal', async () => {
    const { id } = await garage('approved', '2025-10-01T10:00:00Z');
    const dueOn = addDays(localDay(new Date()), 90);
    await prisma.documentCycle.create({
      data: { dueOn: new Date(dueOn), garageId: id },
    });
    const file = await prisma.verificationFile.create({
      data: {
        documents: {
          create: KINDS.map((kind) => ({
            createdAt: new Date('2025-09-25T09:00:00Z'),
            kind,
            pages: ['p1'],
          })),
        },
        garageId: id,
        status: 'approved',
      },
    });

    expect(await cycles.documentCycleOf(id)).toMatchObject({
      canUpload: true,
      refusal: null,
      row: 'valid',
    });

    const decidedAt = new Date('2026-10-20T08:00:00Z');
    await prisma.legalDocument.create({
      data: {
        createdAt: new Date('2026-10-19T08:00:00Z'),
        decidedAt,
        kind: 'rar_authorisation',
        pages: ['r1'],
        refusalNote: 'Autorizația a expirat',
        refusalReason: 'documents',
        status: 'refused',
        verificationFileId: file.id,
      },
    });
    expect(await cycles.documentCycleOf(id)).toMatchObject({
      canUpload: true,
      refusal: {
        decidedAt: decidedAt.toISOString(),
        kind: 'rar_authorisation',
        note: 'Autorizația a expirat',
        reason: 'documents',
      },
      row: 'refused',
    });

    const again = await prisma.legalDocument.create({
      data: {
        kind: 'rar_authorisation',
        pages: ['r2'],
        status: 'in_review',
        verificationFileId: file.id,
      },
    });
    expect(await cycles.documentCycleOf(id)).toMatchObject({
      canUpload: false,
      inReview: true,
      refusal: null,
      row: 'in_review',
    });

    await prisma.legalDocument.updateMany({
      data: { replacedAt: new Date() },
      where: { kind: 'rar_authorisation', status: 'valid' },
    });
    await prisma.legalDocument.update({
      data: { decidedAt: new Date(), status: 'valid' },
      where: { id: again.id },
    });
    expect(await cycles.documentCycleOf(id)).toMatchObject({
      canUpload: true,
      refusal: null,
      row: 'valid',
    });
  });

  it('answers nothing for a garage never approved', async () => {
    const { id } = await garage('draft', null);

    expect(await cycles.documentCycleOf(id)).toBeNull();
  });
});
