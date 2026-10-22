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

const TILE = {
  id: true,
  name: true,
  popularity: true,
  roPossessive: true,
  slug: true,
} as const;

@Injectable()
export class PopularBrandsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // A driver's own cars' brands come first, oldest car first, then the
  // popular ones they leave room for.
  async tiles(limit: number, ownerId?: string): Promise<BrandDto[]> {
    const cars = ownerId
      ? await this.prisma.car.findMany({
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { brand: { select: TILE } },
          where: { brand: { active: true }, ownerId, removedAt: null },
        })
      : [];
    const own = [
      ...new Map(cars.map(({ brand }) => [brand.id, brand])).values(),
    ].slice(0, limit);
    if (own.length === limit) return own;
    const popular = await this.prisma.brand.findMany({
      orderBy: [
        { popularity: { nulls: 'last', sort: 'asc' } },
        { name: 'asc' },
      ],
      select: TILE,
      take: limit - own.length,
      where: { active: true, id: { notIn: own.map((brand) => brand.id) } },
    });
    return [...own, ...popular];
  }
}
