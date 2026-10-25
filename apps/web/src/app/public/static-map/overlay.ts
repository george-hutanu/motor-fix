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
