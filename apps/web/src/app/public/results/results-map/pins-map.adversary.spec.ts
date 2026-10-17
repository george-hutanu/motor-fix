import type { GaragePinDto, GaragePinsDto } from '@motor-fix/data-access';
import type { Map as MapLibre } from 'maplibre-gl';

import { drawPins } from './pins-map';

const pinOf = (n: number): GaragePinDto => ({
  id: `g-${n}`,
  lat: 44.4 + n / 1000,
  lng: 26.1 + n / 1000,
  rateLei: 150,
  stance: 'works_on',
});
const answer = (pins: GaragePinDto[]): GaragePinsDto => ({
  pins,
  total: pins.length,
});

type Hit = {
  geometry?: { coordinates: number[] };
  properties?: Record<string, unknown>;
};

function mapFake() {
  const sources = new Map<
    string,
    { setData: jest.Mock; getClusterExpansionZoom: jest.Mock }
  >();
  return {
    addLayer: jest.fn(),
    addSource: jest.fn((id: string) => {
      sources.set(id, {
        getClusterExpansionZoom: jest.fn(async () => 13),
        setData: jest.fn(),
      });
    }),
    easeTo: jest.fn(),
    fitBounds: jest.fn(),
    getBounds: jest.fn(),
    getCanvas: () => document.createElement('canvas'),
    getLayer: jest.fn(() => ({})),
    getSource: jest.fn((id: string) => sources.get(id)),
    jumpTo: jest.fn(),
    on: jest.fn(),
    project: jest.fn(() => ({ x: 0, y: 0 })),
    queryRenderedFeatures: jest.fn((): Hit[] => []),
    removeLayer: jest.fn(),
    removeSource: jest.fn((id: string) => sources.delete(id)),
    setFilter: jest.fn(),
    sources,
  };
}

let map: ReturnType<typeof mapFake>;
let host: HTMLElement;
const moved = jest.fn();
const picked = jest.fn();
const shifted = jest.fn();

beforeEach(() => {
  map = mapFake();
  moved.mockClear();
  picked.mockClear();
  shifted.mockClear();
  host = document.createElement('div');
  host.style.setProperty('--mf-amber', 'rgb(255, 176, 0)');
  document.body.append(host);
});

afterEach(() => host.remove());

const draw = () =>
  drawPins(map as unknown as MapLibre, host, { moved, picked, shifted });
const click = async (hits: Hit[]) => {
  map.queryRenderedFeatures.mockReturnValueOnce(hits);
  for (const [name, handler] of map.on.mock.calls) {
    if (name === 'click') await handler({ point: { x: 1, y: 1 } });
  }
};
const lastFilter = (id: string) =>
  map.setFilter.mock.calls.findLast(([layer]) => layer === id)?.[1];

// @traces 270-FR-004
describe('a tap on the results map, under attack', () => {
  it('names a numeric garage id as a string', async () => {
    draw();

    await click([{ properties: { id: 42 } }]);

    expect(picked).toHaveBeenCalledWith('42');
  });

  it('zooms a cluster whose id is zero', async () => {
    const view = draw();
    view.show(answer(Array.from({ length: 51 }, (_, i) => pinOf(i))));

    await click([
      {
        geometry: { coordinates: [26.1, 44.4] },
        properties: { cluster: true, cluster_id: 0, point_count: 3 },
      },
    ]);

    expect(
      map.sources.get('pins')?.getClusterExpansionZoom,
    ).toHaveBeenCalledWith(0);
    expect(map.easeTo).toHaveBeenCalledWith({ center: [26.1, 44.4], zoom: 13 });
    expect(picked).not.toHaveBeenCalled();
  });

  it('does nothing, and rejects nothing, when the cluster cannot be expanded', async () => {
    const view = draw();
    view.show(answer(Array.from({ length: 51 }, (_, i) => pinOf(i))));
    map.sources
      .get('pins')
      ?.getClusterExpansionZoom.mockRejectedValue(new Error('gone'));

    await expect(
      click([
        {
          geometry: { coordinates: [26.1, 44.4] },
          properties: { cluster: true, cluster_id: 9 },
        },
      ]),
    ).resolves.toBeUndefined();

    expect(map.easeTo).not.toHaveBeenCalled();
    expect(picked).not.toHaveBeenCalled();
  });

  it('names nothing for a hit with no properties', async () => {
    draw();

    await click([{}]);

    expect(picked).toHaveBeenCalledWith(undefined);
  });

  it('names the topmost hit only when a pin and a circle label overlap', async () => {
    draw();

    await click([
      { properties: { id: 'top' } },
      { properties: { id: 'under' } },
    ]);

    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked).toHaveBeenCalledWith('top');
  });

  it('never queries a layer the map does not hold', async () => {
    draw();
    map.getLayer.mockImplementation(() => undefined as never);

    await click([]);

    const [, options] = map.queryRenderedFeatures.mock.calls[0] as unknown as [
      unknown,
      { layers: string[] },
    ];
    expect(options.layers).toEqual([]);
  });
});

// @traces 270-FR-008
describe('the lit garage, under attack', () => {
  it('lights an id holding quote marks and brackets as plain text', () => {
    const view = draw();
    const id = `"]],["==",1,1]\\'`;

    view.light(id);

    expect(lastFilter('areas-lit-fill')).toEqual(['==', ['get', 'id'], id]);
  });

  it('lights one garage then another, and the second replaces the first', () => {
    const view = draw();
    view.light('g-1');
    view.light('g-2');

    expect(lastFilter('pins-lit-dot')).toEqual([
      'all',
      ['!', ['has', 'point_count']],
      ['==', ['get', 'id'], 'g-2'],
    ]);
  });

  it('lights the same garage twice to the same filter', () => {
    const view = draw();
    view.light('g-1');
    const once = lastFilter('pins-lit-rate');
    view.light('g-1');

    expect(lastFilter('pins-lit-rate')).toEqual(once);
  });

  it('keeps the lit circle through a redraw of the pins with a mobile mechanic', () => {
    const view = draw();
    view.light('mech');

    view.show(answer([{ ...pinOf(1), id: 'mech', serviceRadiusKm: 20 }]));

    expect(lastFilter('areas-lit-fill')).toEqual(['==', ['get', 'id'], 'mech']);
    expect(lastFilter('pins-lit-dot')).toEqual([
      'all',
      ['!', ['has', 'point_count']],
      ['==', ['get', 'id'], 'mech'],
    ]);
  });

  it('shows with no answer and lights nothing wrong', () => {
    const view = draw();
    view.light('g-1');

    expect(() => view.show(undefined)).not.toThrow();
    expect(lastFilter('areas-lit-fill')).toEqual(['==', ['get', 'id'], 'g-1']);
  });
});
