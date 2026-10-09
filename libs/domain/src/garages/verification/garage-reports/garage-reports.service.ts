import type { CreateGarageReportDto } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal, taken } from '../../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type {
  GarageReport,
  Prisma,
  PrismaClient,
} from '../../../generated/prisma/client';
import {
  countGarageReport,
  type GarageReportOutcome,
} from '../../../metrics/product-counters';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  newestFirst,
  SYSTEM,
  VerificationService,
} from '../verification.service';

interface GarageReportsOptions {
  // The web app's address, for the alert's link; unset, no admin is told.
  webUrl?: string;
}

export const GARAGE_REPORTS_OPTIONS = Symbol('GARAGE_REPORTS_OPTIONS');

const DAILY_CAP = 5;
const DAY_MS = 24 * 3_600_000;
const BRIEF_MAX = 120;

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');

// Only the refusals that share a status: a 404 or a 429 on this route already
// reads from the request-duration metric, and each label costs a series.
const OUTCOME: Record<string, GarageReportOutcome> = {
  garage_already_reported: 'already_reported',
  verification_transition_refused: 'refused',
};

// Cut in code points, so an emoji at the cut stays whole.
const brief = (text: string) => {
  const letters = [...text];
  return letters.length <= BRIEF_MAX
    ? text
    : `${letters.slice(0, BRIEF_MAX - 1).join('')}…`;
};

interface Reported {
  report: GarageReport;
  garage: string;
  // The file's first report: the one the admins are told of.
  first: boolean;
}

// A driver tells MotorFix something is wrong with a listed garage. The
// report puts the garage's verification file back in front of the admins;
// the garage stays listed until one of them decides.
@Injectable()
export class GarageReportsService {
  private readonly logger = new Logger('GarageReports');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly verification: VerificationService,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly notifications: NotificationsService,
    @Inject(GARAGE_REPORTS_OPTIONS)
    private readonly options: GarageReportsOptions,
  ) {}

  async report(
    actor: Actor,
    garageId: string,
    { text }: CreateGarageReportDto,
  ): Promise<{ createdAt: Date; id: string }> {
    try {
      const done = await this.prisma.$transaction((tx) =>
        this.store(tx, actor, garageId, text),
      );
      countGarageReport('created');
      if (done.first) await this.tellAdmins(done);
      return { createdAt: done.report.createdAt, id: done.report.id };
    } catch (error) {
      const refused = taken(error)
        ? refusal(
            HttpStatus.CONFLICT,
            'garage_already_reported',
            'Ai raportat deja acest service.',
          )
        : error;
      const code =
        refused instanceof HttpException
          ? (refused.getResponse() as { code?: string }).code
          : undefined;
      if (code && OUTCOME[code]) countGarageReport(OUTCOME[code]);
      throw refused;
    }
  }

  private async store(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    text: string,
  ): Promise<Reported> {
    const reporterId = actor.accountId;
    // A garage-side or admin account never learns more than "no such garage".
    if (actor.role !== 'driver' || !reporterId || !isUUID(garageId)) {
      throw notFound();
    }
    // The reporter first, then the garage, always in that order: one
    // driver's reports queue for the cap, one garage's for its file.
    await tx.$queryRaw`SELECT id FROM account WHERE id = ${reporterId}::uuid FOR UPDATE`;
    const [garage] = await tx.$queryRaw<{ name: string }[]>`
      SELECT name FROM garage
      WHERE id = ${garageId}::uuid AND status = 'approved'
      FOR UPDATE`;
    if (!garage) throw notFound();
    const [member, mechanic] = await Promise.all([
      tx.garageMember.findFirst({ where: { accountId: reporterId, garageId } }),
      tx.mechanic.findFirst({ where: { accountId: reporterId, garageId } }),
    ]);
    if (member || mechanic) throw notFound();

    const open = await tx.garageReport.findFirst({
      where: { garageId, reporterId, status: 'open' },
    });
    if (open) {
      throw refusal(
        HttpStatus.CONFLICT,
        'garage_already_reported',
        'Ai raportat deja acest service.',
      );
    }
    const today = await tx.garageReport.count({
      where: { createdAt: { gt: new Date(Date.now() - DAY_MS) }, reporterId },
    });
    if (today >= DAILY_CAP) {
      throw refusal(
        HttpStatus.TOO_MANY_REQUESTS,
        'too_many_reports',
        'Too many reports today',
      );
    }

    const file = await tx.verificationFile.findFirst({
      orderBy: newestFirst,
      where: { garageId },
    });
    if (!file) {
      throw refusal(
        HttpStatus.CONFLICT,
        'verification_transition_refused',
        'The garage has no verification file',
      );
    }
    const earlier = await tx.garageReport.count({
      where: { status: 'open', verificationFileId: file.id },
    });
    if (file.status === 'approved') {
      await this.verification.reopen(tx, SYSTEM, file.id, 'garage_report');
    }

    const report = await tx.garageReport.create({
      data: { garageId, reporterId, text, verificationFileId: file.id },
    });
    await this.audit.record(tx, {
      action: 'create',
      actorId: reporterId,
      actorRole: actor.role,
      garageId,
      newValue: report,
      subjectId: report.id,
      subjectType: 'garage_report',
    });
    // Ids only: the reporter and the text stay with the admins' own reads.
    await this.events.record(tx, {
      audience: { adminOnly: true, type: 'platform' },
      kind: 'garage.reported',
      payload: { fileId: file.id, garageId, reportId: report.id },
      subjectId: report.id,
    });
    return { first: earlier === 0, garage: garage.name, report };
  }

  // A failure here undoes nothing: the report and the reopened file stand.
  private async tellAdmins({ garage, report }: Reported) {
    try {
      const { webUrl } = this.options;
      if (!webUrl) throw new Error('PUBLIC_WEB_URL is not set');
      const admins = await this.prisma.account.findMany({
        select: { id: true },
        where: { roles: { some: { role: 'admin' } }, status: 'active' },
      });
      if (admins.length === 0) return;
      await this.notifications.notify({
        eventId: `garage.reported:${report.id}`,
        kind: 'ADMIN_GARAGE_REPORTED',
        params: {
          brief: brief(report.text),
          dashboard: `${webUrl}/app/admin`,
          garage,
          text: report.text,
        },
        recipients: admins.map((a) => a.id),
        subjectId: report.id,
      });
    } catch (error) {
      this.logger.error(
        `report ${report.id} admins not told: ${(error as Error).message}`,
      );
    }
  }
}
