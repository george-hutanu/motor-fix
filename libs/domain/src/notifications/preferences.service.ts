import { randomUUID } from 'node:crypto';

import type {
  NotificationPreferencesDto,
  UpdateNotificationPreferenceDto,
  UpdateNotificationPreferencesDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { NOTIFICATION_TYPES, type OutsideChannel } from './catalogue';
import { LIVE_PUBLISHER, NOTIFICATIONS_PRISMA } from './notifications.service';
import {
  canMute,
  isDriverType,
  type PreferenceRow,
  planSave,
  preferencesView,
} from './preferences';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import type { Actor } from '../auth/policy';
import { LIVE_CHANNEL } from '../events/live.hub';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

interface Publisher {
  publish(channel: string, message: string): Promise<unknown>;
}

const refuse = (status: HttpStatus, code: string, message: string) =>
  new HttpException({ code, message }, status);

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger('NotificationPreferences');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(LIVE_PUBLISHER) private readonly publisher: Publisher,
  ) {}

  async read(accountId: string): Promise<NotificationPreferencesDto> {
    return preferencesView(await this.rows(this.prisma, accountId));
  }

  async save(
    actor: Actor,
    body: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    const choices = body.preferences ?? [];
    for (const choice of choices) this.check(choice);
    await this.checkGarages(actor.accountId, choices);
    const who = {
      actorId: actor.accountId,
      actorRole: actor.role,
      subjectId: actor.accountId,
      subjectType: 'notification_preference',
    };
    // One save at a time per person, so the last one wins per row.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`preferences:${actor.accountId}`}))`;
      const { changes, writes } = planSave(
        await this.rows(tx, actor.accountId),
        body.groups ?? [],
        choices,
      );
      for (const row of writes) {
        await tx.notificationPreference.deleteMany({
          where: {
            accountId: actor.accountId,
            garageId: row.garageId,
            type: row.type,
            // A driver type keeps one row, any other type one per channel.
            ...(isDriverType(row.type) ? {} : { channel: row.channel }),
          },
        });
        await tx.notificationPreference.create({
          data: { ...row, accountId: actor.accountId },
        });
      }
      for (const change of changes) {
        await this.audit.record(tx, { ...who, ...change, action: 'update' });
      }
    });
    await this.announce(actor.accountId);
    return this.read(actor.accountId);
  }

  private check({
    channel,
    enabled,
    garageId,
    type,
  }: UpdateNotificationPreferenceDto) {
    if (!Object.hasOwn(NOTIFICATION_TYPES, type)) {
      throw refuse(
        HttpStatus.BAD_REQUEST,
        'unknown_notification_type',
        `${type} is not a notification type`,
      );
    }
    if (!NOTIFICATION_TYPES[type].channels.includes(channel)) {
      throw refuse(
        HttpStatus.BAD_REQUEST,
        'channel_not_allowed',
        `${type} is not sent by ${channel}`,
      );
    }
    if (garageId !== null && isDriverType(type)) {
      throw refuse(
        HttpStatus.BAD_REQUEST,
        'garage_not_allowed',
        `${type} is a personal choice and takes no garage`,
      );
    }
    if (!enabled && !canMute(type)) {
      throw refuse(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'notification_type_always_sent',
        `${type} is always sent and cannot be switched off`,
      );
    }
  }

  private async checkGarages(
    accountId: string,
    choices: readonly UpdateNotificationPreferenceDto[],
  ) {
    const named = new Set(choices.flatMap((c) => c.garageId ?? []));
    if (named.size === 0) return;
    const [memberships, mechanic] = await Promise.all([
      this.prisma.garageMember.findMany({ where: { accountId } }),
      this.prisma.mechanic.findUnique({ where: { accountId } }),
    ]);
    const mine = new Set([
      ...memberships.map((m) => m.garageId),
      ...(mechanic ? [mechanic.garageId] : []),
    ]);
    if ([...named].some((id) => !mine.has(id))) {
      throw refuse(HttpStatus.NOT_FOUND, 'not_found', 'Not found');
    }
  }

  private async rows(
    client: PrismaClient | Prisma.TransactionClient,
    accountId: string,
  ): Promise<PreferenceRow[]> {
    const rows = await client.notificationPreference.findMany({
      orderBy: [{ type: 'asc' }, { channel: 'asc' }],
      select: { channel: true, enabled: true, garageId: true, type: true },
      where: { accountId },
    });
    return rows.map((r) => ({ ...r, channel: r.channel as OutsideChannel }));
  }

  private async announce(accountId: string) {
    const message = {
      audience: [`account:${accountId}`],
      event: {
        at: new Date().toISOString(),
        id: randomUUID(),
        kind: 'notification_preferences.updated',
      },
    };
    try {
      await this.publisher.publish(LIVE_CHANNEL, JSON.stringify(message));
    } catch {
      this.logger.warn(
        'preferences change not announced live: Redis did not answer',
      );
    }
  }
}
