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
