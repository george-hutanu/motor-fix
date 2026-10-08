// A text field as the services read it: anything that is not a string the
// database can store, a NUL among it, counts as no text at all.
export const plainText = (value: unknown): string =>
  typeof value === 'string' && !value.includes('\u0000') ? value : '';

// An entry of a list the services read: an object, not null or a list.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
