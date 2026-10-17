import type { ListedGarageDto } from '@motor-fix/contracts';
import {
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  ROMANIA_BOUNDS,
} from '@motor-fix/contracts/place-section';
import {
  SEARCH_RADIUS_DEFAULT_KM,
  type SearchBbox,
  type SearchPoint,
} from '@motor-fix/contracts/search-place';

import { Prisma, type PrismaClient } from '../../generated/prisma/client';

export interface InArea {
  distanceM: number;
  lat: number;
  lng: number;
  mobile: boolean;
}

export interface AreaOf {
  point?: SearchPoint;
  radiusKm?: number;
  bbox?: SearchBbox;
}

const ROMANIA_CENTRE = {
  lat: (ROMANIA_BOUNDS.latMin + ROMANIA_BOUNDS.latMax) / 2,
  lng: (ROMANIA_BOUNDS.lngMin + ROMANIA_BOUNDS.lngMax) / 2,
};

const centreOf = ({ south, west, north, east }: SearchBbox) => ({
  lat: (south + north) / 2,
  lng: (west + east) / 2,
});

// Haversine on a sphere of the Earth's mean radius: within a metre of the
// ellipsoid at these distances, and it needs no PostGIS extension. Distances
// run from the place, else the box's centre, else Romania's. A mobile
// mechanic is in when the place is inside the area it serves around its
// seat, whatever the radius or box; with a box and no place there is no place
// to come to, so none is. A fixed garage is in when inside the box, else
// within the radius of the place. With neither, every garage with a position.
export async function garagesInArea(
  prisma: PrismaClient,
  { bbox, point, radiusKm = SEARCH_RADIUS_DEFAULT_KM }: AreaOf,
): Promise<Map<string, InArea>> {
  const { lat, lng } = point ?? (bbox ? centreOf(bbox) : ROMANIA_CENTRE);
  const mobileIn = point
    ? Prisma.sql`distance_m <= COALESCE(service_radius_km, ${MOBILE_SERVICE_RADIUS_DEFAULT_KM}) * 1000`
    : bbox
      ? Prisma.sql`FALSE`
      : Prisma.sql`TRUE`;
  const fixedIn = bbox
    ? Prisma.sql`latitude BETWEEN ${bbox.south} AND ${bbox.north}
        AND longitude BETWEEN ${bbox.west} AND ${bbox.east}`
    : point
      ? Prisma.sql`distance_m <= ${radiusKm * 1000}`
      : Prisma.sql`TRUE`;
  const rows = await prisma.$queryRaw<
    {
      id: string;
      distance_m: number;
      latitude: number;
      longitude: number;
      mobile: boolean;
    }[]
  >`
    SELECT id, distance_m, latitude, longitude, mobile FROM (
      SELECT
        id,
        latitude,
        longitude,
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
    WHERE CASE WHEN mobile THEN ${mobileIn} ELSE ${fixedIn} END
  `;
  return new Map(
    rows.map((row) => [
      row.id,
      {
        distanceM: Number(row.distance_m),
        lat: row.latitude,
        lng: row.longitude,
        mobile: row.mobile,
      },
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
