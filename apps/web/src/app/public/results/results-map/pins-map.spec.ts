import type { GaragePinDto, GaragePinsDto } from '@motor-fix/data-access';
import type { Map as MapLibre, Marker } from 'maplibre-gl';

import { drawPins } from './pins-map';
import { ring } from '../../map-libre/map-libre';

const GREEN = 'rgb(0, 128, 0)';
const RED = 'rgb(200, 0, 0)';
const AMBER = 'rgb(255, 176, 0)';
const ON_AMBER = 'rgb(11, 12, 14)';
const PLACE = { lat: 44.437, lng: 26.117 };

const pinOf = (n: number, over: Partial<GaragePinDto> = {}): GaragePinDto => ({
  id: `g-${n}`,
  lat: 44.4 + n / 1000,
  lng: 26.1 + n / 1000,
  rateLei: 150,
  stance: 'works_on',
  ...over,
});
const answer = (pins: GaragePinDto[]): GaragePinsDto => ({
  pins,
  total: pins.length,
});

type Source = { setData: jest.Mock; getClusterExpansionZoom: jest.Mock };
type Hit = {
  geometry?: { coordinates: number[] };
  properties: Record<string, unknown>;
};
function mapFake() {
  const sources = new Map<string, Source>();
  const canvas = document.createElement('canvas');
  return {
    addLayer: jest.fn(),
    addSource: jest.fn((id: string, _spec: { cluster?: boolean }) => {
      sources.set(id, {
        getClusterExpansionZoom: jest.fn(async () => 13),
        setData: jest.fn(),
      });
    }),
    easeTo: jest.fn(),
    fitBounds: jest.fn(),
    getBounds: jest.fn(() => ({
      getEast: () => shown.east,
      getNorth: () => shown.north,
      getSouth: () => shown.south,
      getWest: () => shown.west,
    })),
    getCanvas: () => canvas,
    getLayer: jest.fn(() => ({})),
    getSource: jest.fn((id: string) => sources.get(id)),
    jumpTo: jest.fn(),
    on: jest.fn(),
    project: jest.fn(([lng, lat]: [number, number]) => ({
      x: lng * 10,
      y: lat * 10,
    })),
    queryRenderedFeatures: jest.fn((): Hit[] => []),
    removeLayer: jest.fn(),
    removeSource: jest.fn((id: string) => sources.delete(id)),
    setFilter: jest.fn(),
    sources,
  };
}

let map: ReturnType<typeof mapFake>;
let host: HTMLElement;
let shown = { east: 26.2, north: 44.5, south: 44.4, west: 26 };
const moved = jest.fn();
const picked = jest.fn();
const shifted = jest.fn();

beforeEach(() => {
  map = mapFake();
  moved.mockClear();
  picked.mockClear();
  here.addTo.mockClear();
  here.remove.mockClear();
  here.setLngLat.mockClear();
  shifted.mockClear();
  host = document.createElement('div');
  host.style.setProperty('--mf-green', GREEN);
  host.style.setProperty('--mf-red', RED);
  host.style.setProperty('--mf-amber', AMBER);
  host.style.setProperty('--mf-on-amber', ON_AMBER);
  document.body.append(host);
});

afterEach(() => host.remove());

// The "you are here" marker MapLibre places on the map.
const here = {
  addTo: jest.fn().mockReturnThis(),
  remove: jest.fn().mockReturnThis(),
  setLngLat: jest.fn().mockReturnThis(),
};
const draw = () =>
  drawPins(
    map as unknown as MapLibre,
    host,
    { moved, picked, shifted },
    here as unknown as Marker,
  );
const fire = (type: string, event: object = {}) => {
  for (const [name, handler] of map.on.mock.calls) {
    if (name === type) handler(event);
  }
};
const lastData = () => map.sources.get('pins')?.setData.mock.calls.at(-1)?.[0];
const layer = (id: string) =>
  map.addLayer.mock.calls.map(([spec]) => spec).findLast((l) => l.id === id);
const pinsSources = () =>
  map.addSource.mock.calls.filter(([id]) => id === 'pins').map(([, s]) => s);

// @traces 269-FR-013
describe('the pins on the results map', () => {
  it('draws one point per fixed garage, labelled with its rate in lei', () => {
    draw().show(
      answer([
        pinOf(1, { rateLei: 150 }),
        pinOf(2, { rateLei: null, stance: 'does_not_take' }),
      ]),
    );

    expect(lastData()).toEqual({
      features: [
        {
          geometry: {
            coordinates: [26.1 + 1 / 1000, 44.4 + 1 / 1000],
            type: 'Point',
          },
          properties: { id: 'g-1', rate: '150', stance: 'works_on' },
          type: 'Feature',
        },
        {
          geometry: {
            coordinates: [26.1 + 2 / 1000, 44.4 + 2 / 1000],
            type: 'Point',
          },
          properties: { id: 'g-2', rate: '', stance: 'does_not_take' },
          type: 'Feature',
        },
      ],
      type: 'FeatureCollection',
    });
  });

  it('draws no pin for a mobile mechanic', () => {
    draw().show(answer([pinOf(1), pinOf(2, { serviceRadiusKm: 20 })]));

    expect(
      lastData().features.map(
        (f: { properties: { id: string } }) => f.properties.id,
      ),
    ).toEqual(['g-1']);
  });

  it('colours a pin green for a garage that takes the brand and red for the rest, in the theme lamp colours', () => {
    draw();

    expect(layer('pins-dot')).toMatchObject({
      paint: {
        'circle-color': ['match', ['get', 'stance'], 'works_on', GREEN, RED],
        'circle-radius': 7,
        'circle-stroke-width': 2,
      },
      source: 'pins',
      type: 'circle',
    });
  });

  it('writes the rate beside each pin', () => {
    draw();

    expect(layer('pins-rate')).toMatchObject({
      layout: { 'text-field': ['get', 'rate'] },
      source: 'pins',
      type: 'symbol',
    });
  });

  it('keeps the pins apart up to 50 fixed garages', () => {
    draw().show(answer(Array.from({ length: 50 }, (_, n) => pinOf(n))));

    expect(pinsSources().map((s) => s.cluster)).toEqual([false]);
    expect(map.removeSource).not.toHaveBeenCalled();
  });

  it('merges the pins into counted clusters above 50 fixed garages, building the source again', () => {
    const view = draw();
    view.show(answer(Array.from({ length: 51 }, (_, n) => pinOf(n))));

    expect(pinsSources().map((s) => s.cluster)).toEqual([false, true]);
    expect(pinsSources()[1]).toMatchObject({ clusterRadius: 48 });
    expect(map.removeSource).toHaveBeenCalledWith('pins');
    expect(lastData().features).toHaveLength(51);
    expect(layer('pins-count')).toMatchObject({
      layout: { 'text-field': ['get', 'point_count_abbreviated'] },
      type: 'symbol',
    });
  });

  it('splits the clusters again when the answer falls to 50, and not before it changes', () => {
    const view = draw();
    view.show(answer(Array.from({ length: 60 }, (_, n) => pinOf(n))));
    view.show(answer(Array.from({ length: 55 }, (_, n) => pinOf(n))));

    expect(pinsSources().map((s) => s.cluster)).toEqual([false, true]);

    view.show(answer(Array.from({ length: 50 }, (_, n) => pinOf(n))));

    expect(pinsSources().map((s) => s.cluster)).toEqual([false, true, false]);
  });

  it('counts only fixed garages toward the clusters', () => {
    draw().show(
      answer([
        ...Array.from({ length: 50 }, (_, n) => pinOf(n)),
        pinOf(99, { serviceRadiusKm: 20 }),
      ]),
    );

    expect(pinsSources().map((s) => s.cluster)).toEqual([false]);
  });

  it('clears the pins when there is no answer', () => {
    const view = draw();
    view.show(answer([pinOf(1)]));

    view.show(undefined);

    expect(lastData()).toEqual({ features: [], type: 'FeatureCollection' });
  });
});

// @traces 269-FR-012
describe('fitting the results map', () => {
  const OPTIONS = { animate: false, maxZoom: 15, padding: 40 };

  it('fits the place and every fixed pin, instantly, never past zoom 15', () => {
    draw().fit(
      PLACE,
      answer([
        pinOf(1, { lat: 44.5, lng: 26.0 }),
        pinOf(2, { lat: 44.3, lng: 26.2 }),
      ]),
    );

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [26.0, 44.3],
        [26.2, 44.5],
      ],
      OPTIONS,
    );
  });

  it('leaves a mobile mechanic out of the fit', () => {
    draw().fit(
      PLACE,
      answer([pinOf(1, { lat: 47, lng: 27, serviceRadiusKm: 20 })]),
    );

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [PLACE.lng, PLACE.lat],
        [PLACE.lng, PLACE.lat],
      ],
      OPTIONS,
    );
  });

  it('fits the pins alone without a place', () => {
    draw().fit(undefined, answer([pinOf(1, { lat: 44.5, lng: 26.0 })]));

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [26.0, 44.5],
        [26.0, 44.5],
      ],
      OPTIONS,
    );
  });

  it('shows Romania whole with neither a place nor a pin', () => {
    draw().fit(undefined, answer([]));

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: [24.97, 45.94],
      zoom: 5.2,
    });
  });
});

// @traces 269-FR-014
describe('a mobile mechanic on the results map', () => {
  const areasData = () =>
    map.sources.get('areas')?.setData.mock.calls.at(-1)?.[0];
  const order = () => map.addLayer.mock.calls.map(([spec]) => spec.id);

  it('draws a light circle of its radius around its centre, labelled with its rate', () => {
    draw().show(
      answer([
        pinOf(1),
        pinOf(2, { lat: 44.45, lng: 26.12, rateLei: 120, serviceRadiusKm: 20 }),
      ]),
    );

    expect(areasData()).toEqual({
      features: [
        {
          geometry: {
            coordinates: [ring({ lat: 44.45, lng: 26.12 }, 20)],
            type: 'Polygon',
          },
          properties: { id: 'g-2', rate: '120', stance: 'works_on' },
          type: 'Feature',
        },
      ],
      type: 'FeatureCollection',
    });
  });

  it('gives a circle with no rate an empty label', () => {
    draw().show(answer([pinOf(2, { rateLei: null, serviceRadiusKm: 10 })]));

    expect(areasData().features[0].properties.rate).toBe('');
  });

  it('fills the circle faintly and outlines it in the lamp colour, under every pin layer', () => {
    draw();

    expect(layer('areas-fill')).toMatchObject({
      paint: {
        'fill-color': ['match', ['get', 'stance'], 'works_on', GREEN, RED],
        'fill-opacity': 0.12,
      },
      source: 'areas',
      type: 'fill',
    });
    expect(layer('areas-line')).toMatchObject({
      paint: {
        'line-color': ['match', ['get', 'stance'], 'works_on', GREEN, RED],
      },
      source: 'areas',
      type: 'line',
    });
    expect(layer('areas-rate')).toMatchObject({
      layout: { 'text-field': ['get', 'rate'] },
      source: 'areas',
      type: 'symbol',
    });
    const ids = order();
    const lastArea = Math.max(
      ...['areas-fill', 'areas-line', 'areas-rate'].map((id) =>
        ids.indexOf(id),
      ),
    );
    expect(lastArea).toBeLessThan(ids.indexOf('pins-dot'));
    expect(lastArea).toBeLessThan(ids.indexOf('pins-cluster'));
  });

  it('keeps the circles under the pins when the pins merge into clusters', () => {
    draw().show(answer(Array.from({ length: 51 }, (_, n) => pinOf(n))));

    expect(map.removeSource).not.toHaveBeenCalledWith('areas');
    expect(map.removeLayer).not.toHaveBeenCalledWith('areas-fill');
    expect(order().filter((id) => id.startsWith('areas'))).toEqual([
      'areas-fill',
      'areas-line',
      'areas-lit-fill',
      'areas-lit-line',
      'areas-rate',
    ]);
  });

  it('draws no pin and no marker at the centre of a circle', () => {
    draw().show(answer([pinOf(2, { serviceRadiusKm: 20 })]));

    expect(lastData().features).toEqual([]);
    expect(
      map.addLayer.mock.calls.filter(
        ([spec]) => spec.source === 'areas' && spec.type === 'circle',
      ),
    ).toEqual([]);
  });

  it('clears the circles when there is no answer', () => {
    const view = draw();
    view.show(answer([pinOf(2, { serviceRadiusKm: 20 })]));

    view.show(undefined);

    expect(areasData()).toEqual({ features: [], type: 'FeatureCollection' });
  });
});

// @traces 269-FR-007
// @traces 269-FR-009
describe('a move of the map by the driver', () => {
  const drag = () => fire('moveend', { originalEvent: new MouseEvent('up') });

  beforeEach(() => {
    jest.useFakeTimers();
    shown = { east: 26.20049, north: 44.50012, south: 44.40041, west: 26.0 };
    draw();
  });

  afterEach(() => jest.useRealTimers());

  it('gives the box it shows once the map has been still for 400 ms, rounded to 3 decimals', () => {
    drag();
    jest.advanceTimersByTime(399);

    expect(moved).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);

    expect(moved).toHaveBeenCalledTimes(1);
    expect(moved).toHaveBeenCalledWith({ bbox: '44.4,26,44.5,26.2' });
  });

  it('waits for the last of several moves', () => {
    drag();
    jest.advanceTimersByTime(300);
    shown = { ...shown, east: 26.3 };
    drag();
    jest.advanceTimersByTime(300);

    expect(moved).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);

    expect(moved.mock.calls).toEqual([[{ bbox: '44.4,26,44.5,26.3' }]]);
  });

  it('gives nothing while the map moves again within the 400 ms', () => {
    drag();
    jest.advanceTimersByTime(200);
    fire('movestart', { originalEvent: new MouseEvent('down') });
    jest.advanceTimersByTime(1000);

    expect(moved).not.toHaveBeenCalled();
  });

  it("gives nothing after the page's own fit", () => {
    fire('moveend', {});
    jest.advanceTimersByTime(1000);

    expect(moved).not.toHaveBeenCalled();
  });

  it('clamps the box to Romania', () => {
    shown = { east: 30.4, north: 48.9, south: 48.0, west: 29.5 };
    drag();
    jest.advanceTimersByTime(400);

    expect(moved).toHaveBeenCalledWith({ bbox: '48,29.5,48.4,29.8' });
  });

  it('gives nothing for a box wholly outside Romania', () => {
    shown = { east: 19.5, north: 47.6, south: 47.4, west: 19.0 };
    drag();
    jest.advanceTimersByTime(400);

    expect(moved).not.toHaveBeenCalled();
  });

  it('says the box is too wide past 100 km on its longer side', () => {
    shown = { east: 26.4, north: 45.1, south: 44.9, west: 25.0 };
    drag();
    jest.advanceTimersByTime(400);

    expect(moved).toHaveBeenCalledWith({ tooWide: true });
  });

  it('measures the box after clamping it', () => {
    shown = { east: 21.0, north: 46.0, south: 45.6, west: 19.0 };
    drag();
    jest.advanceTimersByTime(400);

    expect(moved).toHaveBeenCalledWith({ bbox: '45.6,20.2,46,21' });
  });

  it('gives nothing once the map is gone', () => {
    drag();
    fire('remove');
    jest.advanceTimersByTime(1000);

    expect(moved).not.toHaveBeenCalled();
    expect(map.getBounds).not.toHaveBeenCalled();
  });
});

const added = () => map.addLayer.mock.calls.map(([spec]) => spec.id);
const lastFilter = (id: string) =>
  map.setFilter.mock.calls.findLast(([layer]) => layer === id)?.[1];
const single = ['!', ['has', 'point_count']];

// @traces 270-FR-008
// @traces 270-FR-009
describe('the lit garage on the results map', () => {
  it('draws the lit pin above every other pin, and the lit circle under the circle labels', () => {
    draw();
    const order = added();

    expect(order.indexOf('pins-lit-dot')).toBeGreaterThan(
      order.indexOf('pins-rate'),
    );
    expect(order.indexOf('pins-lit-rate')).toBeGreaterThan(
      order.indexOf('pins-lit-dot'),
    );
    expect(order.indexOf('areas-lit-fill')).toBeGreaterThan(
      order.indexOf('areas-line'),
    );
    expect(order.indexOf('areas-lit-line')).toBeLessThan(
      order.indexOf('areas-rate'),
    );
  });

  it('colours the lit pin amber, its rate in the ink on amber', () => {
    draw();

    expect(layer('pins-lit-dot')).toMatchObject({
      paint: { 'circle-color': AMBER },
    });
    expect(layer('pins-lit-rate')).toMatchObject({
      paint: { 'text-color': ON_AMBER, 'text-halo-color': AMBER },
    });
  });

  it('fills the lit circle amber, denser than a resting one yet still see-through, with an amber outline', () => {
    draw();
    const fill = layer('areas-lit-fill');

    expect(fill).toMatchObject({ paint: { 'fill-color': AMBER } });
    expect(fill.paint['fill-opacity']).toBeGreaterThan(
      layer('areas-fill').paint['fill-opacity'],
    );
    expect(fill.paint['fill-opacity']).toBeLessThan(1);
    expect(layer('areas-lit-line')).toMatchObject({
      paint: { 'line-color': AMBER },
    });
  });

  it('lights one garage by its id, never a cluster, and redraws no data', () => {
    const view = draw();
    view.show(answer([pinOf(1), pinOf(2)]));
    const sets = map.sources.get('pins')?.setData.mock.calls.length;

    view.light('g-2');

    expect(lastFilter('pins-lit-dot')).toEqual([
      'all',
      single,
      ['==', ['get', 'id'], 'g-2'],
    ]);
    expect(lastFilter('pins-lit-rate')).toEqual([
      'all',
      single,
      ['==', ['get', 'id'], 'g-2'],
    ]);
    expect(lastFilter('areas-lit-fill')).toEqual(['==', ['get', 'id'], 'g-2']);
    expect(lastFilter('areas-lit-line')).toEqual(['==', ['get', 'id'], 'g-2']);
    expect(map.sources.get('pins')?.setData.mock.calls.length).toBe(sets);
  });

  it('lights nothing once no garage is lit', () => {
    const view = draw();
    view.light('g-2');

    view.light(undefined);

    expect(lastFilter('pins-lit-dot')).toEqual([
      'all',
      single,
      ['==', ['get', 'id'], ''],
    ]);
    expect(lastFilter('areas-lit-fill')).toEqual(['==', ['get', 'id'], '']);
  });

  it('keeps the lit garage when the pins switch to clusters and back', () => {
    const view = draw();
    view.light('g-3');

    view.show(answer(Array.from({ length: 51 }, (_, i) => pinOf(i))));

    expect(lastFilter('pins-lit-dot')).toEqual([
      'all',
      single,
      ['==', ['get', 'id'], 'g-3'],
    ]);
  });
});

// @traces 270-FR-004
// @traces 270-FR-010
// @traces 270-FR-011
describe('a tap on the results map', () => {
  const tap = (hits: Hit[]) => {
    map.queryRenderedFeatures.mockReturnValueOnce(hits);
    fire('click', { point: { x: 5, y: 6 } });
  };

  it('asks only the pins, the circle labels and the clusters what was tapped', () => {
    draw();
    tap([]);

    const [, options] = map.queryRenderedFeatures.mock.calls[0] as unknown as [
      unknown,
      { layers: string[] },
    ];
    expect([...options.layers].sort()).toEqual(
      [
        'areas-rate',
        'pins-cluster',
        'pins-dot',
        'pins-lit-dot',
        'pins-lit-rate',
        'pins-rate',
      ].sort(),
    );
  });

  it('gives the garage of a tapped pin or circle label', () => {
    draw();

    tap([{ properties: { id: 'g-7', rate: '150' } }]);

    expect(picked).toHaveBeenCalledWith('g-7');
  });

  it('gives no garage for a tap away from every pin, a circle fill among them', () => {
    draw();

    tap([]);

    expect(picked).toHaveBeenCalledWith(undefined);
  });

  it('zooms into a tapped cluster where it splits, as its own move, and gives no garage', async () => {
    const view = draw();
    view.show(answer(Array.from({ length: 51 }, (_, i) => pinOf(i))));

    tap([
      {
        geometry: { coordinates: [26.1, 44.4] },
        properties: { cluster: true, cluster_id: 9, point_count: 12 },
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(
      map.sources.get('pins')?.getClusterExpansionZoom,
    ).toHaveBeenCalledWith(9);
    expect(map.easeTo).toHaveBeenCalledWith({ center: [26.1, 44.4], zoom: 13 });
    expect(picked).not.toHaveBeenCalled();
  });

  it('shows the pointer over what can be tapped, and the plain cursor elsewhere', () => {
    draw();
    const canvas = map.getCanvas();

    map.queryRenderedFeatures.mockReturnValueOnce([
      { properties: { id: 'g-1' } },
    ]);
    fire('mousemove', { point: { x: 1, y: 1 } });
    expect(canvas.style.cursor).toBe('pointer');

    fire('mousemove', { point: { x: 2, y: 2 } });
    expect(canvas.style.cursor).toBe('');
  });

  it('finds a place on the map in pixels, and says when the map moved', () => {
    const view = draw();

    expect(view.spot({ lat: 44.4, lng: 26.1 })).toEqual({ x: 261, y: 444 });

    fire('move');
    expect(shifted).toHaveBeenCalledTimes(1);
  });
});

// @traces 271-garage-distance-FR-004
describe('the "you are here" marker on the results map', () => {
  const OTHER = { lat: 46.771, lng: 23.624 };

  it('puts one marker at the place', () => {
    draw().mark(PLACE);

    expect(here.setLngLat).toHaveBeenLastCalledWith([PLACE.lng, PLACE.lat]);
    expect(here.addTo).toHaveBeenCalledTimes(1);
    expect(here.addTo).toHaveBeenCalledWith(map);
  });

  it('moves the same marker when the place changes', () => {
    const view = draw();
    view.mark(PLACE);
    view.mark(OTHER);

    expect(here.setLngLat).toHaveBeenLastCalledWith([OTHER.lng, OTHER.lat]);
    expect(here.addTo).toHaveBeenCalledTimes(1);
    expect(here.remove).not.toHaveBeenCalled();
  });

  it('takes the marker off with no place, and puts it back with one', () => {
    const view = draw();
    view.mark(PLACE);
    view.mark(undefined);

    expect(here.remove).toHaveBeenCalledTimes(1);

    view.mark(OTHER);
    expect(here.addTo).toHaveBeenCalledTimes(2);
    expect(here.setLngLat).toHaveBeenLastCalledWith([OTHER.lng, OTHER.lat]);
  });

  it('puts nothing on the map before there is a place', () => {
    draw().mark(undefined);

    expect(here.addTo).not.toHaveBeenCalled();
  });

  it('keeps the place in the fit with no pin around it', () => {
    const view = draw();
    view.mark(PLACE);
    view.fit(PLACE, answer([]));

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [PLACE.lng, PLACE.lat],
        [PLACE.lng, PLACE.lat],
      ],
      { animate: false, maxZoom: 15, padding: 40 },
    );
    expect(map.jumpTo).not.toHaveBeenCalled();
  });
});
