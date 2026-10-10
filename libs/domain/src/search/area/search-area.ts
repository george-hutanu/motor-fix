import type { ListedGarageDto } from '@motor-fix/contracts';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import {
  SEARCH_RADIUS_DEFAULT_KM,
  type SearchPoint,
} from '@motor-fix/contracts/search-place';

import type { Prisma, PrismaClient } from '../../generated/prisma/client';

export interface InArea {
  distanceM: number;
  mobile: boolean;
}

// Haversine on a sphere of the Earth's mean radius: within a metre of the
// ellipsoid at these distances, and it needs no PostGIS extension. A fixed
// garage is in when within the search radius; a mobile mechanic when the
// place is inside the area it serves around its seat.
export async function garagesInArea(
  prisma: PrismaClient,
  { lat, lng }: SearchPoint,
): Promise<Map<string, InArea>> {
  const rows = await prisma.$queryRaw<
    { id: string; distance_m: number; mobile: boolean }[]
  >`
    SELECT id, distance_m, mobile FROM (
      SELECT
        id,
        business_kind IS NOT DISTINCT FROM 'mobile' AS mobile,
        service_radius_km,
        2 * 6371008.8 * asin(sqrt(
          power(sin(radians(latitude - ${lat}) / 2), 2)
          + cos(radians(${lat})) * cos(radians(latitude))
            * power(sin(radians(longitude - ${lng}) / 2), 2)
        )) AS distance_m
      FROM garage
      WHERE status = 'approved' AND latitude IS NOT NULL
    ) measured
    WHERE distance_m <= CASE
      WHEN mobile
        THEN COALESCE(service_radius_km, ${MOBILE_SERVICE_RADIUS_DEFAULT_KM}) * 1000
      ELSE ${SEARCH_RADIUS_DEFAULT_KM * 1000}
    END
  `;
  return new Map(
    rows.map((row) => [
      row.id,
      { distanceM: Number(row.distance_m), mobile: row.mobile },
    ]),
  );
}

// The garages that take the brand and the rest, in the area when there is one.
export function groupsOf(
  brandId: string,
  area: Map<string, InArea> | undefined,
): Record<'works_on' | 'other', Prisma.GarageWhereInput> {
  const inArea = area && { id: { in: [...area.keys()] } };
  const takers = { brandId, stance: 'works_on' as const };
  return {
    other: { brands: { none: takers }, ...inArea },
    works_on: { brands: { some: takers }, ...inArea },
  };
}

// A mobile mechanic's distance would tell where its seat is; it only says it
// comes to the place.
export function placed<T extends { id: string }>(
  item: T,
  area: Map<string, InArea> | undefined,
): T & Pick<ListedGarageDto, 'comesToYou' | 'distanceKm'> {
  const found = area?.get(item.id);
  if (!found) return item;
  return {
    ...item,
    comesToYou: found.mobile,
    distanceKm: found.mobile ? null : Math.round(found.distanceM / 100) / 10,
  };
}
