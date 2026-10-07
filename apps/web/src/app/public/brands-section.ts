export type Stance = 'works_on' | 'does_not_take';

export interface MarkedBrand {
  brandId: string;
  name: string;
  stance: Stance;
}

// Step 2 of the listing draft: only the brands the owner marked, and the two
// optional texts, each absent when blank.
export interface BrandsSection {
  brands: MarkedBrand[];
  brandNote?: string;
  refusalPhrase?: string;
}

export const NOTE_MAX = 140;
export const PHRASE_MAX = 60;

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
  return brands.some((b) => b.brandId === brand.id)
    ? brands.map((b) => (b.brandId === brand.id ? marked : b))
    : [...brands, marked];
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

const isMarked = (value: unknown): value is MarkedBrand => {
  if (!isRecord(value)) return false;
  const { brandId, name, stance } = value;
  return (
    typeof brandId === 'string' &&
    typeof name === 'string' &&
    (stance === 'works_on' || stance === 'does_not_take')
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
