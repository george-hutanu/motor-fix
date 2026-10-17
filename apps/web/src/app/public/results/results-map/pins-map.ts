import { ROMANIA_BOUNDS } from '@motor-fix/contracts/place-section';
import {
  bboxOf,
  bboxSideKm,
  clampBbox,
  roundCoordinate,
  SEARCH_BBOX_MAX_KM,
} from '@motor-fix/contracts/search-place';
import type { GaragePinDto, GaragePinsDto } from '@motor-fix/data-access';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
  LayerSpecification,
  Map as MapLibre,
} from 'maplibre-gl';

import { type LatLng, ring, START } from '../../map-libre/map-libre';

// Past this many fixed pins, close ones merge into a counted cluster.
const CLUSTER_ABOVE = 50;
const SOURCE = 'pins';
const AREAS = 'areas';
const FIT = { animate: false, maxZoom: 15, padding: 40 };
const FONT = ['Noto Sans Bold'];
// How long the map stays still after the driver's move before it counts.
const SETTLE_MS = 400;

// Where the driver left the map: the box it shows, inside Romania, or too
// wide a box to ask about.
export type MapMove = { bbox: string } | { tooWide: true };

interface PinsMap {
  show(answer: GaragePinsDto | undefined): void;
  fit(place: LatLng | undefined, answer: GaragePinsDto | undefined): void;
}

// A mobile mechanic has no place of its own to pin; its area is drawn apart.
const fixedOf = (answer: GaragePinsDto | undefined) =>
  (answer?.pins ?? []).filter((pin) => pin.serviceRadiusKm === undefined);

const propertiesOf = (pin: GaragePinDto) => ({
  id: pin.id,
  rate: pin.rateLei === null ? '' : String(pin.rateLei),
  stance: pin.stance,
});

const collectionOf = (pins: GaragePinDto[]) => ({
  features: pins.map((pin) => ({
    geometry: { coordinates: [pin.lng, pin.lat], type: 'Point' as const },
    properties: propertiesOf(pin),
    type: 'Feature' as const,
  })),
  type: 'FeatureCollection' as const,
});

const areasOf = (answer: GaragePinsDto | undefined) => ({
  features: (answer?.pins ?? []).flatMap(({ serviceRadiusKm, ...pin }) =>
    serviceRadiusKm === undefined
      ? []
      : [
          {
            geometry: {
              coordinates: [ring(pin, serviceRadiusKm)],
              type: 'Polygon' as const,
            },
            properties: propertiesOf(pin),
            type: 'Feature' as const,
          },
        ],
  ),
  type: 'FeatureCollection' as const,
});

// The pins of a search on a map that has loaded, coloured like the cards'
// lamps: green for a garage that takes the brand, red for the rest.
export function drawPins(
  map: MapLibre,
  host: HTMLElement,
  moved: (move: MapMove) => void,
): PinsMap {
  const look = getComputedStyle(host);
  const token = (name: string) => look.getPropertyValue(name).trim();
  const green = token('--mf-green');
  const red = token('--mf-red');
  const halo = token('--mf-panel');
  const ink = token('--mf-text');
  const single: FilterSpecification = ['!', ['has', 'point_count']];
  const lamp: ExpressionSpecification = [
    'match',
    ['get', 'stance'],
    'works_on',
    green,
    red,
  ];
  // A mobile mechanic's area, under every pin; MapLibre sets a polygon's
  // label at its middle.
  const areaLayers: LayerSpecification[] = [
    {
      id: 'areas-fill',
      paint: { 'fill-color': lamp, 'fill-opacity': 0.12 },
      source: AREAS,
      type: 'fill',
    },
    {
      id: 'areas-line',
      paint: { 'line-color': lamp, 'line-width': 1.5 },
      source: AREAS,
      type: 'line',
    },
    {
      id: 'areas-rate',
      layout: {
        'text-field': ['get', 'rate'],
        'text-font': FONT,
        'text-size': 12,
      },
      paint: {
        'text-color': ink,
        'text-halo-color': halo,
        'text-halo-width': 1.5,
      },
      source: AREAS,
      type: 'symbol',
    },
  ];
  const layers: LayerSpecification[] = [
    {
      filter: ['has', 'point_count'],
      id: 'pins-cluster',
      paint: {
        'circle-color': green,
        'circle-radius': 14,
        'circle-stroke-color': halo,
        'circle-stroke-width': 2,
      },
      source: SOURCE,
      type: 'circle',
    },
    {
      filter: ['has', 'point_count'],
      id: 'pins-count',
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': FONT,
        'text-size': 12,
      },
      paint: { 'text-color': halo },
      source: SOURCE,
      type: 'symbol',
    },
    {
      filter: single,
      id: 'pins-dot',
      paint: {
        'circle-color': lamp,
        'circle-radius': 7,
        'circle-stroke-color': halo,
        'circle-stroke-width': 2,
      },
      source: SOURCE,
      type: 'circle',
    },
    {
      filter: single,
      id: 'pins-rate',
      layout: {
        'text-anchor': 'left',
        'text-field': ['get', 'rate'],
        'text-font': FONT,
        'text-offset': [0.9, 0],
        'text-size': 12,
      },
      paint: {
        'text-color': ink,
        'text-halo-color': halo,
        'text-halo-width': 1.5,
      },
      source: SOURCE,
      type: 'symbol',
    },
  ];

  let clustered = false;
  const drop = () => {
    for (const { id } of layers) if (map.getLayer(id)) map.removeLayer(id);
    map.removeSource(SOURCE);
  };
  // MapLibre fixes a source's clustering when it is added, so a change of
  // mode builds the source and its layers again.
  const build = (cluster: boolean) => {
    const source: GeoJSONSourceSpecification = cluster
      ? { cluster, clusterRadius: 48, data: collectionOf([]), type: 'geojson' }
      : { cluster, data: collectionOf([]), type: 'geojson' };
    map.addSource(SOURCE, source);
    for (const layer of layers) map.addLayer(layer);
    clustered = cluster;
  };
  map.addSource(AREAS, { data: areasOf(undefined), type: 'geojson' });
  for (const layer of areaLayers) map.addLayer(layer);
  build(false);
  follow(map, moved);

  return {
    fit(place, answer) {
      const points = [
        ...(place ? [place] : []),
        ...fixedOf(answer).map(({ lat, lng }) => ({ lat, lng })),
      ];
      if (points.length === 0) {
        map.jumpTo(START);
        return;
      }
      const lats = points.map((p) => p.lat);
      const lngs = points.map((p) => p.lng);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        FIT,
      );
    },
    show(answer) {
      const fixed = fixedOf(answer);
      const cluster = fixed.length > CLUSTER_ABOVE;
      if (cluster !== clustered) {
        drop();
        build(cluster);
      }
      (map.getSource(SOURCE) as GeoJSONSource).setData(collectionOf(fixed));
      (map.getSource(AREAS) as GeoJSONSource).setData(areasOf(answer));
    },
  };
}

// Only a move by the driver carries the input event that made it; the page's
// own fit has none, and any new move restarts the wait.
function follow(map: MapLibre, moved: (move: MapMove) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Read to three decimals as the API reads it, so a box too small to
  // survive the rounding is empty too.
  const settled = () => {
    const shown = map.getBounds();
    const box = clampBbox(
      {
        east: roundCoordinate(shown.getEast()),
        north: roundCoordinate(shown.getNorth()),
        south: roundCoordinate(shown.getSouth()),
        west: roundCoordinate(shown.getWest()),
      },
      ROMANIA_BOUNDS,
    );
    if (!box) return;
    moved(
      bboxSideKm(box) > SEARCH_BBOX_MAX_KM
        ? { tooWide: true }
        : { bbox: bboxOf(box) },
    );
  };
  map.on('movestart', () => clearTimeout(timer));
  map.on('moveend', ({ originalEvent }) => {
    if (!originalEvent) return;
    clearTimeout(timer);
    timer = setTimeout(settled, SETTLE_MS);
  });
  map.on('remove', () => clearTimeout(timer));
}
