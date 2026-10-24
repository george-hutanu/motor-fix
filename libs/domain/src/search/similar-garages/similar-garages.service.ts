import type {
  BrandRefDto,
  SimilarGarageDto,
  SimilarGaragesDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { recordSimilarGarages } from './similar-garages.metrics';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import type { PrismaClient } from '../../generated/prisma/client';
import { areaSql } from '../area/area-sql';
import {
  brandOf,
  groupPage,
  listedCards,
} from '../garage-search/garage-search.service';

const SIMILAR_MAX = 3;

// The garages a link to a garage no longer listed offers instead: approved
// ones that work on the brand around where it stood, as the search finds
// them (25 km for a fixed garage, its own area for a mobile mechanic), in the
// search's order. Only a suspended garage was listed and is no longer; every
// other slug is not found, as its profile is. Nothing is cached or written.
@Injectable()
export class SimilarGaragesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async forGarage(
    slug: string,
    brandSlug?: string,
  ): Promise<SimilarGaragesDto> {
    const gone = await this.prisma.garage.findUnique({
      select: {
        brands: { select: { brandId: true }, where: { stance: 'works_on' } },
        latitude: true,
        longitude: true,
        status: true,
      },
      where: { slug },
    });
    if (gone?.status !== 'suspended') {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found');
    }
    const brand =
      brandSlug === undefined
        ? null
        : await brandOf(this.prisma, { slug: brandSlug });
    const wanted = brand ? [brand.id] : gone.brands.map((row) => row.brandId);
    const items =
      gone.latitude === null || gone.longitude === null || wanted.length === 0
        ? []
        : await this.around(
            { lat: gone.latitude, lng: gone.longitude },
            wanted,
          );
    recordSimilarGarages(items.length > 0 ? 'results' : 'none');
    return { brand, items };
  }

  // Each card is drawn for the first of the wanted brands it works on, in
  // the catalogue's order, which is the order of its own works-on list.
  private async around(
    point: { lat: number; lng: number },
    wanted: string[],
  ): Promise<SimilarGarageDto[]> {
    const area = areaSql({ point });
    const rows = await groupPage(this.prisma, wanted, 'works_on', area, {
      take: SIMILAR_MAX,
    });
    const shared = (worksOn: BrandRefDto[]) =>
      worksOn.find((brand) => wanted.includes(brand.id));
    const cards = await listedCards(
      this.prisma,
      rows,
      area,
      (worksOn) => shared(worksOn)?.id ?? wanted[0],
    );
    return cards.flatMap((card) => {
      const brand = shared(card.worksOn);
      return brand ? [{ ...card, brand }] : [];
    });
  }
}
