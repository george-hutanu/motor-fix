import type {
  DocumentCycleDto,
  DocumentCycleState,
  DocumentKind,
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

export type DocumentRow = 'valid' | 'due' | 'in_review' | 'refused' | 'overdue';

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

// Whether the newest upload of some kind was refused.
function refusedNewest(documents: readonly CycleDocument[]): boolean {
  const newest = new Map<DocumentKind, CycleDocument>();
  for (const document of documents) {
    const held = newest.get(document.kind);
    if (!held || document.createdAt > held.createdAt) {
      newest.set(document.kind, document);
    }
  }
  return [...newest.values()].some((d) => d.status === 'refused');
}

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

  // The garage's cycle, or null for a garage never approved.
  async documentCycleOf(garageId: string): Promise<DocumentCycleDto | null> {
    const [cycle, inReview] = await Promise.all([
      this.prisma.documentCycle.findUnique({ where: { garageId } }),
      this.prisma.legalDocument.count({ where: inReviewWhere(garageId) }),
    ]);
    if (!cycle) return null;
    return {
      dueOn: dayOf(cycle.dueOn),
      graceUntil: cycle.graceUntil && dayOf(cycle.graceUntil),
      inReview: inReview > 0,
      state: cycle.state as DocumentCycleState,
    };
  }
}
