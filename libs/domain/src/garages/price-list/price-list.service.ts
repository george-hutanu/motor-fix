import type { PriceListDto } from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { PRICE_ROW_SELECT, priceListJobs } from './price-list';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import {
  assertGarageOwner,
  notFound,
} from '../garage-brands/garage-brands.service';

@Injectable()
export class PriceListService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // The owner's price list, each job with whether drivers see it and why not.
  async read(actor: Actor, garageId: string): Promise<PriceListDto> {
    assertGarageOwner(actor, garageId);
    const garage = await this.prisma.garage.findUnique({
      select: {
        prices: { select: PRICE_ROW_SELECT },
        rarActivities: true,
      },
      where: { id: garageId },
    });
    if (!garage) throw notFound();
    return { items: priceListJobs(garage.prices, garage.rarActivities) };
  }
}
