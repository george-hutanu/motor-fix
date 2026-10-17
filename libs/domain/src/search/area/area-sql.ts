import {
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  ROMANIA_BOUNDS,
} from '@motor-fix/contracts/place-section';
import {
  SEARCH_RADIUS_DEFAULT_KM,
  type SearchBbox,
  type SearchPoint,
} from '@motor-fix/contracts/search-place';

import type { Area } from './search-area';
import { publicGaragesSql } from '../../garages/public-garages/public-garages';
import { Prisma } from '../../generated/prisma/client';

export interface AreaSql {
  // Metres from the measured point; NULL for a garage without a position.
  distance: Prisma.Sql;
  fixedIn: Prisma.Sql;
  mobileIn: Prisma.Sql;
  // The public scope and the area, for the WHERE of a read on `garage`.
  where: Prisma.Sql;
}

export const ROMANIA_CENTRE: SearchPoint = {
  lat: (ROMANIA_BOUNDS.latMin + ROMANIA_BOUNDS.latMax) / 2,
  lng: (ROMANIA_BOUNDS.lngMin + ROMANIA_BOUNDS.lngMax) / 2,
};

export const centreOf = ({
  south,
  west,
  north,
  east,
}: SearchBbox): SearchPoint => ({
  lat: (south + north) / 2,
  lng: (west + east) / 2,
});

export const kmOf = (metres: number) => Math.round(metres / 100) / 10;

const at = ({ lat, lng }: SearchPoint) =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

// Distances run from the place, else the box's centre, else Romania's, on
// the sphere of the Earth's mean radius (`false`), which the cards' rounded
// kilometres and the radius edge were always measured on. A mobile mechanic
// is in when the place is inside the area it serves around its seat,
// whatever the radius or box; with a box and no place there is no place to
// come to, so none is. A fixed garage is in when inside the box, else within
// the radius of the place. With neither, every garage with a position.
export function areaSql({
  bbox,
  point,
  radiusKm = SEARCH_RADIUS_DEFAULT_KM,
}: Area): AreaSql {
  const from = at(point ?? (bbox ? centreOf(bbox) : ROMANIA_CENTRE));
  const distance = Prisma.sql`ST_Distance(garage.position, ${from}, false)`;
  const fixedRule = bbox
    ? Prisma.sql`garage.latitude BETWEEN ${bbox.south} AND ${bbox.north}
        AND garage.longitude BETWEEN ${bbox.west} AND ${bbox.east}`
    : point
      ? Prisma.sql`ST_DWithin(garage.position, ${from}, ${radiusKm * 1000}, false)`
      : Prisma.sql`TRUE`;
  const mobileRule = point
    ? Prisma.sql`${distance} <= COALESCE(garage.service_radius_km, ${MOBILE_SERVICE_RADIUS_DEFAULT_KM}) * 1000`
    : bbox
      ? Prisma.sql`FALSE`
      : Prisma.sql`TRUE`;
  const fixedIn = Prisma.sql`(garage.business_kind IS DISTINCT FROM 'mobile'
    AND garage.position IS NOT NULL AND ${fixedRule})`;
  const mobileIn = Prisma.sql`(garage.business_kind = 'mobile'
    AND garage.position IS NOT NULL AND ${mobileRule})`;
  return {
    distance,
    fixedIn,
    mobileIn,
    where: Prisma.sql`${publicGaragesSql} AND (${fixedIn} OR ${mobileIn})`,
  };
}
