import type { GaragePinDto, GaragePinsDto } from '@motor-fix/data-access';

import { CLUSTER_ABOVE, CLUSTER_CELL, overlayOf, quietLabels } from './overlay';
import { span } from '../map-libre/map-libre';

// MapLibre's own MercatorCoordinate.fromLngLat in its 512-px world and the
// screen position `map.project` gives at a centre and zoom: maplibre-gl needs
// a browser to load, so its formulas are copied here.
const mercator = ({ lat, lng }: { lat: number; lng: number }) => ({
  x: (180 + lng) / 360,
  y:
    (180 -
      (180 / Math.PI) *
        Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) /
    360,
});
const onScreen = (
  at: { lat: number; lng: number },
  view: { center: { lat: number; lng: number }; zoom: number },
  box: { w: number; h: number },
) => {
  const size = 512 * 2 ** view.zoom;
  const p = mercator(at);
  const c = mercator(view.center);
  return {
    x: (p.x - c.x) * size + box.w / 2,
    y: (p.y - c.y) * size + box.h / 2,
  };
};

const VIEW = { center: { lat: 44.43, lng: 26.1 }, zoom: 12 };
const BOX = { h: 500, w: 390 };
const PLACE = { lat: 44.437, lng: 26.117 };
const pinOf = (n: number, over: Partial<GaragePinDto> = {}): GaragePinDto => ({
  id: `g-${n}`,
  lat: 44.4 + n / 1000,
  lng: 26.07 + n / 1000,
  rateLei: 150,
  stance: 'works_on',
  ...over,
});
const answer = (pins: GaragePinDto[]): GaragePinsDto => ({
  pins,
  total: pins.length,
});

// @traces 1196-FR-012
describe('overlayOf, what the browser draws over the static image', () => {
  it('places every pin within a pixel of where the interactive map draws it', () => {
    const pins = [
      pinOf(1),
      pinOf(2, { lat: 44.47, lng: 26.15 }),
      pinOf(3, { lat: 44.39, lng: 26.04 }),
    ];
    const drawn = overlayOf(answer(pins), PLACE, VIEW, BOX);

    for (const [i, pin] of pins.entries()) {
      const want = onScreen(pin, VIEW, BOX);
      expect(Math.abs(drawn.pins[i].x - want.x)).toBeLessThan(1);
      expect(Math.abs(drawn.pins[i].y - want.y)).toBeLessThan(1);
    }
  });

  it("labels each pin with its rate and colours it by the garage's stance", () => {
    const drawn = overlayOf(
      answer([pinOf(1), pinOf(2, { rateLei: null, stance: 'does_not_take' })]),
      undefined,
      VIEW,
      BOX,
    );

    expect(
      drawn.pins.map(({ id, rate, takes }) => ({ id, rate, takes })),
    ).toEqual([
      { id: 'g-1', rate: '150', takes: true },
      { id: 'g-2', rate: '', takes: false },
    ]);
    expect(drawn.clusters).toEqual([]);
  });

  it(`draws up to ${CLUSTER_ABOVE} fixed pins one by one`, () => {
    const pins = Array.from({ length: CLUSTER_ABOVE }, (_, n) => pinOf(n));
    const drawn = overlayOf(answer(pins), undefined, VIEW, BOX);

    expect(drawn.pins).toHaveLength(CLUSTER_ABOVE);
    expect(drawn.clusters).toEqual([]);
  });

  it(`counts more than ${CLUSTER_ABOVE} fixed pins into circles on a ${CLUSTER_CELL}-px grid of its own`, () => {
    const pins = Array.from({ length: CLUSTER_ABOVE + 1 }, (_, n) =>
      pinOf(n, { lat: 44.43 + (n % 3) * 0.0001, lng: 26.1 + (n % 3) * 0.0001 }),
    );
    const drawn = overlayOf(answer(pins), undefined, VIEW, BOX);
    const at = onScreen(pins[0], VIEW, BOX);

    expect(CLUSTER_CELL).toBe(48);
    expect(drawn.pins).toEqual([]);
    expect(drawn.clusters).toEqual([
      {
        count: CLUSTER_ABOVE + 1,
        x: (Math.floor(at.x / 48) + 0.5) * 48,
        y: (Math.floor(at.y / 48) + 0.5) * 48,
      },
    ]);
  });

  it('keeps a lone pin of a crowded answer in a cell of its own', () => {
    const pins = [
      ...Array.from({ length: CLUSTER_ABOVE }, (_, n) =>
        pinOf(n, { lat: 44.43, lng: 26.1 }),
      ),
      pinOf(99, { lat: 44.46, lng: 26.16 }),
    ];
    const counts = overlayOf(answer(pins), undefined, VIEW, BOX)
      .clusters.map((cluster) => cluster.count)
      .sort((a, b) => a - b);

    expect(counts).toEqual([1, CLUSTER_ABOVE]);
  });

  it('draws a mobile mechanic as a circle of its service radius, never as a pin', () => {
    const mobile = pinOf(7, { lat: 44.45, lng: 26.12, serviceRadiusKm: 5 });
    const drawn = overlayOf(answer([mobile]), undefined, VIEW, BOX);
    const centre = onScreen(mobile, VIEW, BOX);
    const edge = onScreen(
      { lat: mobile.lat + span(mobile.lat, 5).dLat, lng: mobile.lng },
      VIEW,
      BOX,
    );

    expect(drawn.pins).toEqual([]);
    expect(drawn.circles).toHaveLength(1);
    expect(drawn.circles[0]).toMatchObject({
      id: 'g-7',
      rate: '150',
      takes: true,
    });
    expect(Math.abs(drawn.circles[0].x - centre.x)).toBeLessThan(1);
    expect(Math.abs(drawn.circles[0].y - centre.y)).toBeLessThan(1);
    expect(Math.abs(drawn.circles[0].r - (centre.y - edge.y))).toBeLessThan(1);
  });

  it('leaves mobile mechanics out of the count that clusters the pins', () => {
    const pins = [
      ...Array.from({ length: CLUSTER_ABOVE }, (_, n) => pinOf(n)),
      pinOf(98, { serviceRadiusKm: 10 }),
    ];
    const drawn = overlayOf(answer(pins), undefined, VIEW, BOX);

    expect(drawn.pins).toHaveLength(CLUSTER_ABOVE);
    expect(drawn.circles).toHaveLength(1);
  });

  it('puts the "you are here" marker at the place, and none without one', () => {
    const at = onScreen(PLACE, VIEW, BOX);
    const marker = overlayOf(answer([]), PLACE, VIEW, BOX).marker;

    expect(Math.abs((marker?.x ?? 0) - at.x)).toBeLessThan(1);
    expect(Math.abs((marker?.y ?? 0) - at.y)).toBeLessThan(1);
    expect(overlayOf(answer([]), undefined, VIEW, BOX).marker).toBeUndefined();
  });

  it('draws nothing before the pins have answered', () => {
    expect(overlayOf(undefined, undefined, VIEW, BOX)).toEqual({
      circles: [],
      clusters: [],
      pins: [],
    });
  });
});

// QA lap 6 at 390 px: the lit pin's rate drew over its neighbour's. The
// interactive map lets no two labels overlap and places the lit one first.
// @traces 1196-FR-012
describe('quietLabels, the rates that give way', () => {
  const pin = (id: string, x: number, y: number, rate = '180') => ({
    id,
    rate,
    takes: true,
    x,
    y,
  });

  it('keeps every rate where none meet', () => {
    expect(quietLabels([pin('a', 0, 0), pin('b', 100, 0)], undefined)).toEqual(
      new Set(),
    );
  });

  it('quiets the later of two rates that meet', () => {
    expect(quietLabels([pin('a', 0, 0), pin('b', 20, 4)], undefined)).toEqual(
      new Set(['b']),
    );
  });

  it('places the lit pin’s rate first, so its neighbour gives way', () => {
    expect(quietLabels([pin('a', 0, 0), pin('b', 20, 4)], 'b')).toEqual(
      new Set(['a']),
    );
  });

  it('lets rates one above the other stand when their boxes do not meet', () => {
    expect(quietLabels([pin('a', 0, 0), pin('b', 0, 20)], undefined)).toEqual(
      new Set(),
    );
  });

  it('never quiets a pin with no rate, nor lets it push another away', () => {
    expect(
      quietLabels([pin('a', 0, 0, ''), pin('b', 4, 0)], undefined),
    ).toEqual(new Set());
  });
});
