// The filters of a search, read from its query. Server-side: it reads the
// Bucharest clock, which the page's first bundle does not carry.
import { bucharestClock } from './open-status';
import type { SearchMinRating, SearchPriceCeiling } from './search-place';

// What a search keeps among the garages it finds. Open now carries the
// request's instant on the Bucharest clock, read once, so every statement of
// one answer and the profile's status agree on it.
export interface SearchFilters {
  card?: true;
  maxPrice?: SearchPriceCeiling;
  minRating?: SearchMinRating;
  openNow?: ReturnType<typeof bucharestClock>;
  saturday?: true;
}

// The filters a validated query sets, by their names in the address bar;
// none set is no filter at all.
export function filtersOf(
  query: {
    card?: string;
    max_price?: SearchPriceCeiling;
    min_rating?: SearchMinRating;
    open_now?: string;
    open_saturday?: string;
  },
  at: Date,
): SearchFilters | undefined {
  const filters: SearchFilters = {
    ...(query.open_now === '1' && { openNow: bucharestClock(at) }),
    ...(query.open_saturday === '1' && { saturday: true }),
    ...(query.max_price !== undefined && { maxPrice: query.max_price }),
    ...(query.min_rating !== undefined && { minRating: query.min_rating }),
    ...(query.card === '1' && { card: true }),
  };
  return filtersKey(filters) === undefined ? undefined : filters;
}

// Which filters are set, never the instant: the cache key and the cursor
// carry it, so a minute later is still the same search. None without a
// filter, so an unfiltered search keeps its key and its cursors.
export function filtersKey(filters?: SearchFilters): string | undefined {
  const { card, maxPrice, minRating, openNow, saturday } = filters ?? {};
  if (!openNow && !saturday && !card && !maxPrice && !minRating) {
    return undefined;
  }
  return [
    openNow ? '1' : '',
    saturday ? '1' : '',
    maxPrice ?? '',
    minRating ?? '',
    card ? '1' : '',
  ].join(',');
}
