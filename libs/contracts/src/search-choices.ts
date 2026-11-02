// The choices a list of results can narrow by: the hourly rate a card shows,
// at most, in whole lei; the rating, at least, as the garage table holds it.
// Browser-safe, and apart from search-place, which the page's first bundle
// carries: only Results reads these, so they stay in its lazy chunk.

export const SEARCH_PRICE_CEILINGS = [150, 200, 250, 300] as const;
export type SearchPriceCeiling = (typeof SEARCH_PRICE_CEILINGS)[number];
export const SEARCH_MIN_RATINGS = ['3.5', '4.0', '4.5'] as const;
export type SearchMinRating = (typeof SEARCH_MIN_RATINGS)[number];
