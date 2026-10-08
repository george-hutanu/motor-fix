import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { verifyAccessToken } from './access-token';
import type { Capability } from './capabilities';
import {
  MAINTENANCE,
  type Maintenance,
  maintenanceRefusal,
} from './maintenance';
import type { OAuthSettings } from './oauth/providers';
import { type Actor, requireCapability, roleInUse } from './policy';
import { PRISMA } from './prisma';
import type { PrismaClient } from '../generated/prisma/client';

export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');

export interface AuthOptions {
  databaseUrl: string;
  // Counts failed sign-ins only.
  redisUrl: string;
  tokenSecret: string;
  // Sign-in with Google and Apple; a provider left out is not offered.
  oauth?: OAuthSettings;
}

const REQUIRES = 'auth:requires';
const PUBLIC = 'auth:public';
const OPEN_IN_MAINTENANCE = 'auth:maintenance-open';

// Every route needs a signed-in account unless it carries this mark.
export const Public = () => SetMetadata(PUBLIC, true);

// Answers as usual while the platform is in maintenance.
export const OpenInMaintenance = () => SetMetadata(OPEN_IN_MAINTENANCE, true);

export const Requires = (capability: Capability) =>
  SetMetadata(REQUIRES, capability);

type WithActor = Request & { actor?: Actor };

export const CurrentActor = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<WithActor>().actor,
);

const signInRequired = () =>
  new HttpException(
    { code: 'sign_in_required', message: 'Sign in to continue' },
    HttpStatus.UNAUTHORIZED,
  );

@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
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
    if (!marked(OPEN_IN_MAINTENANCE) && (await this.maintenance.on())) {
      await this.adminOnly(request);
    }
    if (open) return true;
    const actor = await this.actor(request.header('authorization'));
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
    const actor = await this.actor(request.header('authorization')).catch(
      () => null,
    );
    if (!actor) throw maintenanceRefusal(route, 'visitor');
    if (!actor.roles.includes('admin')) {
      throw maintenanceRefusal(route, 'signed_in');
    }
  }

  private async actor(authorization: string | undefined): Promise<Actor> {
    const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
    const claims = token
      ? verifyAccessToken(token, this.options.tokenSecret)
      : null;
    if (!claims) throw signInRequired();
    const account = await this.activeAccount(claims.accountId);
    const roles = account.roles.map((r) => r.role);
    const role = roleInUse(claims.role, account.lastRole, roles);
    if (!role) throw signInRequired();
    const membership = account.memberships.find(
      (m) =>
        (role === 'garage' && m.role === 'owner') ||
        (role === 'receptionist' && m.role === 'receptionist'),
    );
    const mechanic = role === 'mechanic' ? account.mechanic : null;
    return {
      accountId: account.id,
      garageId: membership?.garageId ?? mechanic?.garageId ?? null,
      permissions: {
        canAnswerQuotes: mechanic?.canAnswerQuotes ?? false,
        canMoveBookings: mechanic?.canMoveBookings ?? false,
        canRecordFinalPrice: mechanic?.canRecordFinalPrice ?? false,
      },
      role,
      roles,
    };
  }

  private async activeAccount(id: string) {
    const account = await this.prisma.account.findUnique({
      include: { mechanic: true, memberships: true, roles: true },
      where: { id },
    });
    if (!account || account.status === 'deleted') throw signInRequired();
    if (account.status === 'suspended') {
      throw new HttpException(
        { code: 'account_suspended', message: 'This account is suspended' },
        HttpStatus.FORBIDDEN,
      );
    }
    return account;
  }
}
