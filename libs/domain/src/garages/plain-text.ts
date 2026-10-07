// A text field as the services read it: anything that is not a string the
// database can store, a NUL among it, counts as no text at all.
export const plainText = (value: unknown): string =>
  typeof value === 'string' && !value.includes('\u0000') ? value : '';
