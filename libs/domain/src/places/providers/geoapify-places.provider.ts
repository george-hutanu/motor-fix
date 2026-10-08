import {
  ADDRESS_MAX,
  inRomania,
  PLACE_SUGGESTIONS_MAX,
} from '@motor-fix/contracts/place-section';
import { Logger } from '@nestjs/common';

import {
  type PlaceSuggestion,
  type PlacesAnswer,
  type PlacesProvider,
} from './places.provider';

const ENDPOINT = 'https://api.geoapify.com/v1/geocode/autocomplete';
const TIMEOUT_MS = 3000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const suggestionOf = (row: unknown): PlaceSuggestion | null => {
  if (typeof row !== 'object' || row === null) return null;
  const { formatted, lat, lon } = row as Record<string, unknown>;
  const label = typeof formatted === 'string' ? formatted.trim() : '';
  // A label the address field would refuse is no suggestion.
  if (!label || label.length > ADDRESS_MAX) return null;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inRomania(lat, lon))
    return null;
  return { label, lat, lng: lon };
};

// Geoapify's address autocomplete, asked for Romania only. Its log lines and
// answers carry the reason it failed, never the key or what was typed.
export class GeoapifyPlaces implements PlacesProvider {
  readonly name = 'geoapify';
  private readonly logger = new Logger('Places');

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async search(q: string, lang: string): Promise<PlacesAnswer> {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({
      apiKey: this.apiKey,
      filter: 'countrycode:ro',
      format: 'json',
      lang,
      limit: String(PLACE_SUGGESTIONS_MAX),
      text: q,
    }).toString();
    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = (error as Error | undefined)?.name === 'TimeoutError';
      return this.unavailable(timedOut ? 'timeout' : 'network');
    }
    if (!response.ok) return this.unavailable(String(response.status));
    const body: unknown = await response.json().catch(() => null);
    const results = (body as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) return this.unavailable('malformed');
    return {
      items: results
        .map(suggestionOf)
        .filter((item): item is PlaceSuggestion => item !== null)
        .slice(0, PLACE_SUGGESTIONS_MAX),
    };
  }

  private unavailable(reason: string): PlacesAnswer {
    this.logger.warn(`address search unavailable: ${reason}`);
    return { unavailable: reason };
  }
}
