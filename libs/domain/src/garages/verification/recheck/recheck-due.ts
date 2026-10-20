import { Logger } from '@nestjs/common';

import { countDue } from './recheck.service';
import { localDay } from '../../../bucharest';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { NotificationsService } from '../../../notifications/notifications.service';
import type { DailyTask } from '../../../scheduler/daily';

type Language = 'ro' | 'en';

const en = new Intl.PluralRules('en');
const ro = new Intl.PluralRules('ro');

// "1 service", "12 service-uri", "20 de service-uri"; "1 garage", "2 garages".
const garages = (n: number, language: Language) => {
  if (language === 'en') {
    return en.select(n) === 'one' ? `${n} garage` : `${n} garages`;
  }
  const form = ro.select(n);
  if (form === 'one') return `${n} service`;
  return form === 'few' ? `${n} service-uri` : `${n} de service-uri`;
};

// Each morning, every active admin learns how many published garages are due
// their look-up in the RAR register. The day is the event id, so a second run
// the same day finds the rows already written and sends nothing more.
export class RecheckDueTask implements DailyTask {
  private readonly logger = new Logger('RecheckDue');

  constructor(
    private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly webUrl: string | undefined,
  ) {}

  async run(now: Date): Promise<void> {
    const day = localDay(now);
    const n = await countDue(this.prisma, day);
    if (n === 0) {
      this.logger.log(`${day}: none due`);
      return;
    }
    if (!this.webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    const admins = await this.prisma.account.findMany({
      select: { id: true, language: true },
      where: { roles: { some: { role: 'admin' } }, status: 'active' },
    });
    for (const language of ['ro', 'en'] as const) {
      const recipients = admins
        .filter((admin) => admin.language === language)
        .map(({ id }) => id);
      if (recipients.length === 0) continue;
      await this.notifications.notify({
        eventId: `recheck-due-${day}`,
        kind: 'ADMIN_RECHECK_DUE',
        params: {
          dashboard: `${this.webUrl}/app/admin/garages`,
          garages: garages(n, language),
        },
        recipients,
      });
    }
    this.logger.log(`${day}: ${n} due, told to ${admins.length} admins`);
  }
}
