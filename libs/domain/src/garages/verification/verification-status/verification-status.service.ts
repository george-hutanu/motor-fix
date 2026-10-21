import {
  type GarageStatusKey,
  garageStatusKey,
  type VerificationStageStatus,
  type VerificationStatusDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';

import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import type { PrismaClient } from '../../../generated/prisma/client';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');
const forbidden = () =>
  refusal(
    HttpStatus.FORBIDDEN,
    'forbidden',
    'Only the owner sees the verification status',
  );

// A suspended garage was approved: its suspension is the dashboard's to show.
const STAGE: Record<GarageStatusKey, VerificationStageStatus> = {
  approved: 'approved',
  draft: 'draft',
  more_requested: 'more_requested',
  rejected: 'rejected',
  sent: 'submitted',
  suspended: 'approved',
  under_review: 'in_review',
};

// Where the garage's listing stands on its way to the map, for its owner and
// for an admin.
@Injectable()
export class VerificationStatusService {
  private readonly logger = new Logger('VerificationStatus');

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // One line per refusal: its code and the actor's role, no account,
  // garage or request detail.
  private refuse(actor: Actor, code: 'forbidden' | 'not_found') {
    this.logger.warn(
      `verification status refused: ${code} (role ${actor.role})`,
    );
    return code === 'forbidden' ? forbidden() : notFound();
  }

  // An admin reads any garage. Anyone else outside the garage learns nothing
  // of it; its staff other than the owner are told they may not.
  private assertMayRead(actor: Actor, garageId: string) {
    if (actor.role === 'admin') {
      if (!isUUID(garageId)) throw this.refuse(actor, 'not_found');
      return;
    }
    if (actor.garageId !== garageId) throw this.refuse(actor, 'not_found');
    if (actor.role !== 'garage') throw this.refuse(actor, 'forbidden');
  }

  async read(actor: Actor, garageId: string): Promise<VerificationStatusDto> {
    this.assertMayRead(actor, garageId);
    const garage = await this.prisma.garage.findUnique({
      select: {
        status: true,
        verificationFiles: {
          orderBy: { createdAt: 'desc' },
          select: {
            reasonCode: true,
            reasonNote: true,
            requestedItems: true,
            status: true,
            submittedAt: true,
          },
          take: 1,
        },
      },
      where: { id: garageId },
    });
    if (!garage) throw this.refuse(actor, 'not_found');
    const file = garage.verificationFiles[0] ?? null;
    const { key, reason } = garageStatusKey(garage, file);
    const status = STAGE[key];
    return {
      reason: reason ?? null,
      requestedItems:
        status === 'more_requested' ? (file?.requestedItems ?? []) : [],
      status,
      submittedAt: file ? file.submittedAt.toISOString() : null,
    };
  }
}
