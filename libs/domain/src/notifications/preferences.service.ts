import { randomUUID } from 'node:crypto';

import {
  NEWS_CONSENT_TEXT_VERSION,
  type NotificationPreferencesDto,
  type OutsideChannel,
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

import { NOTIFICATION_TYPES } from './catalogue';
import {
  LIVE_PUBLISHER,
  NOTIFICATIONS_PRISMA,
  type Publisher,
} from './notifications.service';
import {
  canMute,
  consentChange,
  isDriverChoice,
  type NewsConsent,
  newsConsentView,
  type PreferenceChange,
  type PreferenceRow,
  planSave,
  preferencesView,
} from './preferences';
import { STAFF_TYPES, staffChecks, staffEntries } from './staff-lists';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import type { Actor } from '../auth/policy';
import { LIVE_CHANNEL } from '../events/live.hub';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

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

  async read(actor: Actor): Promise<NotificationPreferencesDto> {
    const [rows, consent] = await Promise.all([
      this.rows(this.prisma, actor.accountId),
      this.newsConsent(this.prisma, actor.accountId),
    ]);
    return {
      ...preferencesView(rows),
      newsConsent: newsConsentView(consent),
      staff: await this.staff(actor, rows),
    };
  }

  async save(
    actor: Actor,
    body: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    const choices = body.preferences ?? [];
    for (const choice of choices) this.check(actor, choice);
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
      const rows = await this.rows(tx, actor.accountId);
      // Judged after the lock, so two saves at once never both pass the
      // last-channel check on the same rows.
      const refused = staffChecks(await this.staff(actor, rows, tx), choices);
      if (refused) {
        throw refuse(
          HttpStatus.UNPROCESSABLE_ENTITY,
          refused.code,
          `${refused.type} cannot be saved that way (${refused.code})`,
        );
      }
      const { changes, writes } = planSave(rows, body.groups ?? [], choices);
      const { consented, consent } = await this.newsWrite(
        tx,
        actor.accountId,
        writes,
        body.newsConsentTextVersion,
      );
      for (const row of writes) {
        await tx.notificationPreference.deleteMany({
          where: {
            accountId: actor.accountId,
            garageId: row.garageId,
            type: row.type,
            // A driver choice keeps one row, any other one per channel.
            ...(isDriverChoice(row.type, row.garageId)
              ? {}
              : { channel: row.channel }),
          },
        });
        await tx.notificationPreference.create({
          data: { ...row, ...consent[row.type], accountId: actor.accountId },
        });
      }
      for (const entry of [...changes, ...consented]) {
        await this.audit.record(tx, { ...who, ...entry, action: 'update' });
      }
    });
    await this.announce(actor.accountId);
    return this.read(actor);
  }

  private check(
    actor: Actor,
    { channel, enabled, garageId, type }: UpdateNotificationPreferenceDto,
  ) {
    if (!Object.hasOwn(NOTIFICATION_TYPES, type)) {
      throw refuse(
        HttpStatus.BAD_REQUEST,
        'unknown_notification_type',
        `${type} is not a notification type`,
      );
    }
    // SMS costs MotorFix; only drivers get it, for their reminders.
    if (channel === 'sms' && actor.role !== 'driver') {
      throw refuse(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'channel_not_allowed',
        `only a driver may choose sms`,
      );
    }
    if (!NOTIFICATION_TYPES[type].channels.includes(channel)) {
      throw refuse(
        HttpStatus.BAD_REQUEST,
        'channel_not_allowed',
        `${type} is not sent by ${channel}`,
      );
    }
    // A garage only goes with a type some garage list holds.
    if (garageId !== null && !STAFF_TYPES.has(type)) {
      throw refuse(
        HttpStatus.BAD_REQUEST,
        'garage_not_allowed',
        `${type} is a personal choice and takes no garage`,
      );
    }
    // A listed type's locked channels are the staff checks' to refuse.
    const staffType = !isDriverChoice(type, garageId) && STAFF_TYPES.has(type);
    if (!enabled && !canMute(type) && !staffType) {
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

  // What the person may choose as a garage's staff or as an admin.
  private async staff(
    actor: Actor,
    rows: readonly PreferenceRow[],
    db: PrismaClient | Prisma.TransactionClient = this.prisma,
  ) {
    const { accountId } = actor;
    const [memberships, mechanic, account] = await Promise.all([
      db.garageMember.findMany({
        include: { garage: { select: { name: true } } },
        orderBy: { joinedAt: 'asc' },
        where: { accountId },
      }),
      db.mechanic.findUnique({
        include: { garage: { select: { name: true } } },
        where: { accountId },
      }),
      db.account.findUnique({
        select: { phoneVerifiedAt: true },
        where: { id: accountId },
      }),
    ]);
    const garageIds = [
      ...memberships.map((m) => m.garageId),
      ...(mechanic ? [mechanic.garageId] : []),
    ];
    const features = garageIds.length
      ? await db.garageFeature.findMany({
          where: { garageId: { in: garageIds } },
        })
      : [];
    return staffEntries({
      admin: actor.roles.includes('admin'),
      features,
      mechanic: mechanic && {
        canAnswerQuotes: mechanic.canAnswerQuotes,
        garageId: mechanic.garageId,
        garageName: mechanic.garage.name,
      },
      memberships: memberships.map((m) => ({
        garageId: m.garageId,
        garageName: m.garage.name,
        role: m.role,
      })),
      phoneVerified: account?.phoneVerifiedAt != null,
      rows,
    });
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

  // What a save that switches news records about consent, by type; turning
  // it on needs the text version the driver was shown.
  private async newsWrite(
    tx: Prisma.TransactionClient,
    accountId: string,
    writes: readonly PreferenceRow[],
    version: string | undefined,
  ): Promise<{
    consented: PreferenceChange[];
    consent: Partial<Record<string, NewsConsent>>;
  }> {
    const news = writes.find((row) => row.type === 'NEWS');
    if (!news) return { consent: {}, consented: [] };
    const before = await this.newsConsent(tx, accountId);
    const result = consentChange(news.enabled, before, version, new Date());
    if (!result) {
      throw refuse(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'news_consent_required',
        `turning news on needs the consent text version ${NEWS_CONSENT_TEXT_VERSION}`,
      );
    }
    return {
      consent: { NEWS: result.consent },
      consented: result.change ? [result.change] : [],
    };
  }

  private newsConsent(
    client: PrismaClient | Prisma.TransactionClient,
    accountId: string,
  ): Promise<NewsConsent | null> {
    return client.notificationPreference.findFirst({
      select: {
        consentGivenAt: true,
        consentSource: true,
        consentTextVersion: true,
        withdrawnAt: true,
      },
      where: { accountId, garageId: null, type: 'NEWS' },
    });
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
