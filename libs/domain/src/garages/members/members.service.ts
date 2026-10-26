import type { GarageMemberDto, GarageMembersDto } from '@motor-fix/contracts';
import { Injectable } from '@nestjs/common';

import type { Actor } from '../../auth/policy';
import type { PrismaClient } from '../../generated/prisma/client';
import { assertGarageOwner } from '../garage-brands/garage-brands.service';

const byName = new Intl.Collator('ro', { sensitivity: 'base' });
const RANK: Record<GarageMemberDto['role'], number> = {
  mechanic: 2,
  owner: 0,
  receptionist: 1,
};

@Injectable()
export class GarageMembersService {
  // Who has access to the garage, for its owner: reads only, writes nothing.
  async list(
    prisma: PrismaClient,
    actor: Actor,
    garageId: string,
  ): Promise<GarageMembersDto> {
    assertGarageOwner(actor, garageId);
    const now = new Date();
    const [memberships, mechanics, invites] = await Promise.all([
      prisma.garageMember.findMany({
        include: { account: { select: { name: true } } },
        where: { garageId },
      }),
      prisma.mechanic.findMany({
        where: { accountId: { not: null }, garageId, removedAt: null },
      }),
      prisma.staffInvite.findMany({
        orderBy: { createdAt: 'asc' },
        where: { expiresAt: { gt: now }, garageId, status: 'sent' },
      }),
    ]);
    // A member's own card (the owner who also works on cars) is not a second row.
    const listed = new Set(memberships.map((m) => m.accountId));
    const members: GarageMemberDto[] = [
      ...memberships.map((m) => ({
        accountId: m.accountId,
        name: m.account.name,
        permissions: null,
        role: m.role,
        since: m.joinedAt.toISOString(),
      })),
      ...mechanics
        .filter((card) => !listed.has(card.accountId as string))
        .map((card) => ({
          accountId: card.accountId as string,
          name: card.name,
          permissions: {
            canAnswerQuotes: card.canAnswerQuotes,
            canMoveBookings: card.canMoveBookings,
            canRecordFinalPrice: card.canRecordFinalPrice,
          },
          role: 'mechanic' as const,
          since: null,
        })),
    ];
    members.sort(
      (a, b) => RANK[a.role] - RANK[b.role] || byName.compare(a.name, b.name),
    );
    return {
      invites: invites.map((invite) => ({
        email: invite.email,
        id: invite.id,
        kind: invite.kind,
        phone: invite.phone,
        sentAt: invite.createdAt.toISOString(),
      })),
      members,
    };
  }
}
