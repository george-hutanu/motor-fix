// Where a search starts from. Browser-safe: the page rounds the point before
// it leaves, and the API reads it back the same way.

export const SEARCH_RADIUS_DEFAULT_KM = 25;
// About 100 m: one spot gives one request, so a cached answer is shared.
export const PLACE_DECIMALS = 3;

export interface SearchPoint {
  lat: number;
  lng: number;
}

const SCALE = 10 ** PLACE_DECIMALS;

export const roundCoordinate = (value: number) =>
  Math.round(value * SCALE) / SCALE;

export const nearOf = ({ lat, lng }: SearchPoint) =>
  `${roundCoordinate(lat)},${roundCoordinate(lng)}`;

export function parseNear(near?: string): SearchPoint | undefined {
  if (near === undefined) return undefined;
  const [lat, lng] = near.split(',').map(Number);
  return { lat: roundCoordinate(lat), lng: roundCoordinate(lng) };
}
