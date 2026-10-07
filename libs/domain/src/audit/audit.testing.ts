import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';

// Writes one activity entry per row, dated now, for a garage and a subject no
// spec creates. activity_log refuses DELETE and TRUNCATE, so a worktree's
// reused database always holds entries like these; a spec that writes them
// after its checkpoint fails whenever one of its reads is not scoped to the
// rows it created.
export function foreignEntries(
  prisma: PrismaClient,
  rows: { subjectType: string; kind?: string }[],
) {
  return prisma.activityLog.createMany({
    data: rows.map(({ kind, subjectType }) => ({
      action: 'update',
      actorName: 'another spec',
      actorRole: 'system',
      garageId: randomUUID(),
      kind,
      subjectId: randomUUID(),
      subjectType,
    })),
  });
}
