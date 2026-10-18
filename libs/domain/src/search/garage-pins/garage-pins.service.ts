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
import type {
  GarageBrandStance,
  PrismaClient,
} from '../../generated/prisma/client';
import { areaSql } from '../area/area-sql';
import type { AreaRow } from '../area/search-area';
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
    // With neither a place nor a box the count reads no area, and the pins
    // are the nearest garages to the middle of Romania.
    const placed = Boolean(point || bbox);
    const area = areaSql({ bbox, point, radiusKm });
    const [found, rows] = await Promise.all([
      countGroups(this.prisma, brandId, placed ? area : undefined),
      this.prisma.$queryRaw<
        (AreaRow & {
          labour_from_bani: number | null;
          service_radius_km: number | null;
          stance: GarageBrandStance | null;
        })[]
      >`
        SELECT
          garage.id,
          ${area.distance} AS distance_m,
          garage.latitude,
          garage.longitude,
          garage.business_kind IS NOT DISTINCT FROM 'mobile' AS mobile,
          garage.labour_from_bani,
          garage.service_radius_km,
          (SELECT gb.stance::text FROM garage_brand gb
            WHERE gb.garage_id = garage.id AND gb.brand_id = ${brandId}::uuid
          ) AS stance
        FROM garage
        WHERE ${area.where}
        ORDER BY distance_m, garage.id
        LIMIT ${SEARCH_PINS_MAX}`,
    ]);
    const pins = rows.map((row): GaragePinDto => {
      const pin = {
        id: row.id,
        rateLei:
          row.labour_from_bani === null
            ? null
            : Math.round(row.labour_from_bani / 100),
        stance: row.stance ?? ('unstated' as const),
      };
      return row.mobile
        ? {
            ...pin,
            lat: roughly(row.latitude),
            lng: roughly(row.longitude),
            serviceRadiusKm:
              row.service_radius_km ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM,
          }
        : { ...pin, lat: row.latitude, lng: row.longitude };
    });
    return { pins, total: found.total };
  }
}
