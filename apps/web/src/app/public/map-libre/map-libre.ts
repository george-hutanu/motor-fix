import type { MapEventType, Map as MapLibre } from 'maplibre-gl';

export interface LatLng {
  lat: number;
  lng: number;
}

const STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/liberty',
};
// Romania whole, before anything is placed.
export const START = { center: [24.97, 45.94] as [number, number], zoom: 5.2 };
const KM_PER_DEGREE = 111.32;
// A map whose style has not loaded by then is given up as unavailable.
const LOAD_MS = 10_000;

type MapWindow = Window & { __MF_MAP?: MapLibre; __MF_MAP_STYLE?: string };

// A test, the e2e suite and the PR QA run point the map at the app's own
// empty style, so no tile is fetched from outside.
export function styleFor(document: Document) {
  const view = document.defaultView as MapWindow | null;
  if (view?.__MF_MAP_STYLE) return view.__MF_MAP_STYLE;
  return view?.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? STYLES.dark
    : STYLES.light;
}

export function span(lat: number, km: number) {
  return {
    dLat: km / KM_PER_DEGREE,
    dLng: km / (KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180)),
  };
}

export function circleBounds(
  { lat, lng }: LatLng,
  km: number,
): [[number, number], [number, number]] {
  const { dLat, dLng } = span(lat, km);
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat + dLat],
  ];
}

export function ring({ lat, lng }: LatLng, km: number): [number, number][] {
  const { dLat, dLng } = span(lat, km);
  return Array.from({ length: 65 }, (_, i) => {
    const angle = (i / 64) * 2 * Math.PI;
    return [lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)];
  });
}

// MapLibre's worker and stylesheet are copied to /map by the build
// (project.json assets) rather than bundled: the worker is looked up beside
// the module that loads it, which a bundle moves, and the stylesheet would
// weigh on every page's first load.
function mapAssets(document: Document) {
  const sheet = new URL('/map/maplibre-gl.css', document.baseURI).href;
  const links = document.head.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"]',
  );
  if (!Array.from(links).some((link) => link.href === sheet)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = sheet;
    document.head.append(link);
  }
  return {
    workerUrl: new URL('/map/maplibre-gl-worker.mjs', document.baseURI).href,
  };
}

// A MapLibre map over Romania, answered once its style has loaded. A failure
// before that, or no load within 10 s, removes it and rejects; once loaded,
// an error (one failed tile is enough) is the caller's to handle. `loaded`
// runs at the load itself, before any later event can reach the map.
export async function openMapLibre(
  host: HTMLElement,
  style: string,
  loaded?: (map: MapLibre) => void,
): Promise<MapLibre> {
  const { workerUrl } = mapAssets(host.ownerDocument);
  const maplibre = await import('maplibre-gl');
  maplibre.setWorkerUrl(workerUrl);
  const map: MapLibre = new maplibre.Map({
    attributionControl: { compact: true },
    container: host,
    cooperativeGestures: true,
    style,
    ...START,
  });
  map.addControl(
    new maplibre.NavigationControl({ showCompass: false }),
    'top-right',
  );
  await new Promise<void>((resolve, reject) => {
    const give = (error: unknown) => {
      clearTimeout(timer);
      map.off('load', load);
      map.off('error', broken);
      map.remove();
      reject(error);
    };
    const timer = setTimeout(
      () => give(new Error('the map did not load in time')),
      LOAD_MS,
    );
    const load = () => {
      clearTimeout(timer);
      map.off('error', broken);
      loaded?.(map);
      resolve();
    };
    const broken = ({ error }: MapEventType['error']) => give(error);
    map.once('error', broken);
    map.once('load', load);
  });
  // Under the test style the e2e suite reads the view off the live map.
  const view = host.ownerDocument.defaultView as MapWindow | null;
  if (view?.__MF_MAP_STYLE) view.__MF_MAP = map;
  return map;
}

// Only ever called in the browser, where a map exists.
export function closeMapLibre(map: MapLibre) {
  map.remove();
  const view = globalThis as unknown as MapWindow;
  if (view.__MF_MAP === map) delete view.__MF_MAP;
}

// Keeps the map's canvas, controls and attribution links out of the keyboard
// order, those MapLibre adds later too, while the pointer can still move the
// map; `inert` would stop both. Returns the call that stops watching.
export function keepOutOfTabOrder(host: HTMLElement) {
  const hide = () => {
    for (const control of host.querySelectorAll<HTMLElement>(
      'a, button, canvas, [tabindex]',
    )) {
      if (control.tabIndex !== -1) control.tabIndex = -1;
    }
  };
  hide();
  const watch = new MutationObserver(hide);
  watch.observe(host, { childList: true, subtree: true });
  return () => watch.disconnect();
}
