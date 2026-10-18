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
  Marker,
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

// What the map tells the page: where the driver left it, which garage a tap
// named (none for a tap away from every pin), and that it moved at all.
export interface MapEvents {
  moved(move: MapMove): void;
  picked(id: string | undefined): void;
  shifted(): void;
}

interface PinsMap {
  show(answer: GaragePinsDto | undefined): void;
  fit(place: LatLng | undefined, answer: GaragePinsDto | undefined): void;
  // Lights one garage's pin or circle amber, or none.
  light(id: string | undefined): void;
  // Where a place sits on the map, in pixels from its top left corner.
  spot(at: LatLng): { x: number; y: number };
  // Puts the "you are here" marker at the place, or takes it off.
  mark(place: LatLng | undefined): void;
}

// The part of MapLibre's marker the map moves.
export type PlaceMarker = Pick<Marker, 'addTo' | 'remove' | 'setLngLat'>;

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
  on: MapEvents,
  here: PlaceMarker,
): PinsMap {
  const look = getComputedStyle(host);
  const token = (name: string) => look.getPropertyValue(name).trim();
  const green = token('--mf-green');
  const red = token('--mf-red');
  const halo = token('--mf-panel');
  const ink = token('--mf-text');
  const amber = token('--mf-amber');
  const onAmber = token('--mf-on-amber');
  // The lit garage; '' matches no feature, so nothing is lit.
  let lit = '';
  const isLit = (): ExpressionSpecification => ['==', ['get', 'id'], lit];
  const single: FilterSpecification = ['!', ['has', 'point_count']];
  const litPin = (): FilterSpecification => [
    'all',
    ['!', ['has', 'point_count']],
    isLit(),
  ];
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
    // The lit circle: denser than a resting one, the map still showing
    // through, under the labels so its rate stays readable.
    {
      filter: isLit(),
      id: 'areas-lit-fill',
      paint: { 'fill-color': amber, 'fill-opacity': 0.3 },
      source: AREAS,
      type: 'fill',
    },
    {
      filter: isLit(),
      id: 'areas-lit-line',
      paint: { 'line-color': amber, 'line-width': 2.5 },
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
    // The lit pin, drawn again above every other one; a cluster never is.
    {
      filter: litPin(),
      id: 'pins-lit-dot',
      paint: {
        'circle-color': amber,
        'circle-radius': 8,
        'circle-stroke-color': halo,
        'circle-stroke-width': 2,
      },
      source: SOURCE,
      type: 'circle',
    },
    {
      filter: litPin(),
      id: 'pins-lit-rate',
      layout: {
        'text-anchor': 'left',
        'text-field': ['get', 'rate'],
        'text-font': FONT,
        'text-offset': [0.9, 0],
        'text-size': 12,
      },
      paint: {
        'text-color': onAmber,
        'text-halo-color': amber,
        'text-halo-width': 2,
      },
      source: SOURCE,
      type: 'symbol',
    },
  ];
  const lightLayers = [
    'areas-lit-fill',
    'areas-lit-line',
    'pins-lit-dot',
    'pins-lit-rate',
  ];
  const relight = () => {
    for (const id of lightLayers) {
      if (!map.getLayer(id)) continue;
      map.setFilter(id, id.startsWith('pins') ? litPin() : isLit());
    }
  };

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
    relight();
  };
  map.addSource(AREAS, { data: areasOf(undefined), type: 'geojson' });
  for (const layer of areaLayers) map.addLayer(layer);
  build(false);
  follow(map, on.moved);
  tappable(map, on);
  let marked = false;

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
    light(id) {
      lit = id ?? '';
      relight();
    },
    mark(place) {
      if (!place) {
        if (marked) here.remove();
        marked = false;
        return;
      }
      here.setLngLat([place.lng, place.lat]);
      if (!marked) here.addTo(map);
      marked = true;
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
    spot({ lat, lng }) {
      const { x, y } = map.project([lng, lat]);
      return { x, y };
    },
  };
}

// What a tap can name: a pin, a mobile mechanic's rate label, or a cluster,
// which zooms to where it splits as the page's own move, naming nothing.
const TAPPABLE = [
  'pins-lit-dot',
  'pins-lit-rate',
  'pins-dot',
  'pins-rate',
  'areas-rate',
  'pins-cluster',
];

function tappable(map: MapLibre, on: MapEvents) {
  const hit = (point: { x: number; y: number }) =>
    map.queryRenderedFeatures([point.x, point.y], {
      layers: TAPPABLE.filter((id) => map.getLayer(id)),
    })[0];
  map.on('click', async ({ point }) => {
    const feature = hit(point);
    const cluster = feature?.properties?.['cluster_id'];
    if (!feature || cluster === undefined) {
      const id = feature?.properties?.['id'];
      on.picked(id === undefined ? undefined : String(id));
      return;
    }
    const center = (feature.geometry as { coordinates: [number, number] })
      .coordinates;
    // The source may have been rebuilt meanwhile; the tap then does nothing.
    try {
      const source = map.getSource(SOURCE) as GeoJSONSource;
      const zoom = await source.getClusterExpansionZoom(Number(cluster));
      map.easeTo({ center, zoom });
    } catch {
      return;
    }
  });
  map.on('mousemove', ({ point }) => {
    map.getCanvas().style.cursor = hit(point) ? 'pointer' : '';
  });
  map.on('move', () => on.shifted());
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
