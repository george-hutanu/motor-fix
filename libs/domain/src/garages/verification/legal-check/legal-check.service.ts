import { type LegalCheckDto, legalCheckRows } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { localDay } from '../../../bucharest';
import type { PrismaClient } from '../../../generated/prisma/client';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');
const forbidden = () =>
  refusal(
    HttpStatus.FORBIDDEN,
    'forbidden',
    'Only the owner sees the legal check',
  );

const dayOf = (at: Date) => at.toISOString().slice(0, 10);
const day = (at: Date | null) => (at ? dayOf(at) : null);

// The owner's view of the garage's legal check: the newest verification
// file's company, CAEN and RAR checks and its two documents, with the latest
// re-check, read only while the garage is approved or suspended. Notes,
// reviewers, evidence and pages stay out.
@Injectable()
export class LegalCheckService {
  private readonly logger = new Logger('LegalCheck');

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // One line per refusal: its code and the actor's role, no account,
  // garage or request detail.
  private refuse(actor: Actor, code: 'forbidden' | 'not_found') {
    this.logger.warn(`legal check refused: ${code} (role ${actor.role})`);
    return code === 'forbidden' ? forbidden() : notFound();
  }

  async read(actor: Actor, garageId: string): Promise<LegalCheckDto> {
    if (actor.garageId !== garageId) throw this.refuse(actor, 'not_found');
    if (actor.role !== 'garage') throw this.refuse(actor, 'forbidden');
    const garage = await this.prisma.garage.findUnique({
      select: {
        businessKind: true,
        lastCheckedOn: true,
        name: true,
        rarActivities: true,
        rechecks: {
          orderBy: { recordedAt: 'desc' },
          select: {
            checkedOn: true,
            detail: true,
            failure: true,
            result: true,
          },
          take: 1,
        },
        status: true,
        suspensions: {
          select: { cause: true },
          take: 1,
          where: { untilTime: null },
        },
        verificationFiles: {
          orderBy: { createdAt: 'desc' },
          select: {
            checks: {
              select: {
                detail: true,
                kind: true,
                recordedAt: true,
                result: true,
              },
              where: { kind: { in: ['company', 'caen', 'rar'] } },
            },
            documents: { select: { kind: true, status: true } },
          },
          take: 1,
        },
      },
      where: { id: garageId },
    });
    const file = garage?.verificationFiles[0];
    if (
      (garage?.status !== 'approved' && garage?.status !== 'suspended') ||
      !file
    ) {
      throw this.refuse(actor, 'not_found');
    }
    const activities = await this.prisma.rarActivity.findMany({
      select: { code: true, nameEn: true, nameRo: true },
      where: { code: { in: garage.rarActivities } },
    });
    const lastCheckedOn = day(garage.lastCheckedOn);
    const recheck = garage.rechecks[0];
    const latestRecheck = recheck
      ? {
          checkedOn: dayOf(recheck.checkedOn),
          detail: recheck.detail,
          failure: recheck.failure,
          result: recheck.result,
        }
      : null;
    return {
      companyName: garage.name,
      isMobile: garage.businessKind === 'mobile',
      lastCheckedOn,
      latestRecheck,
      // In the garage's own order; a code the register no longer lists is left out.
      rarActivities: garage.rarActivities.flatMap((code) =>
        activities.filter((a) => a.code === code),
      ),
      rows: legalCheckRows({
        checks: file.checks.map((check) => ({
          checkedOn: check.recordedAt ? localDay(check.recordedAt) : null,
          detail: check.detail,
          kind: check.kind,
          result: check.result,
        })),
        documents: file.documents,
        lastCheckedOn,
        latestRecheck,
        recheckFailed:
          garage.status === 'suspended' &&
          garage.suspensions[0]?.cause === 'recheck_failed',
      }),
      status: garage.status,
    };
  }
}
