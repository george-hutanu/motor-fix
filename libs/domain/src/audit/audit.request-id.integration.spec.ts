// @traces 365-FR-011
import { randomUUID } from 'node:crypto';

import { AuditService } from './audit.service';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const audit = new AuditService();

const entryOf = (subjectId: string) =>
  prisma.activityLog.findFirstOrThrow({ where: { subjectId } });

const ion = {
  action: 'update' as const,
  actorId: randomUUID(),
  actorName: 'Ion Popescu',
  actorRole: 'garage' as const,
  field: 'note',
  newValue: 'cu ulei sintetic',
  subjectType: 'quote',
};

describe('the request id on an activity entry', () => {
  it('stores the call that made the change next to the assistant grant', async () => {
    const subjectId = randomUUID();
    const assistantGrantId = randomUUID();
    const requestId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, { ...ion, assistantGrantId, requestId, subjectId }),
    );

    expect(await entryOf(subjectId)).toMatchObject({
      assistantGrantId,
      requestId,
      viaAssistant: true,
    });
  });

  it('stays empty for an entry that names no request', async () => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) => audit.record(tx, { ...ion, subjectId }));

    expect(await entryOf(subjectId)).toMatchObject({
      requestId: null,
      viaAssistant: false,
    });
  });

  it('carries the request id onto every field of a multi-field change', async () => {
    const subjectId = randomUUID();
    const requestId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        { ...ion, requestId, subjectId },
        { note: 'a', price: 1 },
        { note: 'b', price: 2 },
      ),
    );

    const entries = await prisma.activityLog.findMany({ where: { subjectId } });
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(entry.requestId).toBe(requestId);
  });
});
