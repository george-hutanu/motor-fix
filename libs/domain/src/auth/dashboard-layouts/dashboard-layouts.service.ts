import type {
  DashboardLayoutDto,
  DashboardPanelDto,
} from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import {
  checkPanels,
  mergeLayout,
  panelKeysOf,
} from './dashboard-layouts.panels';
import {
  type DomainEvent,
  EVENT_PORT,
  type EventPort,
} from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';
import { countDashboardLayoutWrite } from '../../metrics/product-counters';
import { refusal } from '../http-refusal';
import type { Actor } from '../policy';
import { PRISMA } from '../prisma';

// To the person's own channel only, so their other tabs and devices follow.
const event = (accountId: string, role: Role): DomainEvent => ({
  audience: { accountId, type: 'account' },
  kind: 'dashboard_layout.updated',
  payload: { accountId, role },
  subjectId: accountId,
});

@Injectable()
export class DashboardLayoutsService {
  private readonly logger = new Logger(DashboardLayoutsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async read(actor: Actor, path: string): Promise<DashboardLayoutDto> {
    const { keys, role } = served(actor, path);
    const row = await this.prisma.dashboardLayout.findUnique({
      where: { accountId_role: { accountId: actor.accountId, role } },
    });
    return answer(role, keys, row);
  }

  async save(
    actor: Actor,
    path: string,
    panels: DashboardPanelDto[],
  ): Promise<DashboardLayoutDto> {
    const { keys, role } = served(actor, path);
    const problem = checkPanels(keys, panels);
    if (problem) {
      countDashboardLayoutWrite(role, 'refused');
      this.logger.warn({ msg: 'dashboard layout refused', problem, role });
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        problem === 'unknown_key'
          ? `A key is not one of the ${role} sections`
          : 'A key is listed twice',
        [{ code: problem, field: 'panels' }],
      );
    }
    const { accountId } = actor;
    const value = panels.map(({ key, visible }) => ({ key, visible }));
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.dashboardLayout.upsert({
        create: { accountId, panels: value, role },
        update: { panels: value },
        where: { accountId_role: { accountId, role } },
      });
      await this.events.record(tx, event(accountId, role));
      return saved;
    });
    countDashboardLayoutWrite(role, 'saved');
    return answer(role, keys, row);
  }

  async reset(actor: Actor, path: string): Promise<DashboardLayoutDto> {
    const { keys, role } = served(actor, path);
    const { accountId } = actor;
    await this.prisma.$transaction(async (tx) => {
      await tx.dashboardLayout.deleteMany({ where: { accountId, role } });
      await this.events.record(tx, event(accountId, role));
    });
    countDashboardLayoutWrite(role, 'reset');
    return answer(role, keys, null);
  }
}

// A role with a section list that the caller holds, or 404: a role they do
// not hold is answered as one that does not exist.
function served(actor: Actor, path: string) {
  const role = path as Role;
  const keys = panelKeysOf(path);
  if (!keys || !actor.roles.includes(role))
    throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such dashboard');
  return { keys, role };
}

function answer(
  role: Role,
  keys: readonly string[],
  row: { panels: unknown; updatedAt: Date } | null,
): DashboardLayoutDto {
  const saved = Array.isArray(row?.panels) ? row.panels : null;
  return {
    panels: mergeLayout(keys, saved),
    role,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}
