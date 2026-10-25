import type { Capability } from '@motor-fix/contracts/capabilities';
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

import { consentPending, pendingAcceptance } from './acceptance/acceptance';
import { verifyAccessToken } from './access-token';
import {
  AccountLoader,
  actorOf,
  type LoadedAccount,
  signInRequired,
} from './account-loader';
import type { AssistantBroker } from './assistant/assistant.service';
import {
  MAINTENANCE,
  type Maintenance,
  maintenanceRefusal,
} from './maintenance';
import type { OAuthSettings } from './oauth/providers';
import { type Actor, requireCapability, roleInUse } from './policy';
import { countConsentRefusal } from '../metrics/product-counters';

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
  // The PR QA boot only (signInLimitConfig): no signInAttempts route limit.
  skipSignInAttemptsLimit?: boolean;
}

const REQUIRES = 'auth:requires';
const PUBLIC = 'auth:public';
const OPEN_IN_MAINTENANCE = 'auth:maintenance-open';
const OPTIONAL_ACTOR = 'auth:optional-actor';
const OPEN_TO_PENDING = 'auth:open-to-pending';

// Every route needs a signed-in account unless it carries this mark.
export const Public = () => SetMetadata(PUBLIC, true);

// Answers as usual while the platform is in maintenance.
export const OpenInMaintenance = () => SetMetadata(OPEN_IN_MAINTENANCE, true);

// On an open route, names the caller when their token resolves; a missing or
// bad token leaves them a visitor instead of refusing them.
export const OptionalActor = () => SetMetadata(OPTIONAL_ACTOR, true);

// Answers an account that has not yet accepted the terms and privacy notice in
// force; every other signed-in route refuses it until it does.
export const OpenToPending = () => SetMetadata(OPEN_TO_PENDING, true);

export const Requires = (capability: Capability) =>
  SetMetadata(REQUIRES, capability);

type WithActor = Request & { actor?: Actor };

export const CurrentActor = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<WithActor>().actor,
);

function refusePending(account: LoadedAccount) {
  const pending = pendingAcceptance(account.consents);
  if (!pending) return;
  countConsentRefusal('api');
  throw consentPending(pending);
}

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
          admin?.actor ??
          (await this.actor(authorization).catch(() => undefined))?.actor;
      }
      return true;
    }
    const { account, actor } =
      admin ?? (await this.actor(request.header('authorization')));
    const capability = this.reflector.get<Capability | undefined>(
      REQUIRES,
      context.getHandler(),
    );
    if (!marked(OPEN_TO_PENDING)) refusePending(account);
    if (capability) requireCapability(actor, capability);
    request.actor = actor;
    return true;
  }

  private async adminOnly(request: WithActor) {
    const route: string = request.route?.path ?? request.path;
    const authorization = request.header('authorization');
    if (!authorization) throw maintenanceRefusal(route, 'visitor');
    // A token that does not resolve answers as usual, so the app renews it.
    const signedIn = await this.actor(authorization);
    if (!signedIn.actor.roles.includes('admin')) {
      throw maintenanceRefusal(route, 'signed_in');
    }
    return signedIn;
  }

  private async actor(authorization: string | undefined) {
    const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
    const claims = token
      ? verifyAccessToken(token, this.options.tokenSecret)
      : null;
    if (!claims) throw signInRequired();
    const account = await this.accounts.activeAccount(claims.accountId);
    const roles = account.roles.map((r) => r.role);
    const role = roleInUse(claims.role, account.lastRole, roles);
    if (!role) throw signInRequired();
    return { account, actor: actorOf(account, role) };
  }
}
