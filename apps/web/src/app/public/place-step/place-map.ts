import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { PLACE_ZOOM } from '@motor-fix/contracts/place-section';
import type { GeoJSONSource, Map as MapLibre, Marker } from 'maplibre-gl';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlaceMapEvents {
  dragged(at: LatLng): void;
  failed(): void;
  tapped(at: LatLng): void;
}

export interface PlaceMap {
  circle(km: number | undefined): void;
  destroy(): void;
  pin(at: LatLng | undefined): void;
}

export type OpenPlaceMap = (
  host: HTMLElement,
  events: PlaceMapEvents,
) => Promise<PlaceMap>;

const STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/liberty',
};
// Romania whole, before anything is placed.
const START = { center: [24.97, 45.94] as [number, number], zoom: 5.2 };
const KM_PER_DEGREE = 111.32;

// A test, the e2e suite and the PR QA run point the map at the app's own
// empty style, so no tile is fetched from outside.
function styleFor(document: Document) {
  const view = document.defaultView as
    | (Window & { __MF_MAP_STYLE?: string })
    | null;
  if (view?.__MF_MAP_STYLE) return view.__MF_MAP_STYLE;
  return view?.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? STYLES.dark
    : STYLES.light;
}

function ring({ lat, lng }: LatLng, km: number): [number, number][] {
  const dLat = km / KM_PER_DEGREE;
  const dLng = km / (KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: 65 }, (_, i) => {
    const angle = (i / 64) * 2 * Math.PI;
    return [lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)];
  });
}

// MapLibre's worker and stylesheet are copied to /map by the build
// (project.json assets) rather than bundled: the worker is looked up beside
// the module that loads it, which a bundle moves, and the stylesheet would
// weigh on every page's first load.
export function mapAssets(document: Document) {
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

async function openMapLibre(
  host: HTMLElement,
  events: PlaceMapEvents,
  style: string,
): Promise<PlaceMap> {
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
    map.once('load', () => resolve());
    map.once('error', ({ error }) => {
      map.remove();
      reject(error);
    });
  });
  map.on('error', () => events.failed());
  map.on('click', ({ lngLat }) =>
    events.tapped({ lat: lngLat.lat, lng: lngLat.lng }),
  );

  const look = getComputedStyle(host);
  const accent =
    look.getPropertyValue('--mf-focus').trim() || look.color || 'black';
  map.addSource('radius', {
    data: { features: [], type: 'FeatureCollection' },
    type: 'geojson',
  });
  map.addLayer({
    id: 'radius-fill',
    paint: { 'fill-color': accent, 'fill-opacity': 0.15 },
    source: 'radius',
    type: 'fill',
  });
  map.addLayer({
    id: 'radius-line',
    paint: { 'line-color': accent, 'line-width': 2 },
    source: 'radius',
    type: 'line',
  });

  let marker: Marker | undefined;
  let at: LatLng | undefined;
  let km: number | undefined;
  const draw = () =>
    (map.getSource('radius') as GeoJSONSource).setData({
      features:
        at && km
          ? [
              {
                geometry: { coordinates: [ring(at, km)], type: 'Polygon' },
                properties: {},
                type: 'Feature',
              },
            ]
          : [],
      type: 'FeatureCollection',
    });

  return {
    circle(next) {
      km = next;
      draw();
    },
    destroy: () => map.remove(),
    pin(next) {
      at = next;
      draw();
      if (!next) {
        marker?.remove();
        marker = undefined;
        return;
      }
      if (!marker) {
        marker = new maplibre.Marker({ draggable: true });
        marker.on('dragend', () => {
          const { lat, lng } = (marker as Marker).getLngLat();
          events.dragged({ lat, lng });
        });
      }
      marker.setLngLat([next.lng, next.lat]).addTo(map);
      if (!map.getBounds().contains([next.lng, next.lat]) || map.getZoom() < 10)
        map.jumpTo({ center: [next.lng, next.lat], zoom: PLACE_ZOOM });
    },
  };
}

// Opens the map of step 5 in the browser; the component never sees MapLibre,
// which is fetched only when the step is shown.
export const PLACE_MAP = new InjectionToken<OpenPlaceMap>('PLACE_MAP', {
  factory: () => {
    const document = inject(DOCUMENT);
    return (host, events) => openMapLibre(host, events, styleFor(document));
  },
});
