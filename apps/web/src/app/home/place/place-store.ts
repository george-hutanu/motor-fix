import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { ADDRESS_MAX, inRomania } from '@motor-fix/contracts/place-section';
import { roundCoordinate } from '@motor-fix/contracts/search-place';

export interface Place {
  // None for the browser's location: the line then says "near you".
  label: string | null;
  lat: number;
  lng: number;
  origin: 'location' | 'address';
}

const KEY = 'mf-place';

export function parsePlace(value: unknown): Place | null {
  if (typeof value !== 'object' || value === null) return null;
  const { label, lat, lng, origin } = value as Partial<Place>;
  const labelled =
    label === null ||
    (typeof label === 'string' && label.length <= ADDRESS_MAX);
  const point =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    inRomania(lat, lng);
  if (!labelled || !point || (origin !== 'location' && origin !== 'address'))
    return null;
  return { label: label ?? null, lat, lng, origin };
}

// The browser keeps the visitor's own choice; it is read before the first
// render, so the first count already carries it.
@Injectable({ providedIn: 'root' })
export class PlaceStore {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly place = signal<Place | null>(this.browser ? this.read() : null);

  set(place: Place) {
    const rounded = {
      ...place,
      lat: roundCoordinate(place.lat),
      lng: roundCoordinate(place.lng),
    };
    this.place.set(rounded);
    try {
      localStorage.setItem(KEY, JSON.stringify(rounded));
    } catch {
      // Storage refused: the place lasts for this visit only.
    }
  }

  // A place shown but not kept: the Setări city, so a later edit there still
  // reaches Home.
  use(place: Place) {
    this.place.set(place);
  }

  private read(): Place | null {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === null) return null;
      const place = parsePlace(safeJson(stored));
      if (!place) localStorage.removeItem(KEY);
      return place;
    } catch {
      return null;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
