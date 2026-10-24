import {
  RETENTION,
  RETENTION_BATCH,
  retentionCutoff,
} from './retention.config';
import type { PrismaClient } from '../generated/prisma/client';
import type { StorageService } from '../storage/storage.service';

interface LegalDocumentDeps {
  prisma: PrismaClient;
  storage: Pick<StorageService, 'deleteObject'>;
}

// Removes every legal document, whatever its status, of a garage closed before
// the period, its page files first, and answers how many. The store answers a
// page already gone with success. A document whose page the store refuses
// stays for the next night, the rest go, and the sweep then fails naming it:
// dropping the row would leave the file with nothing to find it by.
export async function sweepLegalDocuments(
  { prisma, storage }: LegalDocumentDeps,
  now: Date,
): Promise<number> {
  const cutoff = retentionCutoff(now, RETENTION.legalDocuments.days);
  const stuck: string[] = [];
  const errors: Error[] = [];
  let total = 0;
  for (;;) {
    const due = await prisma.$queryRaw<{ id: string; pages: string[] }[]>`
      SELECT d.id, d.pages FROM legal_document d
        JOIN verification_file f ON f.id = d.verification_file_id
        JOIN garage g ON g.id = f.garage_id
       WHERE g.closed_at < ${cutoff} AND NOT (d.id = ANY(${stuck}::uuid[]))
       LIMIT ${RETENTION_BATCH}`;
    const removable: string[] = [];
    for (const document of due) {
      const refused = await deletePages(storage, document.pages);
      if (refused) {
        stuck.push(document.id);
        errors.push(refused);
      } else removable.push(document.id);
    }
    if (removable.length) {
      total += (
        await prisma.legalDocument.deleteMany({
          where: { id: { in: removable } },
        })
      ).count;
    }
    if (due.length < RETENTION_BATCH) break;
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      `legal documents kept, pages not deleted: ${errors.map((e) => e.message).join('; ')}`,
    );
  }
  return total;
}

// Deletes the pages in turn and answers the first refusal, naming its key.
async function deletePages(
  storage: LegalDocumentDeps['storage'],
  pages: string[],
): Promise<Error | null> {
  for (const page of pages) {
    try {
      await storage.deleteObject(page);
    } catch (error) {
      return new Error(`${page}: ${String(error)}`, { cause: error });
    }
  }
  return null;
}
