import type { Role } from '../auth/capabilities';
import type { Prisma } from '../generated/prisma/client';

// A garage acting as itself is recorded as its owner.
export const recordedRole = (role: Role | 'system') =>
  role === 'garage' ? 'owner' : role;

export interface AuditEntry {
  actorId: string | null;
  actorRole: Role | 'system';
  // Shown to others as the first name; read from the account when absent.
  actorName?: string;
  assistantGrantId?: string;
  action: 'create' | 'update' | 'delete' | 'open';
  subjectType: string;
  subjectId: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  garageId?: string;
  carId?: string;
  jobId?: string;
  internal?: boolean;
  kind?: string;
  text?: string;
}

export type AuditChange = Omit<
  AuditEntry,
  'action' | 'field' | 'oldValue' | 'newValue'
>;

// Called inside the change's own transaction: a failed entry fails the change.
export interface AuditPort {
  record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void>;
  // One update entry per field of `after` that differs from `before`.
  recordChanges(
    tx: Prisma.TransactionClient,
    change: AuditChange,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void>;
}

export const AUDIT_PORT = Symbol('AUDIT_PORT');
