// What a quote may hold, read by the API's checks and the web's dialog alike.
export const QUOTE_DURATION_MIN_MINUTES = 15;
export const QUOTE_DURATION_MAX_MINUTES = 7_200;
export const QUOTE_NOTE_MAX = 500;
// The Idempotency-Key header a send carries, as the column's CHECK allows.
export const QUOTE_IDEMPOTENCY_KEY_MAX = 200;
// A quote's range is in whole lei and reaches past the price list's top.
export const QUOTE_LEI_MIN = 1;
export const QUOTE_LEI_MAX = 1_000_000;
