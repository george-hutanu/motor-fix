import type { BrandDto } from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PopularBrandsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  tiles(limit: number): Promise<BrandDto[]> {
    return this.prisma.brand.findMany({
      orderBy: [
        { popularity: { nulls: 'last', sort: 'asc' } },
        { name: 'asc' },
      ],
      select: { id: true, name: true, popularity: true, slug: true },
      take: limit,
      where: { active: true },
    });
  }
}
