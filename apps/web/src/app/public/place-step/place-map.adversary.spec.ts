import { TestBed } from '@angular/core/testing';
import { PLACE_ZOOM } from '@motor-fix/contracts/place-section';

import {
  circleBounds,
  type LatLng,
  PLACE_MAP,
  type PlaceMap,
  viewFor,
} from './place-map';
import type { MapFake } from './place-step.testing';

jest.mock('maplibre-gl', () => jest.requireActual('./place-step.testing'));
const { fake } = jest.requireMock<MapFake>('maplibre-gl');

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

describe('the place map when the map raises errors around load', () => {
  const BOOM = new Error('tile failed');
  let failed: jest.Mock;

  const open = () =>
    TestBed.inject(PLACE_MAP)(document.createElement('div'), {
      dragged: () => {},
      failed,
      tapped: () => {},
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const outcome = (opening: Promise<PlaceMap>) => {
    const seen: { map?: PlaceMap; error?: unknown; done: boolean } = {
      done: false,
    };
    opening.then(
      (map) => Object.assign(seen, { done: true, map }),
      (error) => Object.assign(seen, { done: true, error }),
    );
    return seen;
  };

  beforeEach(() => {
    failed = jest.fn();
    fake.inView = true;
    fake.manualLoad = true;
  });

  afterEach(() => {
    fake.manualLoad = false;
  });

  // @traces 945-FR-001
  it('keeps the map and resolves the opener when an error follows load', async () => {
    const seen = outcome(open());
    await settle();
    fake.map.fire('load');
    fake.map.fire('error', { error: BOOM });
    await settle();

    expect(fake.map.remove).not.toHaveBeenCalled();
    expect(seen.done).toBe(true);
    expect(seen.error).toBeUndefined();
    expect(seen.map).toBeDefined();
  });

  // @traces 945-FR-001
  it('keeps the map when an error fires in the same tick as load, before the opener resumes', async () => {
    const opening = open();
    await settle();
    fake.map.fire('load');
    fake.map.fire('error', { error: BOOM });

    const map = await opening;
    map.show({ at: SEAT, km: 20 });

    expect(fake.map.remove).not.toHaveBeenCalled();
    expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);
  });

  // @traces 945-FR-001
  it('draws and frames a show after an error exactly as it does without one', async () => {
    const opening = open();
    await settle();
    fake.map.fire('load');
    const plain = await opening;
    plain.show({ at: SEAT, km: 20 });
    const expected = {
      data: fake.map.data.mock.calls,
      fit: fake.map.fitBounds.mock.calls,
      jump: fake.map.jumpTo.mock.calls,
    };

    const opening2 = open();
    await settle();
    fake.map.fire('load');
    fake.map.fire('error', { error: BOOM });
    const hit = await opening2;
    hit.show({ at: SEAT, km: 20 });

    expect(fake.map.data.mock.calls).toEqual(expected.data);
    expect(fake.map.fitBounds.mock.calls).toEqual(expected.fit);
    expect(fake.map.jumpTo.mock.calls).toEqual(expected.jump);
    expect(fake.map.remove).not.toHaveBeenCalled();
  });

  // @traces 945-FR-001
  it('still places the pin and the circle after many errors', async () => {
    const opening = open();
    await settle();
    fake.map.fire('load');
    for (let i = 0; i < 50; i++) fake.map.fire('error', { error: BOOM });
    const map = await opening;
    map.show({ at: SEAT, km: 5 });
    map.show({ at: FAR, km: 100 });

    expect(fake.map.remove).not.toHaveBeenCalled();
    expect(fake.map.data.mock.calls.at(-1)?.[0].features).toHaveLength(1);
    expect(fake.map.fitBounds).toHaveBeenLastCalledWith(
      circleBounds(FAR, 100),
      FIT,
    );
  });

  // @traces 945-FR-002
  it('calls failed once per error after load', async () => {
    const opening = open();
    await settle();
    fake.map.fire('load');
    fake.map.fire('error', { error: BOOM });
    fake.map.fire('error', { error: BOOM });
    fake.map.fire('error', { error: BOOM });
    await opening;

    expect(failed).toHaveBeenCalledTimes(3);
  });

  // @traces 945-FR-003
  it('removes the map only once when two errors arrive before load', async () => {
    const seen = outcome(open());
    await settle();
    fake.map.fire('error', { error: BOOM });
    fake.map.fire('error', { error: new Error('second') });
    await settle();

    expect(fake.map.remove).toHaveBeenCalledTimes(1);
    expect(seen.error).toBe(BOOM);
  });

  // @traces 945-FR-003
  it('does not remove the map again when an error follows load that followed a start-up error', async () => {
    const seen = outcome(open());
    await settle();
    fake.map.fire('error', { error: BOOM });
    fake.map.fire('load');
    fake.map.fire('error', { error: BOOM });
    await settle();

    expect(seen.error).toBe(BOOM);
    expect(fake.map.remove).toHaveBeenCalledTimes(1);
  });

  // @traces 945-FR-002
  it('does not report a start-up error as a post-load failure twice or tear down on the next open', async () => {
    const first = outcome(open());
    await settle();
    fake.map.fire('error', { error: BOOM });
    await settle();
    const dead = fake.map;
    expect(first.error).toBe(BOOM);

    const second = open();
    await settle();
    fake.map.fire('load');
    const map = await second;
    map.show({ at: SEAT });

    expect(fake.map).not.toBe(dead);
    expect(fake.map.remove).not.toHaveBeenCalled();
    expect(dead.remove).toHaveBeenCalledTimes(1);
  });
});
