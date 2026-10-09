import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { AccountLoader } from '@motor-fix/domain';
import type { Caller, Scope } from '@motor-fix/mcp-tools';
import { Injectable } from '@nestjs/common';

import { AssistantGrants } from './auth.grants';

const isScope = (s: string): s is Scope =>
  s === 'motorfix.read' || s === 'motorfix.act';

@Injectable()
export class McpActorService {
  constructor(
    private readonly accounts: AccountLoader,
    private readonly grants: AssistantGrants,
  ) {}

  // The account is loaded before the grant, so a deleted or suspended
  // account never opens one.
  async caller(auth: AuthInfo, requestId: string): Promise<Caller> {
    const account = await this.accounts.activeAccount(
      (auth.extra as { accountId: string }).accountId,
    );
    const grant = await this.grants.use(account, auth, requestId);
    return {
      account,
      grantId: grant.id,
      requestId,
      scopes: grant.scopes.filter(isScope),
    };
  }
}
