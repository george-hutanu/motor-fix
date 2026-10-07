// The company and RAR check of a listing: the form and the server read the
// two values by the same rules.

export const RAR_NUMBER_MIN = 3;
const STEP6_VALUE_MAX = 40;

export interface Step6Section {
  cui?: string;
  rarNumber?: string;
}

const CUI_KEY = [7, 5, 3, 2, 1, 7, 5, 3, 2];
const CUI_SHAPE = /^\d{2,10}$/;

// What the owner typed without its spaces and the RO a VAT payer puts first.
export const stripCui = (input: string): string =>
  input.replace(/\s+/g, '').replace(/^ro/i, '');

// The control digit: the digits before it, right-aligned to nine places,
// weighted by 753217532, summed, times 10, mod 11, and 10 reads as 0.
export function isValidCui(stripped: string): boolean {
  if (!CUI_SHAPE.test(stripped)) return false;
  const body = stripped.slice(0, -1).padStart(CUI_KEY.length, '0');
  const sum = CUI_KEY.reduce(
    (total, weight, i) => total + weight * +body[i],
    0,
  );
  return ((sum * 10) % 11) % 10 === +stripped.slice(-1);
}

export const normaliseRarNumber = (input: string): string =>
  input.trim().toUpperCase().slice(0, STEP6_VALUE_MAX);

const STEP6_KEYS = new Set(['cui', 'rarNumber']);

// The section as stored: only the two keys, each a string of at most 40 UTF-16
// code units (what `length` and the input's `maxlength` count).
// Whether a value is valid is the form's to say; the draft keeps it as typed.
export function isStep6Section(value: unknown): value is Step6Section {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  return Object.entries(value).every(
    ([key, field]) =>
      STEP6_KEYS.has(key) &&
      typeof field === 'string' &&
      field.length <= STEP6_VALUE_MAX,
  );
}
