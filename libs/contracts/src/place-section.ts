// Where a garage is: the address, the pin and, for a mobile mechanic, the
// radius it works in. The draft guard, the listing form, the address look-up
// and the write at submit all read these rules. Browser-safe.

export const ADDRESS_MAX = 200;
export const PLACE_SEARCH_MIN = 3;
// Street level: close enough to put the pin on the right gate.
export const PLACE_ZOOM = 16;
export const RADIUS_KM = { default: 20, max: 100, min: 1 } as const;
export const MOBILE_SERVICE_RADIUS_DEFAULT_KM = RADIUS_KM.default;

// One box around the country, not its border: the admin's address check
// catches the few kilometres of a neighbour it lets through.
export const ROMANIA_BOUNDS = {
  latMax: 48.4,
  latMin: 43.5,
  lngMax: 29.8,
  lngMin: 20.2,
} as const;

export interface PlaceSection {
  address?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

const KEYS = ['address', 'lat', 'lng', 'radiusKm'];

export const inRomania = (lat: number, lng: number) =>
  lat >= ROMANIA_BOUNDS.latMin &&
  lat <= ROMANIA_BOUNDS.latMax &&
  lng >= ROMANIA_BOUNDS.lngMin &&
  lng <= ROMANIA_BOUNDS.lngMax;

export const radiusAllowed = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= RADIUS_KM.min &&
  (value as number) <= RADIUS_KM.max;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Shape only, so a half-given place is kept; a position is both or neither.
export function isPlaceSection(value: unknown): value is PlaceSection {
  if (!isRecord(value)) return false;
  const { address, lat, lng, radiusKm } = value;
  return (
    Object.keys(value).every((key) => KEYS.includes(key)) &&
    (address === undefined ||
      (typeof address === 'string' && address.length <= ADDRESS_MAX)) &&
    (lat === undefined) === (lng === undefined) &&
    (lat === undefined || Number.isFinite(lat)) &&
    (lng === undefined || Number.isFinite(lng)) &&
    (radiusKm === undefined || radiusAllowed(radiusKm))
  );
}

export const placeComplete = ({ address, lat, lng }: PlaceSection) =>
  !!address?.trim() &&
  lat !== undefined &&
  lng !== undefined &&
  inRomania(lat, lng);
