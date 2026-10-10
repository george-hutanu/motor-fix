import { Inject, Injectable, Logger } from '@nestjs/common';

import type { ReadAlert } from './outage';
import type { PrismaClient } from '../../generated/prisma/client';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const OUTAGE_WEBHOOK_TOKEN = Symbol('OUTAGE_WEBHOOK_TOKEN');

// Tells every active admin that an uptime check went down or came back.
@Injectable()
export class OutageService {
  private readonly logger = new Logger('Outage');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(alerts: readonly ReadAlert[]): Promise<void> {
    for (const alert of alerts) {
      if (!('outage' in alert)) {
        this.logger.log(`alert skipped: ${alert.skipped}`);
        continue;
      }
      const { at, eventId, fingerprint, service, state } = alert.outage;
      const admins = await this.prisma.account.findMany({
        select: { id: true },
        where: { roles: { some: { role: 'admin' } }, status: 'active' },
      });
      const queued = await this.notifications.notify({
        eventId,
        kind: 'ADMIN_OUTAGE_ALERT',
        params: {
          at,
          dashboard: `${this.config.webUrl ?? ''}/app/admin`,
          service,
          state,
        },
        recipients: admins.map((a) => a.id),
      });
      this.logger.log(
        `${service} ${state} fingerprint=${fingerprint} admins=${admins.length} sent=${queued > 0}`,
      );
    }
  }
}
