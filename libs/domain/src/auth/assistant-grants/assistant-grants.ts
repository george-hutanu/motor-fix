import type { AuditPort } from '../../audit/audit.port';
import type { EventPort } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import type { Role } from '../capabilities';

export type GrantRevokeReason =
  | 'role_removed'
  | 'account_suspended'
  | 'account_deleted';

// Who ended the grants: the acting person, or `system` when a handler acted
// with no person behind it. A label stands in for a name that is being wiped.
export type GrantRevoker =
  | { id: string; role: Role; label?: string }
  | 'system';

// Ends every live assistant grant of an account inside the caller's
// transaction: one audit entry and one `assistant_grant.revoked` event per
// grant, and nothing for a grant already revoked. Answers how many it ended.
export async function revokeAssistantGrants(
  tx: Prisma.TransactionClient,
  audit: AuditPort,
  events: EventPort,
  input: { accountId: string; by: GrantRevoker; reason: GrantRevokeReason },
): Promise<number> {
  const { accountId, by, reason } = input;
  const live = await tx.assistantGrant.findMany({
    select: { id: true },
    where: { accountId, revokedAt: null },
  });
  if (live.length === 0) return 0;
  const ids = live.map((g) => g.id);
  const revokedAt = new Date();
  const { count } = await tx.assistantGrant.updateMany({
    data: {
      revokedAt,
      revokedBy: by === 'system' ? 'system' : by.id,
      revokeReason: reason,
    },
    where: { id: { in: ids }, revokedAt: null },
  });
  const actor =
    by === 'system'
      ? { actorId: null, actorRole: 'system' as const }
      : {
          actorId: by.id,
          actorRole: by.role,
          ...(by.label !== undefined && { actorLabel: by.label }),
        };
  await audit.recordMany(
    tx,
    ids.map((id) => ({
      ...actor,
      action: 'update' as const,
      field: 'revoked_at',
      kind: 'assistant_grant_revoked',
      newValue: revokedAt.toISOString(),
      oldValue: null,
      subjectId: id,
      subjectType: 'assistant_grant',
      text: reason,
    })),
  );
  for (const grantId of ids) {
    await events.record(tx, {
      audience: { accountId, type: 'account' },
      kind: 'assistant_grant.revoked',
      payload: { accountId, grantId, reason },
      subjectId: grantId,
    });
  }
  return count;
}
