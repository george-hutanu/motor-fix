// Step 2 of the listing form as the draft holds it: only the brands the owner
// marked, the fuels a taken brand works on, and the two optional texts. The
// form, the draft save and the write at submit read it by these rules.
// Browser-safe: no Nest or validator import.

import { isSetOf } from './garage-hours';
import { FUELS } from './plate';
import { JOB_NAME_MAX, JOB_NAME_MIN, JOBS_MAX } from './price-range';

export { FUELS };
export type Fuel = (typeof FUELS)[number];

export type Stance = 'works_on' | 'does_not_take';

// `fuels` absent means all four, so a draft kept before fuels existed keeps
// its meaning; an empty list means none.
export interface MarkedBrand {
  brandId: string;
  name: string;
  stance: Stance;
  fuels?: Fuel[];
  // The price list's jobs the garage does not do on this brand: a catalogue
  // job by its id, a proposed one by its name. Absent means every job.
  unticked?: string[];
}

export interface BrandsSection {
  brands?: MarkedBrand[];
  brandNote?: string;
  refusalPhrase?: string;
}

export const NOTE_MAX = 140;
export const PHRASE_MAX = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const textUpTo = (value: unknown, max: number) =>
  value === undefined ||
  (typeof value === 'string' && [...value].length <= max);

const isFuels = isSetOf<Fuel>(FUELS);

const isJobRef = (ref: unknown) =>
  typeof ref === 'string' &&
  (UUID.test(ref) ||
    (ref.length >= JOB_NAME_MIN && ref.length <= JOB_NAME_MAX));

// A uuid is the same job in either case; a name only as written.
const isUnticked = (refs: unknown) =>
  Array.isArray(refs) &&
  refs.length <= JOBS_MAX &&
  refs.every(isJobRef) &&
  new Set(refs.map((ref: string) => (UUID.test(ref) ? ref.toLowerCase() : ref)))
    .size === refs.length;

function isMarkedBrand(value: unknown): value is MarkedBrand {
  if (!isRecord(value)) return false;
  const { brandId, fuels, name, stance, unticked } = value;
  return (
    onlyKeys(value, ['brandId', 'name', 'stance', 'fuels', 'unticked']) &&
    typeof brandId === 'string' &&
    UUID.test(brandId) &&
    typeof name === 'string' &&
    (stance === 'works_on' || stance === 'does_not_take') &&
    (fuels === undefined || (stance === 'works_on' && isFuels(fuels))) &&
    (unticked === undefined || (stance === 'works_on' && isUnticked(unticked)))
  );
}

export function isBrandsSection(value: unknown): value is BrandsSection {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ['brands', 'brandNote', 'refusalPhrase'])
  )
    return false;
  const { brandNote, brands, refusalPhrase } = value;
  if (!textUpTo(brandNote, NOTE_MAX) || !textUpTo(refusalPhrase, PHRASE_MAX))
    return false;
  if (brands === undefined) return true;
  return (
    Array.isArray(brands) &&
    brands.every(isMarkedBrand) &&
    new Set(brands.map((brand) => brand.brandId.toLowerCase())).size ===
      brands.length
  );
}

// Keyed in FUELS order: the history records a brand's fuels in that order.
export const fuelColumns = (fuels?: readonly Fuel[]): Record<Fuel, boolean> =>
  Object.fromEntries(
    FUELS.map((fuel) => [fuel, fuels === undefined || fuels.includes(fuel)]),
  ) as Record<Fuel, boolean>;
