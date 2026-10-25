// One view of the map as a static image: the API renders it and the page
// draws its pins over it, so both sides compute it here. Browser-safe.

// The widths and heights an image may have: a page takes the smallest at or
// above its map box, so a handful of sizes serve every screen.
export const STATIC_MAP_SIZES = [320, 390, 480, 640, 768, 1024, 1280] as const;
export type StaticMapSize = (typeof STATIC_MAP_SIZES)[number];
export const STATIC_MAP_MAX = { h: 1024, w: 1280 } as const;
export const STATIC_MAP_ZOOM = { max: 16, min: 5 } as const;
export const STATIC_MAP_THEMES = ['light', 'dark'] as const;
export type StaticMapTheme = (typeof STATIC_MAP_THEMES)[number];

export interface LatLng {
  lat: number;
  lng: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface StaticMapView extends LatLng {
  theme: StaticMapTheme;
  z: number;
  w: number;
  h: number;
}

// MapLibre's world: 512 pixels across at zoom 0, so a point projected here
// lands where the interactive map draws it at the same centre and zoom.
export const WORLD = 512;
export const worldSize = (z: number) => WORLD * 2 ** z;

export function project({ lat, lng }: LatLng, z: number): WorldPoint {
  const size = worldSize(z);
  const phi = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
}

export function unproject({ x, y }: WorldPoint, z: number): LatLng {
  const size = worldSize(z);
  const n = Math.PI * (1 - (2 * y) / size);
  return {
    lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    lng: (x / size) * 360 - 180,
  };
}

const DECIMALS = 1e5;
const rounded = (value: number) => Math.round(value * DECIMALS) / DECIMALS;

// The nearest point of a grid one eighth of the image wide: searches a few
// hundred metres apart share one image. Five decimals, about a metre, keep
// a snapped centre where it is when snapped again.
export function snapCentre(centre: LatLng, z: number, w: number): LatLng {
  const step = w / 8;
  const p = project(centre, z);
  const snapped = unproject(
    { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step },
    z,
  );
  return { lat: rounded(snapped.lat), lng: rounded(snapped.lng) };
}

export function bucketFor(px: number, side: 'w' | 'h' = 'w'): StaticMapSize {
  const max = STATIC_MAP_MAX[side];
  const found = STATIC_MAP_SIZES.find((size) => size >= px && size <= max);
  return found ?? (max as StaticMapSize);
}

export const staticMapPath = ({ theme, z, lat, lng, w, h }: StaticMapView) =>
  `/api/v1/maps/static?theme=${theme}&z=${z}&lat=${lat}&lng=${lng}&w=${w}&h=${h}`;
