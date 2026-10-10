import type { FieldProblem } from './problem';

// Money is held in whole bani; the screens show whole lei.
const BANI_PER_LEU = 100;
export const PRICE_MIN_BANI = 100;
export const PRICE_MAX_BANI = 10_000_000;
// A price list's jobs, and a proposed job's name; step 2 reads them too.
export const JOB_NAME_MIN = 2;
export const JOB_NAME_MAX = 80;
export const JOBS_MAX = 50;
const DURATION_MIN_MINUTES = 15;
const DURATION_MAX_MINUTES = 4_800;
const DURATION_STEP_MINUTES = 15;
// A top more than this many times the starting price is shown as a warning.
const PRICE_RANGE_WARN_RATIO = 3;

export function leiToBani(lei: number): number {
  const bani = lei * BANI_PER_LEU;
  if (!Number.isInteger(lei) || !Number.isSafeInteger(bani)) {
    throw new RangeError(`${lei} is not a whole number of lei`);
  }
  return bani;
}

export const baniToLei = (bani: number): number => bani / BANI_PER_LEU;

interface PriceRangeInput {
  fromBani: number;
  toBani?: number | null;
  durationMinutes?: number | null;
}

interface PriceRangeCheck {
  errors: FieldProblem[];
  warnings: FieldProblem[];
}

const isSet = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined;

function fromError(fromBani: number) {
  if (!Number.isInteger(fromBani)) return 'integer';
  if (fromBani < PRICE_MIN_BANI) return 'min';
  if (fromBani > PRICE_MAX_BANI) return 'max';
  return undefined;
}

function toError(toBani: number, fromBani: number, fromValid: boolean) {
  if (!Number.isInteger(toBani)) return 'integer';
  if (fromValid && toBani < fromBani) return 'below_from';
  if (toBani > PRICE_MAX_BANI) return 'max';
  return undefined;
}

function durationError(minutes: number) {
  if (!Number.isInteger(minutes)) return 'integer';
  if (minutes < DURATION_MIN_MINUTES) return 'min';
  if (minutes > DURATION_MAX_MINUTES) return 'max';
  if (minutes % DURATION_STEP_MINUTES !== 0) return 'step';
  return undefined;
}

// One error at most per field, every field judged, so a form can mark all
// of them at once. Field names are relative to the range.
export function checkPriceRange(range: PriceRangeInput): PriceRangeCheck {
  const { durationMinutes, fromBani, toBani } = range;
  const errors: FieldProblem[] = [];
  const from = fromError(fromBani);
  if (from) errors.push({ code: from, field: 'from' });
  const to = isSet(toBani) ? toError(toBani, fromBani, !from) : undefined;
  if (to) errors.push({ code: to, field: 'to' });
  const duration = isSet(durationMinutes)
    ? durationError(durationMinutes)
    : undefined;
  if (duration) errors.push({ code: duration, field: 'duration' });
  const wide =
    !from && !to && isSet(toBani) && toBani > PRICE_RANGE_WARN_RATIO * fromBani;
  return {
    errors,
    warnings: wide ? [{ code: 'wide_range', field: 'to' }] : [],
  };
}

// Shaped as the draft's step 3, so a half-typed range reaches the write and
// is refused there; every start is required, and the labour top too.
export interface StartingPricesInput {
  labour: { fromBani?: number | null; toBani?: number | null };
  // A catalogue job by id, or a name the garage proposes; exactly one.
  jobs: Array<{
    jobTypeId?: string;
    name?: string;
    brandId?: string | null;
    fromBani?: number | null;
    toBani?: number | null;
  }>;
}

export interface StartingPricesResult {
  labour: { fromBani: number; toBani: number; warnings: FieldProblem[] };
  jobs: Array<{
    id: string;
    jobTypeId: string;
    brandId: string | null;
    fromBani: number;
    toBani: number | null;
    durationMinutes: number | null;
    visible: true;
    position: number;
    warnings: FieldProblem[];
  }>;
}
