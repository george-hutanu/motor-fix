import type { HomeDto, HomeGarageDto, SearchPoint } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { publicGarages } from '../../garages/public-garages/public-garages';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { garagesInArea, groupsOf, placed } from '../area/search-area';

// The one order of the dial and the preview: the best rating, unreviewed
// garages last, then more reviews, then name and id so a tie never moves.
const BEST_FIRST: Prisma.GarageOrderByWithRelationInput[] = [
  { rating: { nulls: 'last', sort: 'desc' } },
  { reviewCount: 'desc' },
  { name: 'asc' },
  { id: 'asc' },
];

const TAKERS_SHOWN = 2;
const PREVIEW_MAX = 3;

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
    const area = point && (await garagesInArea(this.prisma, point));
    const groups = groupsOf(brand.id, area);
    const inArea = area && { id: { in: [...area.keys()] } };
    const [total, takers, best, others] = await Promise.all([
      this.prisma.garage.count({ where: { ...publicGarages(), ...inArea } }),
      this.prisma.garage.count({
        where: { ...publicGarages(), ...groups.works_on },
      }),
      this.ranked(brand.id, groups.works_on, TAKERS_SHOWN),
      this.ranked(brand.id, groups.other, PREVIEW_MAX),
    ]);
    // A missing taker is never filled by a refuser: only with none at all
    // does the preview show up to three of the rest.
    const rest =
      best.length > 0 ? others.slice(0, PREVIEW_MAX - TAKERS_SHOWN) : others;
    const preview = [...best, ...rest].map((garage) => placed(garage, area));
    return {
      best: best.length > 0 ? preview[0] : null,
      brand,
      preview,
      takers,
      total,
    };
  }

  private async ranked(
    brandId: string,
    group: Prisma.GarageWhereInput,
    take: number,
  ): Promise<HomeGarageDto[]> {
    const rows = await this.prisma.garage.findMany({
      orderBy: BEST_FIRST,
      select: {
        brands: { select: { stance: true }, where: { brandId } },
        businessKind: true,
        cityName: true,
        id: true,
        labourFromBani: true,
        name: true,
        rating: true,
        reviewCount: true,
        slug: true,
      },
      take,
      where: { ...publicGarages(), ...group },
    });
    return rows.map((row) => ({
      businessKind: row.businessKind,
      id: row.id,
      labourFromLei:
        row.labourFromBani === null
          ? null
          : Math.round(row.labourFromBani / 100),
      name: row.name,
      rating: row.rating === null ? null : row.rating.toNumber(),
      reviewCount: row.reviewCount,
      slug: row.slug,
      stance: row.brands[0]?.stance ?? 'unstated',
      // A mobile mechanic's city would tell where its seat is.
      ...(row.businessKind !== 'mobile' &&
        row.cityName !== null && { city: row.cityName }),
    }));
  }
}
