import type {
  ChangePlatformRuleDto,
  PlatformRuleDto,
  PlatformRulesDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { MAINTENANCE, type Maintenance } from '../../auth/maintenance';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type {
  PlatformRule,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';

export interface PlatformRulesOptions {
  production: boolean;
  // The web app's address, for the Setări link in a change request's alert.
  webUrl?: string;
}

export type ReviewPolicy =
  | { mode: 'job_only' }
  | { mode: 'profile_allowed'; source: 'profile' };

export const PLATFORM_RULES_OPTIONS = Symbol('PLATFORM_RULES_OPTIONS');

// Seeded outside production only; production never reads or changes them,
// even when a copied database holds them.
export const TEST_ONLY = new Set(['skip_manual_approval', 'skip_rar_check']);

const MAINTENANCE_RULE = 'maintenance_mode';

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const dto = (row: PlatformRule): PlatformRuleDto => ({
  defaultValue: row.defaultValue,
  key: row.key,
  requiresTwoAdmins: row.requiresTwoAdmins,
  updatedAt: row.updatedAt?.toISOString() ?? null,
  updatedBy: row.updatedBy,
  value: row.value,
});

@Injectable()
export class PlatformRulesService {
  private readonly logger = new Logger('PlatformRules');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    @Inject(PLATFORM_RULES_OPTIONS)
    private readonly options: PlatformRulesOptions,
    @Inject(MAINTENANCE) private readonly maintenance: Maintenance,
  ) {}

  async list(actor: Actor): Promise<PlatformRulesDto> {
    requireCapability(actor, 'admin.settings');
    const rows = await this.prisma.platformRule.findMany({
      orderBy: { key: 'asc' },
    });
    return {
      production: this.options.production,
      rules: rows.filter((r) => this.visible(r.key)).map(dto),
    };
  }

  async change(
    actor: Actor,
    key: string,
    { seen, value }: ChangePlatformRuleDto,
  ): Promise<PlatformRuleDto> {
    requireCapability(actor, 'admin.settings');
    if (!this.visible(key)) throw unknownRule();
    let changed = false;
    const rule = await this.prisma.$transaction(async (tx) => {
      // Two admins switching the same rule: the second waits here, then
      // finds the value it saw gone.
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM platform_rule WHERE key = ${key} FOR UPDATE`;
      if (!locked) throw unknownRule();
      const row = await tx.platformRule.findUniqueOrThrow({
        where: { id: locked.id },
      });
      if (same(value, row.value) && same(seen, row.value)) return dto(row);
      const refused = refuseChange(row, seen, value);
      if (refused) throw refused;
      const saved = await setRule(
        tx,
        { audit: this.audit, events: this.events },
        actor,
        row,
        value,
      );
      changed = true;
      return dto(saved);
    });
    if (changed && key === MAINTENANCE_RULE) {
      await this.switched(value === true, actor.accountId);
    }
    return rule;
  }

  // Every copy of the api reads the switch from Redis; the stored rule
  // answers there within a minute if this write is lost.
  private async switched(on: boolean, accountId: string) {
    this.logger.log(`maintenance mode ${on ? 'on' : 'off'} by ${accountId}`);
    try {
      await this.maintenance.set(on);
    } catch (error) {
      this.logger.warn(
        `maintenance mode not written to Redis: ${String(error)}`,
      );
    }
  }

  // How a driver may review a garage: only after a confirmed job while the
  // reviews rule is on, also from the garage's profile once it is off.
  async reviewPolicy(): Promise<ReviewPolicy> {
    const rule = await this.prisma.platformRule.findUnique({
      where: { key: 'reviews_only_after_confirmed_job' },
    });
    return rule?.value === false
      ? { mode: 'profile_allowed', source: 'profile' }
      : { mode: 'job_only' };
  }

  private visible(key: string) {
    return !(this.options.production && TEST_ONLY.has(key));
  }
}

// Saves a rule's new value with its audit entry and its event, inside the
// caller's transaction: a direct change, or an approved request.
export async function setRule(
  tx: Prisma.TransactionClient,
  ports: { audit: AuditPort; events: EventPort },
  actor: Actor,
  row: PlatformRule,
  value: unknown,
): Promise<PlatformRule> {
  const saved = await tx.platformRule.update({
    data: {
      updatedAt: new Date(),
      updatedBy: actor.accountId,
      value: value as Prisma.InputJsonValue,
    },
    where: { id: row.id },
  });
  await ports.audit.record(tx, {
    action: 'update',
    actorId: actor.accountId,
    actorRole: actor.role,
    field: row.key,
    kind: 'platform_rule_changed',
    newValue: value,
    oldValue: row.value,
    subjectId: row.id,
    subjectType: 'platform_rule',
  });
  await ports.events.record(tx, {
    audience: { adminOnly: row.key !== MAINTENANCE_RULE, type: 'platform' },
    kind: 'platform_rule.changed',
    payload: { key: row.key, new: value, old: row.value },
    subjectId: row.key,
  });
  return saved;
}

// A change is checked in this order: the value's shape, a stale read, then the
// second admin a rule may need. It runs for a new value or one read stale.
function refuseChange(
  row: { defaultValue: unknown; requiresTwoAdmins: boolean; value: unknown },
  seen: unknown,
  value: unknown,
) {
  if (typeof value !== typeof row.defaultValue) {
    return refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'The value is not of the rule shape',
    );
  }
  if (!same(seen, row.value)) {
    return refusal(
      HttpStatus.CONFLICT,
      'stale_value',
      'The rule changed since it was read',
    );
  }
  // Switching off a rule that needs two admins waits for a second admin to
  // confirm it; switching it back on needs no one else.
  if (row.requiresTwoAdmins && value === false) {
    return refusal(
      HttpStatus.CONFLICT,
      'two_admins_required',
      'This rule needs a second admin',
    );
  }
  return undefined;
}

export const unknownRule = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such rule');
