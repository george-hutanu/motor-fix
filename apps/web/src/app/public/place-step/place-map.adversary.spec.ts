import { TestBed } from '@angular/core/testing';
import { PLACE_ZOOM } from '@motor-fix/contracts/place-section';

import {
  circleBounds,
  type LatLng,
  PLACE_MAP,
  type PlaceMap,
  viewFor,
} from './place-map';

const fake = {
  inView: true,
  map: undefined as unknown as FakeMap,
  marker: undefined as unknown as FakeMarker,
};

class FakeMap {
  readonly data = jest.fn();
  readonly fitBounds = jest.fn();
  readonly jumpTo = jest.fn();
  readonly remove = jest.fn();
  constructor() {
    fake.map = this;
  }
  addControl() {}
  addLayer() {}
  addSource() {}
  getBounds() {
    return { contains: () => fake.inView };
  }
  getSource() {
    return { setData: this.data };
  }
  getZoom() {
    return 8;
  }
  on() {}
  once(event: string, then: () => void) {
    if (event === 'load') then();
  }
}

class FakeMarker {
  readonly remove = jest.fn();
  constructor() {
    fake.marker = this;
  }
  addTo() {
    return this;
  }
  on() {}
  setLngLat() {
    return this;
  }
}

jest.mock('maplibre-gl', () => ({
  Map: FakeMap,
  Marker: FakeMarker,
  NavigationControl: class {},
  setWorkerUrl: () => {},
}));

const SEAT: LatLng = { lat: 44.4512, lng: 26.1207 };
const FAR: LatLng = { lat: 47.1585, lng: 27.6014 };
const NORTH: LatLng = { lat: 48.2, lng: 24.9 };
const FIT = { animate: false, padding: 24 };

const viewCalls = () =>
  fake.map.fitBounds.mock.calls.length + fake.map.jumpTo.mock.calls.length;

describe('circleBounds at the edges of the radius range', () => {
  it.each([1, 100])(
    'stays centred on a seat in the far north at %s km',
    (km) => {
      const [[west, south], [east, north]] = circleBounds(NORTH, km);

      expect((west + east) / 2).toBeCloseTo(NORTH.lng, 9);
      expect((south + north) / 2).toBeCloseTo(NORTH.lat, 9);
      expect(east).toBeGreaterThan(west);
      expect(north).toBeGreaterThan(south);
    },
  );

  it('grows with the radius on both axes', () => {
    const [[w1, s1], [e1, n1]] = circleBounds(SEAT, 1);
    const [[w100, s100], [e100, n100]] = circleBounds(SEAT, 100);

    expect(e100 - w100).toBeCloseTo((e1 - w1) * 100, 6);
    expect(n100 - s100).toBeCloseTo((n1 - s1) * 100, 6);
    expect(w100).toBeLessThan(w1);
    expect(s100).toBeLessThan(s1);
  });

  it('collapses to the seat itself at zero km', () => {
    expect(circleBounds(SEAT, 0)).toEqual([
      [SEAT.lng, SEAT.lat],
      [SEAT.lng, SEAT.lat],
    ]);
  });

  it('gives the same box when called twice with the same input', () => {
    expect(circleBounds(SEAT, 37)).toEqual(circleBounds(SEAT, 37));
  });
});

describe('viewFor on repeated and degenerate input', () => {
  it.each([
    ['a mobile pin sent twice', { at: SEAT, km: 20 }],
    ['a fixed pin sent twice', { at: SEAT }],
  ] as const)('keeps the view for %s while it is in view', (_, shown) => {
    expect(viewFor(shown, { ...shown }, true)).toBe('keep');
  });

  it('keeps the view when nothing is shown before or after', () => {
    expect(viewFor({}, {}, false)).toBe('keep');
    expect(viewFor({}, {}, true)).toBe('keep');
  });

  it('keeps the view when a pin is cleared and the radius changes with it', () => {
    expect(viewFor({ at: SEAT, km: 20 }, { km: 100 }, false)).toBe('keep');
  });

  it('frames the circle when a mobile pin is moved out of view at the same radius', () => {
    expect(viewFor({ at: SEAT, km: 1 }, { at: FAR, km: 1 }, false)).toBe(
      'circle',
    );
  });

  it('goes to the street when a fixed pin is placed first, even if reported out of view', () => {
    expect(viewFor({}, { at: SEAT }, false)).toBe('street');
  });

  it('frames the circle on a radius change even while the pin is out of view', () => {
    expect(viewFor({ at: SEAT, km: 20 }, { at: SEAT, km: 100 }, false)).toBe(
      'circle',
    );
  });

  it('frames the circle at both ends of the radius range on first placement', () => {
    expect(viewFor({}, { at: SEAT, km: 1 }, true)).toBe('circle');
    expect(viewFor({}, { at: SEAT, km: 100 }, true)).toBe('circle');
  });
});

describe('the place map under repeated and awkward sequences', () => {
  let map: PlaceMap;

  beforeEach(async () => {
    fake.inView = true;
    map = await TestBed.inject(PLACE_MAP)(document.createElement('div'), {
      dragged: () => {},
      failed: () => {},
      tapped: () => {},
    });
  });

  afterEach(() => {
    delete (window as { __MF_MAP?: unknown }).__MF_MAP;
  });

  it('makes one view change when the same mobile show arrives twice', () => {
    map.show({ at: SEAT, km: 20 });
    map.show({ at: SEAT, km: 20 });

    expect(viewCalls()).toBe(1);
    expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('makes one view change when the same fixed show arrives twice', () => {
    map.show({ at: SEAT });
    map.show({ at: SEAT });

    expect(fake.map.jumpTo).toHaveBeenCalledTimes(1);
    expect(fake.map.fitBounds).not.toHaveBeenCalled();
  });

  it.each([1, 100])('fits the whole %s km circle on first placement', (km) => {
    map.show({ at: SEAT, km });

    expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);
    expect(fake.map.fitBounds).toHaveBeenCalledWith(
      circleBounds(SEAT, km),
      FIT,
    );
    expect(fake.map.jumpTo).not.toHaveBeenCalled();
  });

  it('refits from 100 km down to 1 km and back up again', () => {
    map.show({ at: SEAT, km: 100 });
    map.show({ at: SEAT, km: 1 });
    expect(fake.map.fitBounds).toHaveBeenLastCalledWith(
      circleBounds(SEAT, 1),
      FIT,
    );

    map.show({ at: SEAT, km: 100 });
    expect(fake.map.fitBounds).toHaveBeenLastCalledWith(
      circleBounds(SEAT, 100),
      FIT,
    );
    expect(fake.map.fitBounds).toHaveBeenCalledTimes(3);
  });

  it('does not move the view when a mobile show becomes a fixed one at the same pin', () => {
    map.show({ at: SEAT, km: 20 });
    const before = viewCalls();

    map.show({ at: SEAT });

    expect(viewCalls()).toBe(before);
  });

  it('draws one circle for a mobile pin and none for a fixed one', () => {
    map.show({ at: SEAT, km: 20 });
    const drawn = fake.map.data.mock.calls.at(-1)?.[0];
    expect(drawn.type).toBe('FeatureCollection');
    expect(drawn.features).toHaveLength(1);

    map.show({ at: SEAT });
    expect(fake.map.data.mock.calls.at(-1)?.[0].features).toEqual([]);
  });

  it('fits the circle again when the kind goes mobile, fixed, mobile at one pin', () => {
    map.show({ at: SEAT, km: 20 });
    map.show({ at: SEAT });
    fake.map.fitBounds.mockClear();

    map.show({ at: SEAT, km: 20 });

    expect(fake.map.fitBounds).toHaveBeenCalledWith(
      circleBounds(SEAT, 20),
      FIT,
    );
    expect(fake.map.data.mock.calls.at(-1)?.[0].features).toHaveLength(1);
  });

  it('frames the circle once, at the latest radius, when a cleared pin comes back after a radius change', () => {
    map.show({ at: SEAT, km: 20 });
    map.show({ km: 20 });
    map.show({ km: 100 });
    fake.map.fitBounds.mockClear();
    fake.map.jumpTo.mockClear();

    map.show({ at: SEAT, km: 100 });

    expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);
    expect(fake.map.fitBounds).toHaveBeenCalledWith(
      circleBounds(SEAT, 100),
      FIT,
    );
    expect(fake.map.jumpTo).not.toHaveBeenCalled();
  });

  it('does not move the view while only the radius changes with no pin', () => {
    map.show({ km: 20 });
    map.show({ km: 100 });
    map.show({ km: 5 });

    expect(viewCalls()).toBe(0);
  });

  it('frames the circle at the new spot when a mobile pin moves out of view at the same radius', () => {
    map.show({ at: SEAT, km: 20 });
    fake.inView = false;

    map.show({ at: FAR, km: 20 });

    expect(fake.map.fitBounds).toHaveBeenCalledTimes(2);
    expect(fake.map.fitBounds).toHaveBeenLastCalledWith(
      circleBounds(FAR, 20),
      FIT,
    );
    expect(fake.map.jumpTo).not.toHaveBeenCalled();
  });

  it('fits the new radius once when it changes while the pin is out of view', () => {
    map.show({ at: SEAT, km: 20 });
    fake.inView = false;

    map.show({ at: SEAT, km: 100 });

    expect(fake.map.fitBounds).toHaveBeenCalledTimes(2);
    expect(fake.map.fitBounds).toHaveBeenLastCalledWith(
      circleBounds(SEAT, 100),
      FIT,
    );
  });

  it('fits once to the new circle when pin and radius change in one show', () => {
    map.show({ at: SEAT, km: 20 });

    map.show({ at: FAR, km: 100 });

    expect(fake.map.fitBounds).toHaveBeenCalledTimes(2);
    expect(fake.map.fitBounds).toHaveBeenLastCalledWith(
      circleBounds(FAR, 100),
      FIT,
    );
  });

  it('goes to the street, never to a circle, for a fixed pin out of view after a mobile one', () => {
    map.show({ at: SEAT, km: 20 });
    fake.inView = false;
    fake.map.fitBounds.mockClear();

    map.show({ at: FAR });

    expect(fake.map.jumpTo).toHaveBeenLastCalledWith({
      center: [FAR.lng, FAR.lat],
      zoom: PLACE_ZOOM,
    });
    expect(fake.map.fitBounds).not.toHaveBeenCalled();
  });

  it('clears twice and still frames the next pin once', () => {
    map.show({ at: SEAT });
    map.show({});
    map.show({});
    fake.map.jumpTo.mockClear();

    map.show({ at: SEAT });

    expect(fake.map.jumpTo).toHaveBeenCalledTimes(1);
  });
});
