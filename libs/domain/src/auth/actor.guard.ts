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
import {
  MAINTENANCE,
  type Maintenance,
  maintenanceRefusal,
} from './maintenance';
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
const OPEN_IN_MAINTENANCE = 'auth:maintenance-open';
const OPTIONAL_ACTOR = 'auth:optional-actor';

// Every route needs a signed-in account unless it carries this mark.
export const Public = () => SetMetadata(PUBLIC, true);

// Answers as usual while the platform is in maintenance.
export const OpenInMaintenance = () => SetMetadata(OPEN_IN_MAINTENANCE, true);

// On an open route, names the caller when their token resolves; a missing or
// bad token leaves them a visitor instead of refusing them.
export const OptionalActor = () => SetMetadata(OPTIONAL_ACTOR, true);

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
    @Inject(MAINTENANCE) private readonly maintenance: Maintenance,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const marked = (key: string) =>
      this.reflector.getAllAndOverride<boolean | undefined>(key, [
        context.getHandler(),
        context.getClass(),
      ]);
    const open = marked(PUBLIC);
    const request = context.switchToHttp().getRequest<WithActor>();
    const admin =
      !marked(OPEN_IN_MAINTENANCE) && (await this.maintenance.on())
        ? await this.adminOnly(request)
        : undefined;
    if (open) {
      const authorization = request.header('authorization');
      if (marked(OPTIONAL_ACTOR) && authorization) {
        request.actor =
          admin ?? (await this.actor(authorization).catch(() => undefined));
      }
      return true;
    }
    const actor = admin ?? (await this.actor(request.header('authorization')));
    const capability = this.reflector.get<Capability | undefined>(
      REQUIRES,
      context.getHandler(),
    );
    if (capability) requireCapability(actor, capability);
    request.actor = actor;
    return true;
  }

  private async adminOnly(request: WithActor) {
    const route: string = request.route?.path ?? request.path;
    const authorization = request.header('authorization');
    if (!authorization) throw maintenanceRefusal(route, 'visitor');
    // A token that does not resolve answers as usual, so the app renews it.
    const actor = await this.actor(authorization);
    if (!actor.roles.includes('admin')) {
      throw maintenanceRefusal(route, 'signed_in');
    }
    return actor;
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
