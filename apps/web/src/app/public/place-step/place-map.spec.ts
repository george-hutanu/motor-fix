import { TestBed } from '@angular/core/testing';
import { PLACE_ZOOM } from '@motor-fix/contracts/place-section';

import {
  circleBounds,
  type LatLng,
  mapAssets,
  PLACE_MAP,
  type PlaceMap,
  viewFor,
} from './place-map';
import type { MapFake } from './place-step.testing';

jest.mock('maplibre-gl', () => jest.requireActual('./place-step.testing'));
const { fake } = jest.requireMock<MapFake>('maplibre-gl');

const sheets = () =>
  Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).filter((link) => link.href.endsWith('/map/maplibre-gl.css'));

const SEAT: LatLng = { lat: 44.4512, lng: 26.1207 };
const FAR: LatLng = { lat: 47.1585, lng: 27.6014 };
const KM_PER_DEGREE = 111.32;

describe('mapAssets, what MapLibre needs that the bundle does not hold', () => {
  afterEach(() => {
    for (const link of sheets()) link.remove();
  });

  it('points the worker at the copy served from /map, beside the page', () => {
    const { workerUrl } = mapAssets(document);

    expect(new URL(workerUrl).pathname).toBe('/map/maplibre-gl-worker.mjs');
    expect(new URL(workerUrl).origin).toBe(new URL(document.baseURI).origin);
  });

  it('adds the map stylesheet to the page only when the map opens, once', () => {
    expect(sheets()).toHaveLength(0);

    mapAssets(document);
    mapAssets(document);

    expect(sheets()).toHaveLength(1);
  });
});

describe('circleBounds, the box around a service circle', () => {
  it.each([1, 20, 100])(
    'spans %s km on each side of the seat, south-west corner first',
    (km) => {
      const [[west, south], [east, north]] = circleBounds(SEAT, km);

      expect(north - SEAT.lat).toBeCloseTo(km / KM_PER_DEGREE, 6);
      expect(SEAT.lat - south).toBeCloseTo(km / KM_PER_DEGREE, 6);
      expect(east - SEAT.lng).toBeCloseTo(
        km / (KM_PER_DEGREE * Math.cos((SEAT.lat * Math.PI) / 180)),
        6,
      );
      expect(SEAT.lng - west).toBeCloseTo(east - SEAT.lng, 9);
    },
  );

  it('is wider in degrees of longitude than of latitude, more so further north', () => {
    const width = (at: LatLng) => {
      const [[west], [east]] = circleBounds(at, 20);
      return east - west;
    };
    const [[, south], [, north]] = circleBounds(SEAT, 20);

    expect(width(SEAT)).toBeGreaterThan(north - south);
    expect(width({ lat: 48, lng: SEAT.lng })).toBeGreaterThan(width(SEAT));
  });
});

describe('viewFor, whether the map moves when the pin or radius changes', () => {
  it.each([
    [
      'frames the circle on a mobile first placement',
      {},
      { at: SEAT, km: 20 },
      true,
      'circle',
    ],
    [
      'goes to the street on a fixed first placement',
      {},
      { at: SEAT },
      true,
      'street',
    ],
    [
      'keeps the view on a mobile move inside it',
      { at: SEAT, km: 20 },
      { at: FAR, km: 20 },
      true,
      'keep',
    ],
    [
      'keeps the view on a fixed move inside it',
      { at: SEAT },
      { at: FAR },
      true,
      'keep',
    ],
    [
      'frames the circle when a mobile pin lands outside the view',
      { at: SEAT, km: 20 },
      { at: FAR, km: 20 },
      false,
      'circle',
    ],
    [
      'goes to the street when a fixed pin lands outside the view',
      { at: SEAT },
      { at: FAR },
      false,
      'street',
    ],
    [
      'frames the circle when the radius changes',
      { at: SEAT, km: 20 },
      { at: SEAT, km: 100 },
      true,
      'circle',
    ],
    [
      'frames the circle when the radius becomes known',
      { at: SEAT },
      { at: SEAT, km: 20 },
      true,
      'circle',
    ],
    [
      'keeps the view when the radius is dropped',
      { at: SEAT, km: 20 },
      { at: SEAT },
      true,
      'keep',
    ],
    [
      'keeps the view while there is no pin',
      { km: 20 },
      { km: 100 },
      false,
      'keep',
    ],
  ] as const)('%s', (_, prev, next, inView, view) => {
    expect(viewFor(prev, next, inView)).toBe(view);
  });
});

describe('the place map, how it frames the pin and the circle', () => {
  let map: PlaceMap;

  beforeEach(async () => {
    fake.inView = true;
    const open = TestBed.inject(PLACE_MAP);
    map = await open(document.createElement('div'), {
      dragged: () => {},
      failed: () => {},
      tapped: () => {},
    });
  });

  afterEach(() => {
    for (const link of sheets()) link.remove();
    delete (window as { __MF_MAP?: unknown }).__MF_MAP;
    delete (window as { __MF_MAP_STYLE?: string }).__MF_MAP_STYLE;
  });

  it('fits a mobile mechanic’s first placement to the whole circle, without a jump to the street', () => {
    map.show({ at: SEAT, km: 20 });

    expect(fake.map.fitBounds).toHaveBeenCalledWith(circleBounds(SEAT, 20), {
      animate: false,
      padding: 24,
    });
    expect(fake.map.jumpTo).not.toHaveBeenCalled();
  });

  it('centres a fixed garage’s first placement at street zoom', () => {
    map.show({ at: SEAT });

    expect(fake.map.jumpTo).toHaveBeenCalledWith({
      center: [SEAT.lng, SEAT.lat],
      zoom: PLACE_ZOOM,
    });
    expect(fake.map.fitBounds).not.toHaveBeenCalled();
  });

  it.each([
    ['a mobile mechanic', 20],
    ['a fixed garage', undefined],
  ])(
    'leaves the zoom of a zoomed-out map alone when %s moves the pin inside it',
    (_, km) => {
      map.show({ at: SEAT, km });
      fake.map.fitBounds.mockClear();
      fake.map.jumpTo.mockClear();

      map.show({ at: { lat: SEAT.lat + 0.01, lng: SEAT.lng }, km });

      expect(fake.map.fitBounds).not.toHaveBeenCalled();
      expect(fake.map.jumpTo).not.toHaveBeenCalled();
    },
  );

  it('frames the circle again when a mobile pin is set outside the view', () => {
    map.show({ at: SEAT, km: 20 });
    fake.inView = false;

    map.show({ at: FAR, km: 20 });

    expect(fake.map.fitBounds).toHaveBeenLastCalledWith(circleBounds(FAR, 20), {
      animate: false,
      padding: 24,
    });
  });

  it('goes to the street again when a fixed pin is set outside the view', () => {
    map.show({ at: SEAT });
    fake.inView = false;

    map.show({ at: FAR });

    expect(fake.map.jumpTo).toHaveBeenLastCalledWith({
      center: [FAR.lng, FAR.lat],
      zoom: PLACE_ZOOM,
    });
  });

  it('refits to the new circle when the radius changes', () => {
    map.show({ at: SEAT, km: 20 });

    map.show({ at: SEAT, km: 100 });

    expect(fake.map.fitBounds).toHaveBeenLastCalledWith(
      circleBounds(SEAT, 100),
      { animate: false, padding: 24 },
    );
  });

  it('removes the circle and keeps the view when the kind becomes fixed', () => {
    map.show({ at: SEAT, km: 20 });
    fake.map.fitBounds.mockClear();

    map.show({ at: SEAT });

    expect(fake.map.data).toHaveBeenLastCalledWith({
      features: [],
      type: 'FeatureCollection',
    });
    expect(fake.map.fitBounds).not.toHaveBeenCalled();
    expect(fake.map.jumpTo).not.toHaveBeenCalled();
  });

  it('takes the pin away without moving the view when the position is cleared', () => {
    map.show({ at: SEAT, km: 20 });
    fake.map.fitBounds.mockClear();

    map.show({ km: 20 });

    expect(fake.marker.remove).toHaveBeenCalled();
    expect(fake.map.fitBounds).not.toHaveBeenCalled();
  });

  it('frames the place again when a pin is placed after it was cleared', () => {
    map.show({ at: SEAT });
    map.show({});
    fake.map.jumpTo.mockClear();

    map.show({ at: SEAT });

    expect(fake.map.jumpTo).toHaveBeenCalledTimes(1);
  });

  it('hands the map to the page only under the test style', async () => {
    expect((window as { __MF_MAP?: unknown }).__MF_MAP).toBeUndefined();
    (window as { __MF_MAP_STYLE?: string }).__MF_MAP_STYLE =
      '/map/empty-style.json';

    await TestBed.inject(PLACE_MAP)(document.createElement('div'), {
      dragged: () => {},
      failed: () => {},
      tapped: () => {},
    });

    expect((window as { __MF_MAP?: unknown }).__MF_MAP).toBe(fake.map);
  });

  it('takes the map back from the page when it is destroyed', async () => {
    (window as { __MF_MAP_STYLE?: string }).__MF_MAP_STYLE =
      '/map/empty-style.json';
    const map = await TestBed.inject(PLACE_MAP)(document.createElement('div'), {
      dragged: () => {},
      failed: () => {},
      tapped: () => {},
    });

    map.destroy();

    expect(fake.map.remove).toHaveBeenCalled();
    expect((window as { __MF_MAP?: unknown }).__MF_MAP).toBeUndefined();
  });
});

describe('the place map when MapLibre raises an error', () => {
  const failed = jest.fn();
  const open = () =>
    TestBed.inject(PLACE_MAP)(document.createElement('div'), {
      dragged: () => {},
      failed,
      tapped: () => {},
    });
  // The opener awaits MapLibre's import before it builds the map.
  const built = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    fake.inView = true;
    fake.manualLoad = true;
    failed.mockClear();
  });

  afterEach(() => {
    fake.manualLoad = false;
    for (const link of sheets()) link.remove();
  });

  // @traces 945-FR-001 945-FR-002
  it('keeps a loaded map standing through a later error and still draws on it', async () => {
    const opening = open();
    await built();
    fake.map.fire('load');
    const map = await opening;
    fake.map.fire('error', { error: new Error('tile 404') });

    expect(fake.map.remove).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);

    map.show({ at: SEAT, km: 20 });

    expect(fake.map.data).toHaveBeenCalledTimes(1);
    expect(fake.marker.remove).not.toHaveBeenCalled();
    expect(fake.map.fitBounds).toHaveBeenCalledWith(circleBounds(SEAT, 20), {
      animate: false,
      padding: 24,
    });
  });

  // @traces 945-FR-001
  it('is removed once, by the step, when destroyed after a later error', async () => {
    const opening = open();
    await built();
    fake.map.fire('load');
    const map = await opening;
    fake.map.fire('error', { error: new Error('tile 404') });

    map.destroy();

    expect(fake.map.remove).toHaveBeenCalledTimes(1);
  });

  // @traces 945-FR-003
  it('removes a map that fails before it loads, once, and rejects with the error', async () => {
    const error = new Error('style 500');
    const opening = open();
    await built();
    fake.map.fire('error', { error });

    await expect(opening).rejects.toBe(error);
    expect(fake.map.remove).toHaveBeenCalledTimes(1);
  });

  // @traces 945-FR-003
  it('ignores a load that arrives after the map failed to start', async () => {
    const error = new Error('style 500');
    const opening = open();
    await built();
    fake.map.fire('error', { error });
    fake.map.fire('load');

    await expect(opening).rejects.toBe(error);
    expect(fake.map.remove).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });
});
