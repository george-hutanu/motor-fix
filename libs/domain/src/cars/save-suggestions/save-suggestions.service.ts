import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { driverOnly } from '../saved-garages/saved-garages.service';

// A driver's no to saving a garage after a finished job there. A display
// preference: no audit entry and no event, and only the first no is kept.
@Injectable()
export class SaveSuggestionsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async dismiss(actor: Actor, garageId: string): Promise<void> {
    driverOnly(actor);
    const { accountId } = actor;
    // A handed-over job counts: the card may still be on screen.
    const done = await this.prisma.job.findFirst({
      select: { id: true },
      where: { driverId: accountId, garageId, status: 'done' },
    });
    if (!done) {
      throw refusal(
        HttpStatus.NOT_FOUND,
        'not_found',
        'No finished job of yours at that garage',
      );
    }
    await this.prisma.saveSuggestionDismissal.createMany({
      data: [{ accountId, garageId }],
      skipDuplicates: true,
    });
  }
}
