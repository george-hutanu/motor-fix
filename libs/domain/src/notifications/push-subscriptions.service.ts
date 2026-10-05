import type { PushKeyDto, SavePushSubscriptionDto } from '@motor-fix/contracts';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from './notifications.service';
import { PUSH_CONFIG, type PushConfig } from './push-config';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import type { Actor } from '../auth/policy';
import type { PrismaClient } from '../generated/prisma/client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refuse = (status: HttpStatus, code: string, message: string) =>
  new HttpException({ code, message }, status);

// The signed-in person's own push devices; no route names another account.
@Injectable()
export class PushSubscriptionsService {
  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(PUSH_CONFIG) private readonly config: PushConfig | null,
    private readonly notifications: NotificationsService,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  key(): PushKeyDto {
    return { publicKey: this.config?.publicKey ?? null };
  }

  // A browser belongs to the account that saved it last: its address is
  // unique, and another account's row for it is replaced, never moved.
  async save(
    actor: Actor,
    input: SavePushSubscriptionDto,
  ): Promise<{ id: string }> {
    if (!this.config) {
      throw refuse(HttpStatus.BAD_REQUEST, 'push_off', 'Push is not set up');
    }
    const accountId = actor.accountId;
    const data = {
      auth: input.keys.auth,
      endpoint: input.endpoint,
      label: input.label ?? '',
      p256dh: input.keys.p256dh,
    };
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`push:${input.endpoint}`}))`;
      const existing = await tx.pushSubscription.findUnique({
        where: { endpoint: input.endpoint },
      });
      if (existing?.accountId === accountId) {
        await tx.pushSubscription.update({
          data,
          where: { id: existing.id },
        });
        return { id: existing.id };
      }
      if (existing) {
        await tx.pushSubscription.delete({ where: { id: existing.id } });
      }
      const { id } = await tx.pushSubscription.create({
        data: { ...data, accountId },
      });
      // The address is a capability, so the entry never carries it.
      await this.audit.record(tx, {
        action: 'create',
        actorId: accountId,
        actorRole: actor.role,
        subjectId: id,
        subjectType: 'push_subscription',
      });
      return { id };
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const { accountId } = actor;
    await this.prisma.$transaction(async (tx) => {
      const { count } = UUID.test(id)
        ? await tx.pushSubscription.deleteMany({ where: { accountId, id } })
        : { count: 0 };
      if (count === 0) {
        throw refuse(HttpStatus.NOT_FOUND, 'not_found', 'Not found');
      }
      await this.audit.record(tx, {
        action: 'delete',
        actorId: accountId,
        actorRole: actor.role,
        subjectId: id,
        subjectType: 'push_subscription',
      });
    });
  }

  async test(accountId: string): Promise<{ queued: number }> {
    return { queued: await this.notifications.sendPushTest(accountId) };
  }
}
