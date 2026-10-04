import type { Role } from '../auth/capabilities';
import type { Prisma } from '../generated/prisma/client';

export interface AuditEntry {
  actorId: string | null;
  actorRole: Role | 'system';
  action: 'create' | 'update' | 'delete';
  subjectType: string;
  subjectId: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

// Called inside the change's own transaction: a failed entry fails the change.
export interface AuditPort {
  record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void>;
}

export const AUDIT_PORT = Symbol('AUDIT_PORT');

// Bound until the audit history writer exists.
export const noAudit: AuditPort = { record: async () => undefined };
