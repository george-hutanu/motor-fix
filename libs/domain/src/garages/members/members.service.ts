import type { GarageMemberDto, GarageMembersDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  assertGarageOwner,
  notFound,
} from '../garage-brands/garage-brands.service';

const byName = new Intl.Collator('ro', { sensitivity: 'base' });
const RANK: Record<GarageMemberDto['role'], number> = {
  mechanic: 2,
  owner: 0,
  receptionist: 1,
};

// The garage's open receptionist invites to the person, by e-mail (any case)
// or phone; her mechanic invites are the owner's to keep or revoke.
async function revokeInvites(
  tx: Prisma.TransactionClient,
  garageId: string,
  { email, phone }: { email: string | null; phone: string | null },
) {
  const to = [
    ...(email
      ? [{ email: { equals: email, mode: 'insensitive' as const } }]
      : []),
    ...(phone ? [{ phone }] : []),
  ];
  if (to.length === 0) return;
  await tx.staffInvite.updateMany({
    data: { status: 'revoked' },
    where: { garageId, kind: 'receptionist', OR: to, status: 'sent' },
  });
}

@Injectable()
export class GarageMembersService {
  private readonly logger = new Logger(GarageMembersService.name);

  constructor(
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly notifications: NotificationsService,
  ) {}

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

  // The owner takes a receptionist off the garage: her membership row goes,
  // with the garage's open receptionist invites to her, and she is told.
  // Her account keeps its role and may join again through a new invite.
  async remove(
    prisma: PrismaClient,
    actor: Actor,
    garageId: string,
    accountId: string,
  ): Promise<void> {
    assertGarageOwner(actor, garageId);
    const removed = await prisma.$transaction(async (tx) => {
      const row = await tx.garageMember.findUnique({
        include: {
          account: { select: { email: true, name: true, phone: true } },
          garage: { select: { name: true } },
        },
        where: { garageId_accountId: { accountId, garageId } },
      });
      if (row?.role === 'owner') {
        throw refusal(
          HttpStatus.CONFLICT,
          'owner_row',
          "The owner's own row cannot be removed",
        );
      }
      if (row?.role !== 'receptionist') throw notFound();
      // Two removals race to here; only the first still finds the row.
      const { count } = await tx.garageMember.deleteMany({
        where: { accountId, garageId, role: 'receptionist' },
      });
      if (count === 0) throw notFound();
      await revokeInvites(tx, garageId, row.account);
      await this.audit.record(tx, {
        action: 'delete',
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId,
        oldValue: { name: row.account.name, role: 'receptionist' },
        subjectId: accountId,
        subjectType: 'member',
      });
      // The live hub drops the streams of the account the event names.
      await this.events.record(tx, {
        audience: { garageIds: [garageId], type: 'garage' },
        kind: 'member.removed',
        payload: { accountId, garageId },
        subjectId: accountId,
      });
      return { garage: row.garage.name, joinedAt: row.joinedAt };
    });
    await this.tellRemoved(garageId, accountId, removed);
  }

  // The removed account hears it left the team; a failure undoes nothing.
  private async tellRemoved(
    garageId: string,
    accountId: string,
    { garage, joinedAt }: { garage: string; joinedAt: Date },
  ) {
    try {
      await this.notifications.notify({
        eventId: `member.removed:${garageId}:${accountId}:${joinedAt.getTime()}`,
        garageId,
        kind: 'STAFF_REMOVED',
        params: { garage },
        recipients: [accountId],
        subjectId: accountId,
      });
    } catch (error) {
      this.logger.error(
        `receptionist ${accountId} of garage ${garageId} not told of her removal: ${(error as Error).message}`,
      );
    }
  }
}
