import type { ParamMap } from '@angular/router';
import {
  SEARCH_MIN_RATINGS,
  SEARCH_PRICE_CEILINGS,
  type SearchMinRating,
  type SearchPriceCeiling,
} from '@motor-fix/contracts/search-place';
import { formatRating, type Language } from '@motor-fix/i18n';

// The filters of the results page, as the address bar names them. The API
// judges which garages match; the page only carries the choice.
export type SwitchKey = 'open_now' | 'open_saturday' | 'card';
export type FilterKey = SwitchKey | 'max_price' | 'min_rating';
export interface Filters {
  open_now: boolean;
  open_saturday: boolean;
  max_price?: SearchPriceCeiling;
  min_rating?: SearchMinRating;
  card: boolean;
}

export const OFF: Filters = {
  card: false,
  open_now: false,
  open_saturday: false,
};

export const SWITCHES: readonly { key: SwitchKey; label: string }[] = [
  { key: 'open_now', label: 'public.results.filters.openNow' },
  { key: 'open_saturday', label: 'public.results.filters.openSaturday' },
  { key: 'card', label: 'public.results.filters.card' },
];

// The page's order: the bar, the request, the chips and the panel follow it.
export const ORDER: readonly FilterKey[] = [
  'open_now',
  'open_saturday',
  'max_price',
  'min_rating',
  'card',
];

// The query patch that takes every filter out of the bar in one write.
export const NONE: Record<FilterKey, null> = {
  card: null,
  max_price: null,
  min_rating: null,
  open_now: null,
  open_saturday: null,
};

// A switch is on only when its key's first value is 1, a choice only when it
// is one of the API's values written exactly; anything else reads as off and
// is left in the bar as it stands.
export function filtersIn(bar: ParamMap): Filters {
  const filters: Filters = {
    card: bar.get('card') === '1',
    open_now: bar.get('open_now') === '1',
    open_saturday: bar.get('open_saturday') === '1',
  };
  const price = SEARCH_PRICE_CEILINGS.find(
    (c) => String(c) === bar.get('max_price'),
  );
  const rating = SEARCH_MIN_RATINGS.find((r) => r === bar.get('min_rating'));
  if (price) filters.max_price = price;
  if (rating) filters.min_rating = rating;
  return filters;
}

const on = (filters: Filters, key: FilterKey) =>
  key === 'max_price' || key === 'min_rating'
    ? filters[key] !== undefined
    : filters[key];

export function countOf(filters: Filters): number {
  return ORDER.filter((key) => on(filters, key)).length;
}

export interface FilterParams {
  open_now?: '1';
  open_saturday?: '1';
  max_price?: SearchPriceCeiling;
  min_rating?: SearchMinRating;
  card?: '1';
}

// The request's parameters for the filters on, in the page's order: 1 for a
// switch, the value for a choice, nothing for one off.
export function filterParams(filters: Filters): FilterParams {
  return Object.fromEntries(
    ORDER.filter((key) => on(filters, key)).map((key) => [
      key,
      key === 'max_price' || key === 'min_rating' ? filters[key] : '1',
    ]),
  );
}

export interface Chip {
  key: FilterKey;
  label: string;
  params?: Record<string, string | number>;
}

// One chip per filter on, in the page's order; a rating reads as the
// language writes it.
export function chipsOf(filters: Filters, language: Language): Chip[] {
  return ORDER.filter((key) => on(filters, key)).map((key): Chip => {
    if (key === 'max_price')
      return {
        key,
        label: 'public.results.filters.priceChip',
        params: { n: filters.max_price as number },
      };
    if (key === 'min_rating')
      return {
        key,
        label: 'public.results.filters.ratingChip',
        params: { r: formatRating(Number(filters.min_rating), language) },
      };
    const row = SWITCHES.find((s) => s.key === key) as (typeof SWITCHES)[0];
    return { key, label: row.label };
  });
}

// A request without the filters.
export function unfiltered<Q extends Partial<Record<FilterKey, unknown>>>(
  query: Q,
): Omit<Q, FilterKey> {
  const {
    card: _card,
    max_price: _price,
    min_rating: _rating,
    open_now: _now,
    open_saturday: _saturday,
    ...rest
  } = query;
  return rest;
}
