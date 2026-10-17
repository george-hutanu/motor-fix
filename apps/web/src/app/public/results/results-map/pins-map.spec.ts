import type { GaragePinDto, GaragePinsDto } from '@motor-fix/data-access';
import type { Map as MapLibre } from 'maplibre-gl';

import { drawPins } from './pins-map';
import { ring } from '../../map-libre/map-libre';

const GREEN = 'rgb(0, 128, 0)';
const RED = 'rgb(200, 0, 0)';
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

type Source = { setData: jest.Mock };
function mapFake() {
  const sources = new Map<string, Source>();
  return {
    addLayer: jest.fn(),
    addSource: jest.fn((id: string, _spec: { cluster?: boolean }) => {
      sources.set(id, { setData: jest.fn() });
    }),
    fitBounds: jest.fn(),
    getBounds: jest.fn(() => ({
      getEast: () => shown.east,
      getNorth: () => shown.north,
      getSouth: () => shown.south,
      getWest: () => shown.west,
    })),
    getLayer: jest.fn(() => ({})),
    getSource: jest.fn((id: string) => sources.get(id)),
    jumpTo: jest.fn(),
    on: jest.fn(),
    removeLayer: jest.fn(),
    removeSource: jest.fn((id: string) => sources.delete(id)),
    sources,
  };
}

let map: ReturnType<typeof mapFake>;
let host: HTMLElement;
let shown = { east: 26.2, north: 44.5, south: 44.4, west: 26 };
const moved = jest.fn();

beforeEach(() => {
  map = mapFake();
  moved.mockClear();
  host = document.createElement('div');
  host.style.setProperty('--mf-green', GREEN);
  host.style.setProperty('--mf-red', RED);
  document.body.append(host);
});

afterEach(() => host.remove());

const draw = () => drawPins(map as unknown as MapLibre, host, moved);
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
  const fire = (type: string, event: object = {}) => {
    for (const [name, handler] of map.on.mock.calls) {
      if (name === type) handler(event);
    }
  };
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
