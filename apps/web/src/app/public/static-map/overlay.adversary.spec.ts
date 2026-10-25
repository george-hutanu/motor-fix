import type { GaragePinDto, GaragePinsDto } from '@motor-fix/data-access';

import { CLUSTER_ABOVE, overlayOf } from './overlay';

const VIEW = { center: { lat: 44.43, lng: 26.1 }, zoom: 12 };
const BOX = { h: 600, w: 390 };
const pin = (n: number, over: Partial<GaragePinDto> = {}): GaragePinDto => ({
  id: `g-${n}`,
  lat: 44.4 + (n % 20) / 1000,
  lng: 26.05 + Math.floor(n / 20) / 1000,
  rateLei: 150,
  stance: 'works_on',
  ...over,
});
const answer = (pins: GaragePinDto[]): GaragePinsDto => ({
  pins,
  total: pins.length,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => pin(i));

// @traces 1196-FR-012
describe('overlayOf, empty and many', () => {
  it('draws nothing for no answer and no place', () => {
    expect(overlayOf(undefined, undefined, VIEW, BOX)).toEqual({
      circles: [],
      clusters: [],
      pins: [],
    });
  });

  it('draws nothing for an answer with no pins', () => {
    expect(overlayOf(answer([]), undefined, VIEW, BOX)).toEqual({
      circles: [],
      clusters: [],
      pins: [],
    });
  });

  it('draws 50 fixed pins as pins and 51 as clusters whose counts add up to 51', () => {
    const fifty = overlayOf(answer(many(CLUSTER_ABOVE)), undefined, VIEW, BOX);
    expect(fifty.pins).toHaveLength(50);
    expect(fifty.clusters).toEqual([]);

    const fiftyOne = overlayOf(
      answer(many(CLUSTER_ABOVE + 1)),
      undefined,
      VIEW,
      BOX,
    );
    expect(fiftyOne.pins).toEqual([]);
    expect(fiftyOne.clusters.reduce((sum, c) => sum + c.count, 0)).toBe(51);
  });

  it('counts only fixed pins toward the cluster threshold: fifty fixed beside many mobile ones stay pins', () => {
    const mobile = Array.from({ length: 40 }, (_, i) =>
      pin(1000 + i, { serviceRadiusKm: 5 }),
    );
    const drawn = overlayOf(
      answer([...many(50), ...mobile]),
      undefined,
      VIEW,
      BOX,
    );
    expect(drawn.pins).toHaveLength(50);
    expect(drawn.circles).toHaveLength(40);
    expect(drawn.clusters).toEqual([]);
  });

  it('clusters ten thousand pins into counts that add up to ten thousand', () => {
    const drawn = overlayOf(answer(many(10000)), undefined, VIEW, BOX);
    expect(drawn.clusters.reduce((sum, c) => sum + c.count, 0)).toBe(10000);
  });

  it('counts pins left of and above the box in clusters of their own, not with those on screen', () => {
    const far = Array.from({ length: 30 }, (_, i) =>
      pin(i, { lat: 45.5 + i / 100000, lng: 25 }),
    );
    const near = Array.from({ length: 30 }, (_, i) =>
      pin(100 + i, { lat: 44.43, lng: 26.1 }),
    );
    const drawn = overlayOf(answer([...far, ...near]), undefined, VIEW, BOX);
    expect(drawn.clusters.length).toBeGreaterThanOrEqual(2);
    expect(drawn.clusters.reduce((sum, c) => sum + c.count, 0)).toBe(60);
  });
});

// @traces 1196-FR-012
describe('overlayOf, positions and labels', () => {
  it('puts a pin at the view centre in the middle of the box', () => {
    const drawn = overlayOf(
      answer([pin(1, { lat: 44.43, lng: 26.1 })]),
      { lat: 44.43, lng: 26.1 },
      VIEW,
      BOX,
    );
    expect(drawn.pins[0].x).toBeCloseTo(195, 6);
    expect(drawn.pins[0].y).toBeCloseTo(300, 6);
    expect(drawn.marker?.x).toBeCloseTo(195, 6);
    expect(drawn.marker?.y).toBeCloseTo(300, 6);
  });

  it('puts a point north of the centre above it and east of it to the right', () => {
    const drawn = overlayOf(
      answer([pin(1, { lat: 44.5, lng: 26.2 })]),
      undefined,
      VIEW,
      BOX,
    );
    expect(drawn.pins[0].y).toBeLessThan(300);
    expect(drawn.pins[0].x).toBeGreaterThan(195);
  });

  it('keeps no marker without a place', () => {
    const drawn = overlayOf(answer([pin(1)]), undefined, VIEW, BOX);
    expect('marker' in drawn).toBe(false);
  });

  it('labels a pin without a rate with nothing and a rate of zero with 0', () => {
    const drawn = overlayOf(
      answer([pin(1, { rateLei: null }), pin(2, { rateLei: 0 })]),
      undefined,
      VIEW,
      BOX,
    );
    expect(drawn.pins.map((p) => p.rate)).toEqual(['', '0']);
  });

  it('marks only works_on as taking the car', () => {
    const drawn = overlayOf(
      answer([
        pin(1, { stance: 'works_on' }),
        pin(2, { stance: 'does_not_take' }),
        pin(3, { stance: 'unstated' }),
      ]),
      undefined,
      VIEW,
      BOX,
    );
    expect(drawn.pins.map((p) => p.takes)).toEqual([true, false, false]);
  });

  it('draws a mobile mechanic as a circle of its radius in pixels, as Web Mercator scales it', () => {
    const drawn = overlayOf(
      answer([pin(1, { lat: 44.43, lng: 26.1, serviceRadiusKm: 5 })]),
      undefined,
      VIEW,
      BOX,
    );
    const metresPerPixel =
      (40030173.6 * Math.cos((44.43 * Math.PI) / 180)) / (512 * 2 ** 12);
    expect(drawn.circles[0].r).toBeCloseTo(5000 / metresPerPixel, 0);
    expect(drawn.pins).toEqual([]);
  });

  it('draws a radius of zero as a circle of zero pixels, not as a pin', () => {
    const drawn = overlayOf(
      answer([pin(1, { serviceRadiusKm: 0 })]),
      undefined,
      VIEW,
      BOX,
    );
    expect(drawn.circles).toHaveLength(1);
    expect(drawn.circles[0].r).toBe(0);
    expect(drawn.pins).toEqual([]);
  });

  it('answers the same overlay twice and leaves its input as it was', () => {
    const input = answer(many(12));
    const copy = JSON.stringify(input);
    const first = overlayOf(input, { lat: 44.4, lng: 26 }, VIEW, BOX);
    expect(overlayOf(input, { lat: 44.4, lng: 26 }, VIEW, BOX)).toEqual(first);
    expect(JSON.stringify(input)).toBe(copy);
  });

  it('draws no NaN position for a box with no size', () => {
    const drawn = overlayOf(answer([pin(1)]), { lat: 44.4, lng: 26 }, VIEW, {
      h: 0,
      w: 0,
    });
    expect(Number.isNaN(drawn.pins[0].x)).toBe(false);
    expect(Number.isNaN(drawn.marker?.y)).toBe(false);
  });
});
