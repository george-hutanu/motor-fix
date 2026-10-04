# Contract: the audit writer (`AUDIT_PORT`)

In-process TypeScript contract in `libs/domain/src/audit/audit.port.ts`; no HTTP surface.

```ts
interface AuditEntry {
  action: 'create' | 'update' | 'delete' | 'open';
  subjectType: string;            // lower snake case, Data model table name
  subjectId: string;
  field?: string;
  oldValue?: unknown;             // JSON as it was; money in bani
  newValue?: unknown;
  actorId: string | null;
  actorRole: Role | 'system';     // 'garage' is stored as 'owner'
  actorName?: string;             // reduced to the first name; looked up when absent
  assistantGrantId?: string;      // sets via_assistant
  garageId?: string; carId?: string; jobId?: string;
  internal?: boolean;
  kind?: string; text?: string;
}

interface AuditPort {
  // One entry, through the caller's transaction. A failure throws and fails the change.
  record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void>;
  // One `update` entry per key of `after` whose value differs from `before` by content.
  recordChanges(
    tx: Prisma.TransactionClient,
    entry: Omit<AuditEntry, 'action' | 'field' | 'oldValue' | 'newValue'>,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void>;
}
```

`is_key_change` is not an input: the writer sets it from `subjectType.field`.
