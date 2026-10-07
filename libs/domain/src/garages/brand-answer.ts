import type { BrandRefDto, GarageBrandAnswerDto } from '@motor-fix/contracts';

import type { GarageBrandStance } from '../generated/prisma/client';

type Row = {
  stance: GarageBrandStance;
  brand: BrandRefDto & { popularity: number | null };
};

// Most popular first, unranked last, then by name: the catalogue's order.
const byCatalogue = (a: Row, b: Row) =>
  (a.brand.popularity ?? Number.POSITIVE_INFINITY) -
    (b.brand.popularity ?? Number.POSITIVE_INFINITY) ||
  a.brand.name.localeCompare(b.brand.name);

const refs = (rows: Row[], stance: GarageBrandStance) =>
  rows
    .filter((r) => r.stance === stance)
    .sort(byCatalogue)
    .map(({ brand: { id, name, slug } }) => ({ id, name, slug }));

// A garage's brand answer as anyone reads it.
export function brandAnswer(
  rows: Row[],
  texts: { brandNote: string | null; refusalPhrase: string | null },
): GarageBrandAnswerDto {
  return {
    brandNote: texts.brandNote,
    doesNotTake: refs(rows, 'does_not_take'),
    refusalPhrase: texts.refusalPhrase,
    worksOn: refs(rows, 'works_on'),
  };
}
