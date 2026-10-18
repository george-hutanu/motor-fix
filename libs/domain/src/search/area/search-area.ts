import type { ListedGarageDto } from '@motor-fix/contracts';
import type {
  SearchBbox,
  SearchPoint,
} from '@motor-fix/contracts/search-place';

import { kmOf } from './area-sql';

interface InArea {
  distanceM: number | null;
  lat: number;
  lng: number;
  mobile: boolean;
}

export interface Area {
  point?: SearchPoint;
  radiusKm?: number;
  bbox?: SearchBbox;
}

// A row an area read returned, as the garage's place in that area.
export interface AreaRow {
  id: string;
  distance_m: number | null;
  latitude: number;
  longitude: number;
  mobile: boolean;
}

export const inAreaOf = (rows: AreaRow[]): Map<string, InArea> =>
  new Map(
    rows.map((row) => [
      row.id,
      {
        distanceM: row.distance_m === null ? null : Number(row.distance_m),
        lat: row.latitude,
        lng: row.longitude,
        mobile: row.mobile,
      },
    ]),
  );

// A mobile mechanic's distance would tell where its seat is; it only says it
// comes to the place. Without a place there is no distance.
export function placed<T extends { id: string }>(
  item: T,
  area: Map<string, InArea> | undefined,
): T & Pick<ListedGarageDto, 'comesToYou' | 'distanceKm'> {
  const found = area?.get(item.id);
  if (!found) return item;
  return {
    ...item,
    comesToYou: found.mobile,
    distanceKm:
      found.mobile || found.distanceM === null ? null : kmOf(found.distanceM),
  };
}
