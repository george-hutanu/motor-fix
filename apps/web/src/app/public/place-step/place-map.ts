import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { PLACE_ZOOM } from '@motor-fix/contracts/place-section';
import type { GeoJSONSource, Marker } from 'maplibre-gl';

import {
  circleBounds,
  closeMapLibre,
  type LatLng,
  openMapLibre,
  ring,
  styleFor,
} from '../map-libre/map-libre';

export type { LatLng };

export interface PlaceMapEvents {
  dragged(at: LatLng): void;
  failed(): void;
  recovered(): void;
  tapped(at: LatLng): void;
}

// What the map shows: the pin, and for a mobile mechanic the radius of the
// service circle around it.
export interface Shown {
  at?: LatLng;
  km?: number;
}

export interface PlaceMap {
  destroy(): void;
  show(next: Shown): void;
}

export type OpenPlaceMap = (
  host: HTMLElement,
  events: PlaceMapEvents,
) => Promise<PlaceMap>;

// The view moves only when a placement starts (the first pin, or one set
// outside the view) or the radius changes; any other move keeps the zoom the
// user chose.
export function viewFor(
  prev: Shown,
  next: Shown,
  inView: boolean,
): 'circle' | 'keep' | 'street' {
  if (!next.at) return 'keep';
  if (!prev.at || !inView) return next.km ? 'circle' : 'street';
  if (next.km !== undefined && next.km !== prev.km) return 'circle';
  return 'keep';
}

async function openPlaceMap(
  host: HTMLElement,
  events: PlaceMapEvents,
  style: string,
): Promise<PlaceMap> {
  // Once loaded, an error (one failed tile is enough) is only reported, and
  // the first render after it that settles with no error of its own reports
  // the recovery.
  const map = await openMapLibre(host, style, (loaded) => {
    let down = false;
    let erred = false;
    loaded.on('error', () => {
      down = erred = true;
      events.failed();
    });
    loaded.on('idle', () => {
      if (down && !erred) {
        down = false;
        events.recovered();
      }
      erred = false;
    });
  });
  const maplibre = await import('maplibre-gl');
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
  let shown: Shown = {};
  const draw = ({ at, km }: Shown) =>
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
  const place = (at: LatLng | undefined) => {
    if (!at) {
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
    marker.setLngLat([at.lng, at.lat]).addTo(map);
  };
  const frame = (next: Shown) => {
    const { at, km } = next;
    if (!at) return;
    const move = viewFor(
      shown,
      next,
      map.getBounds().contains([at.lng, at.lat]),
    );
    if (move === 'circle' && km)
      map.fitBounds(circleBounds(at, km), { animate: false, padding: 24 });
    else if (move === 'street')
      map.jumpTo({ center: [at.lng, at.lat], zoom: PLACE_ZOOM });
  };

  return {
    destroy: () => closeMapLibre(map),
    show(next) {
      draw(next);
      place(next.at);
      frame(next);
      shown = next;
    },
  };
}

// Opens the map of step 5 in the browser; the component never sees MapLibre,
// which is fetched only when the step is shown.
export const PLACE_MAP = new InjectionToken<OpenPlaceMap>('PLACE_MAP', {
  factory: () => {
    const document = inject(DOCUMENT);
    return (host, events) => openPlaceMap(host, events, styleFor(document));
  },
});
