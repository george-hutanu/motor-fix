import type { PushKeyDto, SavePushSubscriptionDto } from '@motor-fix/contracts';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import type { PrismaClient } from '../../../generated/prisma/client';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../../notifications.service';
import { PUSH_CONFIG, type PushConfig } from '../push-config';

// What one account can keep; the worker sends to no more.
export const MAX_DEVICES = 10;

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
  ) {}

  key(): PushKeyDto {
    return { publicKey: this.config?.publicKey ?? null };
  }

  // A browser belongs to the account that saved it last: its address is
  // unique, and another account's row for it is replaced, never moved.
  async save(
    accountId: string,
    input: SavePushSubscriptionDto,
  ): Promise<{ id: string }> {
    if (!this.config) {
      throw refuse(HttpStatus.BAD_REQUEST, 'push_off', 'Push is not set up');
    }
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
      await this.evictOldest(tx, accountId);
      const { id } = await tx.pushSubscription.create({
        data: { ...data, accountId },
      });
      return { id };
    });
  }

  // A person keeps the newest devices; the oldest one makes room.
  private async evictOldest(
    tx: Pick<PrismaClient, 'pushSubscription'>,
    accountId: string,
  ) {
    const old = await tx.pushSubscription.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      skip: MAX_DEVICES - 1,
      where: { accountId },
    });
    if (old.length > 0) {
      await tx.pushSubscription.deleteMany({
        where: { id: { in: old.map((d) => d.id) } },
      });
    }
  }

  async remove(accountId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = UUID.test(id)
        ? await tx.pushSubscription.deleteMany({ where: { accountId, id } })
        : { count: 0 };
      if (count === 0) {
        throw refuse(HttpStatus.NOT_FOUND, 'not_found', 'Not found');
      }
    });
  }

  async test(accountId: string): Promise<{ queued: number }> {
    return { queued: await this.notifications.sendPushTest(accountId) };
  }
}
