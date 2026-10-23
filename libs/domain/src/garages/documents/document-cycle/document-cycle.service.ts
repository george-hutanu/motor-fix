import type {
  DocumentCycleDto,
  DocumentCycleRefusalDto,
  DocumentCycleState,
  DocumentKind,
  DocumentRefusalReason,
  DocumentRow,
} from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../../../auth/prisma';
import { addMonths, daysBetween, localDay } from '../../../bucharest';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';

export interface CycleDocument {
  kind: DocumentKind;
  status: 'valid' | 'in_review' | 'refused';
  createdAt: Date;
}

// The reminders start this many days before the due date.
const DUE_FROM_DAYS = 30;

export const dayOf = (at: Date) => at.toISOString().slice(0, 10);

// A yearly upload of the garage that waits for an admin.
export const inReviewWhere = (
  garageId: string,
): Prisma.LegalDocumentWhereInput => ({
  status: 'in_review',
  verificationFile: { garageId },
});

// The garage's first cycle, at its approval; a garage approved again keeps
// the one it has.
export async function ensureDocumentCycle(
  tx: Prisma.TransactionClient,
  garageId: string,
  approvedAt: Date,
): Promise<void> {
  await tx.documentCycle.createMany({
    data: [{ dueOn: new Date(addMonths(localDay(approvedAt), 12)), garageId }],
    skipDuplicates: true,
  });
}

// Each kind's newest upload.
function newestOf<T extends CycleDocument>(documents: readonly T[]): T[] {
  const newest = new Map<DocumentKind, T>();
  for (const document of documents) {
    const held = newest.get(document.kind);
    if (!held || document.createdAt > held.createdAt) {
      newest.set(document.kind, document);
    }
  }
  return [...newest.values()];
}

// Whether the newest upload of some kind was refused.
const refusedNewest = (documents: readonly CycleDocument[]) =>
  newestOf(documents).some((d) => d.status === 'refused');

// What the documents row says, from the cycle and the garage's documents: a
// document in review first, then overdue, then a kind whose newest upload
// was refused, then how near the due date is.
export function rowOf(
  cycle: { dueOn: string; state: DocumentCycleState },
  documents: readonly CycleDocument[],
  today: string,
): { row: DocumentRow; canUpload: boolean } {
  if (documents.some((d) => d.status === 'in_review')) {
    return { canUpload: false, row: 'in_review' };
  }
  if (cycle.state === 'overdue') return { canUpload: true, row: 'overdue' };
  if (refusedNewest(documents)) return { canUpload: true, row: 'refused' };
  const near = daysBetween(today, cycle.dueOn) <= DUE_FROM_DAYS;
  return { canUpload: true, row: near ? 'due' : 'valid' };
}

@Injectable()
export class DocumentCycleService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // The garage's cycle, or null for a garage never approved: the row to
  // show, whether an upload is open, and the newest refusal of a kind whose
  // newest upload was refused. Inside a transaction, it reads through it.
  async documentCycleOf(
    garageId: string,
    db: Prisma.TransactionClient = this.prisma,
    today: string = localDay(new Date()),
  ): Promise<DocumentCycleDto | null> {
    const [cycle, documents] = await Promise.all([
      db.documentCycle.findUnique({ where: { garageId } }),
      db.legalDocument.findMany({
        select: {
          createdAt: true,
          decidedAt: true,
          kind: true,
          refusalNote: true,
          refusalReason: true,
          status: true,
        },
        where: { replacedAt: null, verificationFile: { garageId } },
      }),
    ]);
    if (!cycle) return null;
    const held = documents as (CycleDocument & RefusalSource)[];
    const state = cycle.state as DocumentCycleState;
    const dueOn = dayOf(cycle.dueOn);
    const { canUpload, row } = rowOf({ dueOn, state }, held, today);
    return {
      canUpload,
      dueOn,
      graceUntil: cycle.graceUntil && dayOf(cycle.graceUntil),
      inReview: held.some((d) => d.status === 'in_review'),
      refusal: refusalOf(held),
      row,
      state,
    };
  }
}

interface RefusalSource {
  decidedAt: Date | null;
  refusalNote: string | null;
  refusalReason: string | null;
}

// The newest refusal among the kinds whose newest upload was refused.
function refusalOf(
  documents: readonly (CycleDocument & RefusalSource)[],
): DocumentCycleRefusalDto | null {
  const refused = newestOf(documents)
    .filter((d) => d.status === 'refused')
    .sort(
      (a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0),
    )[0];
  if (!refused?.decidedAt) return null;
  return {
    decidedAt: refused.decidedAt.toISOString(),
    kind: refused.kind,
    note: refused.refusalNote ?? '',
    reason: refused.refusalReason as DocumentRefusalReason,
  };
}
