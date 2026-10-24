import { randomUUID } from 'node:crypto';

import { ANONYMISED, retentionCutoff } from './retention.config';
import { createPrisma } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

// A time `days` whole days and `ms` milliseconds before `now`.
export const ago = (now: Date, days: number, ms = 0) =>
  new Date(retentionCutoff(now, days).getTime() - ms);

export function retentionFixtures(
  prisma: PrismaClient = createPrisma(databaseUrl),
) {
  const base = fixtures(prisma);
  return {
    ...base,
    // One audit entry, as the audit service would write it.
    async entry(fields: {
      at: Date;
      actorId?: string | null;
      garageId?: string | null;
      kind?: string;
      subjectId?: string;
      subjectType?: string;
    }) {
      const { id } = await prisma.activityLog.create({
        data: {
          action: 'update',
          actorId: fields.actorId ?? null,
          actorName: 'Ana Pop',
          actorRole: 'driver',
          at: fields.at,
          field: 'name',
          garageId: fields.garageId ?? null,
          kind: fields.kind,
          newValue: { name: 'new' },
          oldValue: { name: 'old' },
          subjectId: fields.subjectId ?? randomUUID(),
          subjectType: fields.subjectType ?? 'car',
          text: 'Ana Pop changed the name',
        },
      });
      return id;
    },
    async garage(closedAt: Date | null = null) {
      const id = randomUUID();
      await prisma.garage.create({
        data: { closedAt, id, name: `Garage ${id}`, slug: `garage-${id}` },
      });
      return id;
    },
    async legalDocument(garageId: string, status: string, pages: string[]) {
      // A garage holds one live verification file; its documents share it.
      const file =
        (await prisma.verificationFile.findFirst({ where: { garageId } })) ??
        (await prisma.verificationFile.create({ data: { garageId } }));
      const { id } = await prisma.legalDocument.create({
        data: {
          kind: `kind-${randomUUID()}`,
          pages,
          status,
          verificationFileId: file.id,
        },
      });
      return id;
    },
    async reset() {
      await base.reset();
      await prisma.$executeRawUnsafe('TRUNCATE sign_in_code');
    },
  };
}

export const anonymisedShape = {
  actorId: null,
  actorName: ANONYMISED,
  newValue: null,
  oldValue: null,
  text: null,
};
