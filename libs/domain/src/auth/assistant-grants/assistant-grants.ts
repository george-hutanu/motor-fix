import type { Role } from '@motor-fix/contracts/capabilities';

import type { AuditPort } from '../../audit/audit.port';
import type { EventPort } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import { voidAssistantConfirmations } from '../assistant-confirmations/assistant-confirmations';

type GrantRevokeReason =
  | 'role_removed'
  | 'account_suspended'
  | 'account_deleted';

// Who ended the grants: the acting person, or `system` when a handler acted
// with no person behind it. A label stands in for a name that is being wiped.
type GrantRevoker = { id: string; role: Role; label?: string } | 'system';

// Ends every live assistant grant of an account inside the caller's
// transaction: one audit entry and one `assistant_grant.revoked` event per
// grant, its waiting confirmations voided, and nothing for a grant already
// revoked. Answers how many it ended.
export async function revokeAssistantGrants(
  tx: Prisma.TransactionClient,
  audit: AuditPort,
  events: EventPort,
  input: { accountId: string; by: GrantRevoker; reason: GrantRevokeReason },
): Promise<number> {
  const { accountId, by, reason } = input;
  const revokedAt = new Date();
  // Only the rows this write changed: a grant another caller revoked a
  // moment earlier gets no second entry or event.
  const ended = await tx.assistantGrant.updateManyAndReturn({
    data: {
      revokedAt,
      revokedBy: by === 'system' ? 'system' : by.id,
      revokeReason: reason,
    },
    select: { id: true },
    where: { accountId, revokedAt: null },
  });
  if (ended.length === 0) return 0;
  const ids = ended.map((g) => g.id);
  await voidAssistantConfirmations(tx, { grantIds: ids });
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
  return ids.length;
}
