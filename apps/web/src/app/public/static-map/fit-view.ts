import {
  bucketFor,
  type LatLng,
  project,
  STATIC_MAP_ZOOM,
  snapCentre,
  unproject,
} from '@motor-fix/contracts/map-view';
import { ROMANIA_BOUNDS } from '@motor-fix/contracts/place-section';
import type { GaragePinsDto } from '@motor-fix/data-access';

import { START } from '../map-libre/map-libre';

// One view of a map: the static image shows it and the interactive map
// jumps to it, so the two never disagree.
export interface MapView {
  center: LatLng;
  zoom: number;
}

export interface Box {
  w: number;
  h: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// The room kept round the pins on every side.
export const FIT_PADDING = 40;
const MAX_ZOOM = 15;

// What a search's map frames: the place and every fixed garage; a mobile
// mechanic has no place of its own and is left out.
export const pointsOf = (
  place: LatLng | undefined,
  answer: GaragePinsDto | undefined,
): LatLng[] => [
  ...(place ? [place] : []),
  ...(answer?.pins ?? [])
    .filter((pin) => pin.serviceRadiusKm === undefined)
    .map(({ lat, lng }) => ({ lat, lng })),
];

export function boundsOf(points: LatLng[]): Bounds | undefined {
  if (points.length === 0) return undefined;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    east: Math.max(...lngs),
    north: Math.max(...lats),
    south: Math.min(...lats),
    west: Math.min(...lngs),
  };
}

// `covered` is how far up the map's bottom edge something lies, and
// `coveredTop` how far down its top edge, kept clear of every pin.
export const paddingOf = (covered = 0, coveredTop = 0): Padding => ({
  bottom: FIT_PADDING + covered,
  left: FIT_PADDING,
  right: FIT_PADDING,
  top: FIT_PADDING + coveredTop,
});

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// The view MapLibre's fitBounds would reach, at the whole zoom and the
// snapped centre the image service takes: the largest zoom at which the
// bounds fit the box less its padding, never past `maxZoom`, the centre
// moved off the bounds' middle by half the difference of opposite paddings.
export function fitView(
  bounds: Bounds | undefined,
  box: Box,
  padding: Padding,
  maxZoom = MAX_ZOOM,
): MapView {
  const bucket = bucketFor(box.w);
  if (!bounds) {
    const zoom = Math.floor(START.zoom);
    const [lng, lat] = START.center;
    return { center: snapCentre({ lat, lng }, zoom, bucket), zoom };
  }
  const nw = project({ lat: bounds.north, lng: bounds.west }, 0);
  const se = project({ lat: bounds.south, lng: bounds.east }, 0);
  const roomW = box.w - padding.left - padding.right;
  const roomH = box.h - padding.top - padding.bottom;
  const scale = Math.min(roomW / (se.x - nw.x), roomH / (se.y - nw.y));
  const wanted = roomW > 0 && roomH > 0 ? Math.log2(scale) : 0;
  const zoom = clamp(
    Math.floor(Math.min(wanted, maxZoom)),
    STATIC_MAP_ZOOM.min,
    STATIC_MAP_ZOOM.max,
  );
  const size = 2 ** zoom;
  const middle = unproject(
    {
      x: ((nw.x + se.x) / 2) * size - (padding.left - padding.right) / 2,
      y: ((nw.y + se.y) / 2) * size - (padding.top - padding.bottom) / 2,
    },
    zoom,
  );
  return { center: snapInside(middle, zoom, bucket), zoom };
}

const { latMax, latMin, lngMax, lngMin } = ROMANIA_BOUNDS;

// The grid point nearest the centre that lies inside Romania, where the
// image service takes a centre: a point snapped past an edge steps one grid
// cell back in.
function snapInside(centre: LatLng, zoom: number, bucket: number): LatLng {
  const inside = {
    lat: clamp(centre.lat, latMin, latMax),
    lng: clamp(centre.lng, lngMin, lngMax),
  };
  const snapped = snapCentre(inside, zoom, bucket);
  const step = bucket / 8;
  const p = project(snapped, zoom);
  const dx = snapped.lng < lngMin ? step : snapped.lng > lngMax ? -step : 0;
  const dy = snapped.lat < latMin ? -step : snapped.lat > latMax ? step : 0;
  if (dx === 0 && dy === 0) return snapped;
  return snapCentre(
    unproject({ x: p.x + dx, y: p.y + dy }, zoom),
    zoom,
    bucket,
  );
}
