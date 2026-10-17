import {
  circleBounds,
  closeMapLibre,
  keepOutOfTabOrder,
  openMapLibre,
  ring,
  span,
  styleFor,
} from './map-libre';
import type { MapFake } from '../place-step/place-step.testing';

jest.mock('maplibre-gl', () =>
  jest.requireActual('../place-step/place-step.testing'),
);
const { fake } = jest.requireMock<MapFake>('maplibre-gl');

type TestWindow = {
  __MF_MAP?: unknown;
  __MF_MAP_STYLE?: string;
  matchMedia?: unknown;
};
const view = window as unknown as TestWindow;
const KM_PER_DEGREE = 111.32;
const AT = { lat: 44.4512, lng: 26.1207 };
const LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const DARK = 'https://tiles.openfreemap.org/styles/dark';

afterEach(() => {
  delete view.__MF_MAP;
  delete view.__MF_MAP_STYLE;
  delete view.matchMedia;
  fake.manualLoad = false;
  jest.useRealTimers();
});

// @traces 269-FR-011
describe('styleFor, the tiles a map reads', () => {
  const scheme = (dark: boolean) => {
    view.matchMedia = jest.fn((query: string) => ({
      matches: dark && query === '(prefers-color-scheme: dark)',
    }));
  };

  it('reads the light style in a light scheme', () => {
    scheme(false);

    expect(styleFor(document)).toBe(LIGHT);
  });

  it('reads the dark style in a dark scheme', () => {
    scheme(true);

    expect(styleFor(document)).toBe(DARK);
  });

  it('reads the style a test points it at, in either scheme', () => {
    scheme(true);
    view.__MF_MAP_STYLE = '/map/empty-style.json';

    expect(styleFor(document)).toBe('/map/empty-style.json');
  });
});

describe('the circle helpers', () => {
  it('spans a number of km in degrees of latitude and of longitude', () => {
    const { dLat, dLng } = span(AT.lat, 20);

    expect(dLat).toBeCloseTo(20 / KM_PER_DEGREE, 9);
    expect(dLng).toBeCloseTo(
      20 / (KM_PER_DEGREE * Math.cos((AT.lat * Math.PI) / 180)),
      9,
    );
  });

  it('draws a closed ring of 65 points, each the radius away from the centre', () => {
    const points = ring(AT, 20);
    const { dLat, dLng } = span(AT.lat, 20);

    expect(points).toHaveLength(65);
    expect(points[0]?.[0]).toBeCloseTo(points[64]?.[0] ?? 0, 9);
    expect(points[0]?.[1]).toBeCloseTo(points[64]?.[1] ?? 0, 9);
    for (const [lng, lat] of points) {
      expect(
        ((lng - AT.lng) / dLng) ** 2 + ((lat - AT.lat) / dLat) ** 2,
      ).toBeCloseTo(1, 9);
    }
  });

  it('bounds the circle, south-west corner first', () => {
    const { dLat, dLng } = span(AT.lat, 20);

    expect(circleBounds(AT, 20)).toEqual([
      [AT.lng - dLng, AT.lat - dLat],
      [AT.lng + dLng, AT.lat + dLat],
    ]);
  });
});

describe('openMapLibre, what MapLibre needs that the bundle does not hold', () => {
  const sheets = () =>
    Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ).filter((link) => link.href.endsWith('/map/maplibre-gl.css'));

  afterEach(() => {
    for (const link of sheets()) link.remove();
  });

  it('points the worker at the copy served from /map, beside the page', async () => {
    await openMapLibre(document.createElement('div'), LIGHT);

    const workerUrl = new URL(fake.workerUrl ?? '');
    expect(workerUrl.pathname).toBe('/map/maplibre-gl-worker.mjs');
    expect(workerUrl.origin).toBe(new URL(document.baseURI).origin);
  });

  it('adds the map stylesheet to the page only when a map opens, once', async () => {
    expect(sheets()).toHaveLength(0);

    await openMapLibre(document.createElement('div'), LIGHT);
    await openMapLibre(document.createElement('div'), LIGHT);

    expect(sheets()).toHaveLength(1);
  });
});

// @traces 269-FR-017
describe('openMapLibre, a map that loads or says it cannot', () => {
  // The opener awaits MapLibre's import before it builds the map.
  const built = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    fake.manualLoad = true;
  });

  it('answers the map once it has loaded, telling the caller at the load itself', async () => {
    const loaded = jest.fn();
    const opening = openMapLibre(document.createElement('div'), LIGHT, loaded);
    await built();

    fake.map.fire('load');

    expect(loaded).toHaveBeenCalledWith(fake.map);
    await expect(opening).resolves.toBe(fake.map);
  });

  it('removes a map whose style fails before it loads, and rejects with the error', async () => {
    const error = new Error('style 500');
    const opening = openMapLibre(document.createElement('div'), LIGHT);
    await built();

    fake.map.fire('error', { error });

    await expect(opening).rejects.toBe(error);
    expect(fake.map.remove).toHaveBeenCalledTimes(1);
  });

  it('ignores a tile error before the load, and still answers the map once it loads', async () => {
    const opening = openMapLibre(document.createElement('div'), LIGHT);
    await built();

    fake.map.fire('error', {
      error: new Error('tile 404'),
      sourceId: 'openmaptiles',
      tile: {},
    });
    expect(fake.map.remove).not.toHaveBeenCalled();
    fake.map.fire('load');

    await expect(opening).resolves.toBe(fake.map);
    expect(fake.map.remove).not.toHaveBeenCalled();
  });

  it('still gives up on a style error that follows an ignored tile error', async () => {
    const error = new Error('style 500');
    const opening = openMapLibre(document.createElement('div'), LIGHT);
    await built();

    fake.map.fire('error', { error: new Error('tile 404'), sourceId: 'x' });
    fake.map.fire('error', { error });

    await expect(opening).rejects.toBe(error);
    expect(fake.map.remove).toHaveBeenCalledTimes(1);
  });

  it('gives up on a map that has not loaded within 10 seconds', async () => {
    jest.useFakeTimers();
    const opening = openMapLibre(document.createElement('div'), LIGHT);
    const rejected = expect(opening).rejects.toThrow();

    await jest.advanceTimersByTimeAsync(9999);
    expect(fake.map.remove).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await rejected;
    expect(fake.map.remove).toHaveBeenCalledTimes(1);
  });

  it('keeps a loaded map standing through a tile error, and past the 10 seconds', async () => {
    jest.useFakeTimers();
    const opening = openMapLibre(document.createElement('div'), LIGHT);
    await jest.advanceTimersByTimeAsync(0);

    fake.map.fire('load');
    fake.map.fire('error', { error: new Error('tile 404') });
    await jest.advanceTimersByTimeAsync(20_000);

    await expect(opening).resolves.toBe(fake.map);
    expect(fake.map.remove).not.toHaveBeenCalled();
  });

  it('hands the map to the page under the test style only, and takes it back when closed', async () => {
    const plain = openMapLibre(document.createElement('div'), LIGHT);
    await built();
    fake.map.fire('load');
    await plain;
    expect(view.__MF_MAP).toBeUndefined();

    view.__MF_MAP_STYLE = '/map/empty-style.json';
    const opening = openMapLibre(
      document.createElement('div'),
      view.__MF_MAP_STYLE,
    );
    await built();
    fake.map.fire('load');
    const map = await opening;
    expect(view.__MF_MAP).toBe(map);

    closeMapLibre(map);

    expect(fake.map.remove).toHaveBeenCalledTimes(1);
    expect(view.__MF_MAP).toBeUndefined();
  });
});

// @traces 269-FR-016
describe('keepOutOfTabOrder', () => {
  it('takes every control inside the map out of the keyboard order, those added later too, until stopped', async () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<canvas tabindex="0"></canvas><button>+</button><a href="https://osm.org">OSM</a>';
    document.body.append(host);

    const stop = keepOutOfTabOrder(host);
    const later = document.createElement('button');
    host.append(later);
    await Promise.resolve();

    for (const control of host.querySelectorAll('canvas, button, a')) {
      expect(control.getAttribute('tabindex')).toBe('-1');
    }

    stop();
    const after = document.createElement('button');
    host.append(after);
    await Promise.resolve();
    expect(after.hasAttribute('tabindex')).toBe(false);
    host.remove();
  });
});
