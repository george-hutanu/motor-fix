import { randomUUID } from 'node:crypto';

import { VerificationService } from './verification.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const service = () =>
  new VerificationService(new AuditService(), outbox, {
    skipManualApproval: false,
  });
const page = { limit: 20, offset: 0 };

beforeEach(async () => {
  await reset();
});
afterAll(() => prisma.$disconnect());

async function renewing(
  uploads: { kind: string; at: string; status?: string }[],
  options: {
    cycle?: { state: 'due' | 'overdue'; graceUntil?: string } | null;
    garage?: Partial<Prisma.GarageUncheckedCreateInput>;
    fileStatus?: 'approved' | 'submitted';
  } = {},
) {
  const garage = await prisma.garage.create({
    data: {
      name: 'Auto Vest',
      slug: `g-${randomUUID()}`,
      status: 'approved',
      ...options.garage,
    },
  });
  const file = await prisma.verificationFile.create({
    data: {
      garageId: garage.id,
      status: options.fileStatus ?? 'approved',
      submittedAt: new Date('2025-11-01T09:00:00Z'),
    },
  });
  const docs = [];
  for (const upload of uploads) {
    docs.push(
      await prisma.legalDocument.create({
        data: {
          createdAt: new Date(upload.at),
          kind: upload.kind,
          pages: ['legal_document/p'],
          status: (upload.status ?? 'in_review') as 'in_review',
          verificationFileId: file.id,
        },
      }),
    );
  }
  if (options.cycle !== null) {
    await prisma.documentCycle.create({
      data: {
        dueOn: new Date('2026-10-01'),
        garageId: garage.id,
        graceUntil: options.cycle?.graceUntil
          ? new Date(options.cycle.graceUntil)
          : null,
        state: options.cycle?.state ?? 'due',
      },
    });
  }
  return { docs, file, garage };
}

// @traces 068-FR-011
describe('the documents rows under awkward data', () => {
  it('lists a garage with one document in review once, by that document', async () => {
    const one = await renewing([
      { at: '2026-10-13T09:00:00Z', kind: 'rar_authorisation' },
    ]);

    const queue = await service().queue(
      prisma,
      page,
      new Date('2026-10-15T07:00:00Z'),
    );

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      documentId: one.docs[0]?.id,
      item: 'documents',
    });
  });

  it('names the oldest upload as the row document, whichever kind it is', async () => {
    const both = await renewing([
      { at: '2026-10-13T09:00:00Z', kind: 'rar_authorisation' },
      { at: '2026-10-12T09:00:00Z', kind: 'onrc_certificate' },
    ]);

    const queue = await service().queue(
      prisma,
      page,
      new Date('2026-10-15T07:00:00Z'),
    );

    expect(queue.items[0]?.documentId).toBe(both.docs[1]?.id);
    expect(queue.items[0]?.submittedAt).toEqual(
      new Date('2026-10-12T09:00:00Z'),
    );
  });

  it('shows a garage whose own file is waiting as that file only, counted once', async () => {
    const both = await renewing(
      [{ at: '2026-10-13T09:00:00Z', kind: 'rar_authorisation' }],
      { fileStatus: 'submitted' },
    );

    const queue = await service().queue(
      prisma,
      page,
      new Date('2026-10-15T07:00:00Z'),
    );

    expect(queue.items.map((row) => [row.id, row.item])).toEqual([
      [both.file.id, 'verification'],
    ]);
    expect(queue.total).toBe(1);
    expect(await service().countWaiting(prisma)).toBe(1);
  });

  it('ignores a refused or valid document, and lists nothing for them', async () => {
    await renewing([
      {
        at: '2026-10-13T09:00:00Z',
        kind: 'rar_authorisation',
        status: 'refused',
      },
      { at: '2026-10-13T09:00:00Z', kind: 'onrc_certificate', status: 'valid' },
    ]);

    const queue = await service().queue(
      prisma,
      page,
      new Date('2026-10-15T07:00:00Z'),
    );

    expect(queue.items).toEqual([]);
    expect(await service().countWaiting(prisma)).toBe(0);
  });

  it('counts the grace day by the Bucharest calendar, not the UTC one', async () => {
    const last = await renewing(
      [{ at: '2026-10-13T09:00:00Z', kind: 'rar_authorisation' }],
      { cycle: { graceUntil: '2026-10-15', state: 'overdue' } },
    );
    const ended = await renewing(
      [{ at: '2026-10-13T09:00:00Z', kind: 'rar_authorisation' }],
      { cycle: { graceUntil: '2026-10-14', state: 'overdue' } },
    );

    const queue = await service().queue(
      prisma,
      page,
      new Date('2026-10-14T21:30:00Z'),
    );

    const lamp = new Map(queue.items.map((row) => [row.garageId, row.lamp]));
    expect(lamp.get(last.garage.id)).toBe('amber');
    expect(lamp.get(ended.garage.id)).toBe('red');
  });

  it('lists a garage with documents in review but no cycle row without failing', async () => {
    const none = await renewing(
      [{ at: '2026-10-13T09:00:00Z', kind: 'rar_authorisation' }],
      { cycle: null },
    );

    const queue = await service().queue(
      prisma,
      page,
      new Date('2026-10-15T07:00:00Z'),
    );

    expect(queue.items.map((row) => row.garageId)).toEqual([none.garage.id]);
    expect(queue.items[0]?.lamp).toBe('amber');
  });

  it('pages without repeating or dropping a row when the pages end between rows', async () => {
    const rows = [];
    for (let n = 0; n < 5; n += 1) {
      rows.push(
        await renewing([
          { at: `2026-10-1${n}T09:00:00Z`, kind: 'rar_authorisation' },
        ]),
      );
    }
    const seen: string[] = [];
    for (const offset of [0, 2, 4]) {
      const queue = await service().queue(
        prisma,
        { limit: 2, offset },
        new Date('2026-10-20T07:00:00Z'),
      );
      expect(queue.total).toBe(5);
      seen.push(...queue.items.map((row) => row.garageId));
    }
    expect(seen).toEqual(rows.map((row) => row.garage.id));
  });
});
