import { mapAssets } from './place-map';

const sheets = () =>
  Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).filter((link) => link.href.endsWith('/map/maplibre-gl.css'));

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
