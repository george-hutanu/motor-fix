import { baniToLei } from '@motor-fix/contracts';
import type {
  DetailsSection,
  MechanicsSection,
  PricesSection,
} from '@motor-fix/contracts/listing-sections';

import { initials } from '../../dashboard/initials';
import { type BrandAnswer, written } from '../brand-verdict';
import type { BrandsSection, MarkedBrand } from '../brands-section';

// The service area a mobile mechanic is shown with until the form asks for one.
const MOBILE_KM = 20;

interface PreviewCardInput {
  details: DetailsSection;
  brands: BrandsSection;
  prices: PricesSection | undefined;
  mechanics: MechanicsSection;
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
  const once = brands.filter(
    (b, i) => brands.findIndex((c) => c.brandId === b.brandId) === i,
  );
  const rank = (b: MarkedBrand) => {
    const at = order.indexOf(b.brandId);
    return at === -1 ? order.length : at;
  };
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
    mobileKm: input.details.businessKind === 'mobile' ? MOBILE_KM : null,
    name: written(input.details.name),
    range: range(input.prices),
    sample: first ? { id: first.brandId, name: first.name } : null,
  };
}
