import type {
  PlatformRuleChangeDto,
  PlatformRuleChangesDto,
  RequestPlatformRuleChangeDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { type ChangeAction, recordChange } from './changes.metrics';
import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { firstName } from '../../../audit/audit.service';
import { type Actor, requireCapability } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type {
  PlatformRuleChange,
  Prisma,
  PrismaClient,
} from '../../../generated/prisma/client';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  PLATFORM_RULES_OPTIONS,
  type PlatformRulesOptions,
  setRule,
  TEST_ONLY,
  unknownRule,
} from '../platform-rules.service';

const REASON_MIN = 5;
const REASON_MAX = 300;
// A push body holds 120 characters.
const BRIEF_MAX = 120;
const DECIDED_SHOWN = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Decision = 'approved' | 'refused' | 'cancelled';

const dto = (row: PlatformRuleChange, actor: Actor): PlatformRuleChangeDto => ({
  decidedAt: row.decidedAt?.toISOString() ?? null,
  decidedByName: row.decidedByName,
  id: row.id,
  key: row.ruleKey,
  mine: row.requestedBy === actor.accountId,
  reason: row.reason,
  requestedAt: row.requestedAt.toISOString(),
  requestedByName: row.requestedByName,
  status: row.status,
});

const brief = (name: string, reason: string) => {
  // Cut in code points, so an emoji at the cut stays whole.
  const text = [...`${name}: ${reason}`];
  return text.length <= BRIEF_MAX
    ? text.join('')
    : `${text.slice(0, BRIEF_MAX - 1).join('')}…`;
};

// Only another admin decides; only the asker withdraws; a decided request
// stays as it is.
function refuseStep(change: PlatformRuleChange, actor: Actor, step: Decision) {
  const own = change.requestedBy === actor.accountId;
  if (step === 'cancelled' && !own) {
    return refusal(
      HttpStatus.FORBIDDEN,
      'not_requester',
      'Only the admin who asked may withdraw the request',
    );
  }
  if (step !== 'cancelled' && own) {
    return refusal(
      HttpStatus.FORBIDDEN,
      'own_request',
      'Another admin has to decide this request',
    );
  }
  if (change.status !== 'requested') {
    return refusal(
      HttpStatus.CONFLICT,
      'already_decided',
      `Already ${change.status} by ${change.decidedByName}`,
    );
  }
  return undefined;
}

const unknownRequest = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such request');

// Requests to switch off a rule that needs a second admin: one admin asks
// with a reason, another approves or refuses, the asker may withdraw.
@Injectable()
export class PlatformRuleChangesService {
  private readonly logger = new Logger('PlatformRuleChanges');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly notifications: NotificationsService,
    @Inject(PLATFORM_RULES_OPTIONS)
    private readonly options: PlatformRulesOptions,
  ) {}

  async list(actor: Actor, key: string): Promise<PlatformRuleChangesDto> {
    requireCapability(actor, 'admin.settings');
    await this.rule(key);
    const [waiting, decided] = await Promise.all([
      this.prisma.platformRuleChange.findFirst({
        where: { ruleKey: key, status: 'requested' },
      }),
      this.prisma.platformRuleChange.findMany({
        orderBy: { decidedAt: 'desc' },
        take: DECIDED_SHOWN,
        where: { ruleKey: key, status: { not: 'requested' } },
      }),
    ]);
    return {
      decided: decided.map((row) => dto(row, actor)),
      waiting: waiting && dto(waiting, actor),
    };
  }

  // Checked in this order: the rule, the reason, a stale value, a request
  // already waiting.
  async request(
    actor: Actor,
    { key, reason }: RequestPlatformRuleChangeDto,
  ): Promise<PlatformRuleChangeDto> {
    requireCapability(actor, 'admin.settings');
    const rule = await this.rule(key);
    if (!rule.requiresTwoAdmins) throw unknownRule();
    const text = typeof reason === 'string' ? reason.trim() : '';
    // Counted in code points, as the web form counts them.
    const length = [...text].length;
    // PostgreSQL text cannot hold NUL.
    if (length < REASON_MIN || length > REASON_MAX || text.includes('\u0000')) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        `The reason needs ${REASON_MIN} to ${REASON_MAX} characters`,
      );
    }
    const asker = await this.prisma.account.findUniqueOrThrow({
      where: { id: actor.accountId },
    });
    const name = firstName(asker.name);
    const row = await this.prisma.$transaction(async (tx) => {
      // Two admins asking at once: the second waits here, then finds the
      // first request.
      const [locked] = await tx.$queryRaw<{ value: unknown }[]>`
        SELECT value FROM platform_rule WHERE key = ${key} FOR UPDATE`;
      if (locked?.value !== true) {
        throw refusal(
          HttpStatus.CONFLICT,
          'stale_value',
          'The rule is already off',
        );
      }
      const waiting = await tx.platformRuleChange.findFirst({
        where: { ruleKey: key, status: 'requested' },
      });
      if (waiting) {
        throw refusal(
          HttpStatus.CONFLICT,
          'change_pending',
          'A request for this rule already waits',
        );
      }
      const created = await tx.platformRuleChange.create({
        data: {
          newValue: false,
          oldValue: true,
          reason: text,
          requestedBy: actor.accountId,
          requestedByName: name,
          ruleKey: key,
        },
      });
      await this.audit.record(tx, {
        action: 'create',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'value',
        kind: 'platform_rule.change_requested',
        newValue: false,
        oldValue: true,
        subjectId: created.id,
        subjectType: 'platform_rule_change',
        text,
      });
      await this.event(tx, created);
      return created;
    });
    this.done('requested', row);
    await this.tellAdmins(row);
    return dto(row, actor);
  }

  approve(actor: Actor, id: string) {
    return this.decide(actor, id, 'approved');
  }

  refuse(actor: Actor, id: string) {
    return this.decide(actor, id, 'refused');
  }

  cancel(actor: Actor, id: string) {
    return this.decide(actor, id, 'cancelled');
  }

  // Checked in this order: the request, who may take the step, a decision
  // already taken.
  private async decide(
    actor: Actor,
    id: string,
    status: Decision,
  ): Promise<PlatformRuleChangeDto> {
    requireCapability(actor, 'admin.settings');
    if (!UUID.test(id)) throw unknownRequest();
    const decider = await this.prisma.account.findUniqueOrThrow({
      where: { id: actor.accountId },
    });
    const row = await this.prisma.$transaction(async (tx) => {
      // Two admins deciding at once: the second waits here, then finds the
      // request decided.
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM platform_rule_change WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw unknownRequest();
      const change = await tx.platformRuleChange.findUniqueOrThrow({
        where: { id },
      });
      if (!this.visible(change.ruleKey)) throw unknownRequest();
      const refused = refuseStep(change, actor, status);
      if (refused) throw refused;
      const decided = await tx.platformRuleChange.update({
        data: {
          decidedAt: new Date(),
          decidedBy: actor.accountId,
          decidedByName: firstName(decider.name),
          status,
        },
        where: { id },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'status',
        kind: `platform_rule.change_${status}`,
        newValue: status,
        oldValue: 'requested',
        subjectId: id,
        subjectType: 'platform_rule_change',
      });
      await this.event(tx, decided);
      if (status === 'approved') {
        const rule = await tx.platformRule.findUniqueOrThrow({
          where: { key: change.ruleKey },
        });
        await setRule(
          tx,
          { audit: this.audit, events: this.events },
          actor,
          rule,
          change.newValue,
        );
      }
      return decided;
    });
    this.done(status, row);
    return dto(row, actor);
  }

  // The key comes from a body or a query: anything but text is unknown.
  private async rule(key: unknown) {
    if (typeof key !== 'string') throw unknownRule();
    const rule = this.visible(key)
      ? await this.prisma.platformRule.findUnique({ where: { key } })
      : null;
    if (!rule) throw unknownRule();
    return rule;
  }

  private visible(key: string) {
    return !(this.options.production && TEST_ONLY.has(key));
  }

  private event(tx: Prisma.TransactionClient, row: PlatformRuleChange) {
    return this.events.record(tx, {
      audience: { adminOnly: true, type: 'platform' },
      kind:
        row.status === 'requested'
          ? 'platform_rule.change_requested'
          : 'platform_rule.change_decided',
      payload: { id: row.id, key: row.ruleKey, status: row.status },
      subjectId: row.id,
    });
  }

  private done(action: ChangeAction, row: PlatformRuleChange) {
    recordChange(action);
    this.logger.log(`${action} rule=${row.ruleKey} request=${row.id}`);
  }

  // The other admins hear of the request; a failure here undoes nothing.
  private async tellAdmins(row: PlatformRuleChange) {
    try {
      const { webUrl } = this.options;
      // The config leaves it optional (email-config.ts); unset, no one is told.
      if (!webUrl) throw new Error('PUBLIC_WEB_URL is not set');
      const admins = await this.prisma.account.findMany({
        select: { id: true },
        where: {
          id: { not: row.requestedBy },
          roles: { some: { role: 'admin' } },
          status: 'active',
        },
      });
      if (admins.length === 0) return;
      await this.notifications.notify({
        eventId: `platform_rule.change_requested:${row.id}`,
        kind: 'ADMIN_RULE_APPROVAL_NEEDED',
        params: {
          brief: brief(row.requestedByName, row.reason),
          name: row.requestedByName,
          reason: row.reason,
          settings: `${webUrl}/app/admin/settings`,
        },
        recipients: admins.map((a) => a.id),
        subjectId: row.id,
      });
    } catch (error) {
      this.logger.error(
        `request ${row.id} admins not told: ${(error as Error).message}`,
      );
    }
  }
}
