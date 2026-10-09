import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { verifyAccessToken } from './access-token';
import { AccountLoader, actorOf, signInRequired } from './account-loader';
import type { AssistantBroker } from './assistant/assistant.service';
import type { Capability } from './capabilities';
import type { OAuthSettings } from './oauth/providers';
import { type Actor, requireCapability, roleInUse } from './policy';

export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');

export interface AuthOptions {
  databaseUrl: string;
  // Counts failed sign-ins only.
  redisUrl: string;
  tokenSecret: string;
  // Sign-in with Google and Apple; a provider left out is not offered.
  oauth?: OAuthSettings;
  // Sign-in for AI assistants through the identity server; off when unset.
  assistant?: AssistantBroker;
}

const REQUIRES = 'auth:requires';
const PUBLIC = 'auth:public';

// Every route needs a signed-in account unless it carries this mark.
export const Public = () => SetMetadata(PUBLIC, true);

export const Requires = (capability: Capability) =>
  SetMetadata(REQUIRES, capability);

type WithActor = Request & { actor?: Actor };

export const CurrentActor = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<WithActor>().actor,
);

@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    private readonly accounts: AccountLoader,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const open = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (open) return true;
    const request = context.switchToHttp().getRequest<WithActor>();
    const actor = await this.actor(request.header('authorization'));
    const capability = this.reflector.get<Capability | undefined>(
      REQUIRES,
      context.getHandler(),
    );
    if (capability) requireCapability(actor, capability);
    request.actor = actor;
    return true;
  }

  private async actor(authorization: string | undefined): Promise<Actor> {
    const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
    const claims = token
      ? verifyAccessToken(token, this.options.tokenSecret)
      : null;
    if (!claims) throw signInRequired();
    const account = await this.accounts.activeAccount(claims.accountId);
    const roles = account.roles.map((r) => r.role);
    const role = roleInUse(claims.role, account.lastRole, roles);
    if (!role) throw signInRequired();
    return actorOf(account, role);
  }
}
