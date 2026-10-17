import {
  bboxOf,
  type GaragePinDto,
  type GaragePinsDto,
  nearOf,
  SEARCH_PINS_MAX,
  type SearchBbox,
  type SearchPoint,
} from '@motor-fix/contracts';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import { Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import { publicGarages } from '../../garages/public-garages/public-garages';
import type { PrismaClient } from '../../generated/prisma/client';
import { garagesInArea, groupsOf } from '../area/search-area';
import { GarageSearchCache } from '../garage-search/garage-search.cache';
import { recordSearchPins } from '../garage-search/garage-search.metrics';
import {
  type BrandKey,
  brandOf,
  countGroups,
} from '../garage-search/garage-search.service';

// Two decimals, about a kilometre: a mobile mechanic's pin stands near its
// area's centre without giving away the seat's address.
const roughly = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class GaragePinsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly cache: GarageSearchCache,
  ) {}

  // Every garage of the search with a position, nearest first, and the total
  // its list counts. With a box the radius plays no part, so it is not in the
  // key either.
  async forBrand(
    key: BrandKey,
    point?: SearchPoint,
    radiusKm?: number,
    bbox?: SearchBbox,
  ): Promise<GaragePinsDto> {
    const brand = await brandOf(this.prisma, key);
    const answer = await this.cache.entry(
      {
        bbox: bbox && bboxOf(bbox),
        brandId: brand.id,
        kind: 'pins',
        near: point && nearOf(point),
        radiusKm: bbox ? undefined : radiusKm,
      },
      () => this.pinned(brand.id, point, radiusKm, bbox),
    );
    recordSearchPins(
      answer.total > 0 ? 'results' : 'none',
      bbox ? 'bbox' : 'area',
    );
    return answer;
  }

  private async pinned(
    brandId: string,
    point?: SearchPoint,
    radiusKm?: number,
    bbox?: SearchBbox,
  ): Promise<GaragePinsDto> {
    const area = await garagesInArea(this.prisma, { bbox, point, radiusKm });
    const [found, rows] = await Promise.all([
      countGroups(
        this.prisma,
        groupsOf(brandId, point || bbox ? area : undefined),
      ),
      this.prisma.garage.findMany({
        select: {
          brands: { select: { stance: true }, where: { brandId } },
          id: true,
          labourFromBani: true,
          serviceRadiusKm: true,
        },
        where: { ...publicGarages(), id: { in: [...area.keys()] } },
      }),
    ]);
    const pins = rows
      .flatMap((row) => {
        const at = area.get(row.id);
        return at ? [{ at, row }] : [];
      })
      .sort((a, b) => a.at.distanceM - b.at.distanceM)
      .slice(0, SEARCH_PINS_MAX)
      .map(({ at, row }): GaragePinDto => {
        const pin = {
          id: row.id,
          rateLei:
            row.labourFromBani === null
              ? null
              : Math.round(row.labourFromBani / 100),
          stance: row.brands[0]?.stance ?? 'unstated',
        };
        return at.mobile
          ? {
              ...pin,
              lat: roughly(at.lat),
              lng: roughly(at.lng),
              serviceRadiusKm:
                row.serviceRadiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM,
            }
          : { ...pin, lat: at.lat, lng: at.lng };
      });
    return { pins, total: found.total };
  }
}
