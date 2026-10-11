// Whether a listing can be sent: every value it still lacks or holds wrong,
// and the notes that do not stop it. The form and the server read this one
// judgement, each field named by its path in the draft. Browser-safe.

import { EMAIL_PATTERN } from '../email';
import {
  type HoursSection,
  hasOpenDay,
  isCourtesyPrice,
  needsCourtesyPrice,
} from '../garage-hours';
import {
  DECLARED_NAME_MAX,
  DECLARED_NAME_MIN,
  DOCUMENT_KINDS,
  documentDone,
} from '../legal-documents/legal-documents';
import { hasConfirmedPhoto } from '../listing-photos/listing-photos';
import {
  type DetailsSection,
  isRomanianPhone,
  JOB_NAME_MAX,
  JOB_NAME_MIN,
  KNOWN_FOR_MAX,
  type ListingDraftData,
  MECHANIC_NAME_MAX,
  MECHANIC_NAME_MIN,
  NAME_MAX,
  NAME_MIN,
  type PriceEnds,
  type PriceEntry,
} from '../listing-sections';
import { isValidCui, RAR_NUMBER_MIN } from '../listing-verification';
import type { BrandsSection } from '../marked-brands';
import { normalisePhone } from '../phone';
import { inRomania, type PlaceSection, radiusAllowed } from '../place-section';
import { checkPriceRange } from '../price-range';
import type { FieldProblem } from '../problem';

const EMAIL_MAX = 254;
const EMAIL_MIN = 3;

export interface ListingCheckInput {
  data: ListingDraftData;
  // The draft's address lives on its row; judged only when passed.
  email?: string;
}

export interface ListingCheck {
  errors: FieldProblem[];
  warnings: FieldProblem[];
}

export type ListingStep = 1 | 2 | 3 | 4 | 5 | 6;

type Steps = NonNullable<ListingDraftData['steps']>;

// A catalogue job by its id, a proposed one by its name: the ref step 2's
// unticked list holds.
export const refOf = (job: Pick<PriceEntry, 'jobTypeId' | 'name'>): string =>
  job.jobTypeId ?? job.name ?? '';

const STEP_PATH = /^steps\.([1-6])(\.|$)/;

export function stepOf(field: string): ListingStep {
  const match = STEP_PATH.exec(field);
  if (match) return Number(match[1]) as ListingStep;
  if (field === 'email') return 1;
  if (field === 'files') return 5;
  if (field === 'declaration' || field.startsWith('documents.')) return 6;
  throw new RangeError(`${field} is not a field of the listing`);
}

const trimmed = (value: string | undefined) => value?.trim().length ?? 0;
const within = (length: number, min: number, max: number) =>
  length >= min && length <= max;

class Judgement {
  readonly errors: FieldProblem[] = [];
  readonly warnings: FieldProblem[] = [];

  error(field: string, code: string) {
    this.errors.push({ code, field });
  }

  warn(field: string, code: string) {
    this.warnings.push({ code, field });
  }

  // Missing when blank; else wrong when it fails its rule.
  text(field: string, value: string | undefined, valid: boolean) {
    if (!trimmed(value)) this.error(field, 'required');
    else if (!valid) this.error(field, 'invalid');
  }
}

function details(j: Judgement, section: DetailsSection, email?: string) {
  if (email !== undefined) {
    const address = email.trim();
    j.text(
      'email',
      email,
      within(address.length, EMAIL_MIN, EMAIL_MAX) &&
        EMAIL_PATTERN.test(address),
    );
  }
  const name = trimmed(section.name);
  j.text('steps.1.name', section.name, within(name, NAME_MIN, NAME_MAX));
  const phone = section.phone ? normalisePhone(section.phone) : null;
  j.text('steps.1.phone', section.phone, !!phone && isRomanianPhone(phone));
  j.text(
    'steps.1.knownFor',
    section.knownFor,
    trimmed(section.knownFor) <= KNOWN_FOR_MAX,
  );
  const kind = section.businessKind;
  if (kind === undefined) j.error('steps.1.businessKind', 'required');
  const form = section.mobileLegalForm;
  if (kind === 'mobile' && form === undefined)
    j.error('steps.1.mobileLegalForm', 'required');
  if (kind !== undefined && kind !== 'mobile' && form !== undefined)
    j.error('steps.1.mobileLegalForm', 'invalid');
}

function brands(j: Judgement, section: BrandsSection, jobs: PriceEntry[]) {
  const list = section.brands ?? [];
  if (!list.some((brand) => brand.stance === 'works_on'))
    j.error('steps.2.brands', 'required');
  const refs = new Set(jobs.map(refOf));
  list.forEach((brand, n) => {
    if (brand.stance !== 'works_on') return;
    const noFuel = brand.fuels !== undefined && brand.fuels.length === 0;
    const off = new Set(brand.unticked ?? []);
    const noJob = refs.size > 0 && [...refs].every((ref) => off.has(ref));
    if (noFuel || noJob) j.warn(`steps.2.brands[${n}]`, 'no_requests');
  });
}

function range(j: Judgement, path: string, ends: PriceEnds) {
  const { fromBani, toBani } = ends;
  if (fromBani === undefined) j.error(`${path}.from`, 'required');
  if (toBani === undefined) j.error(`${path}.to`, 'required');
  if (fromBani === undefined) return;
  const check = checkPriceRange({ fromBani, toBani });
  for (const { code, field } of check.errors) j.error(`${path}.${field}`, code);
  for (const { code, field } of check.warnings)
    j.warn(`${path}.${field}`, code);
}

function prices(j: Judgement, labour: PriceEnds, jobs: PriceEntry[]) {
  range(j, 'steps.3.labour', labour);
  if (!jobs.some((entry) => entry.brandId === undefined))
    j.error('steps.3.jobs', 'required');
  jobs.forEach((entry, n) => {
    const path = `steps.3.jobs[${n}]`;
    range(j, path, entry);
    if (
      entry.name !== undefined &&
      !within(trimmed(entry.name), JOB_NAME_MIN, JOB_NAME_MAX)
    )
      j.error(`${path}.name`, 'invalid');
  });
}

function mechanics(j: Judgement, section: Steps['4']) {
  (section?.mechanics ?? []).forEach((card, n) => {
    if (!within(trimmed(card.name), MECHANIC_NAME_MIN, MECHANIC_NAME_MAX))
      j.error(`steps.4.mechanics[${n}].name`, 'invalid');
  });
}

function place(j: Judgement, section: PlaceSection, mobile: boolean) {
  const { address, lat, lng, radiusKm } = section;
  if (!trimmed(address)) j.error('steps.5.place.address', 'required');
  if (lat === undefined || lng === undefined)
    j.error('steps.5.place.lat', 'required');
  else if (!inRomania(lat, lng)) j.error('steps.5.place.lat', 'invalid');
  if (!mobile) return;
  if (radiusKm === undefined) j.error('steps.5.place.radiusKm', 'required');
  else if (!radiusAllowed(radiusKm))
    j.error('steps.5.place.radiusKm', 'invalid');
}

function hours(j: Judgement, section: HoursSection) {
  if (!hasOpenDay(section.hours)) j.error('steps.5.hours', 'required');
  if (!section.payments?.length) j.error('steps.5.payments', 'required');
  if (!needsCourtesyPrice(section)) return;
  const price = section.courtesyCar?.pricePerDayBani;
  const field = 'steps.5.courtesyCar.pricePerDayBani';
  if (price === undefined) j.error(field, 'required');
  else if (!isCourtesyPrice(price)) j.error(field, 'invalid');
}

function verification(j: Judgement, data: ListingDraftData) {
  const { cui, rarNumber } = data.steps?.['6'] ?? {};
  j.text('steps.6.cui', cui, isValidCui(cui ?? ''));
  j.text(
    'steps.6.rarNumber',
    rarNumber,
    (rarNumber ?? '').length >= RAR_NUMBER_MIN,
  );
  for (const kind of DOCUMENT_KINDS)
    if (!documentDone(data, kind))
      j.warn(`documents.${kind}`, 'document_missing');
  if (!data.declaredAt) j.error('declaration', 'required');
  else if (
    !within(trimmed(data.declaredByName), DECLARED_NAME_MIN, DECLARED_NAME_MAX)
  )
    j.error('declaration', 'invalid');
}

// Errors in step order, one at most per field; warnings beside them.
export function checkListing({ data, email }: ListingCheckInput): ListingCheck {
  const j = new Judgement();
  const steps = data.steps ?? {};
  const one = steps['1'] ?? {};
  const jobs = steps['3']?.jobs ?? [];
  details(j, one, email);
  brands(j, steps['2'] ?? {}, jobs);
  prices(j, steps['3']?.labour ?? {}, jobs);
  mechanics(j, steps['4']);
  if (!hasConfirmedPhoto(data)) j.error('files', 'required');
  const five = steps['5'] ?? {};
  place(j, five.place ?? {}, one.businessKind === 'mobile');
  hours(j, five);
  verification(j, data);
  return { errors: j.errors, warnings: j.warnings };
}
