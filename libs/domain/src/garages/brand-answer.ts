import {
  type BrandRefDto,
  FUELS,
  type Fuel,
  type GarageBrandAnswerDto,
  type GarageBrandOwnerAnswerDto,
  type PublicBrandDto,
} from '@motor-fix/contracts';

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

// The same answer with the fuels each taken brand works on.
export function brandAnswerWithFuels(
  rows: (Row & Record<Fuel, boolean>)[],
  texts: { brandNote: string | null; refusalPhrase: string | null },
): GarageBrandAnswerDto & { worksOn: PublicBrandDto[] } {
  const answer = brandAnswer(rows, texts);
  const fuels = new Map(
    rows.map((row) => [row.brand.id, FUELS.filter((fuel) => row[fuel])]),
  );
  return {
    ...answer,
    worksOn: answer.worksOn.map((brand) => ({
      ...brand,
      fuels: fuels.get(brand.id) ?? [],
    })),
  };
}

// The answer the owner's write returns: each taken brand with the jobs ticked
// for it, in price-list order; a tick whose job left the list comes last.
export function brandAnswerWithJobs(
  rows: Row[],
  texts: { brandNote: string | null; refusalPhrase: string | null },
  ticks: { brandId: string; jobTypeId: string }[],
  priceList: string[],
): GarageBrandOwnerAnswerDto {
  const answer = brandAnswer(rows, texts);
  const place = (id: string) => {
    const at = priceList.indexOf(id);
    return at === -1 ? priceList.length : at;
  };
  return {
    ...answer,
    worksOn: answer.worksOn.map((brand) => ({
      ...brand,
      jobs: ticks
        .filter((t) => t.brandId === brand.id)
        .map((t) => t.jobTypeId)
        .sort((a, b) => place(a) - place(b)),
    })),
  };
}
