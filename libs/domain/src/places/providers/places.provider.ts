export interface PlaceSuggestion {
  label: string;
  lat: number;
  lng: number;
}

// Why the search could not answer: a status, `timeout`, `network`,
// `malformed` or `not_configured`. Logged and counted, never sent on.
export type PlacesAnswer =
  | { items: PlaceSuggestion[] }
  | { unavailable: string };

// A text in, at most five places in Romania out.
export interface PlacesProvider {
  readonly name: string;
  search(q: string, lang: string): Promise<PlacesAnswer>;
}

export const PLACES_PROVIDER = Symbol('PLACES_PROVIDER');
