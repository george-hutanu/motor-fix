import { ROMANIA_BOUNDS } from '@motor-fix/contracts';
import { project } from '@motor-fix/contracts/map-view';

import { boundsOf, fitView, paddingOf, pointsOf } from './fit-view';

const EVEN = paddingOf();
const inRomania = ({ lat, lng }: { lat: number; lng: number }) =>
  lat >= ROMANIA_BOUNDS.latMin &&
  lat <= ROMANIA_BOUNDS.latMax &&
  lng >= ROMANIA_BOUNDS.lngMin &&
  lng <= ROMANIA_BOUNDS.lngMax;

// @traces 1196-FR-011
describe('boundsOf and pointsOf, empty and many', () => {
  it('has no bounds for no points', () => {
    expect(boundsOf([])).toBeUndefined();
  });

  it('bounds one point as a box of zero size', () => {
    expect(boundsOf([{ lat: 45, lng: 25 }])).toEqual({
      east: 25,
      north: 45,
      south: 45,
      west: 25,
    });
  });

  it('bounds ten thousand points without overflowing the stack', () => {
    const points = Array.from({ length: 10000 }, (_, i) => ({
      lat: 44 + (i % 100) / 100,
      lng: 25 + Math.floor(i / 100) / 100,
    }));
    expect(boundsOf(points)).toEqual({
      east: 25.99,
      north: 44.99,
      south: 44,
      west: 25,
    });
  });

  it('leaves out every mobile mechanic, even one with a radius of zero', () => {
    const answer = {
      pins: [
        { id: 'a', lat: 44, lng: 25, rateLei: 1, stance: 'works_on' as const },
        {
          id: 'b',
          lat: 45,
          lng: 26,
          rateLei: 1,
          serviceRadiusKm: 0,
          stance: 'works_on' as const,
        },
      ],
      total: 2,
    };
    expect(pointsOf(undefined, answer)).toEqual([{ lat: 44, lng: 25 }]);
  });

  it('gives no points for no place and no answer, also when they are null', () => {
    expect(pointsOf(undefined, undefined)).toEqual([]);
    expect(pointsOf(null as never, null as never)).toEqual([]);
  });

  it('copies only lat and lng of a pin, nothing else', () => {
    const answer = {
      pins: [
        { id: 'a', lat: 44, lng: 25, rateLei: 1, stance: 'works_on' as const },
      ],
      total: 1,
    };
    expect(pointsOf({ lat: 1, lng: 2 }, answer)).toEqual([
      { lat: 1, lng: 2 },
      { lat: 44, lng: 25 },
    ]);
  });
});

// @traces 1196-FR-011
describe('fitView, hostile boxes and bounds', () => {
  it('zooms to 15 for a single point', () => {
    const view = fitView(
      boundsOf([{ lat: 44.43, lng: 26.1 }]),
      { h: 500, w: 390 },
      EVEN,
    );
    expect(view.zoom).toBe(15);
  });

  it('never goes past a maxZoom of 20 given by a caller: the image service stops at 16', () => {
    const view = fitView(
      boundsOf([{ lat: 44.43, lng: 26.1 }]),
      { h: 500, w: 390 },
      EVEN,
      20,
    );
    expect(view.zoom).toBe(16);
  });

  it('stays at the lowest served zoom when the padding eats the whole box', () => {
    const view = fitView(
      boundsOf([
        { lat: 44, lng: 25 },
        { lat: 45, lng: 26 },
      ]),
      { h: 100, w: 100 },
      paddingOf(500, 500),
    );
    expect(view.zoom).toBe(5);
    expect(Number.isFinite(view.center.lat)).toBe(true);
    expect(Number.isFinite(view.center.lng)).toBe(true);
  });

  it('stays at zoom 5 for a box with no size', () => {
    const view = fitView(
      boundsOf([
        { lat: 44, lng: 25 },
        { lat: 45, lng: 26 },
      ]),
      { h: 0, w: 0 },
      EVEN,
    );
    expect(view.zoom).toBe(5);
  });

  it('answers a whole zoom from 5 to 16 and a centre in Romania for the whole country', () => {
    const view = fitView(
      boundsOf([
        { lat: ROMANIA_BOUNDS.latMin, lng: ROMANIA_BOUNDS.lngMin },
        { lat: ROMANIA_BOUNDS.latMax, lng: ROMANIA_BOUNDS.lngMax },
      ]),
      { h: 600, w: 320 },
      EVEN,
    );
    expect(Number.isInteger(view.zoom)).toBe(true);
    expect(view.zoom).toBeGreaterThanOrEqual(5);
    expect(inRomania(view.center)).toBe(true);
  });

  it('answers the same view when called twice with the same arguments', () => {
    const bounds = boundsOf([
      { lat: 44.4, lng: 26 },
      { lat: 44.5, lng: 26.2 },
    ]);
    const box = { h: 640, w: 390 };
    expect(fitView(bounds, box, EVEN)).toEqual(fitView(bounds, box, EVEN));
  });

  it('does not change the bounds, box or padding it is given', () => {
    const bounds = { east: 26.2, north: 44.5, south: 44.4, west: 26 };
    const box = { h: 640, w: 390 };
    const padding = paddingOf(100, 20);
    const copy = JSON.stringify([bounds, box, padding]);
    fitView(bounds, box, padding);
    expect(JSON.stringify([bounds, box, padding])).toBe(copy);
  });

  it('keeps a covered bottom band clear: the bounds sit above the covered band on the box', () => {
    const bounds = boundsOf([
      { lat: 44.4, lng: 26 },
      { lat: 44.5, lng: 26.2 },
    ]);
    const box = { h: 700, w: 390 };
    const view = fitView(bounds, box, paddingOf(300, 0));
    const c = project(view.center, view.zoom);
    const south = project({ lat: 44.4, lng: 26 }, view.zoom);
    expect(south.y - c.y + box.h / 2).toBeLessThanOrEqual(box.h - 300 + 8);
  });

  it('answers a centre the image service takes for pins on every edge of Romania, in every bucket', () => {
    const corners = [
      { lat: ROMANIA_BOUNDS.latMin, lng: ROMANIA_BOUNDS.lngMin },
      { lat: ROMANIA_BOUNDS.latMin, lng: ROMANIA_BOUNDS.lngMax },
      { lat: ROMANIA_BOUNDS.latMax, lng: ROMANIA_BOUNDS.lngMin },
      { lat: ROMANIA_BOUNDS.latMax, lng: ROMANIA_BOUNDS.lngMax },
    ];
    for (const corner of corners) {
      for (const w of [300, 390, 700, 1100, 1280]) {
        const view = fitView(boundsOf([corner]), { h: 500, w }, EVEN);
        expect(inRomania(view.center)).toBe(true);
      }
    }
  });
});
