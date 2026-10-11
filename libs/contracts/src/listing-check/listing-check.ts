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
  BUSINESS_KINDS,
  type DetailsSection,
  isRomanianPhone,
  JOB_NAME_MAX,
  JOB_NAME_MIN,
  KNOWN_FOR_MAX,
  type ListingDraftData,
  MECHANIC_NAME_MAX,
  MECHANIC_NAME_MIN,
  MOBILE_LEGAL_FORMS,
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

interface ListingCheckInput {
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

// The step a field belongs to, or null for a path no step holds (a reply
// from a server that knows a field this page does not).
export function stepOf(field: string): ListingStep | null {
  const match = STEP_PATH.exec(field);
  if (match) return Number(match[1]) as ListingStep;
  if (field === 'email') return 1;
  if (field === 'files') return 5;
  if (field === 'declaration' || field.startsWith('documents.')) return 6;
  return null;
}

// A stored draft is read as it is: a section, list or value of the wrong
// shape counts as absent, never as a reason to throw.
const record = <T extends object>(value: unknown): Partial<T> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Partial<T>)
    : {};
const entries = <T extends object>(value: unknown): Partial<T>[] =>
  Array.isArray(value) ? value.map((item) => record<T>(item)) : [];
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const count = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;
const blank = (value: unknown) =>
  value === undefined || value === null || value === '';

const trimmed = (value: unknown) => text(value)?.trim().length ?? 0;
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

function details(
  j: Judgement,
  section: Partial<DetailsSection>,
  email?: string,
) {
  if (email !== undefined) {
    const address = email.trim();
    j.text(
      'email',
      email,
      within(address.length, EMAIL_MIN, EMAIL_MAX) &&
        EMAIL_PATTERN.test(address),
    );
  }
  const name = text(section.name);
  j.text('steps.1.name', name, within(trimmed(name), NAME_MIN, NAME_MAX));
  const typed = text(section.phone);
  const phone = typed ? normalisePhone(typed) : null;
  j.text('steps.1.phone', typed, !!phone && isRomanianPhone(phone));
  const knownFor = text(section.knownFor);
  j.text('steps.1.knownFor', knownFor, trimmed(knownFor) <= KNOWN_FOR_MAX);
  kindAndForm(j, section);
}

// The kind of business, and the legal form only a mobile mechanic gives.
function kindAndForm(j: Judgement, section: Partial<DetailsSection>) {
  const kind: unknown = section.businessKind;
  const known = (BUSINESS_KINDS as readonly unknown[]).includes(kind);
  if (blank(kind)) j.error('steps.1.businessKind', 'required');
  else if (!known) j.error('steps.1.businessKind', 'invalid');
  const form: unknown = section.mobileLegalForm;
  const field = 'steps.1.mobileLegalForm';
  if (kind === 'mobile') {
    if (blank(form)) j.error(field, 'required');
    else if (!(MOBILE_LEGAL_FORMS as readonly unknown[]).includes(form))
      j.error(field, 'invalid');
  } else if (known && !blank(form)) j.error(field, 'invalid');
}

type Brand = NonNullable<BrandsSection['brands']>[number];

function brands(
  j: Judgement,
  section: Partial<BrandsSection>,
  jobs: Partial<PriceEntry>[],
) {
  const list = entries<Brand>(section.brands);
  if (!list.some((brand) => brand.stance === 'works_on'))
    j.error('steps.2.brands', 'required');
  const refs = new Set(jobs.map(refOf));
  list.forEach((brand, n) => {
    if (brand.stance !== 'works_on') return;
    const noFuel = Array.isArray(brand.fuels) && brand.fuels.length === 0;
    const off = new Set(Array.isArray(brand.unticked) ? brand.unticked : []);
    const noJob = refs.size > 0 && [...refs].every((ref) => off.has(ref));
    if (noFuel || noJob) j.warn(`steps.2.brands[${n}]`, 'no_requests');
  });
}

function range(j: Judgement, path: string, ends: Partial<PriceEnds>) {
  const fromBani = count(ends.fromBani);
  const toBani = count(ends.toBani);
  if (fromBani === undefined) j.error(`${path}.from`, 'required');
  if (toBani === undefined) j.error(`${path}.to`, 'required');
  if (fromBani === undefined) return;
  const check = checkPriceRange({ fromBani, toBani });
  for (const { code, field } of check.errors) j.error(`${path}.${field}`, code);
  for (const { code, field } of check.warnings)
    j.warn(`${path}.${field}`, code);
}

function prices(
  j: Judgement,
  labour: Partial<PriceEnds>,
  jobs: Partial<PriceEntry>[],
) {
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

type Mechanic = NonNullable<NonNullable<Steps['4']>['mechanics']>[number];

function mechanics(j: Judgement, section: Partial<NonNullable<Steps['4']>>) {
  entries<Mechanic>(section.mechanics).forEach((card, n) => {
    if (!within(trimmed(card.name), MECHANIC_NAME_MIN, MECHANIC_NAME_MAX))
      j.error(`steps.4.mechanics[${n}].name`, 'invalid');
  });
}

function place(j: Judgement, section: Partial<PlaceSection>, mobile: boolean) {
  const { address, lat, lng, radiusKm } = section;
  if (!trimmed(address)) j.error('steps.5.place.address', 'required');
  if (blank(lat) || blank(lng)) j.error('steps.5.place.lat', 'required');
  else if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !inRomania(lat, lng)
  )
    j.error('steps.5.place.lat', 'invalid');
  if (!mobile) return;
  // An absent radius is the default the field shows.
  if (
    radiusKm !== undefined &&
    (typeof radiusKm !== 'number' || !radiusAllowed(radiusKm))
  )
    j.error('steps.5.place.radiusKm', 'invalid');
}

function hours(j: Judgement, section: HoursSection) {
  if (!hasOpenDay(section.hours)) j.error('steps.5.hours', 'required');
  if (!(Array.isArray(section.payments) && section.payments.length))
    j.error('steps.5.payments', 'required');
  if (!needsCourtesyPrice(section)) return;
  const price = record<{ pricePerDayBani: number }>(
    section.courtesyCar,
  ).pricePerDayBani;
  const field = 'steps.5.courtesyCar.pricePerDayBani';
  if (price === undefined) j.error(field, 'required');
  else if (!isCourtesyPrice(price)) j.error(field, 'invalid');
}

function verification(j: Judgement, data: ListingDraftData) {
  const six = record<{ cui: string; rarNumber: string }>(data.steps?.['6']);
  const cui = text(six.cui);
  const rarNumber = text(six.rarNumber);
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
  const draft = record<ListingDraftData>(data);
  const steps = record<Steps>(draft.steps);
  const one = record<DetailsSection>(steps['1']);
  const three = record<NonNullable<Steps['3']>>(steps['3']);
  const jobs = entries<PriceEntry>(three.jobs);
  details(j, one, email);
  brands(j, record<BrandsSection>(steps['2']), jobs);
  prices(j, record<PriceEnds>(three.labour), jobs);
  mechanics(j, record<NonNullable<Steps['4']>>(steps['4']));
  if (!hasConfirmedPhoto(draft)) j.error('files', 'required');
  const five = record<HoursSection & { place: PlaceSection }>(steps['5']);
  place(j, record<PlaceSection>(five.place), one.businessKind === 'mobile');
  hours(j, five);
  verification(j, { ...draft, steps });
  return { errors: j.errors, warnings: j.warnings };
}
