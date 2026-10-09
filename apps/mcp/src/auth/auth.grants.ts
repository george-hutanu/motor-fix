import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { AssistantGrantCreatedPayload } from '@motor-fix/contracts';
import {
  AUDIT_PORT,
  type AuditPort,
  type createPrisma,
  EVENT_PORT,
  type EventPort,
  type LoadedAccount,
  PRISMA,
} from '@motor-fix/domain';
import { HttpException, Inject, Injectable } from '@nestjs/common';

type Prisma = ReturnType<typeof createPrisma>;

export interface Grant {
  id: string;
  scopes: string[];
}

const LAST_USED_STEP_MS = 60_000;

const clientNameOf = (clientId: string) => {
  try {
    const url = new URL(clientId);
    if (url.protocol === 'https:' || url.protocol === 'http:')
      return url.hostname;
  } catch {}
  return clientId;
};

const uniqueClash = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'P2002';

@Injectable()
export class AssistantGrants {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  // The grant this account gave this client, opened at its first call.
  async use(
    account: LoadedAccount,
    auth: AuthInfo,
    requestId: string,
  ): Promise<Grant> {
    const canRead = auth.scopes.includes('motorfix.read');
    const canAct = auth.scopes.includes('motorfix.act');
    const where = {
      accountId_clientId: { accountId: account.id, clientId: auth.clientId },
    };
    const grant =
      (await this.prisma.assistantGrant.findUnique({ where })) ??
      (await this.open(account, auth.clientId, canRead, canAct, requestId));
    if (grant.revokedAt)
      throw new HttpException(
        {
          code: 'assistant_grant_revoked',
          message: 'This assistant no longer has access. Connect it again.',
        },
        401,
      );
    const scopesChanged = grant.canRead !== canRead || grant.canAct !== canAct;
    if (
      scopesChanged ||
      Date.now() - grant.lastUsedAt.getTime() > LAST_USED_STEP_MS
    )
      await this.prisma.assistantGrant.update({
        data: { canAct, canRead, lastUsedAt: new Date() },
        where: { id: grant.id },
      });
    return { id: grant.id, scopes: auth.scopes };
  }

  private async open(
    account: LoadedAccount,
    clientId: string,
    canRead: boolean,
    canAct: boolean,
    requestId: string,
  ) {
    const clientName = clientNameOf(clientId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const grant = await tx.assistantGrant.create({
          data: {
            accountId: account.id,
            canAct,
            canRead,
            clientId,
            clientName,
          },
        });
        await this.audit.record(tx, {
          action: 'create',
          actorId: account.id,
          actorRole: account.lastRole,
          assistantGrantId: grant.id,
          requestId,
          subjectId: grant.id,
          subjectType: 'assistant_grant',
        });
        const payload: AssistantGrantCreatedPayload = {
          canAct,
          canRead,
          clientName,
          grantId: grant.id,
        };
        await this.events.record(tx, {
          audience: { accountId: account.id, type: 'account' },
          kind: 'assistant_grant.created',
          payload: { ...payload },
          subjectId: grant.id,
        });
        return grant;
      });
    } catch (error) {
      if (!uniqueClash(error)) throw error;
      return this.prisma.assistantGrant.findUniqueOrThrow({
        where: { accountId_clientId: { accountId: account.id, clientId } },
      });
    }
  }
}
