import type {
  DetailsSection,
  MechanicsSection,
  PricesSection,
} from '@motor-fix/contracts/listing-sections';
import {
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  type PlaceSection,
} from '@motor-fix/contracts/place-section';
import { baniToLei } from '@motor-fix/contracts/price-range';

import { initials } from '../../dashboard/initials';
import { type BrandAnswer, written } from '../brand-verdict/brand-verdict';
import type { BrandsSection, MarkedBrand } from '../brands-section';

interface PreviewCardInput {
  details: DetailsSection;
  brands: BrandsSection;
  prices: PricesSection | undefined;
  mechanics: MechanicsSection;
  // Only its radius is read: the seat address never reaches the card.
  place?: PlaceSection;
  // Brand ids in the order the brands step shows its chips.
  order: string[];
}

// What a driver would see of the garage, and nothing else: the phone, the
// seat address, the brand note and the specialities never reach it.
interface PreviewCard {
  name: string | null;
  range: { from: number | null; to: number | null } | null;
  brands: BrandAnswer | null;
  sample: { id: string; name: string } | null;
  mechanics: { name: string; initials: string }[];
  mobileKm: number | null;
}

// A kept draft may hold null for an end the owner cleared.
const lei = (bani: number | null | undefined) =>
  bani == null ? null : baniToLei(bani);

function range(prices: PricesSection | undefined): PreviewCard['range'] {
  const from = lei(prices?.labour?.fromBani);
  const to = lei(prices?.labour?.toBani);
  return from === null && to === null ? null : { from, to };
}

// Known brands in display order; brands the step does not show keep their
// draft order, after them. A brand the draft repeats counts once.
function inOrder(brands: MarkedBrand[], order: string[]): MarkedBrand[] {
  // Linear lookups: a draft can carry thousands of brands.
  const seen = new Set<string>();
  const once = brands.filter((b) => {
    if (seen.has(b.brandId)) return false;
    seen.add(b.brandId);
    return true;
  });
  const position = new Map<string, number>();
  order.forEach((id, i) => {
    if (!position.has(id)) position.set(id, i);
  });
  const rank = (b: MarkedBrand) => position.get(b.brandId) ?? order.length;
  return once.sort((a, b) => rank(a) - rank(b));
}

export function previewCard(input: PreviewCardInput): PreviewCard {
  const marked = inOrder(input.brands.brands, input.order);
  const ref = (b: MarkedBrand) => ({ id: b.brandId, name: b.name });
  const taken = marked.filter((b) => b.stance === 'works_on');
  const refused = marked.filter((b) => b.stance === 'does_not_take');
  const refusalPhrase = written(input.brands.refusalPhrase);
  const first = taken[0];
  return {
    brands:
      marked.length || refusalPhrase
        ? {
            brandNote: null,
            doesNotTake: refused.map(ref),
            refusalPhrase,
            worksOn: taken.map(ref),
          }
        : null,
    mechanics: input.mechanics.onProfile
      ? (input.mechanics.mechanics ?? []).flatMap((m) => {
          const name = m.name.trim();
          return name ? [{ initials: initials(name), name }] : [];
        })
      : [],
    mobileKm:
      input.details.businessKind === 'mobile'
        ? (input.place?.radiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM)
        : null,
    name: written(input.details.name),
    range: range(input.prices),
    sample: first ? { id: first.brandId, name: first.name } : null,
  };
}
