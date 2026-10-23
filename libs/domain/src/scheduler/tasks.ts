import type { Provider } from '@nestjs/common';

import { DAILY_TASKS } from './daily';
import { DocumentCycleStep } from '../garages/documents/document-cycle/document-cycle.step';
import { ListingDraftSweep } from '../garages/listing-draft-sweep';
import { RecheckDueTask } from '../garages/verification/recheck/recheck-due';
import type { PrismaClient } from '../generated/prisma/client';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

// The worker's daily tasks, on the notifications module's pool. The yearly
// documents move before the re-checks, which read their overdue state.
export const dailyTasks = (webUrl: string | undefined): Provider => ({
  inject: [NOTIFICATIONS_PRISMA, NotificationsService, StorageService],
  provide: DAILY_TASKS,
  useFactory: (
    prisma: PrismaClient,
    notifications: NotificationsService,
    storage: StorageService,
  ) => [
    new ListingDraftSweep(prisma, notifications, storage, webUrl),
    new DocumentCycleStep(prisma, notifications, webUrl),
    new RecheckDueTask(prisma, notifications, webUrl),
  ],
});
