import type { GaragePinDto, GaragePinsDto } from '@motor-fix/data-access';
import type { Map as MapLibre } from 'maplibre-gl';

import { drawPins } from './pins-map';

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

beforeEach(() => {
  map = mapFake();
  host = document.createElement('div');
  host.style.setProperty('--mf-green', GREEN);
  host.style.setProperty('--mf-red', RED);
  document.body.append(host);
});

afterEach(() => host.remove());

const draw = () => drawPins(map as unknown as MapLibre, host);
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
