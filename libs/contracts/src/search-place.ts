// Where a search starts from. Browser-safe: the page rounds the point before
// it leaves, and the API reads it back the same way.

export const SEARCH_RADIUS_DEFAULT_KM = 25;
// The areas a search may cover, in km; the wider one is offered once when the
// default finds nothing.
export const SEARCH_RADII = [SEARCH_RADIUS_DEFAULT_KM, 50] as const;
export type SearchRadius = (typeof SEARCH_RADII)[number];

// The orders a list of results can take; rating is the order with none named.
export const SEARCH_SORTS = ['rating', 'distance', 'price'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

// The filters a list of results can narrow by: the hourly rate a card shows,
// at most, in whole lei; the rating, at least, as the garage table holds it;
// card payment.
export const SEARCH_PRICE_CEILINGS = [150, 200, 250, 300] as const;
export type SearchPriceCeiling = (typeof SEARCH_PRICE_CEILINGS)[number];
export const SEARCH_MIN_RATINGS = ['3.5', '4.0', '4.5'] as const;
export type SearchMinRating = (typeof SEARCH_MIN_RATINGS)[number];

export interface SearchFilters {
  card?: true;
  maxPrice?: SearchPriceCeiling;
  minRating?: SearchMinRating;
}

// The filters a validated query sets, by their names in the address bar.
export const filtersOf = (query: {
  card?: '1';
  max_price?: SearchPriceCeiling;
  min_rating?: SearchMinRating;
}): SearchFilters => ({
  ...(query.max_price !== undefined && { maxPrice: query.max_price }),
  ...(query.min_rating !== undefined && { minRating: query.min_rating }),
  ...(query.card === '1' && { card: true }),
});

// One text per combination, for a cache key and a cursor; none without a
// filter, so an unfiltered search keeps its key and its cursors.
export function filtersKey(filters: SearchFilters = {}): string | undefined {
  const { card, maxPrice, minRating } = filters;
  if (!card && maxPrice === undefined && minRating === undefined) {
    return undefined;
  }
  return `${maxPrice ?? ''},${minRating ?? ''},${card ? '1' : ''}`;
}

// The garages one page of results shows.
export const SEARCH_PAGE_SIZE = 20;
// The garages a live re-read or stream names: one page's worth.
export const SEARCH_IDS_MAX = SEARCH_PAGE_SIZE;
// About 100 m: one spot gives one request, so a cached answer is shared.
const PLACE_DECIMALS = 3;

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

// The pins one answer carries, nearest first; the total still counts them all.
export const SEARCH_PINS_MAX = 500;
// The widest side of the visible area the map may ask about.
export const SEARCH_BBOX_MAX_KM = 100;

export interface SearchBbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;
const EARTH_KM = 6371.0088;
const KM_PER_DEGREE_LAT = 111.32;

export function parseBbox(text: string): SearchBbox | undefined {
  const parts = text.split(',');
  if (parts.length !== 4 || !parts.every((part) => DECIMAL.test(part))) {
    return undefined;
  }
  const [south, west, north, east] = parts.map((part) =>
    roundCoordinate(Number(part)),
  );
  return { east, north, south, west };
}

export const bboxOf = ({ south, west, north, east }: SearchBbox) =>
  [south, west, north, east].map(roundCoordinate).join(',');

export function bboxSideKm({ south, west, north, east }: SearchBbox) {
  const halfSpan = (((east - west) / 2) * Math.PI) / 180;
  const width =
    2 *
    EARTH_KM *
    Math.asin(Math.cos((south * Math.PI) / 180) * Math.sin(halfSpan));
  return Math.max(width, (north - south) * KM_PER_DEGREE_LAT);
}

export function clampBbox(
  box: SearchBbox,
  bounds: { latMin: number; latMax: number; lngMin: number; lngMax: number },
): SearchBbox | undefined {
  const clamped = {
    east: Math.min(box.east, bounds.lngMax),
    north: Math.min(box.north, bounds.latMax),
    south: Math.max(box.south, bounds.latMin),
    west: Math.max(box.west, bounds.lngMin),
  };
  return clamped.south < clamped.north && clamped.west < clamped.east
    ? clamped
    : undefined;
}
