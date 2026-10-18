import { type LegalCheckDto, legalCheckRows } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { localDay } from '../../../bucharest';
import type { PrismaClient } from '../../../generated/prisma/client';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');

const day = (at: Date | null) => (at ? at.toISOString().slice(0, 10) : null);

// The owner's view of the garage's legal check: the newest verification
// file's company, CAEN and RAR checks and its two documents, read only while
// the garage is approved. Notes, reviewers, evidence and pages stay out.
@Injectable()
export class LegalCheckService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async read(actor: Actor, garageId: string): Promise<LegalCheckDto> {
    if (actor.garageId !== garageId) throw notFound();
    if (actor.role !== 'garage') {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        'Only the owner sees the legal check',
      );
    }
    const garage = await this.prisma.garage.findUnique({
      select: {
        businessKind: true,
        lastCheckedOn: true,
        name: true,
        rarActivities: true,
        status: true,
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
    if (garage?.status !== 'approved' || !file) throw notFound();
    const activities = await this.prisma.rarActivity.findMany({
      select: { code: true, nameEn: true, nameRo: true },
      where: { code: { in: garage.rarActivities } },
    });
    const lastCheckedOn = day(garage.lastCheckedOn);
    return {
      companyName: garage.name,
      isMobile: garage.businessKind === 'mobile',
      lastCheckedOn,
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
      }),
    };
  }
}
