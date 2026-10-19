import {
  type HomeDto,
  type HomeGarageDto,
  nearOf,
  type SearchPoint,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { type CacheRead, cacheKey } from '../../cache/cache.service';
import { publicGarages } from '../../garages/public-garages/public-garages';
import type {
  GarageBrandStance,
  PrismaClient,
} from '../../generated/prisma/client';
import { type AreaSql, areaSql } from '../area/area-sql';
import { inAreaOf, placed } from '../area/search-area';
import {
  countGroups,
  type Group,
  groupPage,
  inOrder,
} from '../garage-search/garage-search.service';

const TAKERS_SHOWN = 2;
const PREVIEW_MAX = 3;

// The Home answer of a brand and place as the cache keeps it: a minute, and
// purged with the searches.
export const homeRead = (
  home: HomeService,
  slug: string,
  point?: SearchPoint,
): CacheRead<HomeDto> => ({
  key: cacheKey('home', slug, point ? nearOf(point) : '-'),
  read: async () => ({
    tags: ['search'],
    value: await home.forBrand(slug, point),
  }),
  soft: 60,
});

@Injectable()
export class HomeService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async forBrand(slug: string, point?: SearchPoint): Promise<HomeDto> {
    const brand = await this.prisma.brand.findFirst({
      select: { id: true, name: true, popularity: true, slug: true },
      where: { active: true, slug },
    });
    if (!brand) {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'no such brand');
    }
    // The dial and the preview read the search's order: the best rating,
    // unreviewed garages last, then more reviews, then name and id.
    const area = point && areaSql({ point });
    const [found, best, others] = await Promise.all([
      countGroups(this.prisma, brand.id, area),
      this.ranked(brand.id, 'works_on', area, TAKERS_SHOWN),
      this.ranked(brand.id, 'other', area, PREVIEW_MAX),
    ]);
    // A missing taker is never filled by a refuser: only with none at all
    // does the preview show up to three of the rest.
    const rest =
      best.length > 0 ? others.slice(0, PREVIEW_MAX - TAKERS_SHOWN) : others;
    const preview = [...best, ...rest];
    return {
      best: best.length > 0 ? preview[0] : null,
      brand,
      preview,
      takers: found.counts.worksOn,
      total: found.total,
    };
  }

  private async ranked(
    brandId: string,
    group: Group,
    area: AreaSql | undefined,
    take: number,
  ): Promise<HomeGarageDto[]> {
    const page = await groupPage(this.prisma, brandId, group, area, { take });
    const at = area && inAreaOf(page);
    const rows = await inOrder(page, (ids) => this.garages(ids));
    const named = (
      brands: (typeof rows)[number]['brands'],
      stance: GarageBrandStance,
    ) => brands.filter((b) => b.stance === stance).map((b) => b.brand.name);
    return rows.map((row) =>
      placed(
        {
          businessKind: row.businessKind,
          doesNotTake: named(row.brands, 'does_not_take'),
          id: row.id,
          labourFromLei:
            row.labourFromBani === null
              ? null
              : Math.round(row.labourFromBani / 100),
          name: row.name,
          rating: row.rating === null ? null : row.rating.toNumber(),
          reviewCount: row.reviewCount,
          slug: row.slug,
          stance:
            row.brands.find((b) => b.brandId === brandId)?.stance ?? 'unstated',
          worksOn: named(row.brands, 'works_on'),
          // A mobile mechanic's city would tell where its seat is.
          ...(row.businessKind !== 'mobile' &&
            row.cityName !== null && { city: row.cityName }),
          ...(row.businessKind === 'mobile' &&
            row.serviceRadiusKm !== null && {
              serviceRadiusKm: row.serviceRadiusKm,
            }),
        },
        at,
      ),
    );
  }

  // The garages of a page by their ids only.
  private garages(ids: string[]) {
    return this.prisma.garage.findMany({
      select: {
        brands: {
          orderBy: { brand: { name: 'asc' } },
          select: {
            brand: { select: { name: true } },
            brandId: true,
            stance: true,
          },
          // A brand retired from the catalogue is in neither list.
          where: { brand: { active: true } },
        },
        businessKind: true,
        cityName: true,
        id: true,
        labourFromBani: true,
        name: true,
        rating: true,
        reviewCount: true,
        serviceRadiusKm: true,
        slug: true,
      },
      where: { id: { in: ids }, ...publicGarages() },
    });
  }
}
