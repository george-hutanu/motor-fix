import type { FieldProblem } from '@motor-fix/contracts';

const L = 'public.listing';

// The text each field problem reads, by the field's path with any row index
// taken out (`steps.3.jobs[2].to` is `steps.3.jobs[].to`) and the code. The
// steps' own texts stay where they had one; the rest are the check's.
const TEXTS: Readonly<Record<string, string>> = {
  'declaration:invalid': `${L}.declaration.nameShort`,
  'declaration:required': `${L}.check.declarationNeeded`,
  'documents.onrc_certificate:document_missing': `${L}.check.documentMissing`,
  'documents.rar_authorisation:document_missing': `${L}.check.documentMissing`,
  'email:invalid': `${L}.emailInvalid`,
  'email:required': `${L}.emailNeeded`,
  'files:required': `${L}.check.photosNeeded`,
  'steps.1.businessKind:required': `${L}.check.kindNeeded`,
  'steps.1.knownFor:invalid': `${L}.check.knownForLong`,
  'steps.1.knownFor:required': `${L}.details.knownForNeeded`,
  'steps.1.mobileLegalForm:required': `${L}.check.legalFormNeeded`,
  'steps.1.name:invalid': `${L}.details.nameLength`,
  'steps.1.name:required': `${L}.details.nameLength`,
  'steps.1.phone:invalid': `${L}.details.phoneRomanian`,
  'steps.1.phone:required': `${L}.details.phoneNeeded`,
  'steps.2.brands:required': `${L}.check.brandsNeeded`,
  'steps.2.brands[]:no_requests': `${L}.brands.noRequests`,
  'steps.3.jobs:required': `${L}.check.jobsNeeded`,
  'steps.3.jobs[].name:invalid': `${L}.check.jobNameLength`,
  'steps.4.mechanics[].name:invalid': `${L}.mechanics.nameNeeded`,
  'steps.5.courtesyCar.pricePerDayBani:invalid': `${L}.hours.courtesy.priceRange`,
  'steps.5.courtesyCar.pricePerDayBani:required': `${L}.hours.courtesy.priceMissing`,
  'steps.5.hours:required': `${L}.check.hoursNeeded`,
  'steps.5.payments:required': `${L}.hours.payment.needed`,
  'steps.5.place.address:required': `${L}.check.addressNeeded`,
  'steps.5.place.lat:invalid': `${L}.place.outside`,
  'steps.5.place.lat:required': `${L}.check.positionNeeded`,
  'steps.5.place.radiusKm:invalid': `${L}.check.radiusNeeded`,
  'steps.6.cui:cui_in_use': `${L}.check.cuiInUse`,
  'steps.6.cui:invalid': `${L}.cuiInvalid`,
  'steps.6.cui:required': `${L}.check.cuiNeeded`,
  'steps.6.rarNumber:invalid': `${L}.rarShort`,
  'steps.6.rarNumber:required': `${L}.check.rarNeeded`,
};

// A mobile mechanic's place is the registered seat, with texts of its own.
const SEAT: Readonly<Record<string, string>> = {
  'steps.5.place.address:required': `${L}.check.seatAddressNeeded`,
  'steps.5.place.lat:required': `${L}.check.seatPositionNeeded`,
};

// Every end of a price range reads the range check's own texts.
const RANGE_END = /^steps\.3\.(labour|jobs\[\])\.(from|to)$/;

const pattern = (field: string) => field.replace(/\[\d+\]/g, '[]');

export function textKey(problem: FieldProblem, mobile = false): string {
  const key = `${pattern(problem.field)}:${problem.code}`;
  const text = (mobile && SEAT[key]) || TEXTS[key];
  if (text) return text;
  if (RANGE_END.test(pattern(problem.field)))
    return problem.code === 'wide_range'
      ? `${L}.prices.wideRange`
      : `${L}.prices.errors.${problem.code}`;
  return problem.code === 'required'
    ? `${L}.check.required`
    : `${L}.check.invalid`;
}
