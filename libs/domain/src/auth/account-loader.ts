import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import type { Role } from './capabilities';
import type { Actor } from './policy';
import { PRISMA } from './prisma';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

export type LoadedAccount = Prisma.AccountGetPayload<{
  include: { mechanic: true; memberships: true; roles: true };
}>;

export const signInRequired = () =>
  new HttpException(
    { code: 'sign_in_required', message: 'Sign in to continue' },
    HttpStatus.UNAUTHORIZED,
  );

// The one place a session or an assistant call turns an account id into an
// account allowed to act.
@Injectable()
export class AccountLoader {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async activeAccount(id: string): Promise<LoadedAccount> {
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

export function actorOf(account: LoadedAccount, role: Role): Actor {
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
    roles: account.roles.map((r) => r.role),
  };
}
