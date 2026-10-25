import {
  bucketFor,
  project,
  snapCentre,
  unproject,
} from '@motor-fix/contracts/map-view';

import { boundsOf, FIT_PADDING, fitView, paddingOf } from './fit-view';

const BOX = { h: 600, w: 800 };
const EVEN = { bottom: 40, left: 40, right: 40, top: 40 };
const A = { lat: 44.5, lng: 26.0 };
const B = { lat: 44.3, lng: 26.2 };

// Where a place lands on a map box of the view, in pixels from its centre.
const offset = (
  at: { lat: number; lng: number },
  view: ReturnType<typeof fitView>,
) => {
  const p = project(at, view.zoom);
  const c = project(view.center, view.zoom);
  return { x: p.x - c.x, y: p.y - c.y };
};

// @traces 1196-FR-011
describe('fitView, the view the static image and the first fit share', () => {
  it('frames the bounds inside the box less its padding, at the largest whole zoom that holds them', () => {
    const view = fitView(boundsOf([A, B]), BOX, EVEN);
    const inside = (z: number) => {
      const nw = project({ lat: A.lat, lng: A.lng }, z);
      const se = project({ lat: B.lat, lng: B.lng }, z);
      return se.x - nw.x <= BOX.w - 80 && se.y - nw.y <= BOX.h - 80;
    };

    expect(Number.isInteger(view.zoom)).toBe(true);
    expect(inside(view.zoom)).toBe(true);
    expect(inside(view.zoom + 1)).toBe(false);
  });

  it('centres the bounds, snapped as the image service snaps for the box width', () => {
    const view = fitView(boundsOf([A, B]), BOX, EVEN);
    const nw = project({ lat: A.lat, lng: A.lng }, view.zoom);
    const se = project({ lat: B.lat, lng: B.lng }, view.zoom);
    const middle = unproject(
      { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 },
      view.zoom,
    );

    expect(view.center).toEqual(snapCentre(middle, view.zoom, bucketFor(800)));
  });

  it('never goes past zoom 15 for a single place', () => {
    const view = fitView(boundsOf([A]), BOX, EVEN);

    expect(view.zoom).toBe(15);
    expect(view.center).toEqual(snapCentre(A, 15, bucketFor(800)));
  });

  it('takes a lower cap when it is given one', () => {
    expect(fitView(boundsOf([A]), BOX, EVEN, 12).zoom).toBe(12);
  });

  it('never goes under zoom 5, however wide the bounds', () => {
    const view = fitView(
      boundsOf([
        { lat: 43.6, lng: 20.3 },
        { lat: 48.3, lng: 29.7 },
      ]),
      { h: 320, w: 320 },
      EVEN,
    );

    expect(view.zoom).toBe(5);
  });

  it('shifts the centre by half of a covered band, as the interactive fit does', () => {
    const plain = fitView(boundsOf([A, B]), BOX, EVEN);
    const covered = fitView(boundsOf([A, B]), BOX, {
      ...EVEN,
      bottom: 240,
      top: 106,
    });
    const step = bucketFor(800) / 8;
    const middle = { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };

    // The bands narrow the room, so the zoom may drop one step: compare the
    // middle's place on screen, which the bands push up by (240 − 106) / 2.
    const up = offset(middle, covered).y;
    expect(Math.abs(up - -67)).toBeLessThanOrEqual(step / 2 + 1);
    expect(Math.abs(offset(middle, plain).y)).toBeLessThanOrEqual(step / 2 + 1);
  });

  it('shows Romania whole at zoom 5 with no place and no pin', () => {
    expect(fitView(undefined, BOX, EVEN)).toEqual({
      center: snapCentre({ lat: 45.94, lng: 24.97 }, 5, bucketFor(800)),
      zoom: 5,
    });
  });

  it('keeps the centre inside Romania, where the image service takes it', () => {
    const view = fitView(boundsOf([{ lat: 43.55, lng: 28.6 }]), BOX, {
      ...EVEN,
      bottom: 600,
    });

    expect(view.center.lat).toBeGreaterThanOrEqual(43.5);
  });
});

describe('boundsOf and paddingOf', () => {
  it('gives no bounds for no point', () => {
    expect(boundsOf([])).toBeUndefined();
  });

  it('spans every point it is given', () => {
    expect(boundsOf([A, B, { lat: 44.4, lng: 26.5 }])).toEqual({
      east: 26.5,
      north: 44.5,
      south: 44.3,
      west: 26.0,
    });
  });

  it("adds the covered bands to the fit's 40 px padding", () => {
    expect(FIT_PADDING).toBe(40);
    expect(paddingOf(70)).toEqual({
      bottom: 110,
      left: 40,
      right: 40,
      top: 40,
    });
    expect(paddingOf(200, 66)).toEqual({
      bottom: 240,
      left: 40,
      right: 40,
      top: 106,
    });
  });
});
