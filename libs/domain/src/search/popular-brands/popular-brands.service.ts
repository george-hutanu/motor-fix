import type { BrandDto } from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import { type CacheRead, cacheKey } from '../../cache/cache.service';
import type { PrismaClient } from '../../generated/prisma/client';

// The tiles as the cache keeps them: a minute, purged with the searches; an
// empty list as a not-found answer.
export const tilesRead = (
  popular: PopularBrandsService,
  limit: number,
): CacheRead<BrandDto[]> => ({
  key: cacheKey('popular-brands', String(limit)),
  read: async () => {
    const tiles = await popular.tiles(limit);
    return { negative: tiles.length === 0, tags: ['search'], value: tiles };
  },
  soft: 60,
});

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
