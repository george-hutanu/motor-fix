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
import { type Actor, requireCapability, roleInUse } from './policy';
import { PRISMA } from './prisma';
import type { PrismaClient } from '../generated/prisma/client';

export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');

export interface AuthOptions {
  databaseUrl: string;
  // Counts failed sign-ins only.
  redisUrl: string;
  tokenSecret: string;
}

const REQUIRES = 'auth:requires';

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
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
