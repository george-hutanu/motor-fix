import type { ParamMap } from '@angular/router';

// The filters of the results page, as the address bar names them. The API
// judges which garages match (ST-1260); the page only carries the choice.
export type FilterKey = 'open_now' | 'open_saturday';
export type Filters = Record<FilterKey, boolean>;

export const FILTERS: readonly { key: FilterKey; label: string }[] = [
  { key: 'open_now', label: 'public.results.filters.openNow' },
  { key: 'open_saturday', label: 'public.results.filters.openSaturday' },
];

// A filter is on only when its key's first value is 1; anything else reads
// as off and is left in the bar as it stands.
export function filtersIn(bar: ParamMap): Filters {
  return {
    open_now: bar.get('open_now') === '1',
    open_saturday: bar.get('open_saturday') === '1',
  };
}

export function countOf(filters: Filters): number {
  return FILTERS.filter(({ key }) => filters[key]).length;
}

// The request's parameters for the filters on: 1 each, nothing for one off.
export function filterParams(
  filters: Filters,
): Partial<Record<FilterKey, '1'>> {
  return Object.fromEntries(
    FILTERS.filter(({ key }) => filters[key]).map(({ key }) => [key, '1']),
  );
}

// A request without the filters: the ids= reads name their garages outright.
export function unfiltered<Q extends Partial<Record<FilterKey, unknown>>>(
  query: Q,
): Omit<Q, FilterKey> {
  const { open_now: _now, open_saturday: _saturday, ...rest } = query;
  return rest;
}
