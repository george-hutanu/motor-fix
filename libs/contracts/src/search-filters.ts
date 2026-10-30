// The filters of a search, read from its query. Server-side: it reads the
// Bucharest clock, which the page's first bundle does not carry.
import { bucharestClock } from './open-status';

// What a search keeps among the garages it finds. Open now carries the
// request's instant on the Bucharest clock, read once, so every statement of
// one answer and the profile's status agree on it.
export interface SearchFilters {
  openNow?: ReturnType<typeof bucharestClock>;
  saturday?: true;
}

export function filtersOf(
  query: { open_now?: string; open_saturday?: string },
  at: Date,
): SearchFilters | undefined {
  const openNow = query.open_now === '1';
  const saturday = query.open_saturday === '1';
  if (!openNow && !saturday) return undefined;
  return {
    ...(openNow && { openNow: bucharestClock(at) }),
    ...(saturday && { saturday: true }),
  };
}

// Which filters are set, never the instant: the cache key and the cursor
// carry it, so a minute later is still the same search.
export const filtersKey = (filters?: SearchFilters) =>
  filters && `${filters.openNow ? '1' : ''},${filters.saturday ? '1' : ''}`;
