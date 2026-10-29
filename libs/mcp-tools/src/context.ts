import {
  type AccountLoader,
  AssistantApprovals,
  AssistantConfirmations,
  AuditService,
  type createPrisma,
  DaySheetService,
  DeclineService,
  type EventPort,
  featureOn,
  GarageFiguresService,
  GarageRequestsService,
  GarageScheduleService,
  type MaintenanceReader,
} from '@motor-fix/domain';

import type { ToolContext } from './registry';

// What every tool runs against, built the same for the MCP server and for an
// approval run in the app.
export function toolContext(deps: {
  accounts: Pick<AccountLoader, 'activeAccount'>;
  maintenance: MaintenanceReader;
  outbox: EventPort;
  prisma: ReturnType<typeof createPrisma>;
}): ToolContext {
  const { prisma } = deps;
  const audit = new AuditService();
  return {
    accounts: deps.accounts,
    approvals: new AssistantApprovals(prisma, audit, deps.outbox),
    confirmations: new AssistantConfirmations(prisma),
    featureOn: (garageId, key) => featureOn(prisma, garageId, key),
    garage: {
      daySheet: new DaySheetService(prisma),
      decline: new DeclineService(prisma, audit, deps.outbox),
      figures: new GarageFiguresService(prisma),
      requests: new GarageRequestsService(prisma),
      schedule: new GarageScheduleService(prisma),
    },
    maintenance: deps.maintenance,
  };
}
