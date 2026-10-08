import {
  type BrandsSection as DraftBrands,
  FUELS,
  type Fuel,
  type MarkedBrand,
  NOTE_MAX,
  PHRASE_MAX,
  type Stance,
} from '@motor-fix/contracts/marked-brands';

export type { Fuel, MarkedBrand, Stance };
export { FUELS, NOTE_MAX, PHRASE_MAX };

// The step's own value always holds the list, even when nothing is marked.
export type BrandsSection = DraftBrands & { brands: MarkedBrand[] };

// Off, then taken, then refused, then off again.
export function next(stance: Stance | undefined): Stance | undefined {
  if (!stance) return 'works_on';
  return stance === 'works_on' ? 'does_not_take' : undefined;
}

// The brand set to a stance, kept in place; undefined takes it out.
export function mark(
  brands: MarkedBrand[],
  brand: { id: string; name: string },
  stance: Stance | undefined,
): MarkedBrand[] {
  if (!stance) return brands.filter((b) => b.brandId !== brand.id);
  const marked = { brandId: brand.id, name: brand.name, stance };
  const held = brands.find((b) => b.brandId === brand.id);
  if (!held) return [...brands, marked];
  // Taken again keeps its fuels; refused drops them.
  const kept =
    stance === 'works_on' && held.stance === 'works_on' && held.fuels
      ? { ...marked, fuels: held.fuels }
      : marked;
  return brands.map((b) => (b.brandId === brand.id ? kept : b));
}

// No fuels held means all four, as a draft kept before fuels existed reads.
export const fuelsOf = (brand: MarkedBrand): Fuel[] =>
  brand.fuels ? [...brand.fuels] : [...FUELS];

export function toggleFuel(
  brands: MarkedBrand[],
  brandId: string,
  fuel: Fuel,
): MarkedBrand[] {
  return brands.map((b) => {
    if (b.brandId !== brandId) return b;
    const held = fuelsOf(b);
    const fuels = FUELS.filter((f) =>
      f === fuel ? !held.includes(f) : held.includes(f),
    );
    return { ...b, fuels };
  });
}

export function counts(brands: MarkedBrand[]) {
  const taken = brands.filter((b) => b.stance === 'works_on').length;
  return { refused: brands.length - taken, taken };
}

// Letters, not UTF-16 units: a diacritic or an emoji counts once.
export const cut = (text: string, max: number) =>
  [...text].slice(0, max).join('');

export const letters = (text: string) => [...text].length;

// The text as the draft holds it: trimmed, within its limit, blank as none.
export function clean(text: string, max: number): string | undefined {
  return cut(text.trim(), max) || undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFuels = (value: unknown) =>
  Array.isArray(value) &&
  value.every((f) => (FUELS as readonly unknown[]).includes(f)) &&
  new Set(value).size === value.length;

const isMarked = (value: unknown): value is MarkedBrand => {
  if (!isRecord(value)) return false;
  const { brandId, fuels, name, stance } = value;
  return (
    typeof brandId === 'string' &&
    typeof name === 'string' &&
    (stance === 'works_on' || stance === 'does_not_take') &&
    (fuels === undefined || (stance === 'works_on' && isFuels(fuels)))
  );
};

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? clean(value, max) : undefined;

const stepTwo = (data: unknown) => {
  if (!isRecord(data)) return undefined;
  const { steps } = data;
  return isRecord(steps) ? steps['2'] : undefined;
};

// Step 2 as the listing draft holds it (`steps['2']`); a kept copy not in
// this shape opens with nothing marked rather than breaking the form.
export function brandsOf(data: unknown): BrandsSection {
  const section = stepTwo(data);
  if (!isRecord(section)) return { brands: [] };
  const { brands } = section;
  if (!Array.isArray(brands) || !brands.every(isMarked)) return { brands: [] };
  const brandNote = text(section['brandNote'], NOTE_MAX);
  const refusalPhrase = text(section['refusalPhrase'], PHRASE_MAX);
  return {
    brands,
    ...(brandNote && { brandNote }),
    ...(refusalPhrase && { refusalPhrase }),
  };
}
