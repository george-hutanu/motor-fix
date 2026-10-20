import {
  type GarageAccessDto,
  type MeDto,
  recheckedSince,
} from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { capabilitiesOf } from './capabilities';
import { pendingEmail } from './email-change/email-change.service';
import { type Actor, landingFor } from './policy';
import { PRISMA } from './prisma';
import type { PrismaClient } from '../generated/prisma/client';

// A calendar day as stored (a PostgreSQL date, read at UTC midnight).
const day = (at: Date | null) => (at ? at.toISOString().slice(0, 10) : null);

// "Who am I": what GET /me answers, and every change of the account's own
// details answers once saved.
@Injectable()
export class WhoAmI {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async read(actor: Actor): Promise<MeDto> {
    const { accountId } = actor;
    const [
      { emailVerifiedAt, phoneVerifiedAt, ...account },
      password,
      pending,
    ] = await Promise.all([
      this.prisma.account.findUniqueOrThrow({
        select: {
          city: true,
          email: true,
          emailVerifiedAt: true,
          language: true,
          name: true,
          phone: true,
          phoneVerifiedAt: true,
        },
        where: { id: accountId },
      }),
      this.prisma.accountIdentity.findFirst({
        select: { id: true },
        where: { accountId, method: 'password' },
      }),
      pendingEmail(this.prisma, accountId, new Date()),
    ]);
    return {
      ...account,
      capabilities: capabilitiesOf(actor.role, actor.permissions),
      emailConfirmed: Boolean(account.email && emailVerifiedAt),
      garageAccess: await this.garageAccess(accountId),
      garageId: actor.garageId,
      hasPassword: password !== null,
      id: accountId,
      landing: landingFor(actor.role),
      pendingEmail: pending,
      phoneConfirmed: Boolean(account.phone && phoneVerifiedAt),
      role: actor.role,
      roles: actor.roles,
    };
  }

  // Read from the memberships and the mechanic card, never from the address.
  private async garageAccess(accountId: string): Promise<GarageAccessDto[]> {
    const garage = {
      select: {
        features: { select: { enabled: true, key: true } },
        id: true,
        lastCheckedOn: true,
        name: true,
        rechecks: {
          orderBy: { recordedAt: 'desc' },
          select: { checkedOn: true, result: true },
          take: 1,
        },
        status: true,
        suspensions: {
          select: { cause: true, reason: true },
          take: 1,
          where: { untilTime: null },
        },
      },
    } as const;
    const [memberships, card] = await Promise.all([
      this.prisma.garageMember.findMany({
        include: { garage },
        orderBy: { joinedAt: 'asc' },
        where: { accountId },
      }),
      this.prisma.mechanic.findUnique({
        include: { garage },
        where: { accountId },
      }),
    ]);
    const entry = (
      at: (typeof memberships)[number]['garage'],
      role: GarageAccessDto['role'],
      permissions: GarageAccessDto['permissions'],
    ): GarageAccessDto => {
      const lastCheckedOn = day(at.lastCheckedOn);
      const latest = at.rechecks[0];
      return {
        features: Object.fromEntries(
          at.features.map((f) => [f.key, f.enabled]),
        ),
        garageId: at.id,
        lastCheckedOn,
        name: at.name,
        permissions,
        rechecked: recheckedSince(
          latest && {
            checkedOn: day(latest.checkedOn) ?? '',
            result: latest.result,
          },
          lastCheckedOn,
        ),
        role,
        status: at.status,
        suspension: at.suspensions[0] ?? null,
      };
    };
    return [
      ...memberships.map((m) =>
        entry(m.garage, m.role, {
          canAnswerQuotes: true,
          canMoveBookings: true,
          canRecordFinalPrice: true,
        }),
      ),
      // A member's own row wins over a mechanic card at the same garage.
      ...(card && !memberships.some((m) => m.garageId === card.garageId)
        ? [
            entry(card.garage, 'mechanic', {
              canAnswerQuotes: card.canAnswerQuotes,
              canMoveBookings: card.canMoveBookings,
              canRecordFinalPrice: card.canRecordFinalPrice,
            }),
          ]
        : []),
    ];
  }
}
