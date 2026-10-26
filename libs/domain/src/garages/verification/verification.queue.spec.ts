import { VerificationService } from './verification.service';
import { AuditService } from '../../audit/audit.service';
import { outbox } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';

// @traces 301-FR-001

// Prisma reads a file's garage in a query of its own: a garage deleted
// between the two (an account closed meanwhile) comes back as null.
const GARAGE = {
  _count: { brands: 0, mechanics: 0 },
  businessKind: null,
  cityName: 'Cluj-Napoca',
  features: [],
  id: 'g-1',
  name: 'Auto Vest Motors',
  serviceRadiusKm: null,
};
const file = (id: string, garage: typeof GARAGE | null) => ({
  checks: [],
  cuiWarning: null,
  decidedAt: null,
  documents: [],
  garage,
  id,
  reopenedAt: null,
  status: 'submitted',
  submittedAt: new Date('2026-10-20T08:00:00Z'),
});
const renewal = (id: string, garage: object | null) => ({
  documents: [{ createdAt: new Date('2026-10-21T08:00:00Z'), id: `d-${id}` }],
  garage,
  id,
});

function db(files: unknown[], renewals: unknown[]) {
  return {
    legalDocument: { groupBy: async () => [] },
    publicHoliday: { findMany: async () => [] },
    verificationFile: {
      count: async () => files.length + renewals.length,
      findMany: async (args: { where: { id?: unknown } }) =>
        args.where.id ? renewals : files,
    },
  } as unknown as Prisma.TransactionClient;
}

const service = () =>
  new VerificationService(new AuditService(), outbox, {
    skipManualApproval: false,
  });

describe("the admins' queue", () => {
  it('leaves out a file whose garage was deleted while it was read', async () => {
    const queue = await service().queue(
      db([file('f-gone', null), file('f-1', GARAGE)], []),
      { limit: 20, offset: 0 },
      new Date('2026-10-25T08:00:00Z'),
    );

    expect(queue.items.map((row) => row.id)).toEqual(['f-1']);
  });

  it('leaves out a renewal whose garage was deleted while it was read', async () => {
    const queue = await service().queue(
      db([], [renewal('r-gone', null)]),
      { limit: 20, offset: 0 },
      new Date('2026-10-25T08:00:00Z'),
    );

    expect(queue.items).toEqual([]);
  });
});
