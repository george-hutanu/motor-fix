import { type LatLng, project } from '@motor-fix/contracts/map-view';
import type { GaragePinDto, GaragePinsDto } from '@motor-fix/data-access';

import type { Box, MapView } from './fit-view';
import { span } from '../map-libre/map-libre';

// Past this many fixed pins, close ones are counted together, as the
// interactive map clusters them; the grid is the static map's own.
export const CLUSTER_ABOVE = 50;
export const CLUSTER_CELL = 48;

export interface Spot {
  x: number;
  y: number;
}

interface OverlayPin extends Spot {
  id: string;
  // False for a garage outside the driver's filters, drawn dimmed.
  matches: boolean;
  rate: string;
  takes: boolean;
}

interface OverlayCircle extends OverlayPin {
  r: number;
}

interface OverlayCluster extends Spot {
  count: number;
}

export interface Overlay {
  pins: OverlayPin[];
  clusters: OverlayCluster[];
  circles: OverlayCircle[];
  marker?: Spot;
}

// What the browser draws over the static image, in pixels from the map box's
// top left corner: the image is centred on the view's centre, so a point sits
// where its Web Mercator position lies from that centre.
export function overlayOf(
  answer: GaragePinsDto | undefined,
  place: LatLng | undefined,
  view: MapView,
  box: Box,
): Overlay {
  const centre = project(view.center, view.zoom);
  const spot = (at: LatLng): Spot => {
    const p = project(at, view.zoom);
    return { x: p.x - centre.x + box.w / 2, y: p.y - centre.y + box.h / 2 };
  };
  const pinOf = (pin: GaragePinDto): OverlayPin => ({
    ...spot(pin),
    id: pin.id,
    matches: pin.matches,
    rate: pin.rateLei === null ? '' : String(pin.rateLei),
    takes: pin.stance === 'works_on',
  });
  const all = answer?.pins ?? [];
  const fixed = all.filter((pin) => pin.serviceRadiusKm === undefined);
  const circles = all.flatMap((pin) => {
    if (pin.serviceRadiusKm === undefined) return [];
    const at = pinOf(pin);
    const edge = spot({
      lat: pin.lat + span(pin.lat, pin.serviceRadiusKm).dLat,
      lng: pin.lng,
    });
    return [{ ...at, r: at.y - edge.y }];
  });
  const crowded = fixed.length > CLUSTER_ABOVE;
  const drawn: Overlay = {
    circles,
    clusters: crowded ? clustersOf(fixed.map(spot)) : [],
    pins: crowded ? [] : fixed.map(pinOf),
  };
  if (place) drawn.marker = spot(place);
  return drawn;
}

function clustersOf(spots: Spot[]): OverlayCluster[] {
  const cells = new Map<string, OverlayCluster>();
  for (const { x, y } of spots) {
    const col = Math.floor(x / CLUSTER_CELL);
    const row = Math.floor(y / CLUSTER_CELL);
    const key = `${col}:${row}`;
    const cell = cells.get(key) ?? {
      count: 0,
      x: (col + 0.5) * CLUSTER_CELL,
      y: (row + 0.5) * CLUSTER_CELL,
    };
    cell.count += 1;
    cells.set(key, cell);
  }
  return [...cells.values()];
}

// A rate's box beside its dot (static-map.css): the dot's 14 px less the
// 7 px it is pulled left, the 4 px gap, then about 8 px a digit at the 12 px
// label size, 16 px tall about the pin's centre.
const RATE_FROM = 11;
const DIGIT = 8;
const HALF_LINE = 8;

// The pins and circles whose rate gives way to another's it would cover, as
// MapLibre lets no two labels overlap: the lit one's is placed first, then
// the pins' in order, then the circles'. A circle's rate sits centred on it.
// Their dots and circles stay.
export function quietLabels(
  pins: OverlayPin[],
  lit: string | undefined,
  circles: OverlayPin[] = [],
): Set<string> {
  const all = [
    ...pins.map((pin) => ({ ...pin, centred: false })),
    ...circles.map((circle) => ({ ...circle, centred: true })),
  ];
  const order = [
    ...all.filter((label) => label.id === lit),
    ...all.filter((label) => label.id !== lit),
  ];
  const placed: { left: number; right: number; top: number; bottom: number }[] =
    [];
  const quiet = new Set<string>();
  for (const label of order) {
    if (!label.rate) continue;
    const wide = DIGIT * label.rate.length;
    const left = label.centred ? label.x - wide / 2 : label.x + RATE_FROM;
    const box = {
      bottom: label.y + HALF_LINE,
      left,
      right: left + wide,
      top: label.y - HALF_LINE,
    };
    const meets = placed.some(
      (other) =>
        box.left < other.right &&
        other.left < box.right &&
        box.top < other.bottom &&
        other.top < box.bottom,
    );
    if (meets) quiet.add(label.id);
    else placed.push(box);
  }
  return quiet;
}
