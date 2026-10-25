import type { StaticMapTheme } from '@motor-fix/contracts/map-view';

// The colours of the provider's `liberty` (light) and `dark` styles, read from
// their style documents and flattened over the ground where a style fills with
// opacity, so the picture matches the interactive map without fetching a style.
export const PALETTES = {
  dark: {
    background: '#0c0c0c',
    grass: '#141414',
    major: '#323232',
    minor: '#181818',
    park: '#141414',
    path: '#1b1b1d',
    residential: '#0d0c0c',
    water: '#1b1b1d',
    wood: '#141414',
  },
  light: {
    background: '#f8f4f0',
    grass: '#e2ebd6',
    major: '#ffeeaa',
    minor: '#ffffff',
    park: '#e2ecd4',
    path: '#ffffff',
    residential: '#f5ece0',
    water: '#9ebdff',
    wood: '#e3efd4',
  },
} as const satisfies Record<StaticMapTheme, Record<string, string>>;

export type RoadGroup = 'major' | 'minor' | 'path';

// The road classes of the `openmaptiles` schema, in three widths.
export const ROAD_GROUPS: Record<string, RoadGroup> = {
  minor: 'minor',
  motorway: 'major',
  path: 'path',
  primary: 'major',
  secondary: 'minor',
  service: 'minor',
  tertiary: 'minor',
  track: 'path',
  trunk: 'major',
};

interface Curve {
  base: number;
  stops: readonly (readonly [zoom: number, px: number])[];
}

// Each style's exponential line-width curve, below its first stop nothing.
const WIDTHS: Record<StaticMapTheme, Record<RoadGroup, Curve>> = {
  dark: {
    major: {
      base: 1.3,
      stops: [
        [10, 2],
        [20, 20],
      ],
    },
    minor: {
      base: 1.55,
      stops: [
        [13, 1.8],
        [20, 20],
      ],
    },
    path: {
      base: 1.2,
      stops: [
        [15, 0.5],
        [20, 4],
      ],
    },
  },
  light: {
    major: {
      base: 1.2,
      stops: [
        [7, 1],
        [20, 18],
      ],
    },
    minor: {
      base: 1.2,
      stops: [
        [13.5, 0],
        [14, 2.5],
        [20, 18],
      ],
    },
    path: {
      base: 1.2,
      stops: [
        [15, 1],
        [20, 4],
      ],
    },
  },
};

// MapLibre's exponential interpolation between the two stops around `z`.
export function roadWidth(theme: StaticMapTheme, group: RoadGroup, z: number) {
  const { base, stops } = WIDTHS[theme][group];
  if (z < stops[0][0]) return 0;
  const upper = stops.findIndex(([zoom]) => zoom >= z);
  if (upper === -1) return stops[stops.length - 1][1];
  if (upper === 0) return stops[0][1];
  const [z0, w0] = stops[upper - 1];
  const [z1, w1] = stops[upper];
  const t = (base ** (z - z0) - 1) / (base ** (z1 - z0) - 1);
  return w0 + (w1 - w0) * t;
}
