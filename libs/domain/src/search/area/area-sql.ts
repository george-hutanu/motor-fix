import {
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  RADIUS_KM,
  ROMANIA_BOUNDS,
} from '@motor-fix/contracts/place-section';
import {
  SEARCH_RADIUS_DEFAULT_KM,
  type SearchBbox,
  type SearchPoint,
} from '@motor-fix/contracts/search-place';

import type { Area } from './search-area';
import { Prisma } from '../../generated/prisma/client';

export interface AreaSql {
  // Metres from the place; NULL without a place or a garage position.
  distance: Prisma.Sql;
  fixedIn: Prisma.Sql;
  mobileIn: Prisma.Sql;
  // Metres from the place, else the box's centre, else Romania's: an order
  // of nearness, never shown as a distance.
  nearness: Prisma.Sql;
}

const ROMANIA_CENTRE: SearchPoint = {
  lat: (ROMANIA_BOUNDS.latMin + ROMANIA_BOUNDS.latMax) / 2,
  lng: (ROMANIA_BOUNDS.lngMin + ROMANIA_BOUNDS.lngMax) / 2,
};

const centreOf = ({ south, west, north, east }: SearchBbox): SearchPoint => ({
  lat: (south + north) / 2,
  lng: (west + east) / 2,
});

export const kmOf = (metres: number) => Math.round(metres / 100) / 10;

const at = ({ lat, lng }: SearchPoint) =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

// A distance runs from the place only; without one there is none. The order
// of nearness runs from the place, else the box's centre, else Romania's.
// Both are on the sphere of the Earth's mean radius (`false`), which the
// cards' rounded kilometres and the radius edge were always measured on. A mobile mechanic
// is in when the place is inside the area it serves around its seat,
// whatever the radius or box; with a box and no place there is no place to
// come to, so none is. A fixed garage is in when inside the box, else within
// the radius of the place. With neither, every garage with a position.
// No service radius is wider than the largest a mechanic can set, so that
// bound lets the position index find the mobile mechanics too.
export function areaSql({
  bbox,
  point,
  radiusKm = SEARCH_RADIUS_DEFAULT_KM,
}: Area): AreaSql {
  const from = at(point ?? (bbox ? centreOf(bbox) : ROMANIA_CENTRE));
  const nearness = Prisma.sql`ST_Distance(garage.position, ${from}, false)`;
  const distance = point ? nearness : Prisma.sql`NULL`;
  const fixedRule = bbox
    ? Prisma.sql`garage.latitude BETWEEN ${bbox.south} AND ${bbox.north}
        AND garage.longitude BETWEEN ${bbox.west} AND ${bbox.east}`
    : point
      ? Prisma.sql`ST_DWithin(garage.position, ${from}, ${radiusKm * 1000}, false)`
      : Prisma.sql`TRUE`;
  const mobileRule = point
    ? Prisma.sql`ST_DWithin(garage.position, ${from}, ${RADIUS_KM.max * 1000}, false)
        AND ${nearness} <= COALESCE(garage.service_radius_km, ${MOBILE_SERVICE_RADIUS_DEFAULT_KM}) * 1000`
    : bbox
      ? Prisma.sql`FALSE`
      : Prisma.sql`TRUE`;
  const fixedIn = Prisma.sql`(garage.business_kind IS DISTINCT FROM 'mobile'
    AND garage.position IS NOT NULL AND ${fixedRule})`;
  const mobileIn = Prisma.sql`(garage.business_kind = 'mobile'
    AND garage.position IS NOT NULL AND ${mobileRule})`;
  return { distance, fixedIn, mobileIn, nearness };
}

// The area's garages, public or not; TRUE with no area, so a read beside the
// public scope holds every garage, those with no position too.
export const within = (area?: Pick<AreaSql, 'fixedIn' | 'mobileIn'>) =>
  area ? Prisma.sql`(${area.fixedIn} OR ${area.mobileIn})` : Prisma.sql`TRUE`;
